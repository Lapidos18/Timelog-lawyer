begin;
alter table acts add column if not exists expense_rows jsonb;
do $$ begin
 if exists(select 1 from acts where status in ('signed','paid') and not is_void and coalesce(expenses_amount,0)>0 and expense_rows is null) then
  raise exception 'Есть выпущенные акты без расшифровки расходов. Перед обновлением сопоставьте расходы этих документов';
 end if;
end $$;
create table if not exists public.document_source_claims(
 id text primary key,act_id uuid not null references acts(id) on delete restrict deferrable initially deferred
);
alter table document_source_claims enable row level security;
drop policy if exists document_sources_read on document_source_claims;
create policy document_sources_read on document_source_claims for select using(auth.role()='authenticated');
revoke all on document_source_claims from anon,authenticated;grant select on document_source_claims to authenticated;grant all on document_source_claims to service_role;
create or replace function public.act_accrual_preview(p_matter_id uuid,p_from date,p_to date,p_act_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare fee_rows jsonb;exp_rows jsonb;
begin
 perform require_finance_user();
 if p_from is null or p_to is null or p_to<p_from then raise exception 'Проверьте период';end if;
 if p_act_id is not null and not exists(select 1 from acts where id=p_act_id and matter_id=p_matter_id and status='draft' and not is_void) then raise exception 'Черновик не найден';end if;
 select coalesce(jsonb_agg(source_row order by event_day,source_key),'[]') into fee_rows from (
  select t.work_date event_day,'time:'||t.id source_key,jsonb_build_object('id',t.id,'work_date',t.work_date,'activity_type',t.activity_type,'description',t.description,
   'hours',round(t.duration_min::numeric/60,2),'hourly_rate',t.hourly_rate,'amount',t.amount,'performed_by',coalesce(p.full_name,'')) source_row
  from time_entries t join matters m on m.id=t.matter_id left join profiles p on p.id=t.user_id
  where t.matter_id=p_matter_id and t.work_date between p_from and p_to and t.is_billable
   and not(coalesce(m.monthly_fee,0)>0 and m.fee_from is not null)
   and not exists(select 1 from act_entry_claims c where c.entry_id=t.id and c.act_id is distinct from p_act_id)
  union all
  select b.event_date,b.id,jsonb_build_object('id',b.id,'work_date',b.event_date,'activity_type','other','description',b.title,
   'hours',0,'hourly_rate',0,'amount',b.amount,'performed_by','','source_kind',b.kind)
  from billing_events b where b.matter_id=p_matter_id and b.event_date between p_from and p_to and b.kind in ('subscription','accrual','reduction')
   and not exists(select 1 from document_source_claims c where c.id=b.id and c.act_id is distinct from p_act_id)
 ) sources;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'amount',e.amount,'date',e.expense_date,'description',e.description) order by e.expense_date,e.id),'[]') into exp_rows
 from reimbursable_expenses e where e.matter_id=p_matter_id and e.expense_date between p_from and p_to and e.status in ('pending','invoiced','reimbursed')
 and not exists(select 1 from document_source_claims c where c.id='expense:'||e.id and c.act_id is distinct from p_act_id);
 return jsonb_build_object('rows',fee_rows,'expenses',exp_rows);
end $$;
revoke all on function act_accrual_preview(uuid,date,date,uuid) from public,anon;
grant execute on function act_accrual_preview(uuid,date,date,uuid) to authenticated,service_role;

create or replace function public.guard_document_source_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare source_id text;locked boolean;
begin
 if tg_table_name='matter_accruals' then source_id:='accrual:'||old.id;
 elsif tg_table_name='reimbursable_expenses' then
  if tg_op='UPDATE' and (new.matter_id,new.expense_date,new.amount,new.description) is not distinct from (old.matter_id,old.expense_date,old.amount,old.description) then return new;end if;
  source_id:='expense:'||old.id;
 else
  if tg_op='UPDATE' and (new.monthly_fee,new.fee_from,new.fee_to) is not distinct from (old.monthly_fee,old.fee_from,old.fee_to) then return new;end if;
  select exists(select 1 from document_source_claims where id like 'sub:'||old.id::text||':%') into locked;
 end if;
 if coalesce(locked,false) or exists(select 1 from document_source_claims where id=source_id) then raise exception 'Начисление включено в выпущенный акт. Сначала создайте исправление документа';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_accrual_document on matter_accruals;
create trigger guard_accrual_document before update or delete on matter_accruals for each row execute function guard_document_source_change();
drop trigger if exists guard_expense_document on reimbursable_expenses;
create trigger guard_expense_document before update or delete on reimbursable_expenses for each row execute function guard_document_source_change();
drop trigger if exists guard_subscription_document on matters;
create trigger guard_subscription_document before update or delete on matters for each row execute function guard_document_source_change();

create or replace function public.guard_act_document() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; total numeric; expense_total numeric;
begin
 perform pg_advisory_xact_lock(hashtext('timelog-finance'));
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
   if new.expense_rows is null then raise exception 'Пересоберите черновик из начислений перед выпуском';end if;
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
       if not exists(select 1 from billing_events b where b.id=r->>'id' and b.matter_id=new.matter_id
          and b.kind in ('subscription','accrual','reduction') and b.kind=r->>'source_kind' and b.event_date between new.period_from and new.period_to
          and b.event_date=(r->>'work_date')::date and b.amount=(r->>'amount')::numeric
          and b.title=r->>'description' and coalesce((r->>'hours')::numeric,0)=0 and coalesce((r->>'hourly_rate')::numeric,0)=0) then
         raise exception 'Начисление изменилось или не относится к документу. Пересоберите черновик';
       end if;
       if exists(select 1 from document_source_claims where id=r->>'id' and act_id<>new.id) then raise exception 'Начисление уже выставлено в другом акте';end if;
       insert into document_source_claims(id,act_id)values(r->>'id',new.id) on conflict do nothing;
     end if;
   end loop;
   if new.expense_rows is not null then
    select coalesce(sum((x->>'amount')::numeric),0) into expense_total from jsonb_array_elements(new.expense_rows) x;
    if expense_total<>coalesce(new.expenses_amount,0) then raise exception 'Сумма возмещения не совпадает с расходами';end if;
    if exists(select 1 from jsonb_array_elements(new.expense_rows) x group by x->>'id' having count(*)>1) then raise exception 'Повтор расхода';end if;
    for r in select value from jsonb_array_elements(new.expense_rows) loop
     if not exists(select 1 from reimbursable_expenses where id::text=r->>'id' and matter_id=new.matter_id
      and expense_date between new.period_from and new.period_to and amount=(r->>'amount')::numeric
      and expense_date=(r->>'date')::date and description=r->>'description' and status in ('pending','invoiced','reimbursed')) then raise exception 'Расход изменился. Пересоберите черновик';end if;
     if exists(select 1 from document_source_claims where id='expense:'||(r->>'id') and act_id<>new.id) then raise exception 'Расход уже включён в другой акт';end if;
     insert into document_source_claims(id,act_id)values('expense:'||(r->>'id'),new.id) on conflict do nothing;
     update reimbursable_expenses set status='invoiced' where id::text=r->>'id' and status='pending';
    end loop;
   end if;
   new.issued_at:=now();
   new.document_fingerprint:=md5(new.document_snapshot::text||new.document_html||new.document_css||new.document_word);
 end if;
 if new.is_void then delete from act_entry_claims where act_id=new.id; delete from document_source_claims where act_id=new.id; end if;
 return new;
end $$;

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
 insert into acts(id,act_no,client_id,matter_id,period_from,period_to,amount,description,status,rows,expenses_amount,created_by,document_revision,supersedes_id,expense_rows)
 values(nid,a.act_no||'-И'||(a.document_revision+1),a.client_id,a.matter_id,a.period_from,a.period_to,a.amount,
        p_reason,'draft',a.rows,a.expenses_amount,auth.uid(),a.document_revision+1,a.id,a.expense_rows);
 update payment_allocations set act_id=nid where act_id=a.id;
 insert into financial_operations(id,kind,payload,result_id,created_by) values(p_operation_id,'act_revision',payload,nid,auth.uid());
 return nid;
end $$;


commit;
