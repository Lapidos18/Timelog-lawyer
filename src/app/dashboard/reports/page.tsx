'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ReportRow, ReportFilters, Client, Matter, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { FileDown, FileSpreadsheet, Filter } from 'lucide-react'
import toast from 'react-hot-toast'

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n))
}

export default function ReportsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

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

  async function runReport() {
    setLoading(true)
    let q = supabase.from('report_view').select('*').order('work_date')

    if (filters.date_from) q = q.gte('work_date', filters.date_from)
    if (filters.date_to)   q = q.lte('work_date', filters.date_to)
    if (filters.client_id) q = q.eq('client_name', clients.find(c => c.id === filters.client_id)?.name ?? '')
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
    if (error) { toast.error('Ошибка запроса'); }
    else { setRows(data ?? []); setSearched(true) }
    setLoading(false)
  }

  async function handleExcelExport() {
    if (rows.length === 0) { toast.error('Нет данных для выгрузки'); return }
    const { exportToExcel } = await import('@/lib/reports')
    const title = `Отчёт_${filters.date_from}_${filters.date_to}`
    await exportToExcel(rows, title)
    toast.success('Excel сохранён')
  }

  async function handlePDFExport() {
    if (rows.length === 0) { toast.error('Нет данных для выгрузки'); return }
    const { exportToPDF } = await import('@/lib/reports')
    const title = `Отчёт о рабочем времени`
    const sub = `${filters.date_from} — ${filters.date_to} · АК Бухмин А.А.`
    await exportToPDF(rows, title, sub)
    toast.success('PDF сохранён')
  }

  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalBillable = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)
  const totalEntries = rows.length

  return (
    <div className="p-7">
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
        <div className="grid grid-cols-4 gap-4 mb-4">
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
              {matters
                .filter(m => !filters.client_id || m.client_id === filters.client_id)
                .map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
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
            <select className="select" value={filters.is_billable === undefined ? '' : String(filters.is_billable)}
              onChange={e => setFilters(f => ({ ...f, is_billable: e.target.value === '' ? undefined : e.target.value === 'true' }))}>
              <option value="">Все</option>
              <option value="true">Оплачиваемые</option>
              <option value="false">Неоплачиваемые</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={runReport} disabled={loading} className="btn-primary w-full justify-center">
              {loading ? 'Загрузка...' : 'Сформировать'}
            </button>
          </div>
        </div>
      </div>

      {/* Summary */}
      {searched && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="stat-card">
            <p className="text-xs text-navy-400">Записей</p>
            <p className="text-2xl font-semibold text-navy-100">{totalEntries}</p>
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

      {/* Results table */}
      {searched && (
        <div className="card overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-navy-500 text-sm text-center py-12">Нет данных по заданным фильтрам.</p>
          ) : (
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="border-b border-navy-800">
                  {['№','Дата','Клиент','Дело','№ согл.','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                    <th key={h} className="text-left pb-2.5 pr-3 text-navy-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-navy-800/40 table-row-hover">
                    <td className="py-2.5 pr-3 text-navy-600">{i+1}</td>
                    <td className="py-2.5 pr-3 font-mono text-navy-400 whitespace-nowrap">
                      {format(new Date(r.work_date), 'dd.MM.yy')}
                    </td>
                    <td className="py-2.5 pr-3 text-navy-300 max-w-[140px] truncate">{r.client_name}</td>
                    <td className="py-2.5 pr-3 text-navy-300 max-w-[150px] truncate">{r.matter_title}</td>
                    <td className="py-2.5 pr-3 text-navy-500">{r.agreement_no ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      <span className="badge-gold">{ACTIVITY_LABELS[r.activity_type]}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-navy-300 max-w-[180px] truncate">{r.description}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-navy-300">{Number(r.hours).toFixed(2)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-navy-400">{formatMoney(r.hourly_rate)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">
                      {r.is_billable
                        ? <span className="text-gold-400">{formatMoney(r.amount)} ₽</span>
                        : <span className="text-navy-600">—</span>}
                    </td>
                    <td className="py-2.5 text-navy-500 truncate max-w-[100px]">{r.performed_by}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy-700">
                  <td colSpan={7} className="pt-3 text-right text-navy-400 font-medium pr-3">Итого:</td>
                  <td className="pt-3 text-right font-mono font-semibold text-navy-200 pr-3">
                    {totalHours.toFixed(2)}
                  </td>
                  <td />
                  <td className="pt-3 text-right font-mono font-semibold text-gold-400 pr-3">
                    {formatMoney(totalBillable)} ₽
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
