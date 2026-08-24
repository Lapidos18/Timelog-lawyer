-- Уникальность номера акта.
--
-- Номер акта заполняется вручную, и до сих пор ничто не мешало выпустить
-- два акта с одним номером. Для документа, который передаётся доверителю
-- и попадает в отчётность, дублирование номера — проблема.

-- Шаг 1. Проверка: есть ли уже дубликаты.
-- Если запрос вернёт строки — сначала исправьте номера в приложении,
-- иначе следующий шаг завершится ошибкой.
select act_no, count(*) as повторов
from acts
group by act_no
having count(*) > 1;

-- Шаг 2. Само ограничение.
-- Выполнять после того, как шаг 1 вернул пустой результат.
--
-- `alter table ... add constraint` не поддерживает `if not exists`, поэтому
-- обёрнуто в проверку: миграцию можно запускать повторно, ошибки
-- "relation acts_act_no_unique already exists" больше не будет.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'acts'::regclass
      and conname = 'acts_act_no_unique'
  ) then
    alter table acts add constraint acts_act_no_unique unique (act_no);
    raise notice 'Ограничение acts_act_no_unique создано';
  else
    raise notice 'Ограничение acts_act_no_unique уже существует — ничего не меняем';
  end if;
end $$;

-- Проверка результата: должна вернуться одна строка с UNIQUE (act_no)
select conname, pg_get_constraintdef(oid) as определение
from pg_constraint
where conrelid = 'acts'::regclass and conname = 'acts_act_no_unique';
