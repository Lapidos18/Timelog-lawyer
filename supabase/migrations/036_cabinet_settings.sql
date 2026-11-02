begin;
create table if not exists public.cabinet_settings(id smallint primary key check(id=1),data jsonb not null default '{}',revision bigint not null default 0);
insert into cabinet_settings(id)values(1)on conflict(id)do nothing;
alter table cabinet_settings enable row level security;
drop policy if exists cabinet_settings_read on cabinet_settings;
create policy cabinet_settings_read on cabinet_settings for select using(auth.role()='authenticated');
revoke all on cabinet_settings from anon,authenticated;grant select on cabinet_settings to authenticated;grant all on cabinet_settings to service_role;
create or replace function public.save_cabinet_settings(p_data jsonb,p_expected_revision bigint)returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;v jsonb;current_revision bigint;
begin
 perform require_finance_user();select revision into current_revision from cabinet_settings where id=1 for update;
 if current_revision is distinct from p_expected_revision then raise exception 'Настройки изменены в другом окне. Обновите страницу перед сохранением';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Некорректные настройки';end if;
 for k,v in select * from jsonb_each(p_data) loop
  if k not in ('fullName','regNo','certNo','inn','signerShort','city','registryRegion','shortName','settlementName','bankDetails','reportIntro','reportClosing','actNote','notificationsEnabled','notificationsDetails','defaultRemindDays') then raise exception 'Неизвестное поле настроек';end if;
  if k not in ('notificationsEnabled','notificationsDetails','defaultRemindDays') and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>4000) then raise exception 'Некорректный текст настройки';end if;
 end loop;
 foreach k in array array['fullName','regNo','certNo','inn','signerShort','city','registryRegion','shortName','settlementName'] loop
  if nullif(trim(p_data->>k),'') is null then raise exception 'Заполните обязательные реквизиты';end if;
 end loop;
 if jsonb_typeof(p_data->'notificationsEnabled') is distinct from 'boolean' or jsonb_typeof(p_data->'notificationsDetails') is distinct from 'boolean' then raise exception 'Некорректные параметры напоминаний';end if;
 if jsonb_typeof(p_data->'defaultRemindDays') is distinct from 'number' then raise exception 'Укажите срок напоминания';end if;
 if (p_data->>'defaultRemindDays')::numeric not between 0 and 365 or (p_data->>'defaultRemindDays')::numeric<>trunc((p_data->>'defaultRemindDays')::numeric) then raise exception 'Срок напоминания: целое число от 0 до 365';end if;
 update cabinet_settings set data=p_data,revision=revision+1 where id=1 returning revision into current_revision;
 return current_revision;
end $$;
revoke all on function save_cabinet_settings(jsonb,bigint) from public,anon;
grant execute on function save_cabinet_settings(jsonb,bigint) to authenticated,service_role;
drop trigger if exists audit_cabinet_settings on cabinet_settings;
create or replace function public.log_cabinet_settings() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into audit_log(table_name,row_id,action,old_data,new_data,changed_by)
 values('cabinet_settings','00000000-0000-4000-8000-000000000036'::uuid,'update',to_jsonb(old),to_jsonb(new),auth.uid());return new;
end $$;
create trigger audit_cabinet_settings after update on cabinet_settings for each row execute function log_cabinet_settings();

create or replace function public.backup_snapshot() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with authorised as materialized (select public.require_finance_user())
 select jsonb_build_object(
 'rate_rules',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from rate_rules t),
 'document_source_claims',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from document_source_claims t),
 'notification_deliveries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from notification_deliveries t),
 'cabinet_settings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from cabinet_settings t),
 'clients',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from clients t),
 'profiles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from profiles t),
 'matters',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from matters t),
 'time_entries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from time_entries t),
 'payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from payments t),
 'acts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from acts t),
 'expenses',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from expenses t),
 'tax_settings',(select coalesce(jsonb_agg(to_jsonb(t) order by year),'[]') from tax_settings t),
 'tax_payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from tax_payments t),
 'manual_income',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from manual_income t),
 'reimbursable_expenses',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from reimbursable_expenses t),
 'court_events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from court_events t),
 'audit_log',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from audit_log t),
 'settlement_acts',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from settlement_acts t),
 'matter_accruals',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from matter_accruals t),
 'payment_allocations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from payment_allocations t),
 'act_entry_claims',(select coalesce(jsonb_agg(to_jsonb(t) order by entry_id),'[]') from act_entry_claims t),
 'billing_periods',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from billing_periods t),
 'backup_runs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from backup_runs t),
 'financial_operations',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from financial_operations t)
 ) from authorised;
$$;
revoke all on function public.backup_snapshot() from public,anon;
grant execute on function public.backup_snapshot() to authenticated,service_role;
commit;
