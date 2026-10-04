-- 018. Представления больше не отдают данные посетителю без входа
--
-- Зачем. Проверка 04.10.2026 показала: таблицы закрыты правильно (без входа
-- они отдают пустой список), а три ПРЕДСТАВЛЕНИЯ — нет. По открытому ключу,
-- без пароля, читались:
--   report_view          — весь журнал: названия доверителей, дела, номера
--                          соглашений и судебных дел, ОПИСАНИЯ работы,
--                          примечания, ставки, суммы (42 записи, 20 столбцов);
--   finance_income_view  — все поступления: плательщик, сумма, назначение (9);
--   finance_expense_view — расходы кабинета (13).
-- Менять данные через них было нельзя, только читать.
--
-- Почему так вышло. Представление в PostgreSQL по умолчанию работает с правами
-- СВОЕГО ВЛАДЕЛЬЦА, а не того, кто его читает, поэтому правила доступа
-- (RLS) таблиц под ним не применяются: «любой вошедший» из политик таблиц
-- превращается для представления в «вообще любой». Прежние проверки (20.09)
-- смотрели только таблицы.
--
-- Что делаем. Два замка, любого хватило бы по отдельности:
--   1. security_invoker = true — представление читает таблицы с правами того,
--      кто его открыл, и правила таблиц снова работают: без входа — пустой
--      список, после входа — то же самое, что и раньше.
--   2. Отзываем у роли anon (посетитель без входа) право на чтение.
--
-- Для вошедшего пользователя ничего не меняется: политики чтения у clients,
-- matters, time_entries, payments, expenses и profiles (после 016) — это
-- `auth.role() = 'authenticated'`.
--
-- ВАЖНО на будущее. `create or replace view` СБРАСЫВАЕТ параметры
-- представления: если в следующей миграции переопределить report_view без
-- `with (security_invoker = true)`, дыра откроется снова. Права (revoke)
-- при этом сохраняются. Любое новое представление — сразу с этим параметром и
-- с revoke; за этим следит тест src/lib/migrations.test.ts.

revoke all on report_view          from anon;
revoke all on finance_income_view  from anon;
revoke all on finance_expense_view from anon;

alter view report_view          set (security_invoker = true);
alter view finance_income_view  set (security_invoker = true);
alter view finance_expense_view set (security_invoker = true);

-- ── Проверка 1. Должны вернуться три строки: security_invoker=true и
--    anon_can_select = false.
select c.relname                             as представление,
       c.reloptions                          as параметры,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;

-- ── Проверка 2 (для сведения). Функции базы, которые можно вызвать без входа.
--    Пустой результат — хорошо. Если строки есть, пришлите их мне: функцию,
--    доступную посетителю, надо смотреть отдельно.
select p.proname                                  as функция,
       p.prosecdef                                as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'execute');
