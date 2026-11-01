-- Один банковский платёж — несколько заданий/актов. Применить в SQL Editor.
begin;
alter table public.payments add column if not exists revision bigint not null default 0;
create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  matter_id uuid not null references public.matters(id) on delete restrict,
  act_id uuid references public.acts(id) on delete restrict,
  fee_amount numeric(12,2) not null default 0 check (fee_amount >= 0),
  expense_amount numeric(12,2) not null default 0 check (expense_amount >= 0),
  amount numeric(12,2) generated always as (fee_amount + expense_amount) stored,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (fee_amount + expense_amount > 0)
);
create index if not exists payment_allocations_payment_idx on public.payment_allocations(payment_id);
create index if not exists payment_allocations_matter_idx on public.payment_allocations(matter_id);
create index if not exists payment_allocations_act_idx on public.payment_allocations(act_id);
alter table public.payment_allocations enable row level security;
drop policy if exists allocations_read on public.payment_allocations;
create policy allocations_read on public.payment_allocations for select using (auth.role() = 'authenticated');
revoke all on public.payment_allocations from anon, authenticated;
grant select on public.payment_allocations to authenticated;
grant all on public.payment_allocations to service_role;

create table if not exists public.financial_operations (
  id uuid primary key,
  kind text not null,
  payload jsonb not null,
  result_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.financial_operations enable row level security;
revoke all on public.financial_operations from anon, authenticated;
grant all on public.financial_operations to service_role;

create or replace function public.require_finance_user() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and
     not exists (select 1 from public.profiles where id = auth.uid() and role = 'advocate') then
    raise exception 'Нет права изменять финансовые записи' using errcode = '42501';
  end if;
end $$;

create or replace function public.guard_allocated_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from payment_allocations where payment_id = old.id) then
    if new.client_id <> old.client_id or new.matter_id is not null then
      raise exception 'У платежа есть распределение: доверителя и одно дело менять нельзя';
    end if;
    if new.amount < (select sum(amount) from payment_allocations where payment_id = old.id) then
      raise exception 'Сумма платежа меньше распределённой суммы';
    end if;
  end if;
  new.revision := old.revision + 1;
  return new;
end $$;
drop trigger if exists guard_allocated_payment on public.payments;
create trigger guard_allocated_payment before update on public.payments
for each row execute function public.guard_allocated_payment();

create or replace function public.save_payment_allocations(
  p_payment_id uuid, p_rows jsonb, p_expected_revision bigint, p_operation_id uuid
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p payments%rowtype; item jsonb; total numeric := 0; fee numeric; exp numeric;
  mid uuid; aid uuid; previous financial_operations%rowtype; previous_summary text; next_summary text;
  payload jsonb := jsonb_build_object('payment_id', p_payment_id, 'rows', p_rows);
begin
  perform require_finance_user();
  perform pg_advisory_xact_lock(hashtext('timelog-finance'));
  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'Платёж не найден'; end if;
  select * into previous from financial_operations where id = p_operation_id;
  if found then
    if previous.kind <> 'allocation' or previous.payload <> payload then raise exception 'Идентификатор операции уже использован'; end if;
    return p.revision;
  end if;
  if p.revision is distinct from p_expected_revision then raise exception 'Платёж изменён в другой вкладке. Откройте его заново'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'Некорректное распределение'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    mid := (item->>'matter_id')::uuid; aid := nullif(item->>'act_id', '')::uuid;
    fee := coalesce((item->>'fee_amount')::numeric, 0); exp := coalesce((item->>'expense_amount')::numeric, 0);
    if fee::text in ('NaN','Infinity','-Infinity') or exp::text in ('NaN','Infinity','-Infinity') or fee < 0 or exp < 0 or fee + exp <= 0 or fee <> round(fee,2) or exp <> round(exp,2) then raise exception 'Укажите положительные суммы с точностью до копейки'; end if;
    if not exists(select 1 from matters where id = mid and client_id = p.client_id) then raise exception 'Задание принадлежит другому доверителю'; end if;
    if aid is not null and not exists(select 1 from acts where id = aid and matter_id = mid and client_id = p.client_id) then raise exception 'Акт не относится к выбранному заданию'; end if;
    total := total + fee + exp;
  end loop;
  if total > p.amount then raise exception 'Распределение превышает сумму платежа'; end if;
  -- Компенсации уже связаны с исходным платежом: не считать их доходом второй раз.
  if jsonb_array_length(p_rows)>0 and exists (
    select 1 from (
      select matter_id, sum(amount) expected from reimbursable_expenses where payment_id = p.id group by matter_id
    ) e full join (
      select (x->>'matter_id')::uuid matter_id, sum(coalesce((x->>'expense_amount')::numeric,0)) actual
      from jsonb_array_elements(p_rows) x group by 1
    ) a using (matter_id) where coalesce(expected,0) <> coalesce(actual,0)
  ) then raise exception 'Возмещения в распределении должны совпадать с отмеченными расходами платежа'; end if;
  select string_agg(m.title||': вознаграждение '||a.fee_amount::text||' ₽, возмещение '||a.expense_amount::text||' ₽', '; ' order by a.id::text)
    into previous_summary from effective_payment_allocations a join matters m on m.id=a.matter_id where payment_id=p.id;
  delete from payment_allocations where payment_id = p.id;
  insert into payment_allocations(payment_id,matter_id,act_id,fee_amount,expense_amount,created_by)
    select p.id,(x->>'matter_id')::uuid,nullif(x->>'act_id','')::uuid,
           coalesce((x->>'fee_amount')::numeric,0),coalesce((x->>'expense_amount')::numeric,0),auth.uid()
    from jsonb_array_elements(p_rows) x;
  -- Обновить ревизию даже при пустом распределении; старое одно дело не дублируется.
  update payments set matter_id = null where id = p.id returning revision into p.revision;
  select string_agg(m.title||': вознаграждение '||a.fee_amount::text||' ₽, возмещение '||a.expense_amount::text||' ₽', '; ' order by a.id::text)
    into next_summary from effective_payment_allocations a join matters m on m.id=a.matter_id where payment_id=p.id;
  insert into audit_log(table_name,row_id,action,old_data,new_data,changed_by)
    values('payments',p.id,'update',jsonb_build_object('allocation_summary',coalesce(previous_summary,'Без распределения')),
      jsonb_build_object('allocation_summary',coalesce(next_summary,'Без распределения')),auth.uid());
  insert into financial_operations(id,kind,payload,result_id,created_by) values(p_operation_id,'allocation',payload,p.id,auth.uid());
  return p.revision;
end $$;

create or replace function public.save_payment(
 p_payment jsonb, p_reimbursement_ids uuid[], p_expected_revision bigint, p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid := (p_payment->>'id')::uuid; cid uuid := (p_payment->>'client_id')::uuid;
  existing payments%rowtype; previous financial_operations%rowtype;
  amount_value numeric := (p_payment->>'amount')::numeric;
  mid uuid := nullif(p_payment->>'matter_id','')::uuid;
  payload jsonb := jsonb_build_object('payment',p_payment,'expenses',to_jsonb(p_reimbursement_ids));
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 select * into previous from financial_operations where id=p_operation_id;
 if found then
   if previous.kind <> 'payment' or previous.payload <> payload then raise exception 'Идентификатор операции уже использован'; end if;
   return previous.result_id;
 end if;
 if amount_value is null or amount_value::text in ('NaN','Infinity','-Infinity') or amount_value <= 0 or amount_value <> round(amount_value,2) then raise exception 'Некорректная сумма платежа'; end if;
 if mid is not null and not exists(select 1 from matters where id=mid and client_id=cid) then raise exception 'Дело другого доверителя'; end if;
 select * into existing from payments where id=pid for update;
 if found then
   if existing.revision is distinct from p_expected_revision or existing.client_id <> cid then raise exception 'Платёж изменён. Откройте его заново'; end if;
   update payments set pay_date=(p_payment->>'pay_date')::date, amount=amount_value,
     matter_id=mid, description=coalesce(p_payment->>'description',''),doc_no=nullif(p_payment->>'doc_no','') where id=pid;
 else
   if p_expected_revision is not null then raise exception 'Редактируемый платёж не найден'; end if;
   insert into payments(id,client_id,matter_id,pay_date,amount,description,doc_no,created_by)
   values(pid,cid,mid,(p_payment->>'pay_date')::date,amount_value,coalesce(p_payment->>'description',''),nullif(p_payment->>'doc_no',''),auth.uid());
 end if;
 if exists(select 1 from unnest(coalesce(p_reimbursement_ids,'{}')) rid
   left join reimbursable_expenses e on e.id=rid left join matters m on m.id=e.matter_id
   where e.id is null or m.client_id <> cid or (e.payment_id is not null and e.payment_id <> pid)) then
   raise exception 'Расход отсутствует, относится к другому доверителю или уже компенсирован другим платежом';
 end if;
 if (select coalesce(sum(amount),0) from reimbursable_expenses where id=any(coalesce(p_reimbursement_ids,'{}'))) > amount_value then
   raise exception 'Возмещение превышает платёж';
 end if;
 update reimbursable_expenses set payment_id=null,reimbursed_date=null,status='invoiced'
 where payment_id=pid and not(id=any(coalesce(p_reimbursement_ids,'{}')));
 update reimbursable_expenses set payment_id=pid,reimbursed_date=(p_payment->>'pay_date')::date,status='reimbursed'
 where id=any(coalesce(p_reimbursement_ids,'{}'));
 if exists(select 1 from payment_allocations where payment_id=pid) and exists(
   select 1 from (select matter_id,sum(expense_amount) a from payment_allocations where payment_id=pid group by 1) a
   full join (select matter_id,sum(amount) b from reimbursable_expenses where payment_id=pid group by 1) b using(matter_id)
   where coalesce(a,0)<>coalesce(b,0)) then
   raise exception 'Для изменения состава возмещений сначала снимите распределение, затем измените платёж и распределите его заново';
 end if;
 insert into financial_operations(id,kind,payload,result_id,created_by) values(p_operation_id,'payment',payload,pid,auth.uid());
 return pid;
end $$;

create or replace function public.delete_payment(p_id uuid, p_expected_revision bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 perform 1 from payments where id=p_id and revision=p_expected_revision for update;
 if not found then raise exception 'Платёж изменён или удалён. Обновите список'; end if;
 update reimbursable_expenses set payment_id=null,reimbursed_date=null,status='invoiced' where payment_id=p_id;
 delete from payments where id=p_id;
end $$;

create or replace view public.effective_payment_allocations with (security_invoker=true) as
 select a.id,a.payment_id,p.client_id,a.matter_id,a.act_id,p.pay_date,
        a.fee_amount,a.expense_amount,a.amount,p.doc_no,p.description
 from payment_allocations a join payments p on p.id=a.payment_id
 union all
 select p.id,p.id,p.client_id,p.matter_id,null::uuid,p.pay_date,
        p.amount-coalesce(e.amount,0),coalesce(e.amount,0),p.amount,p.doc_no,p.description
 from payments p left join lateral(select sum(amount) amount from reimbursable_expenses where payment_id=p.id) e on true
 where p.matter_id is not null and not exists(select 1 from payment_allocations a where a.payment_id=p.id);

create or replace view public.billing_events with (security_invoker=true) as
 select 'time:'||t.id::text id,m.client_id,t.matter_id,t.work_date event_date,'work'::text kind,
        t.amount::numeric amount,t.description title,'time_entries'::text source,t.id source_id
 from time_entries t join matters m on m.id=t.matter_id
 where t.is_billable and not(coalesce(m.monthly_fee,0)>0 and m.fee_from is not null)
 union all
 select 'sub:'||m.id::text||':'||to_char(d,'YYYY-MM'),m.client_id,m.id,
        (d+interval '1 month - 1 day')::date,'subscription',m.monthly_fee::numeric,
        'Абонентская плата за '||to_char(d,'MM.YYYY'),'matters',m.id
 from matters m cross join lateral generate_series(date_trunc('month',m.fee_from::date),
     least(coalesce(m.fee_to::date,current_date),current_date),interval '1 month') d
 where coalesce(m.monthly_fee,0)>0 and m.fee_from is not null
 union all
 select 'accrual:'||a.id::text,m.client_id,a.matter_id,a.accrual_date,
        case when a.amount<0 then 'reduction' else 'accrual' end,a.amount,a.description,'matter_accruals',a.id
 from matter_accruals a join matters m on m.id=a.matter_id
 union all
 select 'expense:'||e.id::text,m.client_id,e.matter_id,e.expense_date,'expense',e.amount,e.description,'reimbursable_expenses',e.id
 from reimbursable_expenses e join matters m on m.id=e.matter_id where e.status in ('invoiced','reimbursed')
 union all
 select 'payment:'||a.id::text,a.client_id,a.matter_id,a.pay_date,'payment',-a.amount,
        coalesce('Оплата №'||a.doc_no,'Оплата')||' — '||a.description,'payments',a.payment_id
 from effective_payment_allocations a
 union all
 select 'unallocated:'||p.id::text,p.client_id,null::uuid,p.pay_date,'unallocated',-(p.amount-coalesce(a.amount,0)),
        coalesce('Оплата №'||p.doc_no,'Оплата')||' — не распределено','payments',p.id
 from payments p left join lateral(select sum(amount) amount from effective_payment_allocations where payment_id=p.id) a on true
 where p.amount>coalesce(a.amount,0);

grant select on public.effective_payment_allocations,public.billing_events to authenticated;
revoke all on public.effective_payment_allocations,public.billing_events from anon;
drop trigger if exists audit_payment_allocations on public.payment_allocations;
create trigger audit_payment_allocations after insert or update or delete on public.payment_allocations
for each row execute function public.log_change();
revoke all on function public.require_finance_user() from public, anon;
revoke all on function public.save_payment_allocations(uuid,jsonb,bigint,uuid),public.save_payment(jsonb,uuid[],bigint,uuid),public.delete_payment(uuid,bigint) from public,anon;
grant execute on function public.save_payment_allocations(uuid,jsonb,bigint,uuid),public.save_payment(jsonb,uuid[],bigint,uuid),public.delete_payment(uuid,bigint) to authenticated,service_role;
commit;
