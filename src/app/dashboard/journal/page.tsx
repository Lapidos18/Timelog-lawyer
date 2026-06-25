'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format, addDays, subDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, X, Check, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'

interface DayEntry {
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
  matters: (Matter & { clients: Client }) | null
  profiles: Profile | null
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)
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
  return new Intl.NumberFormat('ru-RU').format(Math.round(n))
}

export default function JournalPage() {
  const supabase = createClient()
  const [date, setDate] = useState(new Date())
  const [entries, setEntries] = useState<DayEntry[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showCal, setShowCal] = useState(false)
  const calRef = useRef<HTMLDivElement>(null)
  const [calMonth, setCalMonth] = useState(new Date())
  const [submitting, setSubmitting] = useState(false)
  const [ndfl, setNdfl] = useState(false)
  const effectiveRate = (base: string) => { const n = parseFloat(base || '0'); return ndfl ? Math.round(n / 0.85) : n }
  const [form, setForm] = useState({
    matter_id: '',
    hours: '1',
    minutes: '0',
    start_hour: '9',
    hourly_rate: '',
    activity_type: 'consultation' as ActivityType,
    description: '',
    is_billable: true,
    notes: '',
  })

  const dateStr = format(date, 'yyyy-MM-dd')
  const dateLabel = format(date, 'EEEE, d MMMM yyyy', { locale: ru })

  // Calendar grid
  const calDays = eachDayOfInterval({
    start: startOfMonth(calMonth),
    end: endOfMonth(calMonth),
  })
  const firstDow = (startOfMonth(calMonth).getDay() + 6) % 7 // Mon=0

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        if (p) { setProfile(p); setForm(f => ({ ...f, hourly_rate: String(p.hourly_rate ?? '') })) }
      }
      const { data: m } = await supabase.from('matters').select('*, clients(*)').eq('status', 'active').order('title')
      setMatters((m ?? []) as (Matter & { clients: Client })[])
    }
    init()
  }, [])

  useEffect(() => { loadDay() }, [dateStr])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setShowCal(false)
      }
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
      .order('created_at')
    setEntries((data ?? []) as DayEntry[])
    setLoading(false)
  }

  function selectDay(d: Date) {
    setDate(d)
    setCalMonth(d)
    setShowCal(false)
  }

  function openFormAtHour(h: number) {
    setForm(f => ({ ...f, start_hour: String(h), hours: '1', minutes: '0' }))
    setShowForm(true)
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const dmin = parseInt(form.hours || '0') * 60 + parseInt(form.minutes || '0')
    if (dmin <= 0) { toast.error('Укажите время'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('time_entries').insert({
      matter_id: form.matter_id,
      user_id: user!.id,
      work_date: dateStr,
      duration_min: dmin,
      hourly_rate: effectiveRate(form.hourly_rate),
      activity_type: form.activity_type,
      description: form.description,
      is_billable: form.is_billable,
      notes: form.notes || null,
    })
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success('Запись добавлена'); setShowForm(false); loadDay() }
    setSubmitting(false)
  }

  const totalHours = entries.reduce((s, e) => s + e.duration_min / 60, 0)
  const totalAmount = entries.filter(e => e.is_billable).reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="p-7">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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

          {/* Calendar button */}
          <div className="relative">
            <button
              onClick={() => { setShowCal(c => !c); setCalMonth(date) }}
              className="btn-ghost text-xs px-3 py-1.5 ml-1 gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" /> Календарь
            </button>

            {/* Calendar popup */}
            {showCal && (
              <div ref={calRef} className="absolute top-10 left-0 z-50 bg-navy-900 border border-navy-700
                              rounded-xl shadow-2xl p-4 w-72">
                {/* Month nav */}
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

                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => (
                    <div key={d} className="text-center text-xs text-navy-600 py-1">{d}</div>
                  ))}
                </div>

                {/* Days grid */}
                <div className="grid grid-cols-7 gap-0.5">
                  {/* Empty cells before first day */}
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`e${i}`} />
                  ))}
                  {calDays.map(d => {
                    const isSelected = isSameDay(d, date)
                    const isToday = isSameDay(d, new Date())
                    const inMonth = isSameMonth(d, calMonth)
                    return (
                      <button
                        key={d.toISOString()}
                        onClick={() => selectDay(d)}
                        className={`
                          h-8 w-full rounded-lg text-xs font-medium transition-colors
                          ${isSelected
                            ? 'bg-gold-500 text-navy-950'
                            : isToday
                            ? 'bg-navy-700 text-gold-400 ring-1 ring-gold-500/50'
                            : inMonth
                            ? 'text-navy-300 hover:bg-navy-800'
                            : 'text-navy-700'}
                        `}
                      >
                        {format(d, 'd')}
                      </button>
                    )
                  })}
                </div>

                {/* Today shortcut */}
                <button
                  onClick={() => selectDay(new Date())}
                  className="w-full mt-3 btn-secondary text-xs justify-center py-1.5"
                >
                  Сегодня
                </button>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => { setForm(f => ({ ...f, start_hour: '9', hours: '1' })); setShowForm(true) }}
          className="btn-primary">
          <Plus className="w-4 h-4" /> Новая запись
        </button>
      </div>

      {/* Quick form */}
      {showForm && (
        <div className="card mb-5 border-gold-800/40">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-navy-200 text-sm capitalize">
              Новая запись — {format(date, 'd MMMM yyyy', { locale: ru })}
            </h2>
            <button onClick={() => setShowForm(false)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">Дело *</label>
              <select className="select" required value={form.matter_id}
                onChange={e => setForm(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {matters.map(m => (
                  <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Начало</label>
              <select className="select" value={form.start_hour}
                onChange={e => setForm(f => ({ ...f, start_hour: e.target.value }))}>
                {HOURS.map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
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
            <div className="col-span-4">
              <label className="label">Описание *</label>
              <input type="text" className="input" required placeholder="Что делал..."
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-4 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : 'Добавить'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Отмена</button>
            </div>
          </form>

        </div>
      )}

      {/* NDFL toggle - visible when form is open */}
      {showForm && (
        <div className="mb-5 flex items-center gap-4 px-4 py-3 bg-navy-900 rounded-xl border border-navy-700">
          <span className="text-sm text-navy-400 font-medium">Ставка с учётом НДФЛ:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-amber-500" checked={ndfl}
              onChange={e => setNdfl(e.target.checked)} />
            <span className={`text-sm font-bold ${ndfl ? 'text-amber-400' : 'text-navy-500'}`}>
              +НДФЛ 15%
            </span>
          </label>
          {form.hourly_rate && (
            <span className="text-sm">
              {ndfl
                ? <span className="text-amber-400 font-semibold">
                    {parseFloat(form.hourly_rate).toLocaleString('ru-RU')} ÷ 0,85 = {Math.round(parseFloat(form.hourly_rate)/0.85).toLocaleString('ru-RU')} ₽/ч
                  </span>
                : <span className="text-navy-400">{parseFloat(form.hourly_rate).toLocaleString('ru-RU')} ₽/ч</span>
              }
            </span>
          )}
        </div>
      )}

      {/* Day view */}
      <div className="card p-0 overflow-hidden">
        <div className="flex">
          {/* Timeline */}
          <div className="w-16 flex-shrink-0 border-r border-navy-800">
            {HOURS.map(h => (
              <div key={h} className="h-16 border-b border-navy-800/50 flex items-start justify-end pr-3 pt-1">
                <span className="text-xs text-navy-600 font-mono">{h}:00</span>
              </div>
            ))}
          </div>

          {/* Slots */}
          <div className="flex-1 relative">
            {HOURS.map(h => (
              <div key={h}
                className="h-16 border-b border-navy-800/30 hover:bg-navy-800/20 cursor-pointer
                           transition-colors group relative"
                onClick={() => openFormAtHour(h)}>
                <span className="absolute inset-0 flex items-center justify-center
                                 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="w-4 h-4 text-navy-600" />
                </span>
              </div>
            ))}

            {/* Entries overlay */}
            {!loading && entries.map((e, i) => {
              const top = (i % 12) * 64
              const height = Math.max(56, Math.min(e.duration_min / 60 * 64, 128))
              return (
                <div key={e.id}
                  className={`absolute left-2 right-2 rounded-lg border px-3 py-2 text-xs
                              cursor-default overflow-hidden ${COLORS[e.activity_type]}`}
                  style={{ top: top + 4, height: height - 8 }}>
                  <div className="font-semibold truncate">{e.matters?.clients?.name}</div>
                  <div className="truncate opacity-80">{e.description}</div>
                  <div className="mt-1 flex items-center gap-2 opacity-60">
                    <span>{Math.floor(e.duration_min/60)}ч {e.duration_min%60>0?`${e.duration_min%60}м`:''}</span>
                    {e.is_billable && <span>{formatMoney(e.amount)} ₽</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Side list */}
          <div className="w-72 border-l border-navy-800 flex-shrink-0">
            <div className="px-4 py-3 border-b border-navy-800">
              <p className="text-xs font-medium text-navy-400 uppercase tracking-wide">Записи дня</p>
            </div>
            {loading ? (
              <p className="text-navy-600 text-xs text-center py-8">Загрузка...</p>
            ) : entries.length === 0 ? (
              <p className="text-navy-600 text-xs text-center py-8 px-4">
                Нет записей.<br/>Кликни на временной слот чтобы добавить.
              </p>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: '832px' }}>
                {entries.map(e => (
                  <div key={e.id} className={`mx-3 my-2 p-3 rounded-lg border text-xs ${COLORS[e.activity_type]}`}>
                    <div className="font-semibold truncate mb-1">{e.matters?.clients?.name}</div>
                    <div className="opacity-80 mb-1">{ACTIVITY_LABELS[e.activity_type]}</div>
                    <div className="opacity-70 line-clamp-2">{e.description}</div>
                    <div className="mt-2 flex justify-between opacity-60">
                      <span>{Math.floor(e.duration_min/60)}ч {e.duration_min%60>0?`${e.duration_min%60}м`:''}</span>
                      {e.is_billable && <span className="text-gold-400">{formatMoney(e.amount)} ₽</span>}
                    </div>
                    <div className="mt-1 opacity-50">{e.profiles?.full_name}</div>
                  </div>
                ))}
                <div className="mx-3 my-3 p-3 bg-navy-800/30 rounded-lg border border-navy-700/50 text-xs">
                  <div className="flex justify-between text-navy-400 mb-1">
                    <span>Итого часов:</span>
                    <span className="text-navy-200 font-mono">{totalHours.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-navy-400">
                    <span>К оплате:</span>
                    <span className="text-gold-400 font-mono">{formatMoney(totalAmount)} ₽</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
