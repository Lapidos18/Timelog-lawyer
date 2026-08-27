-- ============================================================
-- Разделение данных по адвокатским кабинетам (мультитенантность)
-- ============================================================
--
-- ЗАЧЕМ. До этой миграции все права доступа были написаны как
-- `auth.role() = 'authenticated'` — то есть ЛЮБОЙ вошедший пользователь видел
-- всех доверителей, все дела, все записи времени и все платежи. Пока в базе был
-- один кабинет, это работало. Как только регистрируется второй адвокат — это
-- прямое разглашение сведений, составляющих адвокатскую тайну (ст. 8 ФЗ-63),
-- и утечка персональных данных доверителей.
--
-- КАК УСТРОЕНО ТЕПЕРЬ. Появляется понятие «кабинет» (таблица orgs). Каждый
-- пользователь принадлежит ровно одному кабинету (profiles.org_id). У каждой
-- строки данных есть org_id, и права доступа пропускают только строки своего
-- кабинета. Два адвоката в одной базе не видят друг друга вообще — ни данных,
-- ни самого факта существования.
--
-- ВАЖНО ПРО КОД ПРИЛОЖЕНИЯ. Приложению не нужно проставлять org_id при вставке:
-- это делает триггер set_org_id(). Так безопаснее — забытый org_id в одном
-- запросе не создаст «бесхозную» строку, а попытка подставить чужой org_id
-- вручную будет отклонена правилом WITH CHECK.
--
-- Миграцию можно выполнять повторно — она идемпотентна.

-- ------------------------------------------------------------
-- 1. Кабинет (арендатор)
-- ------------------------------------------------------------
create table if not exists orgs (
  id             uuid primary key default uuid_generate_v4(),
  -- Краткое имя для интерфейса: «АК Иванов И.И.»
  name           text not null,
  -- Полное наименование для шапки документов:
  -- «Адвокатский кабинет Иванова Ивана Ивановича»
  full_name      text,
  -- ФИО адвоката полностью: «Иванов Иван Иванович»
  advocate_name  text,
  -- Как подписывается документ: «И.И. Иванов»
  signature_name text,
  -- Регистрационный номер в реестре адвокатов субъекта РФ
  reg_no         text,
  inn            text,
  address        text,
  phone          text,
  email          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists orgs_updated_at on orgs;
create trigger orgs_updated_at before update on orgs
  for each row execute function update_updated_at();

-- ------------------------------------------------------------
-- 2. Колонка org_id везде
-- ------------------------------------------------------------
alter table profiles add column if not exists org_id uuid references orgs(id) on delete cascade;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','matters','time_entries','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    execute format(
      'alter table %I add column if not exists org_id uuid references orgs(id) on delete cascade', t);
    execute format(
      'create index if not exists idx_%s_org on %I(org_id)', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Перенос существующих данных в кабинет владельца
-- ------------------------------------------------------------
-- Всё, что уже есть в базе, принадлежит одному кабинету. Владельцем считаем
-- самый ранний профиль адвоката (если такого нет — просто самый ранний профиль).
do $$
declare
  owner_id  uuid;
  owner_org uuid;
  t         text;
begin
  select id into owner_id from profiles
   where role = 'advocate' order by created_at limit 1;
  if owner_id is null then
    select id into owner_id from profiles order by created_at limit 1;
  end if;

  if owner_id is not null then
    select org_id into owner_org from profiles where id = owner_id;

    if owner_org is null then
      -- Реквизиты до сих пор были зашиты прямо в шаблоны акта и акта сверки.
      -- Переносим их в карточку кабинета, чтобы документы печатались как прежде.
      -- Для кабинета, заведённого не Бухминым А.А., поля останутся пустыми —
      -- их заполняют в разделе «Настройки».
      insert into orgs (name, full_name, advocate_name, signature_name, reg_no, inn)
      select
        'АК ' || full_name,
        case when full_name = 'Бухмин Антон Андреевич'
             then 'Адвокатский кабинет Бухмина Антона Андреевича'
             else 'Адвокатский кабинет ' || full_name end,
        full_name,
        case when full_name = 'Бухмин Антон Андреевич'
             then 'А.А. Бухмин'
             else full_name end,
        case when full_name = 'Бухмин Антон Андреевич' then '54/1831' end,
        case when full_name = 'Бухмин Антон Андреевич' then '540233730471' end
      from profiles where id = owner_id
      returning id into owner_org;

      raise notice 'Создан кабинет % для владельца %', owner_org, owner_id;
    end if;

    -- Все существующие пользователи — сотрудники этого кабинета
    update profiles set org_id = owner_org where org_id is null;

    foreach t in array array[
      'clients','matters','time_entries','payments','acts',
      'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
    ] loop
      execute format('update %I set org_id = $1 where org_id is null', t) using owner_org;
    end loop;
  end if;
end $$;

-- Если владельца нет вообще (чистая база), единственные строки без кабинета —
-- это стартовые налоговые настройки из миграции 006. Реальных данных здесь быть
-- не может: до появления первого пользователя их некому было создать.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','matters','time_entries','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    execute format('delete from %I where org_id is null', t);
  end loop;
end $$;

-- Теперь колонку можно закрыть от NULL
do $$
declare t text;
begin
  foreach t in array array[
    'clients','matters','time_entries','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    execute format('alter table %I alter column org_id set not null', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. Ключи и ограничения, которые были глобальными
-- ------------------------------------------------------------
-- Налоговые настройки: год уникален В ПРЕДЕЛАХ кабинета, а не во всей базе.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'tax_settings'::regclass and conname = 'tax_settings_pkey'
       and (select count(*) from unnest(conkey)) = 1
  ) then
    alter table tax_settings drop constraint tax_settings_pkey;
    alter table tax_settings add primary key (org_id, year);
    raise notice 'Первичный ключ tax_settings переведён на (org_id, year)';
  end if;
end $$;

-- Номер акта: уникален в пределах кабинета. Иначе второй адвокат не смог бы
-- выпустить акт № 1 — и по сообщению об ошибке узнал бы, что такой номер уже
-- занят кем-то ещё.
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'acts'::regclass and conname = 'acts_act_no_unique') then
    alter table acts drop constraint acts_act_no_unique;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'acts'::regclass and conname = 'acts_org_act_no_unique') then
    alter table acts add constraint acts_org_act_no_unique unique (org_id, act_no);
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. Кабинет текущего пользователя
-- ------------------------------------------------------------
-- security definer — функция читает profiles в обход прав доступа. Без этого
-- правило доступа к profiles, которое само вызывает эту функцию, ушло бы
-- в бесконечную рекурсию.
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid()
$$;

revoke all on function current_org_id() from public;
grant execute on function current_org_id() to authenticated;

-- ------------------------------------------------------------
-- 6. Автоподстановка org_id при вставке
-- ------------------------------------------------------------
create or replace function set_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    new.org_id := current_org_id();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','matters','time_entries','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    execute format('drop trigger if exists %s_set_org_id on %I', t, t);
    execute format(
      'create trigger %s_set_org_id before insert on %I
         for each row execute function set_org_id()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. Права доступа: только свой кабинет
-- ------------------------------------------------------------
-- Сначала снимаем ВСЕ старые правила — они назывались по-разному в разных
-- миграциях (часть по-русски, часть по-английски), поэтому удаляем по списку
-- из системного каталога, а не по именам.
do $$
declare t text; p text;
begin
  foreach t in array array[
    'profiles','clients','matters','time_entries','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;
end $$;

-- Данные кабинета: видны, создаются, меняются и удаляются только своим кабинетом.
-- with check на update закрывает попытку «перебросить» строку в чужой кабинет.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','matters','payments','acts',
    'expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "org_select" on %I for select using (org_id = current_org_id())', t);
    execute format('create policy "org_insert" on %I for insert with check (org_id = current_org_id())', t);
    execute format('create policy "org_update" on %I for update using (org_id = current_org_id()) with check (org_id = current_org_id())', t);
    execute format('create policy "org_delete" on %I for delete using (org_id = current_org_id())', t);
  end loop;
end $$;

-- Записи времени — отдельно: внутри кабинета правит и удаляет только автор
-- записи (так было и раньше, сохраняем). Создать запись за коллегу можно —
-- адвокат вносит время помощника; это поведение было и до миграции.
alter table time_entries enable row level security;
create policy "org_select" on time_entries
  for select using (org_id = current_org_id());
create policy "org_insert" on time_entries
  for insert with check (org_id = current_org_id());
create policy "own_update" on time_entries
  for update using (org_id = current_org_id() and user_id = auth.uid())
          with check (org_id = current_org_id() and user_id = auth.uid());
create policy "own_delete" on time_entries
  for delete using (org_id = current_org_id() and user_id = auth.uid());

-- Профили: видно себя и коллег по кабинету, править — только себя.
alter table profiles enable row level security;
create policy "org_select" on profiles
  for select using (id = auth.uid() or org_id = current_org_id());
create policy "self_update" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Кабинет: свой — читать и редактировать. Создание идёт только через триггер
-- регистрации (он security definer), поэтому политики insert здесь нет.
alter table orgs enable row level security;
drop policy if exists "org_select" on orgs;
drop policy if exists "org_update" on orgs;
create policy "org_select" on orgs
  for select using (id = current_org_id());
create policy "org_update" on orgs
  for update using (id = current_org_id()) with check (id = current_org_id());

-- ------------------------------------------------------------
-- 8. Представления
-- ------------------------------------------------------------
-- КРИТИЧНО. По умолчанию представление обращается к таблицам от имени своего
-- владельца, а не того, кто выполняет запрос, — то есть права доступа таблиц
-- не применяются и report_view отдал бы записи всех кабинетов сразу.
-- security_invoker переключает представление на права вызывающего.
alter view report_view            set (security_invoker = on);
alter view finance_income_view    set (security_invoker = on);
alter view finance_expense_view   set (security_invoker = on);

-- ------------------------------------------------------------
-- 9. Эталонные налоговые константы
-- ------------------------------------------------------------
-- Ставки и пороги одинаковы для всех кабинетов и меняются законодателем раз
-- в год. Держим их в одном месте, чтобы при регистрации нового адвоката
-- копировать в его настройки, а не зашивать в код.
create table if not exists tax_defaults (
  year                       int primary key,
  ndfl_rate_low              numeric(5,4)  not null default 0.13,
  ndfl_rate_high             numeric(5,4)  not null default 0.15,
  ndfl_progressive_threshold numeric(12,2) not null default 2400000,
  ops_threshold              numeric(12,2) not null default 300000,
  ops_one_percent_cap        numeric(12,2) not null,
  fixed_contribution_total   numeric(12,2) not null,
  advance_q1_deadline        date,
  advance_q2_deadline        date,
  advance_q3_deadline        date,
  annual_deadline            date,
  ops_deadline               date
);

insert into tax_defaults (
  year, ndfl_rate_low, ndfl_rate_high, ndfl_progressive_threshold,
  ops_threshold, ops_one_percent_cap, fixed_contribution_total,
  advance_q1_deadline, advance_q2_deadline, advance_q3_deadline,
  annual_deadline, ops_deadline
) values (
  2026, 0.13, 0.15, 2400000,
  300000, 321818, 57390,
  '2026-04-25', '2026-07-25', '2026-10-25',
  '2027-07-15', '2027-07-01'
) on conflict (year) do nothing;

alter table tax_defaults enable row level security;
drop policy if exists "tax_defaults_select" on tax_defaults;
create policy "tax_defaults_select" on tax_defaults
  for select using (auth.role() = 'authenticated');

create or replace function seed_tax_settings(p_org_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into tax_settings (
    org_id, year, ndfl_rate_low, ndfl_rate_high, ndfl_progressive_threshold,
    ops_threshold, ops_one_percent_cap, fixed_contribution_total,
    advance_q1_deadline, advance_q2_deadline, advance_q3_deadline,
    annual_deadline, ops_deadline
  )
  select
    p_org_id, d.year, d.ndfl_rate_low, d.ndfl_rate_high, d.ndfl_progressive_threshold,
    d.ops_threshold, d.ops_one_percent_cap, d.fixed_contribution_total,
    d.advance_q1_deadline, d.advance_q2_deadline, d.advance_q3_deadline,
    d.annual_deadline, d.ops_deadline
  from tax_defaults d
  on conflict (org_id, year) do nothing;
$$;

revoke all on function seed_tax_settings(uuid) from public;
grant execute on function seed_tax_settings(uuid) to authenticated;

-- ------------------------------------------------------------
-- 10. Регистрация: каждому новому пользователю — свой кабинет
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_org  uuid;
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email);

  insert into orgs (name, full_name, advocate_name, signature_name, email)
  values ('АК ' || v_name, 'Адвокатский кабинет ' || v_name, v_name, v_name, new.email)
  returning id into v_org;

  -- Роль по умолчанию — адвокат: регистрируется владелец собственного кабинета.
  -- Помощников он потом заводит сам, и они получают роль assistant.
  insert into profiles (id, org_id, full_name, role)
  values (
    new.id,
    v_org,
    v_name,
    coalesce(new.raw_user_meta_data->>'role', 'advocate')
  );

  perform seed_tax_settings(v_org);

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 11. Проверка результата
-- ------------------------------------------------------------
-- Должно вернуть по одной строке на кабинет и ноль строк без кабинета.
select o.name as кабинет,
       (select count(*) from profiles p where p.org_id = o.id)     as пользователей,
       (select count(*) from clients c where c.org_id = o.id)      as доверителей,
       (select count(*) from time_entries e where e.org_id = o.id) as записей
from orgs o
order by o.created_at;
