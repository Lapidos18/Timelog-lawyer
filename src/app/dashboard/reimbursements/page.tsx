'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import {
  Matter, Client, ReimbursableExpense, ReimbursementStatus, REIMBURSEMENT_STATUS_LABELS,
} from '@/types'
import { format } from 'date-fns'
import { Plus, X, Check, Trash2, Receipt } from 'lucide-react'
import toast from 'react-hot-toast'

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

const STATUS_COLORS: Record<ReimbursementStatus, string> = {
  pending: 'text-navy-400 bg-navy-800',
  invoiced: 'text-amber-400 bg-amber-900/30',
  reimbursed: 'text-emerald-400 bg-emerald-900/30',
}

const emptyForm = {
  matter_id: '',
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  amount: '',
  description: '',
  doc_no: '',
  status: 'pending' as ReimbursementStatus,
}

export default function ReimbursementsPage() {
  const supabase = createClient()
  const [expenses, setExpenses] = useState<ReimbursableExpense[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  const [filterMatter, setFilterMatter] = useState('')
  const [filterStatus, setFilterStatus] = useState<ReimbursementStatus | ''>('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: expData }, { data: mattersData }] = await Promise.all([
      supabase.from('reimbursable_expenses').select('*, matters(*, clients(*))').order('expense_date', { ascending: false }),
      supabase.from('matters').select('*, clients(*)').order('title'),
    ])
    setExpenses((expData ?? []) as ReimbursableExpense[])
    setMatters((mattersData ?? []) as (Matter & { clients: Client })[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadAll() }, [loadAll])

  function resetForm() {
    setForm(emptyForm)
    setEditId(null)
    setShowForm(false)
  }

  function startEdit(e: ReimbursableExpense) {
    setForm({
      matter_id: e.matter_id,
      expense_date: e.expense_date,
      amount: String(e.amount),
      description: e.description,
      doc_no: e.doc_no || '',
      status: e.status,
    })
    setEditId(e.id)
    setShowForm(true)
  }

  async function submitForm() {
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const amountNum = parseFloat(form.amount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму'); return }
    if (!form.description.trim()) { toast.error('Укажите описание расхода'); return }
    setSubmitting(true)
    const payload = {
      matter_id: form.matter_id,
      expense_date: form.expense_date,
      amount: amountNum,
      description: form.description,
      doc_no: form.doc_no || null,
      status: form.status,
    }
    const { error } = editId
      ? await supabase.from('reimbursable_expenses').update(payload).eq('id', editId)
      : await supabase.from('reimbursable_expenses').insert(payload)

    setSubmitting(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success(editId ? 'Расход обновлён' : 'Расход добавлен')
    resetForm()
    loadAll()
  }

  async function deleteExpense(id: string) {
    if (!confirm('Удалить запись о расходе?')) return
    const { error } = await supabase.from('reimbursable_expenses').delete().eq('id', id)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Удалено')
    loadAll()
  }

  async function quickStatusChange(e: ReimbursableExpense, status: ReimbursementStatus) {
    await supabase.from('reimbursable_expenses').update({ status }).eq('id', e.id)
    loadAll()
  }

  const filtered = expenses.filter(e =>
    (!filterMatter || e.matter_id === filterMatter) &&
    (!filterStatus || e.status === filterStatus)
  )
  const totalPending = filtered.filter(e => e.status !== 'reimbursed').reduce((s, e) => s + Number(e.amount), 0)
  const totalAll = filtered.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="p-4 md:p-7">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-navy-100 flex items-center gap-2">
          <Receipt className="w-6 h-6 text-gold-400" />
          Возмещаемые расходы
        </h1>
        <p className="text-sm text-navy-500 mt-1">
          Такси, почта, госпошлина и иные издержки, компенсируемые доверителем сверх вознаграждения —
          учитываются отдельно и не входят в акт об оказании юридической помощи как часть гонорара.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="card">
          <div className="text-xs text-navy-500 mb-1">Ожидает компенсации (не оплачено доверителем)</div>
          <div className="text-xl font-bold text-gold-400">{fmt(totalPending)} ₽</div>
        </div>
        <div className="card">
          <div className="text-xs text-navy-500 mb-1">Итого расходов по фильтру</div>
          <div className="text-xl font-bold text-navy-200">{fmt(totalAll)} ₽</div>
        </div>
      </div>

      {/* Filters + add button */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Дело</label>
          <select className="select" value={filterMatter} onChange={e => setFilterMatter(e.target.value)}>
            <option value="">Все дела</option>
            {matters.map(m => <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="label">Статус</label>
          <select className="select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as ReimbursementStatus | '')}>
            <option value="">Все статусы</option>
            {(Object.entries(REIMBURSEMENT_STATUS_LABELS) as [ReimbursementStatus, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Добавить расход
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-5 border-gold-800/40">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-navy-200 text-sm">
              {editId ? 'Редактировать расход' : 'Новый возмещаемый расход'}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">Дело *</label>
              <select className="select" value={form.matter_id}
                onChange={e => setForm(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {matters.map(m => <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Дата</label>
              <input type="date" className="input" value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Сумма *</label>
              <input type="number" inputMode="decimal" className="input" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Описание *</label>
              <input type="text" className="input" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Например: такси до нотариуса, почтовые расходы, госпошлина" />
            </div>
            <div>
              <label className="label">№ документа (чек, квитанция)</label>
              <input type="text" className="input" value={form.doc_no}
                onChange={e => setForm(f => ({ ...f, doc_no: e.target.value }))} />
            </div>
            <div>
              <label className="label">Статус</label>
              <select className="select" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as ReimbursementStatus }))}>
                {(Object.entries(REIMBURSEMENT_STATUS_LABELS) as [ReimbursementStatus, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4 flex gap-3">
              <button onClick={submitForm} disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Table (desktop) */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-navy-600 mb-2 hidden md:block">💡 Двойной клик по строке — редактировать</p>
      )}
      <div className="card hidden md:block">
        {loading ? (
          <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
        ) : filtered.length === 0 ? (
          <p className="text-navy-500 text-sm text-center py-12">Нет записей.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-navy-500 border-b border-navy-800">
                <th className="pb-2 font-medium">Дата</th>
                <th className="pb-2 font-medium">Дело</th>
                <th className="pb-2 font-medium">Описание</th>
                <th className="pb-2 font-medium">№ документа</th>
                <th className="pb-2 font-medium">Статус</th>
                <th className="pb-2 font-medium text-right">Сумма</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}
                  onDoubleClick={() => startEdit(e)}
                  title="Двойной клик — редактировать"
                  className="border-b border-navy-800/40 table-row-hover cursor-pointer">
                  <td className="py-2">{format(new Date(e.expense_date), 'dd.MM.yyyy')}</td>
                  <td className="py-2 text-navy-400 max-w-[180px] truncate">
                    {e.matters?.clients?.name} / {e.matters?.title}
                  </td>
                  <td className="py-2 text-navy-300 max-w-[220px] truncate">{e.description}</td>
                  <td className="py-2 text-navy-500">{e.doc_no || '—'}</td>
                  <td className="py-2">
                    <select
                      value={e.status}
                      onClick={ev => ev.stopPropagation()}
                      onChange={ev => quickStatusChange(e, ev.target.value as ReimbursementStatus)}
                      className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS_COLORS[e.status]}`}>
                      {(Object.entries(REIMBURSEMENT_STATUS_LABELS) as [ReimbursementStatus, string][]).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-right font-medium">{fmt(e.amount)} ₽</td>
                  <td className="py-2 text-right">
                    <button onClick={ev => { ev.stopPropagation(); deleteExpense(e.id) }}
                      className="text-navy-600 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Card list (mobile) — то же содержимое, без горизонтальной прокрутки */}
      <div className="md:hidden">
        {loading ? (
          <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
        ) : filtered.length === 0 ? (
          <p className="text-navy-500 text-sm text-center py-12">Нет записей.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(e => (
              <div key={e.id}
                onClick={() => startEdit(e)}
                className="card p-3 active:bg-navy-800/60 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-navy-200 text-sm font-medium truncate">{e.matters?.clients?.name}</p>
                    <p className="text-navy-500 text-xs truncate">{e.matters?.title}</p>
                  </div>
                  <span className="text-navy-400 font-mono text-xs whitespace-nowrap flex-shrink-0">
                    {format(new Date(e.expense_date), 'dd.MM.yy')}
                  </span>
                </div>
                <p className="text-navy-300 text-xs mb-2 line-clamp-2">{e.description}</p>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <select
                    value={e.status}
                    onClick={ev => ev.stopPropagation()}
                    onChange={ev => quickStatusChange(e, ev.target.value as ReimbursementStatus)}
                    className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS_COLORS[e.status]}`}>
                    {(Object.entries(REIMBURSEMENT_STATUS_LABELS) as [ReimbursementStatus, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  {e.doc_no && <span className="text-navy-500 text-xs truncate">№ {e.doc_no}</span>}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-navy-800/60">
                  <span className="font-mono text-sm font-medium">{fmt(e.amount)} ₽</span>
                  <button onClick={ev => { ev.stopPropagation(); deleteExpense(e.id) }}
                    className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-navy-600 mt-4 leading-relaxed">
        Возмещение издержек (транспортные, почтовые, государственная пошлина и иные расходы) юридически
        отделено от вознаграждения адвоката: не включается в акт об оказании юридической помощи как часть
        гонорара и не образует объект обложения НДФЛ при документальном подтверждении и наличии условия
        о возмещении в соглашении (в используемых шаблонах соглашений — п. «Порядок оплаты»).
      </p>
    </div>
  )
}
