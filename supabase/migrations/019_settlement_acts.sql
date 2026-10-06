-- 019. Акты сверки взаимных расчётов (форма «как в 1С»)
--
-- Зачем. Контрагенты обмениваются актом сверки в одной и той же форме: две
-- таблицы рядом («по данным кабинета» и «по данным доверителя») с колонками
-- Дебет и Кредит, сальдо и выводом «задолженность в пользу …». Страница
-- «Акты сверки» собирает такой акт из журнала, издержек и платежей, а
-- пользователь может дозаполнить и поправить любую строку. Составленный акт
-- нужно хранить: его отправляют доверителю, ждут ответа, потом вносят его
-- данные во вторую таблицу и сравнивают.
--
-- Что хранится. Весь акт одним документом в jsonb (`doc`): реквизиты сторон,
-- строки обеих таблиц, начальное сальдо. Так же устроены строки обычных актов
-- (миграция 015): акт — это то, что было составлено, а не то, что можно
-- пересобрать из журнала заново, потому что строки правят вручную. Обычными
-- колонками вынесено только то, по чему ищут и фильтруют: доверитель, период
-- и статус. Суммы внутри `doc` лежат в копейках целыми числами.
--
-- Статусы: draft — черновик, signed — подписан. У подписанного акта
-- приложение блокирует правку; чтобы изменить, его возвращают в черновик
-- (как обычный акт, см. п. 13 в CLAUDE.md).

create table if not exists settlement_acts (
  id          uuid primary key default gen_random_uuid(),

  -- on delete restrict: доверителя с составленным актом сверки удалить нельзя,
  -- иначе акт остался бы без адресата
  client_id   uuid not null references clients(id) on delete restrict,

  period_from date not null,
  period_to   date not null check (period_to >= period_from),

  status      text not null default 'draft' check (status in ('draft', 'signed')),

  -- Содержимое акта; формат — SettlementDoc в src/lib/settlement-act.ts
  doc         jsonb not null,

  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists settlement_acts_client_idx on settlement_acts (client_id, period_to desc);

alter table settlement_acts enable row level security;

-- Правила как у остальных таблиц: доступ только после входа.
-- `using (true)` здесь недопустимо — см. п. 14 в CLAUDE.md.
create policy "settlement_acts_select" on settlement_acts for select using (auth.role() = 'authenticated');
create policy "settlement_acts_insert" on settlement_acts for insert with check (auth.role() = 'authenticated');
create policy "settlement_acts_update" on settlement_acts for update using (auth.role() = 'authenticated');
create policy "settlement_acts_delete" on settlement_acts for delete using (auth.role() = 'authenticated');

-- Второй замок поверх правил: посетитель без входа не получает к таблице
-- доступа вообще, а не только пустой список (то же сделано для представлений
-- в миграции 018)
revoke all on settlement_acts from anon;

-- Журнал изменений (миграция 013): акт сверки — денежный документ, и «кто и
-- когда сменил сумму или статус» должно быть видно
drop trigger if exists audit_settlement_acts on settlement_acts;
create trigger audit_settlement_acts
  after insert or update or delete on settlement_acts
  for each row execute function log_change();

-- updated_at обновляем сами: в остальных таблицах так же
create or replace function touch_settlement_acts() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists settlement_acts_touch on settlement_acts;
create trigger settlement_acts_touch
  before update on settlement_acts
  for each row execute function touch_settlement_acts();

-- Проверка. Должна вернуться одна строка: таблица пуста, а посетитель без
-- входа читать её не может (anon_can_select = false).
select (select count(*) from settlement_acts)           as "актов в таблице",
       has_table_privilege('anon', 'settlement_acts', 'select') as anon_can_select;
