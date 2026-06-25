'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, MatterType, MatterStatus, MATTER_TYPE_LABELS, MATTER_STATUS_LABELS } from '@/types'
import { Plus, Pencil, X, Check, Gavel } from 'lucide-react'
import toast from 'react-hot-toast'

interface MatterWithClient extends Matter { clients: Client }

export default function MattersPage() {
  const supabase = createClient()
  const [matters, setMatters] = useState<MatterWithClient[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterStatus, setFilterStatus] = useState<MatterStatus | 'all'>('active')

  const [form, setForm] = useState({
    client_id: '', title: '', agreement_no: '',
    matter_type: 'litigation' as MatterType, status: 'active' as MatterStatus,
    court: '', case_no: '', hourly_rate: '', fixed_fee: '',
    started_at: '', closed_at: '', notes: '',
  })

  const loadMatters = useCallback(async () => {
    const q = supabase.from('matters').select('*, clients(*)').order('created_at', { ascending: false })
    const { data } = filterStatus === 'all' ? await q : await q.eq('status', filterStatus)
    setMatters((data ?? []) as MatterWithClient[]); setLoading(false)
  }, [filterStatus])

  useEffect(() => {
    supabase.from('clients').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setClients(data ?? []))
  }, [])

  useEffect(() => { loadMatters() }, [filterStatus])

  function resetForm() {
    setForm({ client_id: '', title: '', agreement_no: '', matter_type: 'litigation',
      status: 'active', court: '', case_no: '', hourly_rate: '', fixed_fee: '',
      started_at: '', closed_at: '', notes: '' })
    setEditId(null); setShowForm(false)
  }

  function startEdit(m: MatterWithClient) {
    setForm({
      client_id: m.client_id, title: m.title, agreement_no: m.agreement_no ?? '',
      matter_type: m.matter_type, status: m.status, court: m.court ?? '',
      case_no: m.case_no ?? '', hourly_rate: m.hourly_rate ? String(m.hourly_rate) : '',
      fixed_fee: m.fixed_fee ? String(m.fixed_fee) : '', started_at: m.started_at ?? '',
      closed_at: m.closed_at ?? '', notes: m.notes ?? '',
    })
    setEditId(m.id); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault(); setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      client_id: form.client_id, title: form.title,
      agreement_no: form.agreement_no || null, matter_type: form.matter_type,
      status: form.status, court: form.court || null, case_no: form.case_no || null,
      hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
      fixed_fee: form.fixed_fee ? parseFloat(form.fixed_fee) : null,
      started_at: form.started_at || null, closed_at: form.closed_at || null,
      notes: form.notes || null, created_by: user!.id,
    }
    const { error } = editId
      ? await supabase.from('matters').update(payload).eq('id', editId)
      : await supabase.from('matters').insert(payload)
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success(editId ? 'Дело обновлено' : 'Дело добавлено'); resetForm(); loadMatters() }
    setSubmitting(false)
  }

  const statusBadge = (s: MatterStatus) => ({
    active: 'badge-active',
    suspended: 'badge bg-amber-900/30 text-amber-400 border border-amber-800/40',
    closed: 'badge-inactive',
  }[s])

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Дела</h1>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Новое дело
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 border-gold-800/40">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-medium text-navy-200">{editId ? 'Редактировать дело' : 'Новое дело'}</h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <div>
              <label className="label">Клиент *</label>
              <select className="select" required value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Название дела *</label>
              <input className="input" required value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Шипунова против Рудакова, дело о ремонте" />
            </div>
            <div>
              <label className="label">№ соглашения</label>
              <input className="input" value={form.agreement_no}
                onChange={e => setForm(f => ({ ...f, agreement_no: e.target.value }))} placeholder="1/2026" />
            </div>
            <div>
              <label className="label">Тип дела</label>
              <select className="select" value={form.matter_type}
                onChange={e => setForm(f => ({ ...f, matter_type: e.target.value as MatterType }))}>
                {(Object.entries(MATTER_TYPE_LABELS) as [MatterType, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Статус</label>
              <select className="select" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as MatterStatus }))}>
                {(Object.entries(MATTER_STATUS_LABELS) as [MatterStatus, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Суд</label>
              <input className="input" value={form.court}
                onChange={e => setForm(f => ({ ...f, court: e.target.value }))}
                placeholder="Октябрьский районный суд г. НСК" />
            </div>
            <div>
              <label className="label">№ дела в суде</label>
              <input className="input" value={form.case_no}
                onChange={e => setForm(f => ({ ...f, case_no: e.target.value }))} placeholder="2-17/2026" />
            </div>
            <div>
              <label className="label">Ставка, руб./ч</label>
              <input type="number" className="input" value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} placeholder="1290" />
            </div>
            <div>
              <label className="label">Дата начала</label>
              <input type="date" className="input" value={form.started_at}
                onChange={e => setForm(f => ({ ...f, started_at: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дата закрытия</label>
              <input type="date" className="input" value={form.closed_at}
                onChange={e => setForm(f => ({ ...f, closed_at: e.target.value }))} />
            </div>
            <div className="col-span-3">
              <label className="label">Примечания</label>
              <textarea className="input resize-none" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="col-span-3 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['active', 'suspended', 'closed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === s
                ? 'bg-navy-700 text-navy-100'
                : 'text-navy-500 hover:text-navy-300'
            }`}>
            {{ active: 'Активные', suspended: 'Приостановленные', closed: 'Закрытые', all: 'Все' }[s]}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
          : matters.length === 0 ? (
            <p className="text-navy-500 text-sm text-center py-12">Нет дел.</p>
          ) : (
            <div className="grid gap-2">
              {matters.map(m => (
                <div key={m.id} className="flex items-start gap-4 px-4 py-3 rounded-lg
                                            hover:bg-navy-800/50 transition-colors border border-transparent
                                            hover:border-navy-700/50">
                  <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Gavel className="w-4 h-4 text-navy-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-navy-200 font-medium text-sm">{m.title}</p>
                      <span className={statusBadge(m.status)}>{MATTER_STATUS_LABELS[m.status]}</span>
                      <span className="badge bg-navy-800 text-navy-400 border border-navy-700">
                        {MATTER_TYPE_LABELS[m.matter_type]}
                      </span>
                    </div>
                    <p className="text-navy-500 text-xs mt-0.5">
                      {m.clients?.name}
                      {m.agreement_no && ` · Соглашение ${m.agreement_no}`}
                      {m.case_no && ` · Дело ${m.case_no}`}
                      {m.court && ` · ${m.court}`}
                      {m.hourly_rate && ` · ${m.hourly_rate} ₽/ч`}
                    </p>
                  </div>
                  <button onClick={() => startEdit(m)} className="btn-ghost p-1.5 flex-shrink-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
