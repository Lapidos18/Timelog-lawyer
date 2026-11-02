begin;
create table if not exists public.notification_deliveries(
 id uuid primary key,notification_day date not null,batch_key text not null,part_no int not null,body text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','checked','nothing')),
 attempts int not null default 0,lease_id uuid,updated_at timestamptz not null default now(),sent_at timestamptz,
 message_id bigint,error_code text,next_attempt_at timestamptz,created_at timestamptz not null default now()
);
alter table notification_deliveries enable row level security;
alter table notification_deliveries add column if not exists next_attempt_at timestamptz;
drop policy if exists delivery_read on notification_deliveries;
create policy delivery_read on notification_deliveries for select using(auth.role()='authenticated');
revoke all on notification_deliveries from anon,authenticated;grant select on notification_deliveries to authenticated;grant all on notification_deliveries to service_role;
create or replace function public.queue_notification(p_day date,p_parts text[]) returns setof notification_deliveries
language plpgsql security definer set search_path=public,pg_temp as $$
declare batch text:=md5(to_jsonb(p_parts)::text);part text;n int:=0;pid uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Нет доступа' using errcode='42501';end if;
 if p_day is null or coalesce(array_length(p_parts,1),0)=0 or array_length(p_parts,1)>100 then raise exception 'Некорректное уведомление';end if;
 foreach part in array p_parts loop
  n:=n+1;if part is null or length(part)=0 or length(part)>3500 then raise exception 'Некорректная часть сообщения';end if;
  pid:=md5(p_day::text||':'||batch||':'||n)::uuid;
  insert into notification_deliveries(id,notification_day,batch_key,part_no,body)values(pid,p_day,batch,n,part)on conflict(id)do nothing;
 end loop;
 return query select * from notification_deliveries where notification_day=p_day and batch_key=batch order by part_no;
end $$;
create or replace function public.claim_notification(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r notification_deliveries;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Нет доступа' using errcode='42501';end if;
 select * into r from notification_deliveries where id=p_id for update;
 if not found then return null;end if;
 if exists(select 1 from notification_deliveries where error_code='telegram_429' and next_attempt_at>now()) then return null;end if;
 if r.status='sending' and r.updated_at<now()-interval '2 minutes' then
  update notification_deliveries set status='uncertain',error_code='worker_interrupted',updated_at=now() where id=p_id;return null;
 end if;
 if r.status not in ('pending','failed') or r.attempts>=3 or r.next_attempt_at>now() then return null;end if;
 update notification_deliveries set status='sending',attempts=attempts+1,lease_id=gen_random_uuid(),updated_at=now(),error_code=null where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
drop function if exists public.finish_notification(uuid,uuid,text,bigint,text);
create or replace function public.finish_notification(p_id uuid,p_lease uuid,p_status text,p_message_id bigint,p_error text,p_retry_after integer default 0) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Нет доступа' using errcode='42501';end if;
 if p_status not in ('sent','failed','uncertain') then raise exception 'Некорректный статус';end if;
 update notification_deliveries set status=p_status,message_id=p_message_id,error_code=left(p_error,80),
 sent_at=case when p_status='sent' then now() else null end,updated_at=now(),
 next_attempt_at=case when p_status='failed' and p_retry_after>0 then now()+least(p_retry_after,604800)*interval '1 second' else null end
 where id=p_id and lease_id=p_lease and status='sending';return found;
end $$;
create or replace function public.retry_uncertain_notification(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_finance_user();update notification_deliveries set status='failed',attempts=0,error_code='manual_retry',updated_at=now()
 where id=p_id and status in ('uncertain','failed') and (next_attempt_at is null or next_attempt_at<=now()) and notification_day=(now() at time zone 'Asia/Novosibirsk')::date;
 if not found then raise exception 'Нет сегодняшнего уведомления с неподтверждённым результатом';end if;
end $$;
revoke all on function queue_notification(date,text[]),claim_notification(uuid),finish_notification(uuid,uuid,text,bigint,text,integer),retry_uncertain_notification(uuid) from public,anon,authenticated;
grant execute on function queue_notification(date,text[]),claim_notification(uuid),finish_notification(uuid,uuid,text,bigint,text,integer) to service_role;
grant execute on function retry_uncertain_notification(uuid) to authenticated,service_role;
create or replace function public.record_notification_check(p_status text,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d date:=(now() at time zone 'Asia/Novosibirsk')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Нет доступа' using errcode='42501';end if;
 if p_status not in ('checked','nothing','failed') then raise exception 'Некорректный статус';end if;
 insert into notification_deliveries(id,notification_day,batch_key,part_no,body,status,error_code)
 values(md5(d::text||':check')::uuid,d,'check',0,'',p_status,left(p_error,80))on conflict(id)do update set status=excluded.status,error_code=excluded.error_code,updated_at=now();
end $$;
revoke all on function record_notification_check(text,text) from public,anon,authenticated;
grant execute on function record_notification_check(text,text) to service_role;
commit;
