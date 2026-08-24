-- Индексы под реальные запросы приложения.
--
-- До сих пор на всю базу был один индекс (reimbursable_expenses.matter_id),
-- хотя фильтрация и сортировка идут по датам, делам и клиентам практически
-- в каждом разделе.
--
-- Честно: при нынешних объёмах (десятки записей) разницы в скорости не будет —
-- Postgres на такой таблице просто читает её целиком, и это быстрее индекса.
-- Смысл миграции в том, чтобы через несколько лет работы, когда записей станут
-- тысячи, Журнал и Отчёты не начали ощутимо тормозить.
--
-- Все индексы создаются с `if not exists` — миграцию можно выполнить повторно
-- без ошибок.

-- Записи времени: самая нагруженная таблица.
-- Фильтры по дате (день, период, набор дней), по делу, по исполнителю.
create index if not exists idx_time_entries_work_date on time_entries(work_date);
create index if not exists idx_time_entries_matter    on time_entries(matter_id);
create index if not exists idx_time_entries_user      on time_entries(user_id);

-- Платежи: акт сверки (клиент + период), Обзор, Доходы.
create index if not exists idx_payments_client   on payments(client_id);
create index if not exists idx_payments_matter   on payments(matter_id);
create index if not exists idx_payments_pay_date on payments(pay_date);

-- Дела: связь с клиентом и фильтр по статусу («активные» — выбор по умолчанию).
create index if not exists idx_matters_client on matters(client_id);
create index if not exists idx_matters_status on matters(status);

-- Акты: связи с делом и клиентом.
create index if not exists idx_acts_matter on acts(matter_id);
create index if not exists idx_acts_client on acts(client_id);

-- Финансы: выборка за год идёт по дате.
create index if not exists idx_expenses_date          on expenses(expense_date);
create index if not exists idx_manual_income_date     on manual_income(income_date);
create index if not exists idx_manual_income_client   on manual_income(client_id);
create index if not exists idx_tax_payments_year      on tax_payments(period_year);
