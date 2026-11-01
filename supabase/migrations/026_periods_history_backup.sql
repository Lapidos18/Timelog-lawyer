-- Закрытие месяца, история времени/ставок и состояние резервирования.
begin;
alter table public.time_entries add column if not exists change_reason text;
create table if not exists public.billing_periods (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references clients(id) on delete restrict,
 period_month date not null check (extract(day from period_month)=1),
 closed boolean not null default true,closed_at timestamptz not null default now(),closed_by uuid references auth.users(id),
 snapshot jsonb not null, note text not null default '',reopen_reason text,
 unique(client_id,period_month)
);
alter table public.billing_periods enable row level security;
drop policy if exists periods_read on public.billing_periods;
create policy periods_read on public.billing_periods for select using(auth.role()='authenticated');
revoke all on public.billing_periods from anon,authenticated;
grant select on public.billing_periods to authenticated;
grant all on public.billing_periods to service_role;

create table if not exists public.backup_runs (
 id uuid primary key default gen_random_uuid(),started_at timestamptz not null default now(),completed_at timestamptz,
 success boolean not null default false,mirror_success boolean not null default false,
 record_count integer,checksum text,source text not null default 'scheduled-local',message text
);
alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_read on public.backup_runs;
create policy backup_runs_read on public.backup_runs for select using(auth.role()='authenticated');
revoke all on public.backup_runs from anon,authenticated;
grant select on public.backup_runs to authenticated;
grant all on public.backup_runs to service_role;

create or replace function public.month_checks(p_client_id uuid,p_month date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare until_date date:=(date_trunc('month',p_month)+interval '1 month')::date; result jsonb;
begin
 perform require_finance_user();
 if p_month<>date_trunc('month',p_month)::date then raise exception 'Укажите начало месяца'; end if;
 select jsonb_build_object(
  'opening',coalesce(sum(amount) filter(where event_date<p_month),0),
  'accrued',coalesce(sum(amount) filter(where event_date>=p_month and amount>0),0),
  'credits',coalesce(-sum(amount) filter(where event_date>=p_month and amount<0),0),
  'balance',coalesce(sum(amount),0)
 ) into result from billing_events where client_id=p_client_id and event_date<until_date;
 return result||jsonb_build_object(
  'unallocated',coalesce((select -sum(amount) from billing_events where client_id=p_client_id and kind='unallocated' and event_date<until_date),0),
  'unbilled', (select count(*) from time_entries t join matters m on m.id=t.matter_id
    where m.client_id=p_client_id and t.work_date>=p_month and t.work_date<until_date and t.is_billable
      and not(coalesce(m.monthly_fee,0)>0 and m.fee_from is not null)
      and not exists(select 1 from act_entry_claims c where c.entry_id=t.id)),
  'drafts',(select count(*) from acts where client_id=p_client_id and not is_void and status='draft' and period_from<until_date and period_to>=p_month),
  'pending_expenses',(select count(*) from reimbursable_expenses e join matters m on m.id=e.matter_id
    where m.client_id=p_client_id and e.expense_date>=p_month and e.expense_date<until_date and e.status='pending')
 );
end $$;

create or replace function public.close_billing_month(p_client_id uuid,p_month date,p_confirmations jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare checks jsonb;
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 if (p_month+interval '1 month')::date>(now() at time zone 'Asia/Novosibirsk')::date then raise exception 'Месяц ещё не завершён'; end if;
 if coalesce(p_confirmations->>'rates','false')<>'true' or coalesce(p_confirmations->>'expenses','false')<>'true'
 or coalesce(p_confirmations->>'documents','false')<>'true' then raise exception 'Подтвердите проверку ставок, расходов и документов'; end if;
 checks:=month_checks(p_client_id,p_month);
 if ((checks->>'unbilled')::int>0 or (checks->>'drafts')::int>0 or (checks->>'pending_expenses')::int>0 or (checks->>'unallocated')::numeric>0)
 and nullif(btrim(p_note),'') is null then raise exception 'Есть незавершённые действия. Укажите, почему период можно закрыть'; end if;
 if exists(select 1 from billing_periods where client_id=p_client_id and period_month=p_month and closed) then
   raise exception 'Месяц уже закрыт';
 end if;
 insert into billing_periods(client_id,period_month,snapshot,note,closed_by)
 values(p_client_id,p_month,checks||jsonb_build_object('confirmations',p_confirmations),coalesce(p_note,''),auth.uid())
 on conflict(client_id,period_month) do update set closed=true,closed_at=now(),closed_by=auth.uid(),
  snapshot=excluded.snapshot,note=excluded.note,reopen_reason=null;
 return checks;
end $$;

create or replace function public.reopen_billing_month(p_client_id uuid,p_month date,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_finance_user(); perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 if nullif(btrim(p_reason),'') is null then raise exception 'Укажите причину открытия периода'; end if;
 update billing_periods set closed=false,reopen_reason=p_reason where client_id=p_client_id and period_month=p_month and closed;
 if not found then raise exception 'Закрытый период не найден'; end if;
end $$;

create or replace function public.guard_closed_period() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; cid uuid; d date; d2 date; mid uuid; vals jsonb[];
begin
 perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 -- Оплата в следующем месяце меняет статус, но не содержание выпущенного документа.
 if tg_table_name='acts' and tg_op='UPDATE' and
   (to_jsonb(new)-array['status','externally_paid'])=(to_jsonb(old)-array['status','externally_paid']) then return new; end if;
 -- Уже предъявленный расход может быть оплачен позже; проверяем кассовые даты отдельно.
 if tg_table_name='reimbursable_expenses' and tg_op='UPDATE' and
  (to_jsonb(new)-array['status','payment_id','reimbursed_date','updated_at'])=(to_jsonb(old)-array['status','payment_id','reimbursed_date','updated_at'])
  and (to_jsonb(old)->>'status'='pending')=(to_jsonb(new)->>'status'='pending') then
   select client_id into cid from matters where id=new.matter_id;
   if exists(select 1 from billing_periods where client_id=cid and closed and
     (old.reimbursed_date between period_month and (period_month+interval '1 month - 1 day')::date
      or new.reimbursed_date between period_month and (period_month+interval '1 month - 1 day')::date)) then
     raise exception 'Месяц компенсации закрыт. Сначала откройте период с указанием причины';
   end if;
   return new;
 end if;
 vals:=case when tg_op='INSERT' then array[to_jsonb(new)] when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end;
 foreach item in array vals loop
  if tg_table_name='payments' then cid:=(item->>'client_id')::uuid;d:=(item->>'pay_date')::date;d2:=d;
  elsif tg_table_name='acts' then cid:=(item->>'client_id')::uuid;d:=(item->>'period_from')::date;d2:=(item->>'period_to')::date;
  elsif tg_table_name='payment_allocations' then select client_id,pay_date into cid,d from payments where id=(item->>'payment_id')::uuid;d2:=d;
  else
   mid:=(item->>'matter_id')::uuid;select client_id into cid from matters where id=mid;
   d:=coalesce(item->>'work_date',item->>'accrual_date',item->>'expense_date')::date;d2:=d;
  end if;
  if exists(select 1 from billing_periods where client_id=cid and closed and period_month<=d2 and period_month+interval '1 month'>d) then
    raise exception 'Месяц закрыт. Сначала откройте период с указанием причины';
  end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['time_entries','payments','matter_accruals','reimbursable_expenses','acts','payment_allocations'] loop
 execute format('drop trigger if exists closed_period_guard on public.%I',t);
 execute format('create trigger closed_period_guard before insert or update or delete on public.%I for each row execute function public.guard_closed_period()',t);
 end loop;
end $$;

create or replace function public.guard_rate_history() returns trigger language plpgsql as $$
begin
 if tg_table_name='time_entries' and tg_op='UPDATE' then
  if (new.duration_min,new.hourly_rate,new.is_billable,new.matter_id,new.work_date) is distinct from
     (old.duration_min,old.hourly_rate,old.is_billable,old.matter_id,old.work_date) and nullif(btrim(new.change_reason),'') is null then
    raise exception 'Укажите причину изменения времени, ставки или суммы';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists require_time_change_reason on time_entries;
create trigger require_time_change_reason before update on time_entries for each row execute function guard_rate_history();
drop trigger if exists audit_time_entries on time_entries;
create trigger audit_time_entries after insert or update or delete on time_entries for each row execute function log_change();
drop trigger if exists audit_matters on matters;
create trigger audit_matters after insert or update or delete on matters for each row execute function log_change();
drop trigger if exists audit_billing_periods on billing_periods;
create trigger audit_billing_periods after insert or update or delete on billing_periods for each row execute function log_change();

create or replace function public.guard_closed_subscription() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 if (new.monthly_fee,new.fee_from,new.fee_to,new.client_id) is distinct from (old.monthly_fee,old.fee_from,old.fee_to,old.client_id)
 and exists(select 1 from billing_periods where closed and client_id in(old.client_id,new.client_id)) then
   raise exception 'Изменение условий затрагивает закрытые месяцы. Сначала откройте соответствующие периоды';
 end if;
 return new;
end $$;
drop trigger if exists guard_closed_subscription on matters;
create trigger guard_closed_subscription before update on matters for each row execute function guard_closed_subscription();
revoke all on function month_checks(uuid,date),close_billing_month(uuid,date,jsonb,text),reopen_billing_month(uuid,date,text) from public,anon;
grant execute on function month_checks(uuid,date),close_billing_month(uuid,date,jsonb,text),reopen_billing_month(uuid,date,text) to authenticated,service_role;
commit;
