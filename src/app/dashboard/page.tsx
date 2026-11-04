'use client'
import { readAllResult } from '@/lib/billing'
import { dashboardTotals, matterPeriodTotals } from '@/lib/dashboard-totals'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ReportRow } from '@/types'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import Link from 'next/link'
import { Clock, Banknote, Briefcase, TrendingUp, ArrowRight, CalendarClock } from 'lucide-react'
import LoadError from '@/components/LoadError'
import PageHeader from '@/components/PageHeader'
import { SkeletonStats, SkeletonRows } from '@/components/Skeleton'
import { daysUntil, untilLabel, toISO } from '@/lib/deadlines'
import { useMounted } from '@/lib/use-mounted'
import { matterFeeAccrued, ManualAccrual } from '@/lib/balance'
import MonthlyWork, { formatHours, type ClientDebt, type WorkRow } from './MonthlyWork'

/** Событие в блоке «Сроки и заседания» на Обзоре */
type UpcomingEvent = {
  id: string
  kind: 'hearing' | 'deadline' | 'other'
  title: string
  event_date: string
  event_time: string | null
  remind_days: number
  matters?: { title: string; clients?: { name: string } | null } | null
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function DashboardPage() {
  const supabase = createClient()
  const [stats, setStats] = useState({
    hoursThisMonth: 0,
    accruedThisMonth: 0,
    receivedThisMonth: 0,
    activeMatters: 0,
  })
  const [recentEntries, setRecentEntries] = useState<ReportRow[]>([])
  const [clientBalances, setClientBalances] = useState<ClientDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [monthlyWork, setMonthlyWork] = useState<{
    current: WorkRow[]; previous: WorkRow[]; clientNames: Record<string, string>
  }>({ current: [], previous: [], clientNames: {} })
  /** Просроченное и то, что наступит в пределах своего срока напоминания */
  const [upcoming, setUpcoming] = useState<UpcomingEvent[]>([])

  // Название месяца зависит от «сегодня», а страница собирается заранее:
  // до загрузки в браузере его не показываем (см. src/lib/use-mounted.ts)
  const mounted = useMounted()
  const now = new Date()
  const monthLabel = format(now, 'LLLL yyyy', { locale: ru })

  useEffect(() => {
    async function load() {
      try {
        const asOf = new Date()
        const today = toISO(asOf)
        const monthStart = toISO(startOfMonth(asOf))
        const previousMonth = subMonths(startOfMonth(asOf), 1)
        const previousStart = toISO(previousMonth)
        const previousEnd = toISO(endOfMonth(previousMonth))
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
          accrualsRes,
          eventsRes,
          manualMonthRes,
        ] = await Promise.all([
          readAllResult(supabase,'report_view','hours, duration_min, amount, is_billable, matter_id, work_date', q => q.gte('work_date',previousStart).lte('work_date',today)),
          supabase
            .from('matters')
            .select('id', { count: 'exact' })
            .eq('status', 'active'),
          supabase
            .from('report_view')
            .select('*')
            .order('work_date', { ascending: false })
            .limit(8),
          readAllResult(supabase,'time_entries','matter_id, amount, is_billable', q => q.lte('work_date',toISO(new Date()))),
          readAllResult(supabase,'payments','client_id, amount, pay_date', q => q.lte('pay_date',toISO(new Date()))),
          readAllResult(supabase, 'clients', 'id, name'),
          // Все поля дела: условия абонплаты (миграция 021) могут отсутствовать,
          // пока миграция не выполнена, — перечислять их в запросе нельзя
          readAllResult(supabase, 'matters', '*'),
          // Издержки, ПРЕДЪЯВЛЕННЫЕ доверителю: он платит их вместе с
          // вознаграждением, поэтому без них «оплачено» больше «начислено»
          // и долг занижается ровно на сумму компенсации.
          // «Ожидает включения в счёт» не берём — это ещё не предъявлено.
          readAllResult(supabase,'reimbursable_expenses','matter_id, amount, expense_date',q=>q.in('status',['invoiced','reimbursed']).lte('expense_date',today)),
          // Начисления по актам (миграция 022): работа на фиксированную сумму без часов.
          // Пока таблицы нет, запрос вернёт ошибку — Обзор из-за этого не падает
          readAllResult(supabase,'matter_accruals','matter_id, accrual_date, amount'),
          // Сроки и заседания: берём только неисполненные и не дальше
          // полугода — фильтр «за сколько дней предупреждать» у каждого
          // события свой и применяется уже здесь, в коде.
          // Пока миграция 017 не выполнена, запрос вернёт ошибку — блок
          // просто не покажется, страница из-за этого падать не должна.
          supabase
            .from('court_events')
            .select('id, kind, title, event_date, event_time, remind_days, done, matters(title, clients(name))')
            .eq('done', false)
            .lte('event_date', toISO(new Date(Date.now() + 180 * 86_400_000)))
            .order('event_date'),
          readAllResult(supabase,'manual_income','amount', q => q.gte('income_date',monthStart).lte('income_date',toISO(new Date()))),
        ])

        // Показываем только то, что уже пора видеть: просроченное и события
        // в пределах собственного срока напоминания каждого из них
        setUpcoming(((eventsRes.data ?? []) as unknown as UpcomingEvent[])
          .filter(e => daysUntil(e.event_date) <= e.remind_days))

        const currentEntries = (monthRes.data ?? []).filter(entry => entry.work_date >= monthStart)
        const totals = dashboardTotals(allMattersRes.data ?? [], currentEntries, accrualsRes.data ?? [],
          [...(allPaymentsRes.data ?? []).filter(p => p.pay_date >= monthStart), ...(manualMonthRes.data ?? [])],
          monthStart, today)
        setStats({hoursThisMonth: totals.hours, accruedThisMonth: totals.accrued,
          receivedThisMonth: totals.received, activeMatters: mattersRes.count ?? 0})

        setRecentEntries(recentRes.data ?? [])

        const allEntries = allEntriesRes.data
        const allPayments = allPaymentsRes.data
        const allClients = allClientsRes.data
        const allMatters = allMattersRes.data

        const clientMap: Record<string, string> = {}
        for (const c of (allClients ?? [])) {
          clientMap[c.id] = c.name
        }

        const workForPeriod = (from: string, to: string, entries: typeof currentEntries): WorkRow[] => {
          const expenses = new Map<string, number>()
          for (const expense of allReimbRes.data ?? []) {
            if (expense.expense_date >= from && expense.expense_date <= to) {
              expenses.set(expense.matter_id, (expenses.get(expense.matter_id) ?? 0)
                + Math.round(Number(expense.amount) * 100))
            }
          }
          return matterPeriodTotals(allMatters ?? [], entries, accrualsRes.data ?? [], from, to)
            .map(row => ({ ...row, expensesKop: expenses.get(row.matter.id) ?? 0 }))
            .filter(row => row.hours || row.accruedKop || row.hourlyKop || row.expensesKop)
        }

        setMonthlyWork({
          current: workForPeriod(monthStart, today, currentEntries),
          previous: workForPeriod(previousStart, previousEnd,
            (monthRes.data ?? []).filter(entry => entry.work_date <= previousEnd)),
          clientNames: clientMap,
        })

        const matterClientMap: Record<string, string> = {}
        for (const m of (allMatters ?? [])) {
          matterClientMap[m.id] = m.client_id
        }

        // Ключуем по client_id, а не по имени — иначе тёзки (два разных
        // доверителя с одинаковым именем) задваиваются в одну строку.
        // Начислено по делу — через общую функцию: по часам или по абонплате
        // (у абонентского дела часы денег не создают), см. src/lib/balance.ts
        const hoursByMatter: Record<string, number> = {}
        for (const r of (allEntries ?? [])) {
          if (r.matter_id && r.is_billable) {
            hoursByMatter[r.matter_id] = (hoursByMatter[r.matter_id] ?? 0) + Number(r.amount)
          }
        }
        const accrByMatter: Record<string, ManualAccrual[]> = {}
        for (const a of ((accrualsRes.error ? [] : accrualsRes.data) ?? []) as (ManualAccrual & { matter_id: string })[]) {
          (accrByMatter[a.matter_id] = accrByMatter[a.matter_id] ?? []).push(a)
        }
        const billedMap: Record<string, number> = {}
        for (const m of (allMatters ?? [])) {
          const accrued = matterFeeAccrued(m, hoursByMatter[m.id] ?? 0, today, accrByMatter[m.id])
          if (accrued !== 0) billedMap[m.client_id] = (billedMap[m.client_id] ?? 0) + accrued
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
            billed: billedMap[clientId] ?? 0,
            reimb: reimbMap[clientId] ?? 0,
            paid: paidMap[clientId] ?? 0,
            debt: (billedMap[clientId] ?? 0) + (reimbMap[clientId] ?? 0) - (paidMap[clientId] ?? 0),
          }))
          .filter(b => b.debt > 0.01)

        setClientBalances(balances)
        // Ошибку любого из запросов показываем явно: иначе Обзор просто
        // рисует нули, и это выглядит как «все данные пропали»
        setLoadError(!!(monthRes.error || recentRes.error || allEntriesRes.error
          || allPaymentsRes.error || allClientsRes.error || allMattersRes.error
          || allReimbRes.error || accrualsRes.error || manualMonthRes.error))
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
      <PageHeader title="Обзор"
        description={<span className="capitalize">{mounted ? monthLabel : ' '}</span>} />

      {loadError && !loading && (
        <div className="mb-5">
          <LoadError onRetry={() => window.location.reload()} />
        </div>
      )}

      {/* Сроки и заседания — самым верхом, до денег.
          Пропущенный срок обжалования не исправляется никакой аккуратностью
          в учёте часов, поэтому он должен попадаться на глаза первым.
          Блока нет, когда ничего не горит: пустая рамка каждый день
          приучает не смотреть в это место. */}
      {!loading && upcoming.length > 0 && (
        <div className="card mb-5 md:mb-6 border-amber-800/40">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium text-navy-200 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-400" /> Сроки и заседания
            </h2>
            <Link href="/dashboard/deadlines"
              className="tap text-xs text-gold-400 hover:text-gold-300 inline-flex items-center gap-1">
              Все <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <ul className="space-y-2.5">
            {upcoming.map(e => {
              const left = daysUntil(e.event_date)
              return (
                <li key={e.id} className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="min-w-0">
                    <span className={`text-sm ${left < 0 ? 'text-red-300' : 'text-navy-100'}`}>
                      {e.title}
                    </span>
                    {e.matters && (
                      <span className="block text-xs text-navy-400 truncate">
                        {e.matters.clients?.name} · {e.matters.title}
                      </span>
                    )}
                  </span>
                  <span className="text-xs whitespace-nowrap">
                    <span className="num text-navy-300">
                      {format(new Date(e.event_date + 'T12:00:00'), 'dd.MM.yyyy')}
                      {e.event_time ? ` · ${e.event_time.slice(0, 5)}` : ''}
                    </span>
                    <span className={`ml-2 font-medium ${left < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {untilLabel(e.event_date)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Stats.
          Четыре плитки в ряд — только от 1024 px. На промежуточной ширине
          (телефон в альбомной ориентации, узкое окно) колонка выходила
          уже суммы, и «95 001,50 ₽» вылезало за край плитки */}
      {loading ? (
        <div className="mb-5 md:mb-6"><SkeletonStats count={4} /></div>
      ) : loadError ? null : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Часов за месяц</span>
          </div>
          {/* На телефоне плитка шириной ~160 px: при 24 px знак ₽ отрывался
              на вторую строку, и «95 001,50» выглядело как обрезанное число */}
          <p className="text-xl md:text-2xl font-semibold text-navy-100 whitespace-nowrap">
            {formatHours(stats.hoursThisMonth)}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Banknote className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Начислено за услуги</span>
          </div>
          {/* На телефоне плитка шириной ~160 px: при 24 px знак ₽ отрывался
              на вторую строку, и «95 001,50» выглядело как обрезанное число */}
          <p className="text-xl md:text-2xl font-semibold text-navy-100 whitespace-nowrap">
            {formatMoney(stats.accruedThisMonth) + ' ₽'}
          </p><p className="text-xs text-navy-400 mt-2">За месяц по сегодня, без расходов.</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Активных дел</span>
          </div>
          {/* На телефоне плитка шириной ~160 px: при 24 px знак ₽ отрывался
              на вторую строку, и «95 001,50» выглядело как обрезанное число */}
          <p className="text-xl md:text-2xl font-semibold text-navy-100 whitespace-nowrap">
            {stats.activeMatters}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-navy-300" />
            <span className="text-xs text-navy-400">Поступило за месяц</span>
          </div>
          {/* На телефоне плитка шириной ~160 px: при 24 px знак ₽ отрывался
              на вторую строку, и «95 001,50» выглядело как обрезанное число */}
          <p className="text-xl md:text-2xl font-semibold text-navy-100 whitespace-nowrap">
            {formatMoney(stats.receivedThisMonth) + ' ₽'}
          </p><p className="text-xs text-navy-400 mt-2">Включая авансы и возмещения.</p>
        </div>
      </div>
      )}

      {!loading && !loadError && <MonthlyWork {...monthlyWork} debts={clientBalances} />}

      {/* Recent entries */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-navy-300">Последние записи</h2>
          <Link href="/dashboard/journal?view=table"
            className="tap text-xs text-gold-400 hover:text-gold-300 inline-flex items-center gap-1">
            Все записи <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loading ? (
          <SkeletonRows rows={6} />
        ) : recentEntries.length === 0 ? (
          <p className="text-navy-300 text-sm text-center py-8">
            Нет записей.{' '}
            <Link href="/dashboard/journal?view=table" className="text-gold-400 hover:underline">
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
