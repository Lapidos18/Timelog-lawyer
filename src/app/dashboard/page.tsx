'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ReportRow } from '@/types'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import Link from 'next/link'
import { Clock, Banknote, Briefcase, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react'
import LoadError from '@/components/LoadError'

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function DashboardPage() {
  const supabase = createClient()
  const [stats, setStats] = useState({
    hoursThisMonth: 0,
    revenueThisMonth: 0,
    activeMatters: 0,
    avgRate: 0,
  })
  const [recentEntries, setRecentEntries] = useState<ReportRow[]>([])
  const [clientBalances, setClientBalances] = useState<{
    id: string; name: string; billed: number; reimb: number; paid: number; debt: number
  }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const now = new Date()
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd   = format(endOfMonth(now),   'yyyy-MM-dd')
  const monthLabel = format(now, 'LLLL yyyy', { locale: ru })

  useEffect(() => {
    async function load() {
      try {
        // Все независимые запросы отправляем ОДНОВРЕМЕННО, а не по очереди —
        // это кратно ускоряет загрузку страницы
        const [
          monthRes,
          mattersRes,
          recentRes,
          allEntriesRes,
          allPaymentsRes,
          allClientsRes,
          allMattersRes,
          allReimbRes,
        ] = await Promise.all([
          supabase
            .from('report_view')
            .select('hours, amount, is_billable, hourly_rate')
            .gte('work_date', monthStart)
            .lte('work_date', monthEnd),
          supabase
            .from('matters')
            .select('id', { count: 'exact' })
            .eq('status', 'active'),
          supabase
            .from('report_view')
            .select('*')
            .order('work_date', { ascending: false })
            .limit(8),
          supabase
            .from('time_entries')
            .select('matter_id, amount, is_billable'),
          supabase
            .from('payments')
            .select('client_id, amount'),
          supabase
            .from('clients')
            .select('id, name'),
          supabase
            .from('matters')
            .select('id, client_id'),
          // Издержки, ПРЕДЪЯВЛЕННЫЕ доверителю: он платит их вместе с
          // вознаграждением, поэтому без них «оплачено» больше «начислено»
          // и долг занижается ровно на сумму компенсации.
          // «Ожидает включения в счёт» не берём — это ещё не предъявлено.
          supabase
            .from('reimbursable_expenses')
            .select('matter_id, amount, status')
            .in('status', ['invoiced', 'reimbursed']),
        ])

        const entries = monthRes.data ?? []
        const totalHours = entries.reduce((s, r) => s + Number(r.hours), 0)
        const billable = entries.filter(r => r.is_billable)
        const totalRevenue = billable.reduce((s, r) => s + Number(r.amount), 0)
        const avgRate = billable.length > 0
          ? billable.reduce((s, r) => s + Number(r.hourly_rate), 0) / billable.length
          : 0

        setStats({
          hoursThisMonth: Math.round(totalHours * 10) / 10,
          revenueThisMonth: totalRevenue,
          activeMatters: mattersRes.count ?? 0,
          avgRate,
        })

        setRecentEntries(recentRes.data ?? [])

        const allEntries = allEntriesRes.data
        const allPayments = allPaymentsRes.data
        const allClients = allClientsRes.data
        const allMatters = allMattersRes.data

        const clientMap: Record<string, string> = {}
        for (const c of (allClients ?? [])) {
          clientMap[c.id] = c.name
        }

        const matterClientMap: Record<string, string> = {}
        for (const m of (allMatters ?? [])) {
          matterClientMap[m.id] = m.client_id
        }

        // Ключуем по client_id, а не по имени — иначе тёзки (два разных
        // доверителя с одинаковым именем) задваиваются в одну строку.
        const billedMap: Record<string, number> = {}
        for (const r of (allEntries ?? [])) {
          const clientId = matterClientMap[r.matter_id]
          if (clientId && r.is_billable) {
            billedMap[clientId] = (billedMap[clientId] ?? 0) + Number(r.amount)
          }
        }

        const reimbMap: Record<string, number> = {}
        for (const r of (allReimbRes.data ?? [])) {
          const clientId = matterClientMap[r.matter_id]
          if (clientId) reimbMap[clientId] = (reimbMap[clientId] ?? 0) + Number(r.amount)
        }

        const paidMap: Record<string, number> = {}
        for (const p of (allPayments ?? [])) {
          paidMap[p.client_id] = (paidMap[p.client_id] ?? 0) + Number(p.amount)
        }

        // Считаем по всем доверителям, у кого есть хоть что-то предъявленное:
        // бывает дело только с издержками, без оплачиваемых часов
        const allClientIds = Array.from(
          new Set(Object.keys(billedMap).concat(Object.keys(reimbMap)))
        )
        const balances = allClientIds
          .map(clientId => ({
            id: clientId,
            name: clientMap[clientId] ?? '—',
            billed: billedMap[clientId] ?? 0,
            reimb: reimbMap[clientId] ?? 0,
            paid: paidMap[clientId] ?? 0,
            debt: (billedMap[clientId] ?? 0) + (reimbMap[clientId] ?? 0) - (paidMap[clientId] ?? 0),
          }))
          .filter(b => b.debt > 0.01)
          .sort((a, b) => b.debt - a.debt)
          .slice(0, 5)

        setClientBalances(balances)
        // Ошибку любого из запросов показываем явно: иначе Обзор просто
        // рисует нули, и это выглядит как «все данные пропали»
        setLoadError(!!(monthRes.error || recentRes.error || allEntriesRes.error
          || allPaymentsRes.error || allClientsRes.error || allMattersRes.error
          || allReimbRes.error))
      } catch (e) {
        console.error('Dashboard load error:', e)
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const ACTIVITY_LABELS: Record<string, string> = {
    consultation:   'Консультация',
    court_hearing:  'Заседание',
    document_prep:  'Документы',
    correspondence: 'Переписка',
    research:       'Исследование',
    travel:         'Выезд',
    other:          'Прочее',
  }

  return (
    <div className="p-4 md:p-7">
      <div className="mb-5 md:mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Обзор</h1>
        <p className="text-sm text-navy-300 capitalize">{monthLabel}</p>
      </div>

      {loadError && !loading && (
        <div className="mb-5">
          <LoadError onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Часов за месяц</span>
          </div>
          <p className="text-2xl font-semibold text-navy-100">
            {loading ? '—' : stats.hoursThisMonth}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Banknote className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Выручка за месяц</span>
          </div>
          <p className="text-2xl font-semibold text-navy-100">
            {loading ? '—' : formatMoney(stats.revenueThisMonth) + ' ₽'}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Активных дел</span>
          </div>
          <p className="text-2xl font-semibold text-navy-100">
            {loading ? '—' : stats.activeMatters}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Ср. ставка</span>
          </div>
          <p className="text-2xl font-semibold text-navy-100">
            {loading ? '—' : formatMoney(stats.avgRate) + ' ₽/ч'}
          </p>
        </div>
      </div>

      {/* Client balances */}
      {!loading && clientBalances.length > 0 && (
        <div className="card mb-5">
          <h2 className="text-sm font-medium text-navy-300 mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            Задолженность доверителей
          </h2>
          <div className="space-y-3">
            {clientBalances.map(b => (
              <div key={b.id} className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-navy-200 flex-1 min-w-[120px] truncate">{b.name}</span>
                <span className="text-xs text-navy-300">
                  начислено {formatMoney(b.billed + b.reimb)} ₽
                  {b.reimb > 0 && (
                    <span className="text-navy-400"> (в т.ч. возмещаемые расходы {formatMoney(b.reimb)} ₽)</span>
                  )}
                </span>
                <span className="text-xs text-emerald-400">оплачено {formatMoney(b.paid)} ₽</span>
                <span className="text-sm font-semibold text-red-400 whitespace-nowrap">
                  долг {formatMoney(b.debt)} ₽
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent entries */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-navy-300">Последние записи</h2>
          <Link href="/dashboard/entries"
            className="text-xs text-gold-400 hover:text-gold-300 flex items-center gap-1">
            Все записи <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loading ? (
          <p className="text-navy-300 text-sm text-center py-8">Загрузка...</p>
        ) : recentEntries.length === 0 ? (
          <p className="text-navy-300 text-sm text-center py-8">
            Нет записей.{' '}
            <Link href="/dashboard/entries" className="text-gold-400 hover:underline">
              Добавить →
            </Link>
          </p>
        ) : (
          <>
          {/* Table (desktop) */}
          <div className="hidden md:block overflow-x-auto lg:overflow-x-visible">
            <table className="w-full text-xs min-w-[600px] table-sticky">
              <thead>
                <tr className="border-b border-navy-800">
                  {['Дата','Доверитель / Дело','Вид работы','Описание','Часов','Сумма','Исполнитель'].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 text-navy-300 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentEntries.map(e => (
                  <tr key={e.id} className="border-b border-navy-800/40 table-row-hover">
                    <td className="py-2.5 pr-4 num text-navy-400 whitespace-nowrap">
                      {format(new Date(e.work_date), 'dd.MM.yy')}
                    </td>
                    <td className="py-2.5 pr-4">
                      <p className="text-navy-200 font-medium truncate max-w-[130px]">{e.client_name}</p>
                      <p className="text-navy-300 truncate max-w-[130px]">{e.matter_title}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="badge-gold">{ACTIVITY_LABELS[e.activity_type] ?? e.activity_type}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-navy-300 truncate max-w-[180px]">{e.description}</td>
                    <td className="py-2.5 pr-4 num text-navy-300">{Number(e.hours).toFixed(2)}</td>
                    <td className="py-2.5 pr-4 num whitespace-nowrap">
                      {e.is_billable
                        ? <span className="text-navy-100">{formatMoney(e.amount)} ₽</span>
                        : <span className="text-navy-400">—</span>}
                    </td>
                    <td className="py-2.5 text-navy-300 truncate max-w-[100px]">{e.performed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card list (mobile) — то же содержимое, без горизонтальной прокрутки */}
          <div className="md:hidden divide-y divide-navy-800/40">
            {recentEntries.map(e => (
              <div key={e.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-navy-200 text-sm font-medium truncate">{e.client_name}</p>
                    <p className="text-navy-300 text-xs truncate">{e.matter_title}</p>
                  </div>
                  <span className="text-navy-400 num text-xs whitespace-nowrap flex-shrink-0">
                    {format(new Date(e.work_date), 'dd.MM.yy')}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="badge-gold text-xs">{ACTIVITY_LABELS[e.activity_type] ?? e.activity_type}</span>
                  <span className="text-navy-400 num text-xs">{Number(e.hours).toFixed(2)} ч</span>
                </div>
                <p className="text-navy-300 text-xs mb-1.5 line-clamp-2">{e.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-navy-300 text-xs truncate">{e.performed_by}</span>
                  <span className="num text-sm">
                    {e.is_billable
                      ? <span className="text-navy-100 font-semibold">{formatMoney(e.amount)} ₽</span>
                      : <span className="text-navy-400">—</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  )
}
