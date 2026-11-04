import { FeeTerms, ManualAccrual, isSubscription, subscriptionKop, manualAccrualsKop } from './balance'

type MoneyRow = { amount: number | string }
type TimeRow = MoneyRow & {
  matter_id: string
  is_billable: boolean
  hours: number | string
  duration_min?: number
}

function entryHours(entry: TimeRow) {
  return entry.duration_min == null ? Number(entry.hours) : entry.duration_min / 60
}

export function matterPeriodTotals<M extends FeeTerms & { id: string }>(
  matters: M[],
  entries: TimeRow[],
  accruals: (ManualAccrual & { matter_id: string })[],
  from: string, to: string,
) {
  const timeByMatter = new Map<string, { hours: number; hourlyKop: number }>()
  for (const entry of entries) {
    const time = timeByMatter.get(entry.matter_id) ?? { hours: 0, hourlyKop: 0 }
    time.hours += entryHours(entry)
    if (entry.is_billable) time.hourlyKop += Math.round(Number(entry.amount) * 100)
    timeByMatter.set(entry.matter_id, time)
  }
  return matters.map(matter => {
    const time = timeByMatter.get(matter.id)
    const subscription = isSubscription(matter)
    const hourlyKop = subscription ? 0 : (time?.hourlyKop ?? 0)
    const accruedKop = hourlyKop + (subscription ? subscriptionKop(matter, to, from) : 0)
      + manualAccrualsKop(accruals.filter(a => a.matter_id === matter.id), to, from)
    return { matter, hours: time?.hours ?? 0, hourlyKop, accruedKop }
  })
}

export function dashboardTotals(
  matters: (FeeTerms & { id: string })[],
  entries: TimeRow[],
  accruals: (ManualAccrual & { matter_id: string })[],
  receipts: MoneyRow[], from: string, to: string,
) {
  return {
    hours: Math.round(entries.reduce((sum, e) => sum + entryHours(e), 0) * 100) / 100,
    accrued: matterPeriodTotals(matters, entries, accruals, from, to)
      .reduce((sum, row) => sum + row.accruedKop, 0) / 100,
    received: receipts.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0) / 100,
  }
}
