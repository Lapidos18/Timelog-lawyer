begin;
create or replace function public.sync_act_payment_state() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; ids uuid[];
begin
 ids:=case when tg_op='INSERT' then array[new.act_id] when tg_op='DELETE' then array[old.act_id] else array[old.act_id,new.act_id] end;
 foreach aid in array ids loop
  if aid is not null then
   update acts a set
    status=case when (select coalesce(sum(fee_amount),0) from payment_allocations where act_id=a.id)>=a.amount then 'paid'
      when a.externally_paid and not exists(select 1 from payment_allocations where act_id=a.id) then 'paid' else 'signed' end,
    externally_paid=case when exists(select 1 from payment_allocations where act_id=a.id) then false else a.externally_paid end
   where a.id=aid and not a.is_void and a.status<>'draft';
  end if;
 end loop;
 return null;
end $$;
drop trigger if exists sync_act_payment_state on public.payment_allocations;
drop trigger if exists sync_act_payment_state on public.payment_allocations;
create trigger sync_act_payment_state after insert or update or delete on public.payment_allocations
for each row execute function public.sync_act_payment_state();

create or replace function public.check_allocation_act() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.act_id is not null and not exists(select 1 from acts a join payments p on p.id=new.payment_id
  where a.id=new.act_id and not a.is_void and a.matter_id=new.matter_id and a.client_id=p.client_id) then
  raise exception 'Распределение не относится к действующему акту этого доверителя';
 end if;
 return new;
end $$;
drop trigger if exists check_allocation_act on public.payment_allocations;
drop trigger if exists check_allocation_act on public.payment_allocations;
create trigger check_allocation_act before insert or update on public.payment_allocations
for each row execute function public.check_allocation_act();

create or replace function public.delete_time_entry(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_finance_user();
 if nullif(btrim(p_reason),'') is null then raise exception 'Укажите причину удаления'; end if;
 update time_entries set change_reason=p_reason where id=p_id;
 delete from time_entries where id=p_id;
end $$;
revoke all on function public.delete_time_entry(uuid,text) from public,anon;
grant execute on function public.delete_time_entry(uuid,text) to authenticated,service_role;
commit;
