-- Согласованный снимок всех прикладных таблиц одним запросом (без ограничения 1000 строк).
begin;
create or replace function public.backup_snapshot() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with authorised as materialized (select public.require_finance_user())
 select jsonb_build_object(
 'rate_rules',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from rate_rules t),
 'document_source_claims',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from document_source_claims t),
 'notification_deliveries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from notification_deliveries t),
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
