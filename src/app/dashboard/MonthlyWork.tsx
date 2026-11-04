import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

type WorkTotals = { hours: number; hourlyKop: number; accruedKop: number }
export type WorkRow = WorkTotals & {
  matter: { id: string; client_id: string; title: string }
  expensesKop: number
}
export type ClientDebt = { id: string; billed: number; reimb: number; paid: number; debt: number }

export function formatHours(hours: number) {
  const minutes = Math.round(hours * 60)
  const wholeHours = Math.floor(minutes / 60)
  return wholeHours && minutes % 60 === 0
    ? `${wholeHours} ч`
    : `${wholeHours ? `${wholeHours} ч ` : ''}${minutes % 60} мин`
}

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function Metrics({ items, compact = false }: {
  items: { label: string; value: string; highlight?: boolean }[]
  compact?: boolean
}) {
  return (
    <span className="grid grid-cols-3 gap-2 text-xs tabular-nums">
      {items.map(({ label, value, highlight }) => (
        <span key={label} className="min-w-0">
          <span className={`block text-navy-400 ${compact ? 'lg:sr-only' : ''}`}>{label}</span>
          <span className={`block break-words font-medium ${highlight ? 'text-red-400' : 'text-navy-100'}`}>{value}</span>
        </span>
      ))}
    </span>
  )
}

export default function MonthlyWork({ current, previous, clientNames, debts }: {
  current: WorkRow[]
  previous: WorkRow[]
  clientNames: Record<string, string>
  debts: ClientDebt[]
}) {
  const [period, setPeriod] = useState('current')
  const byClient = new Map<string, { hours: number; accruedKop: number; rows: WorkRow[]; debt?: ClientDebt }>()
  for (const debt of debts) byClient.set(debt.id, { hours: 0, accruedKop: 0, rows: [], debt })
  for (const row of (period === 'current' ? current : previous)) {
    const id = row.matter.client_id
    const client = byClient.get(id) ?? { hours: 0, accruedKop: 0, rows: [] }
    client.hours += row.hours
    client.accruedKop += row.accruedKop
    client.rows.push(row)
    byClient.set(id, client)
  }
  const clients = Array.from(byClient).sort(([, a], [, b]) =>
    Number(b.rows.length > 0) - Number(a.rows.length > 0)
    || b.accruedKop - a.accruedKop || (b.debt?.debt ?? 0) - (a.debt?.debt ?? 0))

  return (
    <section aria-labelledby="monthly-work-title" className="card mb-5 !p-3 md:!px-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="monthly-work-title" className="text-sm font-medium text-navy-300">Сводка по доверителям</h2>
        <select aria-label="Период сводки" className="input min-h-11 w-auto" value={period}
          onChange={e => setPeriod(e.target.value)}>
          <option value="current">Текущий месяц</option>
          <option value="previous">Прошлый месяц</option>
        </select>
      </div>
      {clients.length === 0 ? (
        <p className="py-2 text-sm text-navy-400">За выбранный месяц записей нет. Текущей задолженности нет.</p>
      ) : (
        <div aria-hidden="true" className="hidden grid-cols-2 gap-2 py-1 text-xs text-navy-400 lg:grid">
          <span className="pl-6">Доверитель</span>
          <span className="grid grid-cols-3 gap-2">
            <span>Время за месяц</span><span>Услуги за месяц</span><span>Долг на сегодня</span>
          </span>
        </div>
      )}
      {clients.map(([id, { hours, accruedKop, rows, debt }]) => (
        <details key={id} className="group border-t border-navy-700/50">
          <summary className="grid min-h-11 cursor-pointer list-none items-center gap-2 rounded py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 lg:grid-cols-2 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-navy-100">
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-navy-400 group-open:rotate-180" />
              <span className="min-w-0 break-words">{clientNames[id] ?? 'Доверитель'}</span>
            </span>
            <Metrics compact items={[
              { label: 'Время за месяц', value: rows.length ? formatHours(hours) : '—' },
              { label: 'Услуги за месяц', value: rows.length ? money.format(accruedKop / 100) : '—' },
              { label: 'Долг на сегодня', value: debt ? money.format(debt.debt) : '—', highlight: !!debt },
            ]} />
          </summary>
          <div className="mb-2 ml-2 space-y-2 border-l border-navy-700/50 py-1 pl-3">
            {rows.length > 0 && <ul className="space-y-2">
              {rows.map(row => (
                <li key={row.matter.id} className="grid items-start gap-2 sm:grid-cols-2">
                  <div className="min-w-0 break-words text-sm text-navy-200">{row.matter.title}</div>
                  <div className="min-w-0">
                    <Metrics items={[
                      { label: 'Учтено', value: formatHours(row.hours) },
                      { label: 'За часы', value: money.format(row.hourlyKop / 100) },
                      { label: 'Всего услуги', value: money.format(row.accruedKop / 100) },
                    ]} />
                    {row.expensesKop !== 0 && (
                      <p className="mt-1 text-xs text-navy-400">Предъявленные расходы · {money.format(row.expensesKop / 100)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>}
            {debt && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-navy-300">
                <span>Начислено к оплате {money.format(debt.billed + debt.reimb)}
                  {debt.reimb > 0 && <span className="text-navy-400">, из них расходы {money.format(debt.reimb)}</span>}
                </span>
                <span className="text-emerald-400">Оплачено {money.format(debt.paid)}</span>
              </p>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
