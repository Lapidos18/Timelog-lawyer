-- ============================================================
-- Адвокатский кабинет Бухмина А.А. — учёт рабочего времени
-- ============================================================

-- Расширения
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- Профили пользователей (привязаны к Supabase Auth)
-- ------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'assistant' check (role in ('advocate', 'assistant')),
  hourly_rate numeric(10,2),
  created_at  timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "Пользователь видит свой профиль" on profiles
  for select using (auth.uid() = id);
create policy "Пользователь редактирует свой профиль" on profiles
  for update using (auth.uid() = id);
create policy "Все пользователи видят коллег" on profiles
  for select using (true);

-- ------------------------------------------------------------
-- Клиенты (доверители)
-- ------------------------------------------------------------
create table clients (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,                   -- ФИО или наименование организации
  type        text not null default 'individual'
              check (type in ('individual', 'legal_entity')),
  inn         text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table clients enable row level security;
create policy "Все аутентифицированные видят клиентов" on clients
  for select using (auth.role() = 'authenticated');
create policy "Все аутентифицированные создают клиентов" on clients
  for insert with check (auth.role() = 'authenticated');
create policy "Все аутентифицированные редактируют клиентов" on clients
  for update using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- Дела / Соглашения (matters)
-- ------------------------------------------------------------
create table matters (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references clients(id) on delete cascade,
  title           text not null,               -- Краткое название дела
  agreement_no    text,                         -- № соглашения (напр. 1/2026)
  matter_type     text not null default 'litigation'
                  check (matter_type in ('litigation', 'consulting', 'document', 'corporate', 'other')),
  court           text,                         -- Суд (для судебных дел)
  case_no         text,                         -- № дела в суде
  status          text not null default 'active'
                  check (status in ('active', 'suspended', 'closed')),
  hourly_rate     numeric(10,2),               -- Ставка по делу (перекрывает ставку пользователя)
  fixed_fee       numeric(10,2),               -- Фиксированное вознаграждение (если есть)
  started_at      date,
  closed_at       date,
  notes           text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table matters enable row level security;
create policy "Все аутентифицированные видят дела" on matters
  for select using (auth.role() = 'authenticated');
create policy "Все аутентифицированные создают дела" on matters
  for insert with check (auth.role() = 'authenticated');
create policy "Все аутентифицированные редактируют дела" on matters
  for update using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- Записи учёта времени (time entries)
-- ------------------------------------------------------------
create table time_entries (
  id            uuid primary key default uuid_generate_v4(),
  matter_id     uuid not null references matters(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  work_date     date not null default current_date,
  duration_min  integer not null check (duration_min > 0),  -- минуты
  hourly_rate   numeric(10,2) not null,         -- ставка на момент записи (фиксируется)
  amount        numeric(10,2) generated always as
                  (round(duration_min::numeric / 60 * hourly_rate, 2)) stored,
  activity_type text not null default 'consultation'
                check (activity_type in (
                  'consultation',   -- Консультация
                  'court_hearing',  -- Судебное заседание
                  'document_prep',  -- Подготовка документов
                  'correspondence', -- Переписка / переговоры
                  'research',       -- Правовой анализ
                  'travel',         -- Выезд
                  'other'
                )),
  description   text not null,
  is_billable   boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table time_entries enable row level security;
create policy "Все аутентифицированные видят записи" on time_entries
  for select using (auth.role() = 'authenticated');
create policy "Все аутентифицированные создают записи" on time_entries
  for insert with check (auth.role() = 'authenticated');
create policy "Пользователь редактирует свои записи" on time_entries
  for update using (auth.uid() = user_id);
create policy "Пользователь удаляет свои записи" on time_entries
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Вспомогательные функции и триггеры
-- ------------------------------------------------------------
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at before update on clients
  for each row execute function update_updated_at();
create trigger matters_updated_at before update on matters
  for each row execute function update_updated_at();
create trigger time_entries_updated_at before update on time_entries
  for each row execute function update_updated_at();

-- Автосоздание профиля при регистрации
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'assistant')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- Представление для отчётов
-- ------------------------------------------------------------
create view report_view as
select
  te.id,
  te.work_date,
  c.name            as client_name,
  c.type            as client_type,
  m.title           as matter_title,
  m.agreement_no,
  m.case_no,
  te.activity_type,
  te.description,
  te.duration_min,
  round(te.duration_min::numeric / 60, 2) as hours,
  te.hourly_rate,
  te.amount,
  te.is_billable,
  p.full_name       as performed_by,
  te.notes,
  te.created_at
from time_entries te
join matters m on m.id = te.matter_id
join clients c on c.id = m.client_id
join profiles p on p.id = te.user_id;
