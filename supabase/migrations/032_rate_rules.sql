begin;
create table if not exists public.rate_rules(
 id uuid primary key default gen_random_uuid(),matter_id uuid not null references matters(id) on delete cascade,
 activity_type text,user_id uuid references profiles(id),valid_from date not null,valid_to date,
 hourly_rate numeric(12,2) not null check(hourly_rate>=0),reason text not null check(length(trim(reason))>0),
 created_at timestamptz not null default now(),created_by uuid default auth.uid() references auth.users(id),
 check(valid_to is null or valid_to>=valid_from),
 check(activity_type is null or activity_type in ('consultation','court_hearing','document_prep','correspondence','research','travel','other'))
);
alter table rate_rules enable row level security;
drop policy if exists rates_read on rate_rules;
create policy rates_read on rate_rules for select using(auth.role()='authenticated');
revoke all on rate_rules from anon,authenticated;grant select on rate_rules to authenticated;grant all on rate_rules to service_role;
create or replace function public.save_rate_rule(p_rule jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid:=coalesce(nullif(p_rule->>'id','')::uuid,gen_random_uuid()); mid uuid:=(p_rule->>'matter_id')::uuid;
 act text:=nullif(p_rule->>'activity_type',''); uid uuid:=nullif(p_rule->>'user_id','')::uuid;
 d1 date:=(p_rule->>'valid_from')::date;d2 date:=nullif(p_rule->>'valid_to','')::date;rate numeric:=(p_rule->>'hourly_rate')::numeric;
begin
 perform require_finance_user();perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 if rate is null or rate::text in ('NaN','Infinity','-Infinity') or rate<0 or rate<>round(rate,2) then raise exception 'Некорректная ставка';end if;
 if exists(select 1 from rate_rules where id=rid and matter_id<>mid) then raise exception 'Нельзя переносить правило в другое дело';end if;
 if exists(select 1 from rate_rules where matter_id=mid and id<>rid and activity_type is not distinct from act and user_id is not distinct from uid
  and daterange(valid_from,valid_to,'[]') && daterange(d1,d2,'[]')) then raise exception 'Правило с такими условиями уже действует в этом периоде. Измените границы дат';end if;
 insert into rate_rules(id,matter_id,activity_type,user_id,valid_from,valid_to,hourly_rate,reason)
 values(rid,mid,act,uid,d1,d2,rate,p_rule->>'reason') on conflict(id)do update set activity_type=excluded.activity_type,user_id=excluded.user_id,
 valid_from=excluded.valid_from,valid_to=excluded.valid_to,hourly_rate=excluded.hourly_rate,reason=excluded.reason;
 return rid;
end $$;
create or replace function public.delete_rate_rule(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform require_finance_user();delete from rate_rules where id=p_id;end $$;
revoke all on function save_rate_rule(jsonb),delete_rate_rule(uuid) from public,anon;
grant execute on function save_rate_rule(jsonb),delete_rate_rule(uuid) to authenticated,service_role;
drop trigger if exists audit_rate_rules on rate_rules;
create trigger audit_rate_rules after insert or update or delete on rate_rules for each row execute function log_change();
commit;
