'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { TimeEntry, ReportRow, ACTIVITY_LABELS } from '@/types'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Clock, Banknote, Briefcase, TrendingUp } from 'lucide-react'
import Link from 'next/link'

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

export default function DashboardPage() {
  const supabase = createClient()
  const [stats, setStats] = useState({
    hoursThisMonth: 0,
    revenueThisMonth: 0,
    activeMatters: 0,
    hoursThisWeek: 0,
  })
  const [recentEntries, setRecentEntries] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const monthLabel = format(now, 'LLLL yyyy', { locale: ru })

  useEffect(() => {
    async function load() {
      const [entriesRes, mattersRes, recentRes] = await Promise.all([
        supabase
          .from('report_view')
          .select('hours, amount, is_billable')
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
      ])

      const entries = entriesRes.data ?? []
      const totalHours = entries.reduce((s, r) => s + Number(r.hours), 0)
      const totalRevenue = entries.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)

      setStats({
        hoursThisMonth: Math.round(totalHours * 10) / 10,
        revenueThisMonth: totalRevenue,
        activeMatters: mattersRes.count ?? 0,
        hoursThisWeek: 0,
      })
      setRecentEntries(recentRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-4 md:p-7">
      <div className="mb-5 md:mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Обзор</h1>
        <p className="text-navy-400 text-sm mt-0.5 capitalize">{monthLabel}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="stat-card">
          <div className="flex items-center gap-2 text-navy-400 text-xs mb-2">
            <Clock className="w-3.5 h-3.5" /> Часов за месяц
          </div>
          <p className="text-3xl font-semibold text-navy-100">
            {loading ? '—' : stats.hoursThisMonth}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-navy-400 text-xs mb-2">
            <Banknote className="w-3.5 h-3.5" /> Выручка за месяц
          </div>
          <p className="text-3xl font-semibold text-gold-400">
            {loading ? '—' : formatMoney(stats.revenueThisMonth)}
            <span className="text-sm font-normal text-navy-400 ml-1">₽</span>
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-navy-400 text-xs mb-2">
            <Briefcase className="w-3.5 h-3.5" /> Активных дел
          </div>
          <p className="text-3xl font-semibold text-navy-100">
            {loading ? '—' : stats.activeMatters}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-navy-400 text-xs mb-2">
            <TrendingUp className="w-3.5 h-3.5" /> Ср. ставка
          </div>
          <p className="text-3xl font-semibold text-navy-100">
            {loading || stats.hoursThisMonth === 0 ? '—' :
              formatMoney(stats.revenueThisMonth / stats.hoursThisMonth)}
            <span className="text-sm font-normal text-navy-400 ml-1">₽/ч</span>
          </p>
        </div>
      </div>

      {/* Recent entries */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-navy-200">Последние записи</h2>
          <Link href="/dashboard/entries" className="btn-ghost text-xs">
            Все записи →
          </Link>
        </div>

        {recentEntries.length === 0 && !loading ? (
          <p className="text-navy-500 text-sm text-center py-8">
            Нет записей. <Link href="/dashboard/entries" className="text-gold-400 hover:underline">Добавить первую →</Link>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-800">
                <th className="text-left pb-2 text-xs text-navy-500 font-medium">Дата</th>
                <th className="text-left pb-2 text-xs text-navy-500 font-medium">Клиент / Дело</th>
                <th className="text-left pb-2 text-xs text-navy-500 font-medium">Вид работы</th>
                <th className="text-left pb-2 text-xs text-navy-500 font-medium">Описание</th>
                <th className="text-right pb-2 text-xs text-navy-500 font-medium">Часов</th>
                <th className="text-right pb-2 text-xs text-navy-500 font-medium">Сумма</th>
                <th className="text-left pb-2 text-xs text-navy-500 font-medium">Исполнитель</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.map(e => (
                <tr key={e.id} className="border-b border-navy-800/50 table-row-hover">
                  <td className="py-2.5 text-navy-400 whitespace-nowrap font-mono text-xs">
                    {format(new Date(e.work_date), 'dd.MM.yy')}
                  </td>
                  <td className="py-2.5 pr-4">
                    <p className="text-navy-200 font-medium truncate max-w-[180px]">{e.client_name}</p>
                    <p className="text-navy-500 text-xs truncate max-w-[180px]">{e.matter_title}</p>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="badge-gold">{ACTIVITY_LABELS[e.activity_type]}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-navy-300 text-xs max-w-[220px] truncate">
                    {e.description}
                  </td>
                  <td className="py-2.5 text-right text-navy-300 font-mono text-xs">
                    {Number(e.hours).toFixed(2)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-xs">
                    {e.is_billable
                      ? <span className="text-gold-400">{formatMoney(e.amount)} ₽</span>
                      : <span className="text-navy-600">—</span>}
                  </td>
                  <td className="py-2.5 pl-4 text-navy-500 text-xs truncate max-w-[120px]">
                    {e.performed_by}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
