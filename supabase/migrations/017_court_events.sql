-- 017. Сроки и заседания
--
-- Зачем. Даты заседаний и процессуальных сроков жили в голове и в бумажном
-- ежедневнике. Пропущенный срок обжалования не исправляется аккуратностью
-- в учёте часов, поэтому им нужно место в программе — с привязкой к делу
-- и с напоминанием на Обзоре.
--
-- Дата хранится отдельно от времени: у процессуального срока времени нет
-- (он истекает в 24:00 последнего дня), а у заседания оно есть. Хранить
-- их одним полем timestamptz значило бы придумывать время там, где его нет,
-- и ловить сдвиги часовых поясов на пустом месте.

create table if not exists court_events (
  id          uuid primary key default gen_random_uuid(),

  -- Дело необязательно: бывает срок, не привязанный к конкретному делу
  matter_id   uuid references matters(id) on delete set null,

  kind        text not null default 'deadline'
              check (kind in ('hearing', 'deadline', 'other')),
  title       text not null,

  event_date  date not null,
  -- Время только у заседаний; у срока остаётся пустым
  event_time  time,

  place       text,
  note        text,

  -- За сколько дней предупреждать на Обзоре
  remind_days integer not null default 7 check (remind_days between 0 and 365),

  done        boolean not null default false,
  done_at     timestamptz,

  -- Чем считали срок: идентификатор шаблона из src/lib/deadlines.ts и дата
  -- события, от которой шёл отсчёт. Нужны, чтобы потом было видно, откуда
  -- взялась дата, и чтобы пересчитать при исправлении исходной даты.
  template_id text,
  base_date   date,

  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists court_events_date_idx   on court_events (event_date);
create index if not exists court_events_matter_idx on court_events (matter_id);
-- Список открытых событий — самый частый запрос
create index if not exists court_events_open_idx   on court_events (done, event_date);

alter table court_events enable row level security;

-- Правила как у остальных таблиц: доступ только после входа.
-- `using (true)` здесь недопустимо — см. п. 14 в CLAUDE.md.
create policy "court_events_select" on court_events for select using (auth.role() = 'authenticated');
create policy "court_events_insert" on court_events for insert with check (auth.role() = 'authenticated');
create policy "court_events_update" on court_events for update using (auth.role() = 'authenticated');
create policy "court_events_delete" on court_events for delete using (auth.role() = 'authenticated');

-- Журнал изменений (миграция 013): дата заседания — то, что важно увидеть
-- в истории, если она вдруг «сама» изменилась
drop trigger if exists audit_court_events on court_events;
create trigger audit_court_events
  after insert or update or delete on court_events
  for each row execute function log_change();

-- updated_at обновляем сами: в остальных таблицах так же
create or replace function touch_court_events() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists court_events_touch on court_events;
create trigger court_events_touch
  before update on court_events
  for each row execute function touch_court_events();

-- Проверка: таблица создана и пуста
select count(*) as "событий в таблице" from court_events;
