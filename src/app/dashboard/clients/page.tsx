'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, ClientType } from '@/types'
import { Plus, Pencil, X, Check, Building2, User } from 'lucide-react'
import toast from 'react-hot-toast'

const TYPE_LABELS: Record<ClientType, string> = {
  individual: 'Физическое лицо',
  legal_entity: 'Организация',
}

export default function ClientsPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    name: '', type: 'individual' as ClientType,
    inn: '', phone: '', email: '', address: '', notes: '', is_active: true,
  })

  const loadClients = useCallback(async () => {
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients(data ?? []); setLoading(false)
  }, [])

  useEffect(() => { loadClients() }, [])

  function resetForm() {
    setForm({ name: '', type: 'individual', inn: '', phone: '', email: '', address: '', notes: '', is_active: true })
    setEditId(null); setShowForm(false)
  }

  function startEdit(c: Client) {
    setForm({ name: c.name, type: c.type, inn: c.inn ?? '', phone: c.phone ?? '',
      email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '', is_active: c.is_active })
    setEditId(c.id); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault(); setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = { ...form, inn: form.inn || null, phone: form.phone || null,
      email: form.email || null, address: form.address || null, notes: form.notes || null,
      created_by: user!.id }
    const { error } = editId
      ? await supabase.from('clients').update(payload).eq('id', editId)
      : await supabase.from('clients').insert(payload)
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success(editId ? 'Клиент обновлён' : 'Клиент добавлен'); resetForm(); loadClients() }
    setSubmitting(false)
  }

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Клиенты</h1>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Новый клиент
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 border-gold-800/40">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-medium text-navy-200">{editId ? 'Редактировать' : 'Новый клиент'}</h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="label">Наименование / ФИО *</label>
              <input className="input" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Рудаков Евгений Владимирович" />
            </div>
            <div>
              <label className="label">Тип</label>
              <select className="select" value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as ClientType }))}>
                {(Object.entries(TYPE_LABELS) as [ClientType, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">ИНН</label>
              <input className="input" value={form.inn}
                onChange={e => setForm(f => ({ ...f, inn: e.target.value }))} placeholder="540200000000" />
            </div>
            <div>
              <label className="label">Телефон</label>
              <input className="input" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7 913 000-00-00" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="label">Адрес</label>
              <input className="input" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="630099, г. Новосибирск, ул. Трудовая, д. 10" />
            </div>
            <div className="col-span-2">
              <label className="label">Примечания</label>
              <textarea className="input resize-none" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <p className="text-xs text-navy-600 mb-2">💡 Двойной клик по клиенту — редактировать</p>
      )}

      <div className="card">
        {loading ? <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
          : clients.length === 0 ? (
            <p className="text-navy-500 text-sm text-center py-12">
              Нет клиентов.{' '}
              <button onClick={() => setShowForm(true)} className="text-gold-400 hover:underline">
                Добавить →
              </button>
            </p>
          ) : (
            <div className="grid gap-2">
              {clients.map(c => (
                <div key={c.id}
                  onDoubleClick={() => startEdit(c)}
                  title="Двойной клик — редактировать"
                  className="flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer
                                            hover:bg-navy-800/50 transition-colors border border-transparent
                                            hover:border-navy-700/50">
                  <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0">
                    {c.type === 'legal_entity'
                      ? <Building2 className="w-4 h-4 text-navy-400" />
                      : <User className="w-4 h-4 text-navy-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-navy-200 font-medium text-sm truncate">{c.name}</p>
                    <p className="text-navy-500 text-xs">
                      {TYPE_LABELS[c.type]}
                      {c.inn && ` · ИНН ${c.inn}`}
                      {c.phone && ` · ${c.phone}`}
                    </p>
                  </div>
                  <span className={c.is_active ? 'badge-active' : 'badge-inactive'}>
                    {c.is_active ? 'Активный' : 'Архив'}
                  </span>
                  <button onClick={() => startEdit(c)} className="btn-ghost p-1.5">
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
