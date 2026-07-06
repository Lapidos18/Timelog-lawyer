-- ============================================================
-- Раздел «Доходы и налоги»: расходы (вычеты), налоговые константы,
-- факт уплаты авансов/взносов.
-- Доходы уже учтены в таблице payments — новых таблиц для них не требуется.
-- ============================================================

-- ------------------------------------------------------------
-- Категории расходов (профессиональный вычет, ст. 221 НК РФ)
-- ------------------------------------------------------------
create type expense_category as enum (
  'fixed_contributions',   -- фиксированные страховые взносы ОПС+ОМС
  'ops_one_percent',       -- 1% ОПС с дохода свыше 300 000 руб.
  'palata_dues',           -- отчисления в адвокатскую палату
  'bank_service',          -- РКО
  'rent',                  -- аренда/содержание помещения кабинета
  'communication',         -- связь, интернет
  'stationery',            -- канцелярия, расходные материалы
  'legal_database',        -- КонсультантПлюс/Гарант и пр.
  'literature',            -- профессиональная литература
  'equipment',             -- оргтехника, мебель (в т.ч. амортизация)
  'education',             -- повышение квалификации (спорная позиция Минфина — см. заметки)
  'travel',                -- транспортные / командировочные
  'advertising',           -- реклама
  'other'                  -- прочее
);

create table if not exists expenses (
  id            uuid primary key default uuid_generate_v4(),
  expense_date  date not null default current_date,
  category      expense_category not null,
  amount        numeric(10,2) not null check (amount > 0),
  description   text not null default '',
  is_documented boolean not null default true,
  doc_no        text,                                  -- № подтверждающего документа
  matter_id     uuid references matters(id) on delete set null,  -- если расход возмещается доверителем отдельно
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table expenses enable row level security;
create policy "expenses_select" on expenses for select using (auth.role() = 'authenticated');
create policy "expenses_insert" on expenses for insert with check (auth.role() = 'authenticated');
create policy "expenses_update" on expenses for update using (auth.role() = 'authenticated');
create policy "expenses_delete" on expenses for delete using (auth.role() = 'authenticated');

create trigger expenses_updated_at before update on expenses
  for each row execute function update_updated_at();

-- ------------------------------------------------------------
-- Налоговые константы по годам (чтобы не зашивать ставки в код —
-- они регулярно меняются законодателем)
-- ------------------------------------------------------------
create table if not exists tax_settings (
  year                      int primary key,
  ndfl_rate_low             numeric(5,4) not null default 0.13,   -- ставка до порога
  ndfl_rate_high            numeric(5,4) not null default 0.15,   -- ставка сверх порога
  ndfl_progressive_threshold numeric(12,2) not null default 2400000,  -- порог прогрессии (ст. 224 НК РФ)
  ops_threshold             numeric(12,2) not null default 300000,   -- порог для 1% ОПС (ст. 430 НК РФ)
  ops_one_percent_cap       numeric(12,2) not null,                  -- предельный размер доп. взноса 1%
  fixed_contribution_total  numeric(12,2) not null,                  -- полная годовая сумма фикс. взносов ОПС+ОМС
  cabinet_start_date        date,                                    -- дата регистрации кабинета (для пропорции в первый год)
  advance_q1_deadline       date,   -- 25 апреля
  advance_q2_deadline       date,   -- 25 июля
  advance_q3_deadline       date,   -- 25 октября
  annual_deadline           date,   -- 15 июля следующего года (уплата) / 30 апреля (декларация)
  ops_deadline              date,   -- 1 июля следующего года
  updated_at                timestamptz not null default now()
);

alter table tax_settings enable row level security;
create policy "tax_settings_select" on tax_settings for select using (auth.role() = 'authenticated');
create policy "tax_settings_insert" on tax_settings for insert with check (auth.role() = 'authenticated');
create policy "tax_settings_update" on tax_settings for update using (auth.role() = 'authenticated');
create policy "tax_settings_delete" on tax_settings for delete using (auth.role() = 'authenticated');

-- Стартовые значения на 2026 год (см. ст. 224, 227, 430 НК РФ)
insert into tax_settings (
  year, ndfl_rate_low, ndfl_rate_high, ndfl_progressive_threshold,
  ops_threshold, ops_one_percent_cap, fixed_contribution_total,
  cabinet_start_date, advance_q1_deadline, advance_q2_deadline, advance_q3_deadline,
  annual_deadline, ops_deadline
) values (
  2026, 0.13, 0.15, 2400000,
  300000, 321818, 57390,
  '2026-04-01', '2026-04-25', '2026-07-25', '2026-10-25',
  '2027-07-15', '2027-07-01'
) on conflict (year) do nothing;

-- ------------------------------------------------------------
-- Факт уплаты авансов НДФЛ и взносов (сверка "начислено / уплачено",
-- абз. 4 п. 1 ст. 221 НК РФ)
-- ------------------------------------------------------------
create type tax_payment_type as enum (
  'ndfl_advance_q1',
  'ndfl_advance_q2',
  'ndfl_advance_q3',
  'ndfl_annual',
  'fixed_contributions',
  'ops_one_percent'
);

create table if not exists tax_payments (
  id             uuid primary key default uuid_generate_v4(),
  payment_date   date not null default current_date,
  payment_type   tax_payment_type not null,
  period_year    int not null,
  amount         numeric(12,2) not null check (amount > 0),
  doc_no         text,     -- № платёжного поручения
  notes          text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now()
);

alter table tax_payments enable row level security;
create policy "tax_payments_select" on tax_payments for select using (auth.role() = 'authenticated');
create policy "tax_payments_insert" on tax_payments for insert with check (auth.role() = 'authenticated');
create policy "tax_payments_update" on tax_payments for update using (auth.role() = 'authenticated');
create policy "tax_payments_delete" on tax_payments for delete using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- Представление: доходы по кварталам (источник — существующая payments)
-- ------------------------------------------------------------
create or replace view finance_income_view as
select
  p.id,
  p.pay_date,
  extract(year from p.pay_date)::int as pay_year,
  ceil(extract(month from p.pay_date)::numeric / 3)::int as pay_quarter,
  p.client_id,
  c.name as client_name,
  p.matter_id,
  m.title as matter_title,
  p.amount,
  p.description,
  p.doc_no
from payments p
join clients c on c.id = p.client_id
left join matters m on m.id = p.matter_id;

-- ------------------------------------------------------------
-- Представление: расходы по кварталам
-- ------------------------------------------------------------
create or replace view finance_expense_view as
select
  e.id,
  e.expense_date,
  extract(year from e.expense_date)::int as expense_year,
  ceil(extract(month from e.expense_date)::numeric / 3)::int as expense_quarter,
  e.category,
  e.amount,
  e.description,
  e.is_documented,
  e.doc_no,
  e.matter_id
from expenses e;
