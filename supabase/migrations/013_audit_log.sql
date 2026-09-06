-- 013. История изменений денежных записей
--
-- Зачем. Суммы в приложении правятся вручную: платёж внесли не той суммой,
-- статус возмещаемого расхода сняли, акт удалили. Сейчас после правки прежнее
-- значение исчезает бесследно, и вопрос «почему в июле было 45 294, а стало
-- 48 074» остаётся без ответа. Для адвоката это не любопытство: если налоговая
-- спросит, откуда взялась цифра, нужно показать не только результат, но и то,
-- как он менялся.
--
-- Что делает. Триггер на четыре таблицы, где живут деньги, складывает в
-- audit_log старое и новое состояние строки. Приложение туда не пишет —
-- только читает, поэтому забыть залогировать правку невозможно.
--
-- Объём. Одна строка на изменение. При нынешней нагрузке это десятки записей
-- в месяц; чистить не потребуется годами.

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text        not null,
  row_id      uuid        not null,
  action      text        not null check (action in ('insert', 'update', 'delete')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid        references auth.users(id),
  changed_at  timestamptz not null default now()
);

-- Читаем историю по конкретной записи и общей лентой — под оба случая индекс
create index if not exists audit_log_row_idx  on audit_log (table_name, row_id, changed_at desc);
create index if not exists audit_log_time_idx on audit_log (changed_at desc);

create or replace function log_change() returns trigger
language plpgsql
security definer
as $$
begin
  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('update', 'delete') then to_jsonb(old) end,
    case when tg_op in ('insert', 'update') then to_jsonb(new) end,
    auth.uid()
  );
  -- Для delete вернуть надо old, иначе строка не удалится
  return case when tg_op = 'delete' then old else new end;
end;
$$;

-- Триггеры вешаем только на денежные таблицы: время правится часто и
-- крупных последствий не имеет, а история по нему только зашумит ленту.
do $$
declare t text;
begin
  foreach t in array array['payments', 'manual_income', 'reimbursable_expenses', 'acts']
  loop
    -- drop + create вместо if not exists: у триггеров его нет,
    -- а миграцию должно быть безопасно запустить повторно
    execute format('drop trigger if exists %I on %I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on %I
       for each row execute function log_change()',
      'audit_' || t, t
    );
  end loop;
end $$;

alter table audit_log enable row level security;

-- Историю можно читать, но не править и не удалять: запись, которую можно
-- переписать, историей не является. Пишет только триггер — он выполняется
-- с правами владельца функции и под RLS не попадает.
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select using (auth.role() = 'authenticated');
