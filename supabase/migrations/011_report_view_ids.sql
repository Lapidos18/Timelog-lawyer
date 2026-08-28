-- Идентификаторы в report_view.
--
-- Представление отдавало только НАЗВАНИЯ (matter_title, client_name,
-- performed_by), поэтому акты, отчёты и акт сверки искали записи текстом.
-- Последствия:
--   * переименовали дело — ранее выпущенный акт при повторном открытии
--     показывает уже другое содержание (запрос идёт по новому названию);
--   * два дела с одинаковым названием — в акт попадают записи обоих;
--   * два доверителя-тёзки — акт сверки их смешивает.
--
-- Добавляем идентификаторы, чтобы поиск шёл по ним. Столбцы с названиями
-- ОСТАЮТСЯ — они используются для отображения и в выгрузках.
--
-- Безопасно для повторного запуска: create or replace.

create or replace view report_view as
select
  te.id,
  te.work_date,
  m.client_id,                      -- новое: устойчивый идентификатор доверителя
  te.matter_id,                     -- новое: устойчивый идентификатор дела
  te.user_id,                       -- новое: устойчивый идентификатор исполнителя
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

-- Проверка: должны вернуться три новых столбца
select column_name
from information_schema.columns
where table_name = 'report_view'
  and column_name in ('client_id', 'matter_id', 'user_id')
order by column_name;
