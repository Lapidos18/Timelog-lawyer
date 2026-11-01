-- Уменьшение стоимости услуг: отрицательное начисление с обязательной причиной.
-- Часы, ставки и поступления денег не изменяются. Применить вручную в SQL Editor.
begin;
alter table public.matter_accruals
  drop constraint if exists matter_accruals_amount_check;
alter table public.matter_accruals
  add constraint matter_accruals_amount_check check (amount <> 0);
alter table public.matter_accruals
  drop constraint if exists matter_accruals_reduction_reason_check;
alter table public.matter_accruals
  add constraint matter_accruals_reduction_reason_check
  check (amount > 0 or length(btrim(description)) > 0);
commit;
