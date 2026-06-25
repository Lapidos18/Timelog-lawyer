'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format } from 'date-fns'
import { Plus, Pencil, Trash2, X, Check, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

interface EntryWithRelations {
  id: string
  matter_id: string
  user_id: string
  work_date: string
  duration_min: number
  hourly_rate: number
  amount: number
  activity_type: ActivityType
  description: string
  is_billable: boolean
  notes: string | null
  created_at: string
  updated_at: string
  matters: (Matter & { clients: Client }) | null
  profiles: Profile | null
}

const ACTIVITY_OPTIONS = Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]

// Шаблоны описаний по виду работы
const TEMPLATES: Record<ActivityType, string[]> = {
  consultation:   ['Консультация по телефону', 'Очная консультация', 'Консультация по материалам дела', 'Консультация по вопросам исполнения решения'],
  court_hearing:  ['Участие в судебном заседании', 'Предварительное судебное заседание', 'Участие в апелляционном заседании', 'Участие в кассационном заседании'],
  document_prep:  ['Подготовка искового заявления', 'Подготовка апелляционной жалобы', 'Подготовка кассационной жалобы', 'Подготовка возражений на иск', 'Составление договора', 'Подготовка правового заключения', 'Составление претензии'],
  correspondence: ['Переписка с судом', 'Переписка с контрагентом', 'Направление процессуальных документов', 'Переговоры с противоположной стороной'],
  research:       ['Правовой анализ материалов дела', 'Анализ судебной практики', 'Изучение нормативной базы', 'Анализ документов клиента'],
  travel:         ['Выезд в суд', 'Выезд к клиенту', 'Выезд к нотариусу', 'Выезд на место событий'],
  other:          ['Ознакомление с материалами дела', 'Получение документов', 'Нотариальные действия', 'Взаимодействие с государственными органами'],
}

function minutesToDisplay(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}
function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n))
}

export default function EntriesPage() {
  const supabase = createClient()
  const [entries, setEntries] = useState<EntryWithRelations[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [ndfl, setNdfl] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const [form, setForm] = useState({
    matter_id: '',
    work_date: format(new Date(), 'yyyy-MM-dd'),
    hours: '',
    minutes: '0',
    hourly_rate: '',
    activity_type: 'consultation' as ActivityType,
    description: '',
    is_billable: true,
    notes: '',
  })

  const effectiveRate = (base: string) => {
    const n = parseFloat(base || '0')
    return ndfl ? Math.round(n / 0.85) : n
  }

  const loadEntries = useCallback(async () => {
    const { data } = await supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setEntries((data ?? []) as EntryWithRelations[])
    setLoading(false)
  }, [])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        if (p) {
          setProfile(p)
          // Автозаполнение ставки из профиля
          if (p.hourly_rate) setForm(f => ({ ...f, hourly_rate: String(p.hourly_rate) }))
        }
      }
      const { data: m } = await supabase
        .from('matters').select('*, clients(*)').eq('status', 'active').order('title')
      setMatters((m ?? []) as (Matter & { clients: Client })[])
      loadEntries()
    }
    init()
  }, [])

  // Автозаполнение ставки при выборе дела
  useEffect(() => {
    if (!form.matter_id) return
    const m = matters.find(x => x.id === form.matter_id)
    if (m?.hourly_rate) {
      setForm(f => ({ ...f, hourly_rate: String(m.hourly_rate) }))
    } else if (profile?.hourly_rate) {
      setForm(f => ({ ...f, hourly_rate: String(profile.hourly_rate) }))
    }
  }, [form.matter_id])

  function resetForm() {
    setForm({
      matter_id: '',
      work_date: format(new Date(), 'yyyy-MM-dd'),
      hours: '',
      minutes: '0',
      hourly_rate: String(profile?.hourly_rate ?? ''),
      activity_type: 'consultation',
      description: '',
      is_billable: true,
      notes: '',
    })
    setEditId(null)
    setShowForm(false)
    setShowTemplates(false)
  }

  function startEdit(e: EntryWithRelations) {
    const h = Math.floor(e.duration_min / 60)
    const m = e.duration_min % 60
    setForm({
      matter_id: e.matter_id,
      work_date: e.work_date,
      hours: String(h),
      minutes: String(m),
      hourly_rate: String(e.hourly_rate),
      activity_type: e.activity_type,
      description: e.description,
      is_billable: e.is_billable,
      notes: e.notes ?? '',
    })
    setEditId(e.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const dmin = (parseInt(form.hours || '0') * 60) + parseInt(form.minutes || '0')
    if (dmin <= 0) { toast.error('Укажите время'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      matter_id: form.matter_id,
      user_id: user!.id,
      work_date: form.work_date,
      duration_min: dmin,
      hourly_rate: effectiveRate(form.hourly_rate),
      activity_type: form.activity_type,
      description: form.description,
      is_billable: form.is_billable,
      notes: form.notes || null,
    }
    const { error } = editId
      ? await supabase.from('time_entries').update(payload).eq('id', editId)
      : await supabase.from('time_entries').insert(payload)
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success(editId ? 'Запись обновлена' : 'Запись добавлена'); resetForm(); loadEntries() }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Удалить запись?')) return
    const { error } = await supabase.from('time_entries').delete().eq('id', id)
    if (error) { toast.error('Ошибка удаления') }
    else { toast.success('Удалено'); loadEntries() }
  }

  const templates = TEMPLATES[form.activity_type] ?? []

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Учёт времени</h1>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Новая запись
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 border-gold-800/40">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-medium text-navy-200">
              {editId ? 'Редактировать запись' : 'Новая запись'}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <div className="col-span-3 md:col-span-1">
              <label className="label">Дело *</label>
              <select className="select" value={form.matter_id}
                onChange={e => setForm(f => ({ ...f, matter_id: e.target.value }))} required>
                <option value="">— выберите дело —</option>
                {matters.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.clients?.name} / {m.title}{m.agreement_no ? ` (${m.agreement_no})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Дата *</label>
              <input type="date" className="input" value={form.work_date}
                onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} required />
            </div>

            <div>
              <label className="label">Вид работы *</label>
              <select className="select" value={form.activity_type}
                onChange={e => {
                  setForm(f => ({ ...f, activity_type: e.target.value as ActivityType, description: '' }))
                  setShowTemplates(false)
                }}>
                {ACTIVITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {/* Description with templates */}
            <div className="col-span-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Описание работы *</label>
                <button type="button" onClick={() => setShowTemplates(s => !s)}
                  className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 transition-colors">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
                  Шаблоны
                </button>
              </div>
              {showTemplates && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {templates.map(t => (
                    <button key={t} type="button"
                      onClick={() => { setForm(f => ({ ...f, description: t })); setShowTemplates(false) }}
                      className="text-xs px-2.5 py-1 bg-navy-800 hover:bg-navy-700 border border-navy-700
                                 hover:border-gold-600 text-navy-300 hover:text-gold-400 rounded-lg transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <textarea className="input resize-none" rows={2} required
                placeholder="Подготовка апелляционной жалобы, анализ материалов дела..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="label">Часов *</label>
                <input type="number" min="0" max="24" className="input" placeholder="0"
                  value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} />
              </div>
              <div className="flex-1">
                <label className="label">Минут</label>
                <select className="select" value={form.minutes}
                  onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))}>
                  {[0,15,30,45].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="label">
                Ставка, руб./ч *
                {profile?.hourly_rate && (
                  <span className="ml-2 text-navy-500 normal-case font-normal">
                    (из профиля: {profile.hourly_rate} ₽)
                  </span>
                )}
              </label>
              <input type="number" min="0" className="input" placeholder="7000"
                value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} required />
            </div>

            <div className="flex flex-col gap-2 justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-gold-500"
                  checked={form.is_billable}
                  onChange={e => setForm(f => ({ ...f, is_billable: e.target.checked }))} />
                <span className="text-sm text-navy-300">Оплачиваемо</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded accent-amber-500"
                  checked={ndfl} onChange={e => setNdfl(e.target.checked)} />
                <span className={`text-sm font-medium ${ndfl ? 'text-amber-400' : 'text-navy-500'}`}>
                  +НДФЛ 15%
                </span>
              </label>
            </div>

            <div className="col-span-3">
              <label className="label">Примечания</label>
              <input type="text" className="input"
                placeholder="Дополнительная информация (необязательно)"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Preview */}
            {form.hours && form.hourly_rate && (
              <div className="col-span-3 bg-navy-800/50 rounded-lg px-4 py-3 flex gap-6 text-sm flex-wrap">
                <span className="text-navy-400">Время:
                  <strong className="text-navy-200 ml-1">
                    {minutesToDisplay((parseInt(form.hours||'0')*60)+parseInt(form.minutes||'0'))}
                  </strong>
                </span>
                <span className="text-navy-400">Ставка:
                  <strong className={`ml-1 ${ndfl ? 'text-amber-400' : 'text-navy-200'}`}>
                    {formatMoney(effectiveRate(form.hourly_rate))} ₽/ч
                    {ndfl && <span className="text-xs ml-1 font-normal text-navy-500">(с НДФЛ)</span>}
                  </strong>
                </span>
                <span className="text-navy-400">Сумма:
                  <strong className="text-gold-400 ml-1">
                    {form.is_billable
                      ? formatMoney(((parseInt(form.hours||'0')*60+parseInt(form.minutes||'0'))/60)*effectiveRate(form.hourly_rate)) + ' ₽'
                      : '—'}
                  </strong>
                </span>
              </div>
            )}

            <div className="col-span-3 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="card">
        {loading ? (
          <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
        ) : entries.length === 0 ? (
          <p className="text-navy-500 text-sm text-center py-12">
            Нет записей.{' '}
            <button onClick={() => setShowForm(true)} className="text-gold-400 hover:underline">
              Добавить первую →
            </button>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-800">
                {['Дата','Дело','Вид работы','Описание','Время','Ставка','Сумма','Кто',''].map(h => (
                  <th key={h} className="text-left pb-2.5 pr-4 text-xs text-navy-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-navy-800/40 table-row-hover">
                  <td className="py-3 pr-4 text-navy-400 font-mono text-xs whitespace-nowrap">
                    {format(new Date(e.work_date), 'dd.MM.yy')}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-navy-200 text-xs font-medium truncate max-w-[150px]">
                      {e.matters?.clients?.name}
                    </p>
                    <p className="text-navy-500 text-xs truncate max-w-[150px]">
                      {e.matters?.title}
                    </p>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="badge-gold text-xs">{ACTIVITY_LABELS[e.activity_type]}</span>
                  </td>
                  <td className="py-3 pr-4 text-navy-300 text-xs max-w-[200px] truncate">
                    {e.description}
                  </td>
                  <td className="py-3 pr-4 text-navy-300 font-mono text-xs whitespace-nowrap">
                    {minutesToDisplay(e.duration_min)}
                  </td>
                  <td className="py-3 pr-4 text-navy-400 font-mono text-xs">
                    {formatMoney(e.hourly_rate)} ₽
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs whitespace-nowrap">
                    {e.is_billable
                      ? <span className="text-gold-400">{formatMoney(e.amount)} ₽</span>
                      : <span className="text-navy-600">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-navy-500 text-xs truncate max-w-[100px]">
                    {e.profiles?.full_name}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(e)} className="btn-ghost p-1.5">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(e.id)}
                        className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
