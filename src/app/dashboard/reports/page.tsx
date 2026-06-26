'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ReportRow, ReportFilters, Client, Matter, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { FileDown, FileSpreadsheet, Filter, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

type GroupBy = 'none' | 'client' | 'matter'

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n))
}

function groupRows(rows: ReportRow[], groupBy: GroupBy): { key: string; label: string; sublabel?: string; rows: ReportRow[] }[] {
  if (groupBy === 'none') return [{ key: 'all', label: '', rows }]
  const groups: Record<string, { key: string; label: string; sublabel?: string; rows: ReportRow[] }> = {}
  for (const r of rows) {
    const key = groupBy === 'client' ? r.client_name : r.matter_title
    if (!groups[key]) {
      groups[key] = {
        key,
        label: groupBy === 'client' ? r.client_name : r.matter_title,
        sublabel: groupBy === 'matter' ? r.client_name : undefined,
        rows: [],
      }
    }
    groups[key].rows.push(r)
  }
  return Object.values(groups)
}

export default function ReportsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const now = new Date()
  const [filters, setFilters] = useState<ReportFilters>({
    date_from: format(startOfMonth(now), 'yyyy-MM-dd'),
    date_to: format(endOfMonth(now), 'yyyy-MM-dd'),
  })

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('matters').select('*, clients(*)').order('title'),
      supabase.from('profiles').select('*').order('full_name'),
    ]).then(([c, m, u]) => {
      setClients(c.data ?? [])
      setMatters((m.data ?? []) as (Matter & { clients: Client })[])
      setUsers(u.data ?? [])
    })
  }, [])

  const clientMatters = matters.filter(m =>
    !filters.client_id || m.client_id === filters.client_id
  )

  async function runReport() {
    setLoading(true)
    let q = supabase.from('report_view').select('*').order('work_date')

    if (filters.date_from) q = q.gte('work_date', filters.date_from)
    if (filters.date_to)   q = q.lte('work_date', filters.date_to)
    if (filters.client_id) {
      const name = clients.find(c => c.id === filters.client_id)?.name ?? ''
      q = q.eq('client_name', name)
    }
    if (filters.matter_id) {
      const m = matters.find(x => x.id === filters.matter_id)
      if (m) q = q.eq('matter_title', m.title)
    }
    if (filters.user_id) {
      const u = users.find(x => x.id === filters.user_id)
      if (u) q = q.eq('performed_by', u.full_name)
    }
    if (filters.activity_type) q = q.eq('activity_type', filters.activity_type)
    if (filters.is_billable !== undefined) q = q.eq('is_billable', filters.is_billable)

    const { data, error } = await q
    if (error) { toast.error('Ошибка запроса') }
    else { setRows(data ?? []); setSearched(true) }
    setLoading(false)
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleExcelExport() {
    if (rows.length === 0) { toast.error('Нет данных'); return }
    const { exportToExcel } = await import('@/lib/reports')
    await exportToExcel(rows, `Отчёт_${filters.date_from}_${filters.date_to}`)
    toast.success('Excel сохранён')
  }

  async function handlePDFExport() {
    if (rows.length === 0) { toast.error('Нет данных'); return }
    const { exportToPDF } = await import('@/lib/reports')
    const clientName = clients.find(c => c.id === filters.client_id)?.name
    const matterName = matters.find(m => m.id === filters.matter_id)?.title
    const title = matterName
      ? `Отчёт по делу: ${matterName}`
      : clientName
      ? `Отчёт по клиенту: ${clientName}`
      : 'Отчёт о рабочем времени'
    const sub = `${filters.date_from} — ${filters.date_to} · АК Бухмин А.А.`
    exportToPDF(rows, title, sub)
  }

  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalBillable = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)
  const groups = groupRows(rows, groupBy)

  const fmtDate = (d: string) => format(new Date(d), 'dd.MM.yy')

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Отчёты</h1>
        {searched && rows.length > 0 && (
          <div className="flex gap-2">
            <button onClick={handleExcelExport} className="btn-secondary">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button onClick={handlePDFExport} className="btn-secondary">
              <FileDown className="w-4 h-4" /> PDF
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-5">
        <div className="flex items-center gap-2 mb-4 text-navy-400 text-sm">
          <Filter className="w-4 h-4" /> Фильтры
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div>
            <label className="label">Дата с</label>
            <input type="date" className="input" value={filters.date_from ?? ''}
              onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
          </div>
          <div>
            <label className="label">Дата по</label>
            <input type="date" className="input" value={filters.date_to ?? ''}
              onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
          </div>
          <div>
            <label className="label">Клиент</label>
            <select className="select" value={filters.client_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, client_id: e.target.value || undefined, matter_id: undefined }))}>
              <option value="">Все клиенты</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Дело</label>
            <select className="select" value={filters.matter_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, matter_id: e.target.value || undefined }))}>
              <option value="">Все дела</option>
              {clientMatters.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Исполнитель</label>
            <select className="select" value={filters.user_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, user_id: e.target.value || undefined }))}>
              <option value="">Все</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Вид работы</label>
            <select className="select" value={filters.activity_type ?? ''}
              onChange={e => setFilters(f => ({ ...f, activity_type: (e.target.value || undefined) as ActivityType }))}>
              <option value="">Все виды</option>
              {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Оплачиваемость</label>
            <select className="select"
              value={filters.is_billable === undefined ? '' : String(filters.is_billable)}
              onChange={e => setFilters(f => ({ ...f, is_billable: e.target.value === '' ? undefined : e.target.value === 'true' }))}>
              <option value="">Все</option>
              <option value="true">Оплачиваемые</option>
              <option value="false">Неоплачиваемые</option>
            </select>
          </div>
          <div>
            <label className="label">Группировка</label>
            <select className="select" value={groupBy}
              onChange={e => setGroupBy(e.target.value as GroupBy)}>
              <option value="none">Без группировки</option>
              <option value="client">По клиенту</option>
              <option value="matter">По делу</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={runReport} disabled={loading} className="btn-primary">
            {loading ? 'Загрузка...' : 'Сформировать'}
          </button>
          {filters.matter_id && searched && rows.length > 0 && (
            <button onClick={handlePDFExport} className="btn-secondary text-xs">
              <FileDown className="w-3.5 h-3.5" /> PDF для клиента
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      {searched && (
        <div className="grid grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-5">
          <div className="stat-card">
            <p className="text-xs text-navy-400">Записей</p>
            <p className="text-2xl font-semibold text-navy-100">{rows.length}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-navy-400">Итого часов</p>
            <p className="text-2xl font-semibold text-navy-100">{totalHours.toFixed(2)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-navy-400">К оплате</p>
            <p className="text-2xl font-semibold text-gold-400">{formatMoney(totalBillable)} ₽</p>
          </div>
        </div>
      )}

      {/* Results */}
      {searched && rows.length === 0 && (
        <div className="card">
          <p className="text-navy-500 text-sm text-center py-12">Нет данных по заданным фильтрам.</p>
        </div>
      )}

      {searched && rows.length > 0 && (
        <div className="space-y-4">
          {groups.map(group => {
            const collapsed = collapsedGroups.has(group.key)
            const groupHours = group.rows.reduce((s, r) => s + Number(r.hours), 0)
            const groupAmount = group.rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)

            return (
              <div key={group.key} className="card p-0 overflow-hidden">
                {/* Group header */}
                {groupBy !== 'none' && (
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-5 py-3
                               bg-navy-800/50 hover:bg-navy-800 transition-colors border-b border-navy-700/50">
                    <div className="flex items-center gap-3">
                      {collapsed
                        ? <ChevronRight className="w-4 h-4 text-navy-500" />
                        : <ChevronDown className="w-4 h-4 text-navy-500" />}
                      <div className="text-left">
                        <p className="text-sm font-semibold text-navy-200">{group.label}</p>
                        {group.sublabel && <p className="text-xs text-navy-500">{group.sublabel}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-xs text-navy-400">
                      <span>{group.rows.length} записей</span>
                      <span>{groupHours.toFixed(2)} ч</span>
                      <span className="text-gold-400 font-semibold">{formatMoney(groupAmount)} ₽</span>
                    </div>
                  </button>
                )}

                {/* Group rows */}
                {!collapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[800px]">
                      <thead>
                        <tr className="border-b border-navy-800">
                          {['№','Дата','Клиент','Дело','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                            <th key={h} className="text-left px-3 py-2.5 text-navy-500 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((r, i) => (
                          <tr key={r.id} className="border-b border-navy-800/40 table-row-hover">
                            <td className="px-3 py-2 text-navy-600">{i+1}</td>
                            <td className="px-3 py-2 font-mono text-navy-400 whitespace-nowrap">{fmtDate(r.work_date)}</td>
                            <td className="px-3 py-2 text-navy-300 max-w-[120px] truncate">{r.client_name}</td>
                            <td className="px-3 py-2 text-navy-300 max-w-[130px] truncate">{r.matter_title}</td>
                            <td className="px-3 py-2">
                              <span className="badge-gold">{ACTIVITY_LABELS[r.activity_type]}</span>
                            </td>
                            <td className="px-3 py-2 text-navy-300 max-w-[180px] truncate">{r.description}</td>
                            <td className="px-3 py-2 text-right font-mono text-navy-300">{Number(r.hours).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-navy-400">{formatMoney(r.hourly_rate)}</td>
                            <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                              {r.is_billable
                                ? <span className="text-gold-400">{formatMoney(r.amount)} ₽</span>
                                : <span className="text-navy-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-navy-500 truncate max-w-[100px]">{r.performed_by}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-navy-700 bg-navy-800/30">
                          <td colSpan={6} className="px-3 pt-2 pb-2 text-right text-navy-400 font-medium">
                            {groupBy !== 'none' ? 'Итого по группе:' : 'Итого:'}
                          </td>
                          <td className="px-3 pt-2 pb-2 text-right font-mono font-semibold text-navy-200">
                            {groupHours.toFixed(2)}
                          </td>
                          <td />
                          <td className="px-3 pt-2 pb-2 text-right font-mono font-semibold text-gold-400">
                            {formatMoney(groupAmount)} ₽
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {/* Grand total for grouped view */}
          {groupBy !== 'none' && (
            <div className="card flex justify-end gap-8 py-3">
              <span className="text-sm text-navy-400">Всего часов:
                <strong className="text-navy-200 ml-2">{totalHours.toFixed(2)}</strong>
              </span>
              <span className="text-sm text-navy-400">Итого к оплате:
                <strong className="text-gold-400 ml-2">{formatMoney(totalBillable)} ₽</strong>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
