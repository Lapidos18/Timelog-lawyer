-- Неизменные выпущенные акты, версии исправлений и защита от двойного выставления.
begin;
alter table public.acts add column if not exists document_snapshot jsonb;
alter table public.acts add column if not exists document_html text;
alter table public.acts add column if not exists document_css text;
alter table public.acts add column if not exists document_word text;
alter table public.acts add column if not exists document_fingerprint text;
alter table public.acts add column if not exists issued_at timestamptz;
alter table public.acts add column if not exists document_revision integer not null default 1;
alter table public.acts add column if not exists supersedes_id uuid references public.acts(id) on delete restrict;
alter table public.acts add column if not exists is_void boolean not null default false;
alter table public.acts add column if not exists void_reason text;
alter table public.acts add column if not exists externally_paid boolean not null default false;
create table if not exists public.act_entry_claims (
 entry_id uuid primary key references public.time_entries(id) on delete restrict,
 act_id uuid not null references public.acts(id) on delete restrict
);
alter table public.act_entry_claims enable row level security;
drop policy if exists act_claims_read on public.act_entry_claims;
create policy act_claims_read on public.act_entry_claims for select using(auth.role()='authenticated');
revoke all on public.act_entry_claims from anon,authenticated;
grant select on public.act_entry_claims to authenticated;
grant all on public.act_entry_claims to service_role;
-- Не присваивать спорную строку одному из нескольких документов молча.
do $$ begin
 if exists(select 1 from acts a cross join lateral jsonb_array_elements(coalesce(a.rows,'[]')) r
 where a.status in ('signed','paid') and not a.is_void group by r->>'id' having count(*)>1) then
 raise exception 'Обнаружено повторное выставление работ в подписанных актах: сначала разберите документы'; end if;
end $$;
insert into act_entry_claims(entry_id,act_id)
 select (r->>'id')::uuid,a.id from acts a cross join lateral jsonb_array_elements(coalesce(a.rows,'[]')) r
 join time_entries t on t.id::text=r->>'id' where a.status in ('signed','paid') and not a.is_void
 on conflict(entry_id) do nothing;

create or replace function public.guard_act_document() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; total numeric;
begin
 if tg_op='DELETE' then
   if old.status in ('signed','paid') or old.issued_at is not null then raise exception 'Выпущенный акт нельзя удалить. Создайте исправление'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and old.is_void then raise exception 'Исходная версия исправленного акта неизменна'; end if;
 if tg_op='UPDATE' and (old.issued_at is not null or old.status in ('signed','paid')) then
   if new.status='draft' then raise exception 'Выпущенный акт нельзя вернуть в черновик. Создайте исправление'; end if;
   if (to_jsonb(new)-array['status','is_void','void_reason','externally_paid']) is distinct from
      (to_jsonb(old)-array['status','is_void','void_reason','externally_paid']) then
     raise exception 'Содержание выпущенного акта неизменно. Создайте исправление';
   end if;
   if new.is_void and nullif(btrim(new.void_reason),'') is null then raise exception 'Укажите причину исправления'; end if;
 end if;
 if new.status in ('signed','paid') and not new.is_void and (tg_op='INSERT' or old.issued_at is null) then
   if new.document_snapshot is null or new.document_html is null or new.document_css is null or nullif(new.document_word,'') is null then
     raise exception 'Перед выпуском сохраните полную версию документа';
   end if;
   select coalesce(sum((x->>'amount')::numeric),0) into total from jsonb_array_elements(coalesce(new.rows,'[]')) x;
   if total <> new.amount or (new.document_snapshot->>'total')::numeric is distinct from new.amount then
     raise exception 'Сумма документа не совпадает с сохранённым составом';
   end if;
   if exists(select 1 from jsonb_array_elements(coalesce(new.rows,'[]')) x group by x->>'id' having count(*)>1) then
     raise exception 'Одна запись работы повторяется в документе';
   end if;
   for r in select value from jsonb_array_elements(coalesce(new.rows,'[]')) loop
     if exists(select 1 from time_entries where id::text=r->>'id') then
       if not exists(select 1 from time_entries where id::text=r->>'id' and matter_id=new.matter_id
          and is_billable and work_date between new.period_from and new.period_to
          and amount=(r->>'amount')::numeric and hourly_rate=(r->>'hourly_rate')::numeric
          and round(duration_min::numeric/60,2)=(r->>'hours')::numeric) then
         raise exception 'Записи времени изменились. Пересоберите черновик';
       end if;
       if exists(select 1 from act_entry_claims where entry_id::text=r->>'id' and act_id<>new.id) then
         raise exception 'Работа уже включена в другой выпущенный акт';
       end if;
       insert into act_entry_claims(entry_id,act_id) values((r->>'id')::uuid,new.id) on conflict do nothing;
     else
       raise exception 'Запись акта не найдена в журнале';
     end if;
   end loop;
   new.issued_at:=now();
   new.document_fingerprint:=md5(new.document_snapshot::text||new.document_html||new.document_css||new.document_word);
 end if;
 if new.is_void then delete from act_entry_claims where act_id=new.id; end if;
 return new;
end $$;
drop trigger if exists guard_act_document on public.acts;
create trigger guard_act_document before insert or update or delete on public.acts
for each row execute function public.guard_act_document();

create or replace function public.create_act_revision(p_id uuid,p_reason text,p_operation_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare a acts%rowtype; nid uuid:=gen_random_uuid(); previous financial_operations%rowtype;
 payload jsonb:=jsonb_build_object('id',p_id,'reason',p_reason);
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 select * into previous from financial_operations where id=p_operation_id;
 if found then
   if previous.kind<>'act_revision' or previous.payload<>payload then raise exception 'Идентификатор операции уже использован'; end if;
   return previous.result_id;
 end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Укажите причину исправления'; end if;
 select * into a from acts where id=p_id for update;
 if not found or a.is_void or a.status='draft' then raise exception 'Выберите действующий выпущенный акт'; end if;
 update acts set is_void=true,void_reason=p_reason where id=a.id;
 insert into acts(id,act_no,client_id,matter_id,period_from,period_to,amount,description,status,rows,expenses_amount,created_by,document_revision,supersedes_id)
 values(nid,a.act_no||'-И'||(a.document_revision+1),a.client_id,a.matter_id,a.period_from,a.period_to,a.amount,
        p_reason,'draft',a.rows,a.expenses_amount,auth.uid(),a.document_revision+1,a.id);
 update payment_allocations set act_id=nid where act_id=a.id;
 insert into financial_operations(id,kind,payload,result_id,created_by) values(p_operation_id,'act_revision',payload,nid,auth.uid());
 return nid;
end $$;

create or replace view public.act_payment_totals with (security_invoker=true) as
 select a.id act_id,a.amount,coalesce(sum(p.fee_amount),0)::numeric paid_amount,
        greatest(a.amount-coalesce(sum(p.fee_amount),0),0)::numeric remaining,
        greatest(coalesce(sum(p.fee_amount),0)-a.amount,0)::numeric overpayment
 from acts a left join payment_allocations p on p.act_id=a.id group by a.id,a.amount;
revoke all on public.act_payment_totals from anon;
grant select on public.act_payment_totals to authenticated;

create or replace function public.record_act_payment(p_id uuid,p_date date,p_amount numeric,p_doc_no text,p_operation_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a acts%rowtype; pid uuid:=gen_random_uuid(); previous financial_operations%rowtype;
 payload jsonb:=jsonb_build_object('id',p_id,'date',p_date,'amount',p_amount,'doc',p_doc_no);
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 select * into previous from financial_operations where id=p_operation_id;
 if found then
  if previous.kind<>'act_payment' or previous.payload<>payload then raise exception 'Идентификатор операции уже использован'; end if;
  return previous.result_id;
 end if;
 select * into a from acts where id=p_id for update;
 if not found or a.is_void or a.status='draft' then raise exception 'Сначала выпустите акт'; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Некорректная сумма'; end if;
 insert into payments(id,client_id,pay_date,amount,description,doc_no,created_by)
 values(pid,a.client_id,p_date,p_amount,'Оплата по акту № '||a.act_no,nullif(p_doc_no,''),auth.uid());
 insert into payment_allocations(payment_id,matter_id,act_id,fee_amount,created_by) values(pid,a.matter_id,a.id,p_amount,auth.uid());
 update acts set status=case when (select sum(fee_amount) from payment_allocations where act_id=a.id)>=a.amount then 'paid' else 'signed' end where id=a.id;
 insert into financial_operations(id,kind,payload,result_id,created_by) values(p_operation_id,'act_payment',payload,pid,auth.uid());
 return pid;
end $$;

create or replace function public.prevent_locked_entry_change() returns trigger language plpgsql as $$
declare locked_act text;
begin
 select a.act_no into locked_act from public.acts a where a.status in ('signed','paid') and not a.is_void
 and exists(select 1 from jsonb_array_elements(coalesce(a.rows,'[]')) r where r->>'id'=old.id::text) limit 1;
 if locked_act is not null then raise exception 'Запись входит в выпущенный акт %. Создайте исправление документа.',locked_act; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.guard_signed_settlement() returns trigger language plpgsql as $$
begin
 if old.status='signed' then raise exception 'Подписанный акт сверки неизменен. Создайте новый черновик'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_signed_settlement on public.settlement_acts;
create trigger guard_signed_settlement before update or delete on public.settlement_acts
for each row execute function public.guard_signed_settlement();
revoke all on function public.create_act_revision(uuid,text,uuid),public.record_act_payment(uuid,date,numeric,text,uuid) from public,anon;
grant execute on function public.create_act_revision(uuid,text,uuid),public.record_act_payment(uuid,date,numeric,text,uuid) to authenticated,service_role;
commit;
