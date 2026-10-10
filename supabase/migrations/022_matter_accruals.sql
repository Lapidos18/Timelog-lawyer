-- 022. Начисления по актам (работа на фиксированную сумму без записей времени)
--
-- Зачем. Программа начисляет вознаграждение по часам журнала (и по абонплате,
-- миграция 021). Но часть работы адвокат не ведёт по часам: услуга на
-- фиксированную сумму, которая закрывается актом («участие в заседании» за
-- 7 000 ₽). Деньги по ней поступили, акт подписан, а в программе нет ни часов,
-- ни начисления — и оплата выглядит «авансом» или «переплатой». Запись здесь
-- — это строка начисления по делу: дата, сумма и подпись («Акт от 31.08.2026»).
-- Программа считает её начисленной везде (Обзор, «Дела», акт сверки).
--
-- Только новая таблица: ничего существующего не меняется.

create table if not exists matter_accruals (
  id           uuid primary key default gen_random_uuid(),

  -- удалили дело — вместе с ним уходят и его начисления
  matter_id    uuid not null references matters(id) on delete cascade,

  accrual_date date not null,                              -- дата акта
  amount       numeric(12,2) not null check (amount > 0),
  description  text not null default '',                   -- «Акт от 31.08.2026»

  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists matter_accruals_matter_idx on matter_accruals (matter_id, accrual_date);

alter table matter_accruals enable row level security;

-- Правила как у остальных таблиц: доступ только после входа (п. 14 в CLAUDE.md:
-- `using (true)` недопустимо)
create policy "matter_accruals_select" on matter_accruals for select using (auth.role() = 'authenticated');
create policy "matter_accruals_insert" on matter_accruals for insert with check (auth.role() = 'authenticated');
create policy "matter_accruals_update" on matter_accruals for update using (auth.role() = 'authenticated');
create policy "matter_accruals_delete" on matter_accruals for delete using (auth.role() = 'authenticated');

revoke all on matter_accruals from anon;

-- Журнал изменений (миграция 013): начисление — денежная запись
drop trigger if exists audit_matter_accruals on matter_accruals;
create trigger audit_matter_accruals
  after insert or update or delete on matter_accruals
  for each row execute function log_change();

create or replace function touch_matter_accruals() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists matter_accruals_touch on matter_accruals;
create trigger matter_accruals_touch
  before update on matter_accruals
  for each row execute function touch_matter_accruals();

-- Проверка. Одна строка: таблица пуста, а посетитель без входа читать её не может (anon_can_select = false)
select (select count(*) from matter_accruals) as "начислений",
       has_table_privilege('anon', 'matter_accruals', 'select') as anon_can_select;
