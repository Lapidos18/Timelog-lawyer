import { FeeTerms, ManualAccrual, isSubscription, subscriptionKop, manualAccrualsKop } from './balance'

type MoneyRow = { amount: number | string }
export function dashboardTotals(
  matters: (FeeTerms & { id: string })[],
  entries: (MoneyRow & { matter_id: string; is_billable: boolean; hours: number | string })[],
  accruals: (ManualAccrual & { matter_id: string })[],
  receipts: MoneyRow[], from: string, to: string,
) {
  let fee = 0
  for (const matter of matters) {
    fee += isSubscription(matter)
      ? subscriptionKop(matter, to, from)
      : entries.filter(e => e.matter_id === matter.id && e.is_billable)
        .reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0)
    fee += manualAccrualsKop(accruals.filter(a => a.matter_id === matter.id), to, from)
  }
  return {
    hours: Math.round(entries.reduce((sum, e) => sum + Number(e.hours), 0) * 100) / 100,
    accrued: fee / 100,
    received: receipts.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0) / 100,
  }
}
