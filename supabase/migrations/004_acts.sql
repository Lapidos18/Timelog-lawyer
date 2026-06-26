-- Acts (акты об оказании юридической помощи)
create table if not exists acts (
  id          uuid primary key default uuid_generate_v4(),
  act_no      text not null,
  matter_id   uuid not null references matters(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  amount      numeric(10,2) not null,
  description text,
  status      text not null default 'draft' check (status in ('draft','signed','paid')),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
alter table acts enable row level security;
create policy "acts_select" on acts for select using (auth.role()='authenticated');
create policy "acts_insert" on acts for insert with check (auth.role()='authenticated');
create policy "acts_update" on acts for update using (auth.role()='authenticated');
create policy "acts_delete" on acts for delete using (auth.role()='authenticated');
