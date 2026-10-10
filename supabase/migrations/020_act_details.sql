-- 020: реквизиты для актов и отчётов в форме, которой пользуется адвокат
-- (образцы «Акт … Задание № 3» и «Отчёт №19/06-26-3009» от 10.10.2026).
--
-- Только новые необязательные колонки: ничего существующего не меняется,
-- выполнять можно в любой момент, повторный запуск безопасен.

-- Карточка доверителя: то, что нужно в шапке и в подписях акта
alter table clients
  add column if not exists full_name       text,   -- полное наименование: «Общество с ограниченной ответственностью «СИСТЕМА»»
  add column if not exists ogrn            text,
  add column if not exists representative  text,   -- после слов «в лице»: «генерального директора Зарипова Раиса Юрьевича»
  add column if not exists signer_position text,   -- в подписи: «Генеральный директор»
  add column if not exists signer_short    text;   -- в подписи: «Р.Ю. Зарипов»

-- Дело = задание к соглашению: номер и дата соглашения и задания, предмет, пункт об издержках
alter table matters
  add column if not exists agreement_date  date,   -- дата соглашения (номер уже в agreement_no)
  add column if not exists task_no         text,   -- «3» в «Задание № 3»
  add column if not exists task_date       date,   -- пусто — берётся дата начала дела
  add column if not exists act_subject     text,   -- после «в виде»: «представления интересов доверителя при взыскании …»
  add column if not exists expenses_clause text;   -- «п. 2.4.» — на что в задании опирается возмещение расходов

-- Акт: сумма возмещаемых расходов на момент составления (как и состав строк, не плавает от правок журнала)
alter table acts
  add column if not exists expenses_amount numeric(12,2);

-- Проверка: все 11 колонок на месте (должно вернуть 11)
select count(*) as new_columns from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'clients' and column_name in ('full_name','ogrn','representative','signer_position','signer_short')) or
  (table_name = 'matters' and column_name in ('agreement_date','task_no','task_date','act_subject','expenses_clause')) or
  (table_name = 'acts'    and column_name = 'expenses_amount')
);
