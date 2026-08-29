-- Связь возмещаемых расходов с фактическим платежом.
--
-- Зачем. Доверитель оплачивает одной суммой и вознаграждение, и компенсацию
-- издержек. Пример: платёж 54 505,34 ₽, внутри которого 387,34 ₽ — возмещение
-- почтовых расходов. Возмещение издержек НЕ является доходом адвоката и не
-- должно попадать в базу по НДФЛ и в базу для 1% ОПС.
--
-- До этой миграции раздел «Доходы и налоги» вообще не знал о таблице
-- reimbursable_expenses, и вся сумма платежа облагалась налогом.
--
-- Почему нужна именно дата возмещения, а не дата расхода: НДФЛ считается по
-- поступлению денег. Расход мог быть в декабре, а компенсация прийти в январе —
-- исключать сумму нужно из того периода, когда деньги поступили.

alter table reimbursable_expenses
  add column if not exists payment_id uuid references payments(id) on delete set null;

alter table reimbursable_expenses
  add column if not exists reimbursed_date date;

comment on column reimbursable_expenses.payment_id is
  'Платёж, которым расход компенсирован. Проставляется при внесении платежа.';
comment on column reimbursable_expenses.reimbursed_date is
  'Дата поступления компенсации (= pay_date платежа). Именно по ней сумма '
  'исключается из дохода в расчёте НДФЛ и 1% ОПС.';

create index if not exists idx_reimbursable_expenses_payment
  on reimbursable_expenses(payment_id);
create index if not exists idx_reimbursable_expenses_reimbursed_date
  on reimbursable_expenses(reimbursed_date);

-- Проверка: должны вернуться две строки
select column_name, data_type
from information_schema.columns
where table_name = 'reimbursable_expenses'
  and column_name in ('payment_id', 'reimbursed_date')
order by column_name;
