-- Таблица платежей от доверителей
create table if not exists payments (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  matter_id   uuid references matters(id) on delete set null,
  pay_date    date not null default current_date,
  amount      numeric(10,2) not null check (amount > 0),
  description text not null default 'Оплата юридических услуг',
  doc_no      text,   -- № платёжного поручения / квитанции
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

alter table payments enable row level security;
create policy "Все аутентифицированные видят платежи" on payments
  for select using (auth.role() = 'authenticated');
create policy "Все аутентифицированные создают платежи" on payments
  for insert with check (auth.role() = 'authenticated');
create policy "Все аутентифицированные редактируют платежи" on payments
  for update using (auth.role() = 'authenticated');
create policy "Все аутентифицированные удаляют платежи" on payments
  for delete using (auth.role() = 'authenticated');
