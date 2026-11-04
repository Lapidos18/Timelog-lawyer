import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

type WorkTotals = { hours: number; hourlyKop: number; accruedKop: number }
export type WorkRow = WorkTotals & {
  matter: { id: string; client_id: string; title: string }
  expensesKop: number
}

export function formatHours(hours: number) {
  const minutes = Math.round(hours * 60)
  const wholeHours = Math.floor(minutes / 60)
  return wholeHours && minutes % 60 === 0
    ? `${wholeHours} ч`
    : `${wholeHours ? `${wholeHours} ч ` : ''}${minutes % 60} мин`
}

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })

function WorkMetrics({ hours, hourlyKop, accruedKop }: WorkTotals) {
  return (
    <span className="grid grid-cols-3 gap-2 text-xs tabular-nums">
      {[
        ['Учтено', formatHours(hours)],
        ['За часы', money.format(hourlyKop / 100)],
        ['Всего услуги', money.format(accruedKop / 100)],
      ].map(([label, value]) => (
        <span key={label} className="min-w-0">
          <span className="block text-navy-400">{label}</span>
          <span className="block break-words font-medium text-navy-100">{value}</span>
        </span>
      ))}
    </span>
  )
}

export default function MonthlyWork({ current, previous, clientNames }: {
  current: WorkRow[]
  previous: WorkRow[]
  clientNames: Record<string, string>
}) {
  const [period, setPeriod] = useState('current')
  const byClient = new Map<string, { totals: WorkTotals; rows: WorkRow[] }>()
  for (const row of (period === 'current' ? current : previous)) {
    const id = row.matter.client_id
    const client = byClient.get(id) ?? { totals: { hours: 0, hourlyKop: 0, accruedKop: 0 }, rows: [] }
    client.totals.hours += row.hours
    client.totals.hourlyKop += row.hourlyKop
    client.totals.accruedKop += row.accruedKop
    client.rows.push(row)
    byClient.set(id, client)
  }
  const clients = Array.from(byClient).sort(([, a], [, b]) => b.totals.accruedKop - a.totals.accruedKop)

  return (
    <section aria-labelledby="monthly-work-title" className="card mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="monthly-work-title" className="text-sm font-medium text-navy-300">Работа и начисления за месяц</h2>
        <select aria-label="Период сводки" className="input min-h-11 w-auto" value={period}
          onChange={e => setPeriod(e.target.value)}>
          <option value="current">Текущий месяц</option>
          <option value="previous">Прошлый месяц</option>
        </select>
      </div>
      <p className="mb-2 text-xs text-navy-400">
        {period === 'current' ? 'С начала месяца по сегодня. ' : ''}
        Учтено всё время. В сумме за услуги также учтены абонплата, фиксированные начисления и корректировки.
      </p>
      {clients.length === 0 && <p className="py-3 text-sm text-navy-400">За этот период записей нет.</p>}
      {clients.map(([id, { totals, rows }]) => (
        <details key={`${period}-${id}`} className="group border-t border-navy-700/50">
          <summary className="grid min-h-11 cursor-pointer list-none items-center gap-2 rounded py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 sm:grid-cols-2 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-navy-100">
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-navy-400 group-open:rotate-180" />
              <span className="min-w-0 break-words">{clientNames[id] ?? 'Доверитель'}</span>
            </span>
            <WorkMetrics {...totals} />
          </summary>
          <ul className="ml-2 space-y-3 border-l border-navy-700/50 py-2 pl-3">
            {rows.map(row => (
              <li key={row.matter.id} className="grid items-start gap-2 sm:grid-cols-2">
                <div className="min-w-0 break-words text-sm text-navy-200">{row.matter.title}</div>
                <div className="min-w-0">
                  <WorkMetrics {...row} />
                  {row.expensesKop !== 0 && (
                    <p className="mt-1 text-xs text-navy-400">Предъявленные расходы · {money.format(row.expensesKop / 100)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  )
}
