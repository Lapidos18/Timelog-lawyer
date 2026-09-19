-- 015. Акт хранит свой состав; записи подписанного акта нельзя изменить
--
-- Зачем. До этой миграции акт хранил только сумму, а строки при каждой
-- печати собирались заново из журнала — в том виде, какой он на сегодня.
-- Поправили запись за июль — подписанный июльский акт при повторной печати
-- показывал другую сумму, чем та, что подписал доверитель. Добавили запись
-- задним числом — она появлялась в уже подписанном акте.
--
-- Что делает:
--   1. acts.rows — копия строк акта на момент его создания. Печать берёт
--      строки отсюда, а не из журнала.
--   2. Существующие акты получают копию из текущего состояния журнала.
--      Если журнал уже правили после подписания, копия зафиксирует
--      исправленный вариант — более раннего состояния в базе нет.
--      Расхождения со старой суммой покажет запрос в конце.
--   3. Триггер не даёт изменить или удалить запись времени, вошедшую
--      в акт со статусом «Подписан» или «Оплачен». Запрет стоит в базе,
--      а не в приложении: записи правятся с трёх экранов, и забыть проверку
--      на одном из них невозможно.
--
-- Как исправить запись в подписанном акте: перевести акт в «Черновик»,
-- исправить запись, в акте нажать «Обновить из журнала», подписать снова.
-- Каждый шаг попадает в историю изменений (миграция 013).
--
-- Добавлять НОВЫЕ записи в закрытый период не запрещено: забытое задним
-- числом время — обычная ситуация, оно пойдёт в следующий акт. В уже
-- созданный акт такая запись не попадёт, потому что акт печатается
-- из своей копии.

alter table acts add column if not exists rows jsonb;

-- 2. Копия для актов, созданных до этой миграции
update acts a set rows = (
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',            rv.id,
      'work_date',     rv.work_date,
      'activity_type', rv.activity_type,
      'description',   rv.description,
      'hours',         rv.hours,
      'hourly_rate',   rv.hourly_rate,
      'amount',        rv.amount,
      'performed_by',  rv.performed_by
    ) order by rv.work_date), '[]'::jsonb)
  from report_view rv
  where rv.matter_id = a.matter_id
    and rv.work_date between a.period_from and a.period_to
    and rv.is_billable
)
where a.rows is null;

-- 3. Запрет правки записей подписанных и оплаченных актов
create or replace function prevent_locked_entry_change() returns trigger
language plpgsql
as $$
declare
  locked_act text;
begin
  select a.act_no into locked_act
  from acts a
  where a.status in ('signed', 'paid')
    and a.rows is not null
    and exists (
      select 1 from jsonb_array_elements(a.rows) r
      where r->>'id' = old.id::text
    )
  limit 1;

  if locked_act is not null then
    raise exception 'Запись входит в акт %, он подписан или оплачен. Чтобы её изменить, переведите акт в «Черновик».', locked_act;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists lock_entries_in_signed_acts on time_entries;
create trigger lock_entries_in_signed_acts
  before update or delete on time_entries
  for each row execute function prevent_locked_entry_change();

-- Проверка: акты, у которых сумма по копии строк не совпадает с суммой,
-- записанной при создании. Пустой результат — всё сходится.
-- Непустой — журнал правили после создания акта; сверьте с подписанным
-- экземпляром.
select act_no, status,
       amount as "сумма при создании",
       (select coalesce(sum((r->>'amount')::numeric), 0)
          from jsonb_array_elements(rows) r) as "сумма по журналу сейчас"
from acts
where abs(amount - (select coalesce(sum((r->>'amount')::numeric), 0)
                      from jsonb_array_elements(rows) r)) > 0.005
order by act_no;
