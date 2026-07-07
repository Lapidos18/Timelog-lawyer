-- Ручной учёт доходов (не привязанных к оплатам по актам от клиентов)
-- Например: авансы наличными, доходы по договорам вне Timelog, корректировки.

create table if not exists manual_income (
  id           uuid primary key default uuid_generate_v4(),
  income_date  date not null default current_date,
  client_id    uuid references clients(id) on delete set null,
  matter_id    uuid references matters(id) on delete set null,
  amount       numeric(10,2) not null check (amount > 0),
  description  text not null default '',
  doc_no       text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table manual_income enable row level security;
create policy "manual_income_select" on manual_income for select using (auth.role() = 'authenticated');
create policy "manual_income_insert" on manual_income for insert with check (auth.role() = 'authenticated');
create policy "manual_income_update" on manual_income for update using (auth.role() = 'authenticated');
create policy "manual_income_delete" on manual_income for delete using (auth.role() = 'authenticated');

create trigger manual_income_updated_at before update on manual_income
  for each row execute function update_updated_at();
