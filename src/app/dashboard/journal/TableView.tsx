'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format } from 'date-fns'
import { Plus, Pencil, Trash2, X, Check, ChevronDown, Filter, BookOpen, CopyPlus, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDraft, loadDraft, clearDraft } from '@/lib/draft'
import { useLockedEntries, lockedMessage } from '@/lib/locked-entries'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import EmptyState from '@/components/EmptyState'
import Modal from '@/components/Modal'
import LoadError from '@/components/LoadError'
import { SkeletonRows, SkeletonCards } from '@/components/Skeleton'

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

// Ключ черновика формы записи — см. src/lib/draft.ts
const DRAFT_KEY = 'timelog-draft-entry'

// Шаблоны описаний по виду работы
const TEMPLATES: Record<ActivityType, string[]> = {
  consultation:   ['Консультация по телефону', 'Очная консультация', 'Консультация по материалам дела', 'Консультация по вопросам исполнения решения'],
  court_hearing:  ['Участие в судебном заседании', 'Предварительное судебное заседание', 'Участие в апелляционном заседании', 'Участие в кассационном заседании'],
  document_prep:  ['Подготовка искового заявления', 'Подготовка апелляционной жалобы', 'Подготовка кассационной жалобы', 'Подготовка возражений на иск', 'Составление договора', 'Подготовка правового заключения', 'Составление претензии'],
  correspondence: ['Переписка с судом', 'Переписка с контрагентом', 'Направление процессуальных документов', 'Переговоры с противоположной стороной'],
  research:       ['Правовой анализ материалов дела', 'Анализ судебной практики', 'Изучение нормативной базы', 'Анализ документов доверителя'],
  travel:         ['Выезд в суд', 'Выезд к доверителю', 'Выезд к нотариусу', 'Выезд на место событий'],
  other:          ['Ознакомление с материалами дела', 'Получение документов', 'Нотариальные действия', 'Взаимодействие с государственными органами'],
}

function minutesToDisplay(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}
function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function TableView() {
  const supabase = createClient()
  const [entries, setEntries] = useState<EntryWithRelations[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [ndfl, setNdfl] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  // Фильтры
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    matter_id: '',
    activity_type: '' as ActivityType | '',
    user_id: '',
  })
  const hasActiveFilters = Object.values(filters).some(v => v !== '')

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
    return ndfl ? n / 0.85 : n
  }

  const loadEntries = useCallback(async (f?: typeof filters) => {
    setLoading(true)
    let query = supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')

    const active = f ?? filters
    if (active.date_from) query = query.gte('work_date', active.date_from)
    if (active.date_to) query = query.lte('work_date', active.date_to)
    if (active.matter_id) query = query.eq('matter_id', active.matter_id)
    if (active.activity_type) query = query.eq('activity_type', active.activity_type)
    if (active.user_id) query = query.eq('user_id', active.user_id)

    const { data, error } = await query
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    setLoadError(!!error)
    setEntries((data ?? []) as EntryWithRelations[])
    setLoading(false)
  }, [filters])

  function applyFilters() {
    loadEntries(filters)
  }

  function resetFilters() {
    const empty = { date_from: '', date_to: '', matter_id: '', activity_type: '' as ActivityType | '', user_id: '' }
    setFilters(empty)
    loadEntries(empty)
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()

      // Независимые запросы отправляем параллельно
      const [profileRes, mattersRes, allProfilesRes] = await Promise.all([
        user ? supabase.from('profiles').select('*').eq('id', user.id).single() : Promise.resolve({ data: null }),
        supabase.from('matters').select('*, clients(*)').eq('status', 'active').order('title'),
        supabase.from('profiles').select('*').order('full_name'),
      ])

      const p = profileRes.data
      if (p) {
        setProfile(p)
        setSelectedUserId(p.id)
        if (p.hourly_rate) setForm(f => ({ ...f, hourly_rate: String(p.hourly_rate) }))
      }
      setMatters((mattersRes.data ?? []) as (Matter & { clients: Client })[])
      setProfiles(allProfilesRes.data ?? [])
      loadEntries({ date_from: '', date_to: '', matter_id: '', activity_type: '' as ActivityType | '', user_id: '' })
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Автозаполнение ставки при выборе дела вручную (не при открытии формы на редактирование —
  // там ставка уже зафиксирована в самой записи и не должна подменяться текущей ставкой дела)
  function selectMatter(matterId: string) {
    const m = matters.find(x => x.id === matterId)
    const rate = m?.hourly_rate ?? profile?.hourly_rate
    setForm(f => ({ ...f, matter_id: matterId, hourly_rate: rate ? String(rate) : f.hourly_rate }))
  }

  // Записи из подписанных и оплаченных актов — править и удалять нельзя
  const { locked } = useLockedEntries()

  // Черновик только для новой записи: при правке он затёр бы реальные данные
  useDraft(DRAFT_KEY, form, showForm && !editId)

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
    clearDraft(DRAFT_KEY)
    if (profile) setSelectedUserId(profile.id)
  }

  /**
   * Открыть форму новой записи, восстановив недописанный черновик.
   *
   * Ставку и дело из черновика берём как есть: если человек их выбрал,
   * значит выбрал осознанно, и подставлять поверх значения по умолчанию
   * было бы обиднее, чем не восстановить ничего.
   */
  function openNewEntry() {
    const draft = loadDraft<typeof form>(DRAFT_KEY)
    if (draft && (draft.description?.trim() || draft.matter_id)) {
      setForm(draft)
      setEditId(null)
      setShowForm(true)
      toast('Восстановлен незаконченный черновик', { icon: '📝' })
      return
    }
    resetForm()
    setShowForm(true)
  }

  /**
   * Повторить запись сегодняшней датой.
   *
   * В работе адвоката половина записей похожа на вчерашние: то же дело,
   * тот же вид работы, та же ставка — меняются дата и время. Открываем
   * форму добавления с этими полями, но БЕЗ времени: его надо указать
   * заново, иначе легко сохранить вчерашние часы, не заметив.
   */
  function repeatEntry(e: EntryWithRelations) {
    setForm({
      matter_id: e.matter_id,
      work_date: format(new Date(), 'yyyy-MM-dd'),
      hours: '',
      minutes: '0',
      hourly_rate: String(e.hourly_rate),
      activity_type: e.activity_type,
      description: e.description,
      is_billable: e.is_billable,
      notes: '',
    })
    setEditId(null)
    setShowForm(true)
  }

  function startEdit(e: EntryWithRelations) {
    const actNo = locked.get(e.id)
    if (actNo) { toast.error(lockedMessage(actNo)); return }
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
    setSelectedUserId(e.user_id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const dmin = (parseInt(form.hours || '0') * 60) + parseInt(form.minutes || '0')
    if (dmin <= 0) { toast.error('Укажите время'); return }
    if (dmin > 1440) { toast.error('Длительность одной записи не может превышать 24 часа'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      matter_id: form.matter_id,
      user_id: selectedUserId || user!.id,
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
    const actNo = locked.get(id)
    if (actNo) { toast.error(lockedMessage(actNo)); return }
    if (!confirm('Удалить запись?')) return
    const { error } = await supabase.from('time_entries').delete().eq('id', id)
    if (error) { toast.error('Не удалось удалить: ' + error.message) }
    else { toast.success('Удалено'); loadEntries() }
  }

  const templates = TEMPLATES[form.activity_type] ?? []


  // Esc закрывает форму записи — см. src/lib/form-keys.ts
  useEscapeKey(showForm, resetForm)

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(s => !s)}
            className={`btn-secondary ${hasActiveFilters ? 'border-gold-600/50 text-gold-400' : ''}`}>
            <Filter className="w-4 h-4" /> Фильтры{hasActiveFilters ? ' •' : ''}
          </button>
          <button onClick={openNewEntry} className="btn-primary">
            <Plus className="w-4 h-4" /> Новая запись
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card mb-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="label">Дата с</label>
              <input type="date" className="input" value={filters.date_from}
                onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дата по</label>
              <input type="date" className="input" value={filters.date_to}
                onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дело</label>
              <select className="select" value={filters.matter_id}
                onChange={e => setFilters(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">Все дела</option>
                {matters.map(m => (
                  <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Вид работы</label>
              <select className="select" value={filters.activity_type}
                onChange={e => setFilters(f => ({ ...f, activity_type: e.target.value as ActivityType | '' }))}>
                <option value="">Все виды</option>
                {ACTIVITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Исполнитель</label>
              <select className="select" value={filters.user_id}
                onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">Все</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={applyFilters} className="btn-primary text-sm">
              <Check className="w-3.5 h-3.5" /> Применить
            </button>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="btn-secondary text-sm">
                <X className="w-3.5 h-3.5" /> Сбросить
              </button>
            )}
          </div>
        </div>
      )}

      <Modal open={showForm} onClose={resetForm}
        title={editId ? 'Редактировать запись' : 'Новая запись'} wide>

          <form onKeyDown={submitOnCtrlEnter} onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <div className="md:col-span-1">
              <label className="label">Дело *</label>
              <select className="select" value={form.matter_id}
                onChange={e => selectMatter(e.target.value)} required>
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
            <div className="md:col-span-3">
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
                <input type="number" min="0" max="23" inputMode="numeric" className="input" placeholder="0"
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
              <label className="label">Исполнитель</label>
              <select className="select" value={selectedUserId}
                onChange={e => {
                  setSelectedUserId(e.target.value)
                  const p = profiles.find(x => x.id === e.target.value)
                  if (p?.hourly_rate) setForm(f => ({ ...f, hourly_rate: String(p.hourly_rate) }))
                }}>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.role === 'advocate' ? 'Адвокат' : 'Помощник'}{p.hourly_rate ? ` · ${p.hourly_rate} ₽/ч` : ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">
                Ставка, руб./ч. *
                {profile?.hourly_rate && (
                  <span className="ml-2 text-navy-300 normal-case font-normal">
                    (из профиля: {profile.hourly_rate} ₽)
                  </span>
                )}
              </label>
              <input type="number" min="0" inputMode="decimal" className="input" placeholder="7000"
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
                <span className={`text-sm font-medium ${ndfl ? 'text-amber-400' : 'text-navy-300'}`}>
                  +НДФЛ 15%
                </span>
              </label>
            </div>

            <div className="md:col-span-3">
              <label className="label">Примечания</label>
              <input type="text" className="input"
                placeholder="Дополнительная информация (необязательно)"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Preview */}
            {form.hours && form.hourly_rate && (
              <div className="md:col-span-3 bg-navy-800/50 rounded-lg px-4 py-3 flex gap-6 text-sm flex-wrap">
                <span className="text-navy-400">Время:
                  <strong className="text-navy-200 ml-1">
                    {minutesToDisplay((parseInt(form.hours||'0')*60)+parseInt(form.minutes||'0'))}
                  </strong>
                </span>
                <span className="text-navy-400">Ставка:
                  <strong className={`ml-1 ${ndfl ? 'text-amber-400' : 'text-navy-200'}`}>
                    {formatMoney(effectiveRate(form.hourly_rate))} ₽/ч
                    {ndfl && <span className="text-xs ml-1 font-normal text-navy-300">(с НДФЛ)</span>}
                  </strong>
                </span>
                <span className="text-navy-400">Сумма:
                  <strong className="text-navy-100 ml-1">
                    {form.is_billable
                      ? formatMoney(((parseInt(form.hours||'0')*60+parseInt(form.minutes||'0'))/60)*effectiveRate(form.hourly_rate)) + ' ₽'
                      : '—'}
                  </strong>
                </span>
              </div>
            )}

            <div className="md:col-span-3 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
      </Modal>

      {loadError && !loading && <LoadError onRetry={() => loadEntries()} />}

      {/* Table (desktop) */}
      <div className={`card hidden ${loadError ? '' : 'md:block'}`}>
        {loading ? (
          <SkeletonRows rows={7} />
        ) : entries.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState icon={Filter} title="По этим фильтрам записей нет"
              description="Снимите часть условий или измените период." />
          ) : (
            <EmptyState icon={BookOpen} title="Записей пока нет"
              description="Записанное время — основа отчётов, актов и расчёта дохода."
              action={<button onClick={openNewEntry} className="btn-primary">
                <Plus className="w-4 h-4" /> Добавить первую запись
              </button>} />
          )
        ) : (
          <table className="w-full text-sm table-sticky">
            <thead>
              <tr className="border-b border-navy-800">
                {['Дата','Дело','Вид работы','Описание','Время','Ставка','Сумма','Кто',''].map(h => (
                  <th key={h} className="text-left pb-2.5 pr-4 text-xs text-navy-300 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}
                  onDoubleClick={() => startEdit(e)}
                  title="Двойной клик — редактировать"
                  className="border-b border-navy-800/40 table-row-hover cursor-pointer">
                  <td className="py-3 pr-4 text-navy-400 num text-xs whitespace-nowrap">
                    {format(new Date(e.work_date), 'dd.MM.yy')}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-navy-200 text-xs font-medium truncate max-w-[150px]">
                      {e.matters?.clients?.name}
                    </p>
                    <p className="text-navy-300 text-xs truncate max-w-[150px]">
                      {e.matters?.title}
                    </p>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="badge-gold text-xs">{ACTIVITY_LABELS[e.activity_type]}</span>
                  </td>
                  <td className="py-3 pr-4 text-navy-300 text-xs max-w-[200px] truncate">
                    {e.description}
                  </td>
                  <td className="py-3 pr-4 text-navy-300 num text-xs whitespace-nowrap">
                    {minutesToDisplay(e.duration_min)}
                  </td>
                  <td className="py-3 pr-4 text-navy-400 num text-xs">
                    {formatMoney(e.hourly_rate)} ₽
                  </td>
                  <td className="py-3 pr-4 num text-xs whitespace-nowrap">
                    {e.is_billable
                      ? <span className="text-navy-100">{formatMoney(e.amount)} ₽</span>
                      : <span className="text-navy-400">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-navy-300 text-xs truncate max-w-[100px]">
                    {e.profiles?.full_name}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button aria-label="Повторить запись" title="Повторить сегодняшней датой"
                        onClick={() => repeatEntry(e)} className="btn-ghost p-1.5">
                        <CopyPlus className="w-3.5 h-3.5" />
                      </button>
                      {locked.has(e.id) ? (
                        <span className="btn-ghost p-1.5 cursor-default" role="img"
                          aria-label={`Входит в акт ${locked.get(e.id)}`}
                          title={`Входит в акт ${locked.get(e.id)} — изменить нельзя`}>
                          <Lock className="w-3.5 h-3.5" />
                        </span>
                      ) : (<>
                      <button aria-label="Редактировать запись" onClick={() => startEdit(e)} className="btn-ghost p-1.5">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label="Удалить запись" onClick={() => handleDelete(e.id)}
                        className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Card list (mobile) — то же содержимое, без горизонтальной прокрутки */}
      <div className={loadError ? 'hidden' : 'md:hidden'}>
        {loading ? (
          <SkeletonCards rows={5} />
        ) : entries.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState icon={Filter} title="По этим фильтрам записей нет"
              description="Снимите часть условий или измените период." />
          ) : (
            <EmptyState icon={BookOpen} title="Записей пока нет"
              description="Записанное время — основа отчётов, актов и расчёта дохода."
              action={<button onClick={openNewEntry} className="btn-primary">
                <Plus className="w-4 h-4" /> Добавить первую запись
              </button>} />
          )
        ) : (
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id}
                onClick={() => startEdit(e)}
                className="card p-3 active:bg-navy-800/60 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-navy-200 text-sm font-medium truncate">{e.matters?.clients?.name}</p>
                    <p className="text-navy-300 text-xs truncate">{e.matters?.title}</p>
                  </div>
                  <span className="text-navy-400 num text-xs whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                    {locked.has(e.id) && (
                      <Lock className="w-3 h-3" aria-label={`Входит в акт ${locked.get(e.id)}`} />
                    )}
                    {format(new Date(e.work_date), 'dd.MM.yy')}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="badge-gold text-xs">{ACTIVITY_LABELS[e.activity_type]}</span>
                  <span className="text-navy-400 num text-xs">{minutesToDisplay(e.duration_min)}</span>
                </div>
                <p className="text-navy-300 text-xs mb-2 line-clamp-2">{e.description}</p>
                <div className="flex items-center justify-between pt-2 border-t border-navy-800/60">
                  <span className="text-navy-300 text-xs truncate">{e.profiles?.full_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="num text-sm">
                      {e.is_billable
                        ? <span className="text-navy-100 font-semibold">{formatMoney(e.amount)} ₽</span>
                        : <span className="text-navy-400">—</span>}
                    </span>
                    <button aria-label="Удалить запись" onClick={ev => { ev.stopPropagation(); handleDelete(e.id) }}
                      className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
