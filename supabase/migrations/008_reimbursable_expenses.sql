-- Возмещаемые расходы по делу (такси, почта, госпошлина и т.п.)
-- Экономически и юридически это компенсация издержек доверителем,
-- а НЕ вознаграждение адвоката — не включается в акт об оказании
-- услуг как часть гонорара и не облагается НДФЛ как доход адвоката,
-- при условии надлежащего документального подтверждения расходов
-- и наличия в соглашении условия об их возмещении доверителем.

create table if not exists reimbursable_expenses (
  id            uuid primary key default uuid_generate_v4(),
  matter_id     uuid not null references matters(id) on delete cascade,
  expense_date  date not null default current_date,
  amount        numeric(10,2) not null check (amount > 0),
  description   text not null default '',
  status        text not null default 'pending' check (status in ('pending', 'invoiced', 'reimbursed')),
  doc_no        text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_reimbursable_expenses_matter on reimbursable_expenses(matter_id);

alter table reimbursable_expenses enable row level security;
create policy "reimbursable_expenses_select" on reimbursable_expenses for select using (auth.role() = 'authenticated');
create policy "reimbursable_expenses_insert" on reimbursable_expenses for insert with check (auth.role() = 'authenticated');
create policy "reimbursable_expenses_update" on reimbursable_expenses for update using (auth.role() = 'authenticated');
create policy "reimbursable_expenses_delete" on reimbursable_expenses for delete using (auth.role() = 'authenticated');

create trigger reimbursable_expenses_updated_at before update on reimbursable_expenses
  for each row execute function update_updated_at();
