-- 021: абонентская плата по делу (клиент платит одну сумму в месяц независимо от объёма работы)
--
-- У дела появляются три необязательных поля. Пока monthly_fee пусто, дело почасовое — всё как раньше.
-- Если сумма и месяц начала заданы, программа сама начисляет эту сумму на последний день каждого
-- месяца (Обзор, «Дела», форма акта, акт сверки), а часы по такому делу денег не создают.
--
-- Только новые колонки: ничего существующего не меняется, повторный запуск безопасен.

alter table matters
  add column if not exists monthly_fee numeric(12,2) check (monthly_fee is null or monthly_fee >= 0),
  add column if not exists fee_from    date,   -- с какого месяца (берётся месяц этой даты, целиком)
  add column if not exists fee_to      date;   -- по какой месяц включительно; пусто — пока идёт

-- Проверка: все 3 колонки на месте (должно вернуть 3)
select count(*) as new_columns from information_schema.columns
where table_schema = 'public' and table_name = 'matters'
  and column_name in ('monthly_fee', 'fee_from', 'fee_to');
