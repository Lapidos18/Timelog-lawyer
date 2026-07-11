'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format, addDays, subDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, X, Check, Calendar, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'

interface DayEntry {
  id: string
  matter_id: string
  user_id: string
  work_date: string
  start_time: string | null
  duration_min: number
  hourly_rate: number
  amount: number
  activity_type: ActivityType
  description: string
  is_billable: boolean
  notes: string | null
  matters: (Matter & { clients: Client }) | null
  profiles: Profile | null
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8) // 8:00 - 20:00
const COLORS: Record<ActivityType, string> = {
  consultation:   'bg-blue-900/60 border-blue-500/50 text-blue-300',
  court_hearing:  'bg-red-900/60 border-red-500/50 text-red-300',
  document_prep:  'bg-amber-900/60 border-amber-500/50 text-amber-300',
  correspondence: 'bg-purple-900/60 border-purple-500/50 text-purple-300',
  research:       'bg-teal-900/60 border-teal-500/50 text-teal-300',
  travel:         'bg-green-900/60 border-green-500/50 text-green-300',
  other:          'bg-navy-800/60 border-navy-600/50 text-navy-300',
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// "09:30:00" -> 9.5 (decimal hour for positioning)
function timeToDecimal(t: string | null): number {
  if (!t) return 9
  const [h, m] = t.split(':').map(Number)
  return h + (m || 0) / 60
}

export default function TimelineView() {
  const supabase = createClient()
  const [date, setDate] = useState(new Date())
  const [entries, setEntries] = useState<DayEntry[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [showCal, setShowCal] = useState(false)
  const calRef = useRef<HTMLDivElement>(null)
  const [calMonth, setCalMonth] = useState(new Date())
  const [submitting, setSubmitting] = useState(false)
  const [ndfl, setNdfl] = useState(false)
  const effectiveRate = (base: string) => { const n = parseFloat(base || '0'); return ndfl ? Math.round(n / 0.85) : n }

  // Даты с записями за отображаемый месяц (для подсветки в календаре)
  const [datesWithEntries, setDatesWithEntries] = useState<Set<string>>(new Set())

  // Режим множественного выбора дней
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [multiEntries, setMultiEntries] = useState<Record<string, DayEntry[]>>({})
  const [multiLoading, setMultiLoading] = useState(false)

  const [form, setForm] = useState({
    matter_id: '',
    hours: '1',
    minutes: '0',
    start_hour: '9',
    start_minute: '0',
    hourly_rate: '',
    activity_type: 'consultation' as ActivityType,
    description: '',
    is_billable: true,
    notes: '',
  })

  const dateStr = format(date, 'yyyy-MM-dd')
  const dateLabel = format(date, 'EEEE, d MMMM yyyy', { locale: ru })

  const calDays = eachDayOfInterval({ start: startOfMonth(calMonth), end: endOfMonth(calMonth) })
  const firstDow = (startOfMonth(calMonth).getDay() + 6) % 7

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      const [profileRes, mattersRes] = await Promise.all([
        user ? supabase.from('profiles').select('*').eq('id', user.id).single() : Promise.resolve({ data: null }),
        supabase.from('matters').select('*, clients(*)').eq('status', 'active').order('title'),
      ])
      const p = profileRes.data
      if (p) { setProfile(p); setForm(f => ({ ...f, hourly_rate: String(p.hourly_rate ?? '') })) }
      setMatters((mattersRes.data ?? []) as (Matter & { clients: Client })[])
    }
    init()
  }, [])

  useEffect(() => { loadDay() }, [dateStr])

  // Подгружаем даты с записями при открытии/смене месяца в календаре
  useEffect(() => {
    if (showCal) loadMonthDates(calMonth)
  }, [showCal, calMonth])

  // Подгружаем записи для всех выбранных дней в режиме мульти-выбора
  useEffect(() => {
    if (multiSelectMode && selectedDates.length > 0) loadMultipleDays(selectedDates)
  }, [multiSelectMode, selectedDates])

  async function loadMonthDates(month: Date) {
    const from = format(startOfMonth(month), 'yyyy-MM-dd')
    const to = format(endOfMonth(month), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('time_entries')
      .select('work_date')
      .gte('work_date', from)
      .lte('work_date', to)
    const set = new Set((data ?? []).map(r => r.work_date as string))
    setDatesWithEntries(set)
  }

  async function loadMultipleDays(dates: string[]) {
    setMultiLoading(true)
    const { data } = await supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')
      .in('work_date', dates)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true })
    const grouped: Record<string, DayEntry[]> = {}
    for (const d of dates) grouped[d] = []
    for (const e of (data ?? []) as DayEntry[]) {
      if (!grouped[e.work_date]) grouped[e.work_date] = []
      grouped[e.work_date].push(e)
    }
    setMultiEntries(grouped)
    setMultiLoading(false)
  }

  function toggleDateSelection(dStr: string) {
    setSelectedDates(prev =>
      prev.includes(dStr) ? prev.filter(x => x !== dStr) : [...prev, dStr].sort()
    )
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setShowCal(false)
    }
    if (showCal) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showCal])

  async function loadDay() {
    setLoading(true)
    const { data } = await supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')
      .eq('work_date', dateStr)
      .order('start_time')
    setEntries((data ?? []) as DayEntry[])
    setLoading(false)
  }

  function selectDay(d: Date) {
    if (multiSelectMode) {
      toggleDateSelection(format(d, 'yyyy-MM-dd'))
      return
    }
    setDate(d); setCalMonth(d); setShowCal(false)
  }

  function resetForm() {
    setForm({
      matter_id: '', hours: '1', minutes: '0',
      start_hour: '9', start_minute: '0',
      hourly_rate: String(profile?.hourly_rate ?? ''),
      activity_type: 'consultation', description: '',
      is_billable: true, notes: '',
    })
    setEditId(null)
    setShowForm(false)
    setNdfl(false)
  }

  function openFormAtHour(h: number) {
    resetForm()
    setForm(f => ({ ...f, start_hour: String(h), start_minute: '0', hours: '1', minutes: '0' }))
    setShowForm(true)
  }

  // Double-click to edit
  function openEdit(entry: DayEntry) {
    const startDec = timeToDecimal(entry.start_time)
    const startH = Math.floor(startDec)
    const startM = Math.round((startDec - startH) * 60)
    const durH = Math.floor(entry.duration_min / 60)
    const durM = entry.duration_min % 60

    setForm({
      matter_id: entry.matter_id,
      hours: String(durH),
      minutes: String(durM),
      start_hour: String(startH),
      start_minute: String(startM),
      hourly_rate: String(entry.hourly_rate),
      activity_type: entry.activity_type,
      description: entry.description,
      is_billable: entry.is_billable,
      notes: entry.notes ?? '',
    })
    setEditId(entry.id)
    setNdfl(false)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const dmin = parseInt(form.hours || '0') * 60 + parseInt(form.minutes || '0')
    if (dmin <= 0) { toast.error('Укажите время'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const startTime = `${form.start_hour.padStart(2,'0')}:${form.start_minute.padStart(2,'0')}:00`

    const payload = {
      matter_id: form.matter_id,
      user_id: user!.id,
      work_date: dateStr,
      start_time: startTime,
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
    else { toast.success(editId ? 'Запись обновлена' : 'Запись добавлена'); resetForm(); loadDay() }
    setSubmitting(false)
  }

  async function handleDelete() {
    if (!editId) return
    if (!confirm('Удалить запись?')) return
    const { error } = await supabase.from('time_entries').delete().eq('id', editId)
    if (error) { toast.error('Ошибка удаления') }
    else { toast.success('Удалено'); resetForm(); loadDay() }
  }

  const totalHours = entries.reduce((s, e) => s + e.duration_min / 60, 0)
  const totalAmount = entries.filter(e => e.is_billable).reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setDate(d => subDays(d, 1))} className="btn-ghost p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-navy-100 capitalize">{dateLabel}</h1>
            <p className="text-xs text-navy-500">
              {entries.length} записей · {totalHours.toFixed(1)} ч · {formatMoney(totalAmount)} ₽
            </p>
          </div>
          <button onClick={() => setDate(d => addDays(d, 1))} className="btn-ghost p-2">
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="relative">
            <button onClick={() => { setShowCal(c => !c); setCalMonth(date) }}
              className="btn-ghost text-xs px-3 py-1.5 ml-1 gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Календарь
            </button>
            {showCal && (
              <div ref={calRef} className="absolute top-10 left-0 z-50 bg-navy-900 border border-navy-700
                              rounded-xl shadow-2xl p-4 w-80">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="btn-ghost p-1">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium text-navy-200 capitalize">
                    {format(calMonth, 'LLLL yyyy', { locale: ru })}
                  </span>
                  <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="btn-ghost p-1">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Переключатель режима выбора */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-3.5 h-3.5 accent-gold-500"
                      checked={multiSelectMode}
                      onChange={e => {
                        setMultiSelectMode(e.target.checked)
                        if (!e.target.checked) setSelectedDates([])
                      }} />
                    <span className="text-xs text-navy-400">Выбрать несколько дней</span>
                  </label>
                  {multiSelectMode && selectedDates.length > 0 && (
                    <span className="text-xs text-gold-400 font-medium">{selectedDates.length} выбрано</span>
                  )}
                </div>

                <div className="grid grid-cols-7 mb-1">
                  {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => (
                    <div key={d} className="text-center text-xs text-navy-600 py-1">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                  {calDays.map(d => {
                    const dStr = format(d, 'yyyy-MM-dd')
                    const isSelected = !multiSelectMode && isSameDay(d, date)
                    const isMultiSelected = multiSelectMode && selectedDates.includes(dStr)
                    const isToday = isSameDay(d, new Date())
                    const inMonth = isSameMonth(d, calMonth)
                    const hasEntries = datesWithEntries.has(dStr)
                    return (
                      <button key={d.toISOString()} onClick={() => selectDay(d)}
                        className={`relative h-8 w-full rounded-lg text-xs font-medium transition-colors
                          ${isSelected || isMultiSelected ? 'bg-gold-500 text-navy-950'
                            : isToday ? 'bg-navy-700 text-gold-400 ring-1 ring-gold-500/50'
                            : inMonth ? 'text-navy-300 hover:bg-navy-800' : 'text-navy-700'}`}>
                        {format(d, 'd')}
                        {hasEntries && !isSelected && !isMultiSelected && (
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold-500" />
                        )}
                      </button>
                    )
                  })}
                </div>

                {multiSelectMode ? (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setShowCal(false) }}
                      disabled={selectedDates.length === 0}
                      className="btn-primary text-xs flex-1 justify-center py-1.5 disabled:opacity-40">
                      Показать выбранные ({selectedDates.length})
                    </button>
                    {selectedDates.length > 0 && (
                      <button onClick={() => setSelectedDates([])} className="btn-secondary text-xs py-1.5">
                        Сброс
                      </button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => selectDay(new Date())} className="w-full mt-3 btn-secondary text-xs justify-center py-1.5">
                    Сегодня
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <button onClick={() => { resetForm(); setForm(f => ({ ...f, start_hour: '9' })); setShowForm(true) }}
          className="btn-primary">
          <Plus className="w-4 h-4" /> Новая запись
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-3 border-gold-800/40">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-navy-200 text-sm capitalize">
              {editId ? 'Редактировать запись' : `Новая запись — ${format(date, 'd MMMM yyyy', { locale: ru })}`}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">Дело *</label>
              <select className="select" required value={form.matter_id}
                onChange={e => setForm(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {matters.map(m => (
                  <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Начало (час)</label>
                <select className="select" value={form.start_hour}
                  onChange={e => setForm(f => ({ ...f, start_hour: e.target.value }))}>
                  {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="label">Мин</label>
                <select className="select" value={form.start_minute}
                  onChange={e => setForm(f => ({ ...f, start_minute: e.target.value }))}>
                  {[0,15,30,45].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Вид работы</label>
              <select className="select" value={form.activity_type}
                onChange={e => setForm(f => ({ ...f, activity_type: e.target.value as ActivityType }))}>
                {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Часов *</label>
              <input type="number" min="0" max="12" className="input" placeholder="1"
                value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} />
            </div>
            <div>
              <label className="label">Минут</label>
              <select className="select" value={form.minutes}
                onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))}>
                {[0,15,30,45].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Ставка ₽/ч</label>
              <input type="number" className="input" value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-gold-500" checked={form.is_billable}
                  onChange={e => setForm(f => ({ ...f, is_billable: e.target.checked }))} />
                <span className="text-sm text-navy-300">Оплачиваемо</span>
              </label>
            </div>

            <div className="md:col-span-4">
              <label className="label">Описание *</label>
              <textarea className="input resize-none" rows={2} required placeholder="Что делал..."
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="md:col-span-4 flex flex-wrap gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
              {editId && (
                <button type="button" onClick={handleDelete}
                  className="btn-secondary text-red-400 hover:bg-red-900/20 ml-auto">
                  <Trash2 className="w-4 h-4" /> Удалить
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* NDFL toggle */}
      {showForm && (
        <div className="mb-5 flex items-center gap-4 px-4 py-3 bg-navy-900 rounded-xl border border-navy-700">
          <span className="text-sm text-navy-400 font-medium">Ставка с учётом НДФЛ:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-amber-500" checked={ndfl}
              onChange={e => setNdfl(e.target.checked)} />
            <span className={`text-sm font-bold ${ndfl ? 'text-amber-400' : 'text-navy-500'}`}>+НДФЛ 15%</span>
          </label>
          {form.hourly_rate && (
            <span className="text-sm">
              {ndfl
                ? <span className="text-amber-400 font-semibold">
                    {parseFloat(form.hourly_rate).toLocaleString('ru-RU')} ÷ 0,85 = {Math.round(parseFloat(form.hourly_rate)/0.85).toLocaleString('ru-RU')} ₽/ч
                  </span>
                : <span className="text-navy-400">{parseFloat(form.hourly_rate).toLocaleString('ru-RU')} ₽/ч</span>}
            </span>
          )}
        </div>
      )}

      {/* Multi-day view */}
      {multiSelectMode && selectedDates.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-navy-300">
              Записи за {selectedDates.length} {selectedDates.length === 1 ? 'день' : 'дней'}
            </h2>
            <button onClick={() => { setMultiSelectMode(false); setSelectedDates([]) }} className="btn-secondary text-xs">
              <X className="w-3.5 h-3.5" /> Закрыть сравнение
            </button>
          </div>

          {multiLoading ? (
            <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
          ) : (
            <div className="space-y-4">
              {selectedDates.map(dStr => {
                const dayEntries = multiEntries[dStr] ?? []
                const dayHours = dayEntries.reduce((s, e) => s + e.duration_min / 60, 0)
                const dayAmount = dayEntries.filter(e => e.is_billable).reduce((s, e) => s + Number(e.amount), 0)
                return (
                  <div key={dStr} className="card">
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-navy-800">
                      <h3 className="text-sm font-semibold text-navy-200 capitalize">
                        {format(new Date(dStr), 'EEEE, d MMMM yyyy', { locale: ru })}
                      </h3>
                      <span className="text-xs text-navy-500">
                        {dayEntries.length} записей · {dayHours.toFixed(1)} ч · {formatMoney(dayAmount)} ₽
                      </span>
                    </div>
                    {dayEntries.length === 0 ? (
                      <p className="text-navy-600 text-xs py-2">Нет записей за этот день</p>
                    ) : (
                      <div className="space-y-1.5">
                        {dayEntries.map(e => (
                          <div key={e.id}
                            onDoubleClick={() => { setDate(new Date(dStr)); setMultiSelectMode(false); setSelectedDates([]); setTimeout(() => openEdit(e), 100) }}
                            title="Двойной клик — редактировать"
                            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer
                                        hover:brightness-125 transition-all ${COLORS[e.activity_type]}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono opacity-70">{e.start_time?.slice(0,5)}</span>
                                <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                                <span className="text-[10px] opacity-70">{ACTIVITY_LABELS[e.activity_type]}</span>
                              </div>
                              <p className="text-xs opacity-80 truncate mt-0.5">{e.description}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs font-mono opacity-70">{(e.duration_min/60).toFixed(2)}ч</p>
                              <p className="text-xs font-semibold">
                                {e.is_billable ? formatMoney(e.amount) + ' ₽' : '—'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Итого по всем выбранным дням */}
              <div className="card bg-navy-900/60">
                <div className="flex justify-between text-sm">
                  <span className="text-navy-400 font-medium">Итого за все выбранные дни:</span>
                  <span className="text-navy-200">
                    {Object.values(multiEntries).flat().reduce((s, e) => s + e.duration_min / 60, 0).toFixed(2)} ч ·{' '}
                    <span className="text-gold-400 font-semibold">
                      {formatMoney(Object.values(multiEntries).flat().filter(e => e.is_billable).reduce((s, e) => s + Number(e.amount), 0))} ₽
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Hint */}
      {!showForm && entries.length > 0 && (
        <p className="text-xs text-navy-600 mb-3">💡 Двойной клик по записи — редактировать</p>
      )}

      {/* Day view */}
      <div className="card p-0 overflow-hidden">
        <div className="flex">
          {/* Timeline */}
          <div className="w-16 flex-shrink-0 border-r border-navy-800">
            {HOURS.map(h => (
              <div key={h} className="h-16 border-b border-navy-800/50 px-2 py-1
                                       text-xs text-navy-600 font-mono">
                {h}:00
              </div>
            ))}
          </div>

          {/* Entries column */}
          <div className="flex-1 relative" style={{ height: `${HOURS.length * 64}px` }}>
            {/* Hour grid lines (clickable to add) */}
            {HOURS.map((h, i) => (
              <div key={h}
                onClick={() => openFormAtHour(h)}
                className="absolute left-0 right-0 border-b border-navy-800/50
                           hover:bg-navy-800/30 cursor-pointer transition-colors"
                style={{ top: `${i * 64}px`, height: '64px' }}
              />
            ))}

            {/* Entry blocks positioned by real start_time */}
            {entries.map(e => {
              const startDec = timeToDecimal(e.start_time)
              const top = Math.max(0, (startDec - 8) * 64)
              const heightPx = Math.max(28, (e.duration_min / 60) * 64)
              const startLabel = e.start_time ? e.start_time.slice(0,5) : '—'
              const endDec = startDec + e.duration_min / 60
              const endH = Math.floor(endDec)
              const endM = Math.round((endDec - endH) * 60)
              const endLabel = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`

              return (
                <div
                  key={e.id}
                  onDoubleClick={() => openEdit(e)}
                  title="Двойной клик — редактировать"
                  className={`absolute left-2 right-2 rounded-lg border px-3 py-1.5
                              cursor-pointer hover:brightness-125 transition-all overflow-hidden
                              ${COLORS[e.activity_type]}`}
                  style={{ top: `${top}px`, height: `${heightPx}px`, zIndex: 5 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                    <span className="text-[10px] font-mono opacity-70 flex-shrink-0">
                      {startLabel}–{endLabel}
                    </span>
                  </div>
                  {heightPx > 30 && (
                    <p className="text-xs opacity-80 truncate">{e.description}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Side list */}
          <div className="w-72 flex-shrink-0 border-l border-navy-800 p-4 overflow-y-auto"
               style={{ maxHeight: `${HOURS.length * 64}px` }}>
            <h3 className="text-xs font-medium text-navy-500 mb-3 uppercase tracking-wide">Записи дня</h3>
            {loading ? (
              <p className="text-navy-600 text-xs">Загрузка...</p>
            ) : entries.length === 0 ? (
              <p className="text-navy-600 text-xs">Нет записей. Кликни на временной слот чтобы добавить.</p>
            ) : (
              <div className="space-y-2">
                {entries.map(e => (
                  <div key={e.id}
                    onDoubleClick={() => openEdit(e)}
                    className={`p-2.5 rounded-lg border cursor-pointer hover:brightness-125 transition-all
                                ${COLORS[e.activity_type]}`}
                    title="Двойной клик — редактировать">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                      <Pencil className="w-3 h-3 opacity-50 flex-shrink-0" />
                    </div>
                    <p className="text-xs opacity-90">{ACTIVITY_LABELS[e.activity_type]}</p>
                    <p className="text-xs opacity-70 truncate mt-0.5">{e.description}</p>
                    <div className="flex justify-between mt-1.5 text-xs">
                      <span className="font-mono opacity-70">
                        {e.start_time?.slice(0,5)} · {(e.duration_min/60).toFixed(2)}ч
                      </span>
                      <span className="font-semibold">
                        {e.is_billable ? formatMoney(e.amount) + ' ₽' : '—'}
                      </span>
                    </div>
                    <p className="text-xs opacity-60 mt-0.5">{e.profiles?.full_name}</p>
                  </div>
                ))}
              </div>
            )}

            {entries.length > 0 && (
              <div className="mt-4 pt-4 border-t border-navy-800 flex justify-between text-xs">
                <span className="text-navy-500">Итого часов:</span>
                <span className="text-navy-200 font-semibold">{totalHours.toFixed(2)}</span>
              </div>
            )}
            {entries.length > 0 && (
              <div className="flex justify-between text-xs mt-1">
                <span className="text-navy-500">К оплате:</span>
                <span className="text-gold-400 font-semibold">{formatMoney(totalAmount)} ₽</span>
              </div>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}
