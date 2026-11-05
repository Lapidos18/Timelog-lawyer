begin;

-- Registration metadata is user controlled. Privileges are assigned separately.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profiles(id,full_name,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.email),'assistant');
  return new;
end;
$$;

create or replace function public.guard_profile_role()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.role is distinct from old.role and
     (coalesce(auth.role(),'') in ('anon','authenticated')
      or current_user in ('anon','authenticated','authenticator')) then
    raise exception 'Изменять роль пользователя может только администратор'
      using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role before update on public.profiles
for each row execute function public.guard_profile_role();

revoke update on public.profiles from public,anon,authenticated;
revoke update(role) on public.profiles from public,anon,authenticated;
grant update(full_name,hourly_rate) on public.profiles to authenticated;

commit;
