'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { isSubscription } from '@/lib/balance'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format, addDays, subDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, X, Check, Calendar, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import Modal from '@/components/Modal'
import LoadError from '@/components/LoadError'
import { useLockedEntries, lockedMessage } from '@/lib/locked-entries'
import { SkeletonRows } from '@/components/Skeleton'
import { useMounted } from '@/lib/use-mounted'
import { layoutColumns } from '@/lib/timeline-layout'

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
// Цвета видов работ на шкале. Заседание, документы и «прочее» берут
// переопределённые темой шкалы red/amber/navy. Остальные четыре — свои
// классы tl-* в globals.css с отдельными значениями для каждой темы:
// стандартные blue/purple/teal/green Tailwind тема не перекрашивает, и
// в светлой теме бледный текст на них давал контраст 2:1 — не прочесть.
const COLORS: Record<ActivityType, string> = {
  consultation:   'tl-blue',
  court_hearing:  'bg-red-900/60 border-red-500/50 text-red-300',
  document_prep:  'bg-amber-900/60 border-amber-500/50 text-amber-300',
  correspondence: 'tl-purple',
  research:       'tl-teal',
  travel:         'tl-green',
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

// Растягивание записи мышкой (или пальцем) за край: шаг 15 минут, в пределах шкалы 8:00–21:00
const PX_PER_MIN = 64 / 60            // высота часа на шкале — 64 px
const GRID_START_MIN = 8 * 60
const GRID_END_MIN = 21 * 60
// Время начала — с шагом 5 минут (16:10, 13:40, 16:15), ДЛИТЕЛЬНОСТЬ — по 15: часы в акте считаются
// четвертями (0,25 ч), и «часы × ставка» сходятся с итогом до копейки. 1/6 часа так не записать.
const START_STEP = 5
const DUR_STEP = 15

interface DragState {
  id: string
  edge: 'top' | 'bottom' | 'move'   // move — вся запись целиком (только мышью)
  startY: number
  origStart: number   // минуты от полуночи
  origEnd: number
  start: number
  end: number
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const minToLabel = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
const snapStart = (m: number) => Math.round(m / START_STEP) * START_STEP
const snapDur = (m: number) => Math.round(m / DUR_STEP) * DUR_STEP
// Минуты начала в форме: 0, 5, 10 … 55; а если у записи стоит другое (например, после
// растягивания за верхний край), оно остаётся в списке
const startMinuteOptions = (cur: number) => {
  const o = Array.from({ length: 60 / START_STEP }, (_, i) => i * START_STEP)
  if (!isNaN(cur) && o.indexOf(cur) === -1) { o.push(cur); o.sort((a, b) => a - b) }
  return o
}

export default function TimelineView() {
  const supabase = createClient()
  // Число в заголовке зависит от «сегодня», а страница собирается заранее —
  // до загрузки в браузере его не показываем (см. src/lib/use-mounted.ts)
  const mounted = useMounted()
  const [date, setDate] = useState(new Date())
  const [entries, setEntries] = useState<DayEntry[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Записи из подписанных и оплаченных актов — править нельзя
  const { locked } = useLockedEntries()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editUserId, setEditUserId] = useState<string | null>(null)

  // На сенсорном экране двойной тап — это жест масштабирования, а не «открыть»,
  // поэтому там запись открывается на редактирование одиночным касанием.
  // На мыши оставляем привычный по остальным разделам двойной клик.
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const sync = () => setIsTouch(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const [showCal, setShowCal] = useState(false)
  const calRef = useRef<HTMLDivElement>(null)
  const [calMonth, setCalMonth] = useState(new Date())
  const [submitting, setSubmitting] = useState(false)
  const [ndfl, setNdfl] = useState(false)
  const effectiveRate = (base: string) => { const n = parseFloat(base || '0'); return ndfl ? n / 0.85 : n }

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
    const { data, error } = await supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')
      .in('work_date', dates)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true })
    if (error) {
      toast.error('Не удалось загрузить записи за выбранные дни. Проверьте связь.')
      setMultiLoading(false)
      return
    }
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
    if (showCal) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside as unknown as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside as unknown as EventListener)
    }
  }, [showCal])

  async function loadDay() {
    setLoading(true)
    const { data, error } = await supabase
      .from('time_entries')
      .select('*, matters(*, clients(*)), profiles(*)')
      .eq('work_date', dateStr)
      .order('start_time')
    setLoadError(!!error)
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

  // Автозаполнение ставки при выборе дела вручную (не при открытии формы на редактирование —
  // там ставка уже зафиксирована в самой записи и не должна подменяться текущей ставкой дела)
  function selectMatter(matterId: string) {
    const m = matters.find(x => x.id === matterId)
    const rate = m?.hourly_rate ?? profile?.hourly_rate
    // Абонентское дело: деньги идут по абонплате, часы — только для учёта труда (src/lib/balance.ts)
    const sub = m ? isSubscription(m) : false
    setForm(f => ({ ...f, matter_id: matterId, hourly_rate: rate ? String(rate) : f.hourly_rate, ...(sub ? { is_billable: false } : {}) }))
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
    setEditUserId(null)
    setShowForm(false)
    setNdfl(false)
  }

  // Форма на выделенный протяжкой отрезок шкалы: начало и длительность уже подставлены
  function openFormAtRange(startMin: number, endMin: number) {
    resetForm()
    const dur = Math.max(DUR_STEP, endMin - startMin)
    setForm(f => ({
      ...f,
      start_hour: String(Math.floor(startMin / 60)), start_minute: String(startMin % 60),
      hours: String(Math.floor(dur / 60)), minutes: String(dur % 60),
    }))
    setShowForm(true)
  }

  function openFormAtHour(h: number) {
    resetForm()
    setForm(f => ({ ...f, start_hour: String(h), start_minute: '0', hours: '1', minutes: '0' }))
    setShowForm(true)
  }

  // Double-click to edit
  function openEdit(entry: DayEntry) {
    const actNo = locked.get(entry.id)
    if (actNo) { toast.error(lockedMessage(actNo)); return }
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
    setEditUserId(entry.user_id)
    setNdfl(false)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    const dmin = parseInt(form.hours || '0') * 60 + parseInt(form.minutes || '0')
    if (dmin <= 0) { toast.error('Укажите время'); return }
    if (dmin > 1440) { toast.error('Длительность одной записи не может превышать 24 часа'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const startTime = `${form.start_hour.padStart(2,'0')}:${form.start_minute.padStart(2,'0')}:00`

    const payload = {
      matter_id: form.matter_id,
      user_id: editUserId ?? user!.id,
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

  // ── Растягивание записи за край ─────────────────────────────────────────
  // Нижний край меняет длительность, верхний — время начала (конец остаётся на месте).
  // Сохраняются только start_time и duration_min: сумма в базе — вычисляемое поле и
  // пересчитывается сама. Запись из подписанного акта не двигается (см. п. 13 CLAUDE.md).
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  // Двойной клик сразу после сдвига записи не должен открывать форму редактирования
  const lastMoveAt = useRef(0)

  // ── Новая запись протяжкой по пустому месту шкалы ───────────────────────
  // Мышью: нажать, протянуть, отпустить — форма откроется с готовым началом и длительностью.
  // Касание без протяжки (и на телефоне — всегда) работает как раньше: час целиком.
  // На сенсорном экране протяжка занята прокруткой страницы, поэтому только мышь и перо.
  const colRef = useRef<HTMLDivElement>(null)
  const [create, setCreate] = useState<{ a: number; b: number } | null>(null)
  const createRef = useRef<{ startY: number; startMin: number; touch: boolean; moved: boolean; a: number; b: number } | null>(null)

  const minAtY = (clientY: number) => {
    const top = colRef.current?.getBoundingClientRect().top ?? 0
    return GRID_START_MIN + (clientY - top) / PX_PER_MIN
  }

  function beginCreate(ev: React.PointerEvent<HTMLDivElement>) {
    // Только по пустому месту (часовые полосы), не по записям
    if (!(ev.target as HTMLElement).dataset.grid) return
    if (ev.pointerType === 'mouse' && ev.button !== 0) return
    const touch = ev.pointerType === 'touch'
    if (!touch) ev.currentTarget.setPointerCapture(ev.pointerId)
    const m = minAtY(ev.clientY)
    createRef.current = { startY: ev.clientY, startMin: m, touch, moved: false, a: Math.floor(m / 60) * 60, b: Math.floor(m / 60) * 60 + 60 }
  }

  function moveCreate(ev: React.PointerEvent<HTMLDivElement>) {
    const c = createRef.current
    if (!c || c.touch) return
    if (!c.moved && Math.abs(ev.clientY - c.startY) < 4) return
    c.moved = true
    const m = minAtY(ev.clientY)
    const lo = Math.min(c.startMin, m), hi = Math.max(c.startMin, m)
    let a = Math.max(GRID_START_MIN, Math.floor(lo / START_STEP) * START_STEP)
    // длительность — вверх до ближайших 15 минут, не меньше 15 и не дальше конца шкалы
    let dur = Math.max(DUR_STEP, Math.ceil((hi - a) / DUR_STEP) * DUR_STEP)
    const maxDur = Math.floor((GRID_END_MIN - a) / DUR_STEP) * DUR_STEP
    if (maxDur < DUR_STEP) { a = GRID_END_MIN - DUR_STEP; dur = DUR_STEP } else dur = Math.min(dur, maxDur)
    const b = a + dur
    c.a = a; c.b = b
    setCreate({ a, b })
  }

  function endCreate() {
    const c = createRef.current
    createRef.current = null
    setCreate(null)
    if (!c) return
    if (c.moved) openFormAtRange(c.a, c.b)
    else openFormAtHour(Math.floor(c.startMin / 60))
  }

  function cancelCreate() {
    createRef.current = null
    setCreate(null)
  }

  function beginDrag(ev: React.PointerEvent<HTMLDivElement>, e: DayEntry, edge: DragState['edge']) {
    ev.stopPropagation()
    const actNo = locked.get(e.id)
    if (actNo) { if (edge !== 'move') toast.error(lockedMessage(actNo)); return }
    ev.currentTarget.setPointerCapture(ev.pointerId)
    const s = Math.round(timeToDecimal(e.start_time) * 60)
    const st: DragState = { id: e.id, edge, startY: ev.clientY, origStart: s, origEnd: s + e.duration_min, start: s, end: s + e.duration_min }
    dragRef.current = st
    setDrag(st)
  }

  function moveDrag(ev: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    const dMin = (ev.clientY - d.startY) / PX_PER_MIN
    let start = d.origStart, end = d.origEnd
    const dur0 = d.origEnd - d.origStart
    if (d.edge === 'move') {
      // Запись целиком: длительность прежняя, начало — с шагом 5 минут
      start = Math.max(Math.min(GRID_START_MIN, d.origStart), Math.min(Math.max(GRID_END_MIN - dur0, d.origStart), snapStart(d.origStart + dMin)))
      end = start + dur0
    } else if (d.edge === 'bottom') {
      // Нижний край: начало на месте, длительность меняется по 15 минут
      const maxDur = Math.max(dur0, Math.floor((GRID_END_MIN - d.origStart) / DUR_STEP) * DUR_STEP)
      end = d.origStart + Math.max(DUR_STEP, Math.min(maxDur, snapDur(dur0 + dMin)))
    } else {
      // Верхний край: конец на месте, длительность тоже по 15 минут — значит начало
      // сдвигается от конца кратно 15 (оно не обязано лежать на сетке в 5 минут)
      const maxDur = Math.max(dur0, Math.floor((d.origEnd - GRID_START_MIN) / DUR_STEP) * DUR_STEP)
      start = d.origEnd - Math.max(DUR_STEP, Math.min(maxDur, snapDur(dur0 - dMin)))
    }
    // Пока не сдвинули хотя бы на несколько пикселей, время не трогаем: иначе простое
    // нажатие «округлило» бы запись, начатую не на сетке шага
    if (Math.abs(ev.clientY - d.startY) < 4) { start = d.origStart; end = d.origEnd }
    const next = { ...d, start, end }
    dragRef.current = next
    setDrag(next)
  }

  async function endDrag() {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d || (d.start === d.origStart && d.end === d.origEnd)) return
    lastMoveAt.current = Date.now()
    const startTime = `${pad2(Math.floor(d.start / 60))}:${pad2(d.start % 60)}:00`
    const durationMin = d.end - d.start
    // Сразу показываем новое время, не дожидаясь базы; loadDay ниже вернёт правду
    setEntries(prev => prev.map(x => x.id === d.id ? { ...x, start_time: startTime, duration_min: durationMin } : x))
    const { error } = await supabase.from('time_entries').update({ start_time: startTime, duration_min: durationMin }).eq('id', d.id)
    if (error) toast.error('Не удалось изменить время: ' + error.message)
    else toast.success(`Время записи: ${minToLabel(d.start)}–${minToLabel(d.end)}`)
    loadDay()
  }

  function cancelDrag() {
    dragRef.current = null
    setDrag(null)
  }

  // Записи, идущие в одно время, встают рядом (src/lib/timeline-layout.ts)
  const slots = layoutColumns(entries.map(e => ({ id: e.id, start: Math.round(timeToDecimal(e.start_time) * 60), dur: e.duration_min })))

  const totalHours = entries.reduce((s, e) => s + e.duration_min / 60, 0)
  const totalAmount = entries.filter(e => e.is_billable).reduce((s, e) => s + Number(e.amount), 0)


  // Esc закрывает форму записи — см. src/lib/form-keys.ts
  useEscapeKey(showForm, resetForm)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap min-w-0">
          <button aria-label="Предыдущий день" onClick={() => setDate(d => subDays(d, 1))} className="btn-ghost p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-semibold text-navy-100 capitalize">{mounted ? dateLabel : ' '}</h1>
            <p className="text-xs text-navy-300">
              {entries.length} записей · {totalHours.toFixed(1)} ч · {formatMoney(totalAmount)} ₽
            </p>
          </div>
          <button aria-label="Следующий день" onClick={() => setDate(d => addDays(d, 1))} className="btn-ghost p-2">
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="relative">
            <button onClick={() => { setShowCal(c => !c); setCalMonth(date) }}
              className="btn-ghost text-xs px-3 py-1.5 ml-1 gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Календарь
            </button>
            {/* На телефоне поповер прижат к краям экрана: раньше он висел на
                left-0 от кнопки и при переносе шапки уезжал за правый край */}
            {showCal && (
              <div ref={calRef} className="fixed left-4 right-4 top-20 w-auto
                              md:absolute md:left-0 md:right-auto md:top-10 md:w-80
                              z-50 bg-navy-900 border border-navy-700
                              rounded-xl shadow-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <button aria-label="Предыдущий месяц" onClick={() => setCalMonth(m => subMonths(m, 1))} className="btn-ghost p-1">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium text-navy-200 capitalize">
                    {format(calMonth, 'LLLL yyyy', { locale: ru })}
                  </span>
                  <button aria-label="Следующий месяц" onClick={() => setCalMonth(m => addMonths(m, 1))} className="btn-ghost p-1">
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
                    <div key={d} className="text-center text-xs text-navy-400 py-1">{d}</div>
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
                        className={`relative h-11 md:h-8 w-full rounded-lg text-xs font-medium transition-colors
                          ${isSelected || isMultiSelected ? 'bg-gold-500 text-navy-950'
                            : isToday ? 'bg-navy-700 text-gold-400 ring-1 ring-gold-500/50'
                            : inMonth ? 'text-navy-300 hover:bg-navy-800' : 'text-navy-400'}`}>
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
      <Modal open={showForm} onClose={resetForm}
        title={editId ? 'Редактировать запись' : `Новая запись — ${format(date, 'd MMMM yyyy', { locale: ru })}`} wide>
          <form onKeyDown={submitOnCtrlEnter} onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">Дело *</label>
              <select className="select" required value={form.matter_id}
                onChange={e => selectMatter(e.target.value)}>
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
                  {startMinuteOptions(parseInt(form.start_minute)).map(m => <option key={m} value={m}>{m}</option>)}
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
              <input type="number" min="0" max="12" inputMode="numeric" className="input" placeholder="1"
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
              <label className="label">Ставка, руб./ч. *</label>
              <input type="number" min="0" required inputMode="decimal" className="input" value={form.hourly_rate}
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
              <textarea className="input resize-none" rows={2} required placeholder="Опишите выполненную работу..."
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
      </Modal>

      {/* NDFL toggle */}
      {showForm && (
        <div className="mb-5 flex items-center gap-4 px-4 py-3 bg-navy-900 rounded-xl border border-navy-700">
          <span className="text-sm text-navy-400 font-medium">Ставка с учётом НДФЛ:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-amber-500" checked={ndfl}
              onChange={e => setNdfl(e.target.checked)} />
            <span className={`text-sm font-bold ${ndfl ? 'text-amber-400' : 'text-navy-300'}`}>+НДФЛ 15%</span>
          </label>
          {form.hourly_rate && (
            <span className="text-sm">
              {ndfl
                ? <span className="text-amber-400 font-semibold">
                    {parseFloat(form.hourly_rate).toLocaleString('ru-RU')} ÷ 0,85 = {formatMoney(parseFloat(form.hourly_rate)/0.85)} ₽/ч
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
            <SkeletonRows rows={5} />
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
                      <span className="text-xs text-navy-300">
                        {dayEntries.length} записей · {dayHours.toFixed(1)} ч · {formatMoney(dayAmount)} ₽
                      </span>
                    </div>
                    {dayEntries.length === 0 ? (
                      <p className="text-navy-400 text-xs py-2">Нет записей за этот день</p>
                    ) : (
                      <div className="space-y-1.5">
                        {dayEntries.map(e => (
                          <div key={e.id}
                            onDoubleClick={() => { setDate(new Date(dStr)); setMultiSelectMode(false); setSelectedDates([]); setTimeout(() => openEdit(e), 100) }}
                            onClick={isTouch ? () => { setDate(new Date(dStr)); setMultiSelectMode(false); setSelectedDates([]); setTimeout(() => openEdit(e), 100) } : undefined}
                            title={isTouch ? 'Нажмите — редактировать' : 'Двойной клик — редактировать'}
                            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer
                                        hover:brightness-125 transition-all ${COLORS[e.activity_type]}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs num opacity-70">{e.start_time?.slice(0,5)}</span>
                                <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                                <span className="text-[10px] opacity-70">{ACTIVITY_LABELS[e.activity_type]}</span>
                              </div>
                              <p className="text-xs opacity-80 truncate mt-0.5">{e.description}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs num opacity-70">{(e.duration_min/60).toFixed(2)}ч</p>
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
                    <span className="text-navy-100 font-semibold">
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
        <p className="text-xs text-navy-400 mb-3">
          💡 <span className="hidden md:inline">Двойной клик по записи — редактировать; потяните запись — сдвинуть по времени, за нижний край — изменить длительность, за верхний — время начала; протяните по пустому месту шкалы — новая запись</span>
          <span className="md:hidden">Нажмите на запись — редактировать; потяните за нижний край — изменить длительность</span>
        </p>
      )}

      {loadError && !loading && <LoadError onRetry={loadDay} />}

      {/* Day view */}
      <div className={`card p-0 overflow-hidden ${loadError ? 'hidden' : ''}`}>
        <div className="flex flex-col md:flex-row">
          {/* Timeline + entries row (scale + positioned cards) */}
          <div className="flex flex-1 min-w-0">
            {/* Timeline */}
            <div className="w-12 md:w-16 flex-shrink-0 border-r border-navy-800">
              {HOURS.map(h => (
                <div key={h} className="h-16 border-b border-navy-800/50 px-1 md:px-2 py-1
                                         text-[10px] md:text-xs text-navy-400 num">
                  {h}:00
                </div>
              ))}
            </div>

            {/* Entries column */}
            <div ref={colRef}
              onPointerDown={beginCreate} onPointerMove={moveCreate} onPointerUp={endCreate} onPointerCancel={cancelCreate}
              className="flex-1 relative min-w-0 select-none"
              style={{ height: `${HOURS.length * 64}px`, touchAction: 'pan-y' }}>
              {/* Hour grid lines: клик — час целиком, протяжка мышью — свой отрезок */}
              {HOURS.map((h, i) => (
                <div key={h} data-grid="1"
                  title="Нажмите — добавить запись на час; протяните мышью — на нужное время"
                  className="absolute left-0 right-0 border-b border-navy-800/50
                             hover:bg-navy-800/30 cursor-pointer transition-colors"
                  style={{ top: `${i * 64}px`, height: '64px' }}
                />
              ))}

              {/* Выделение протяжкой: что получится, если отпустить */}
              {create && (
                <div className="pointer-events-none absolute left-1 right-1 md:left-2 md:right-2 rounded-lg border-2 border-dashed
                                border-gold-400/70 bg-gold-500/15 px-2 py-1 text-[11px] num text-gold-300"
                     style={{ top: `${((create.a - GRID_START_MIN) / 60) * 64}px`, height: `${((create.b - create.a) / 60) * 64}px`, zIndex: 4 }}>
                  Новая запись {minToLabel(create.a)}–{minToLabel(create.b)}
                </div>
              )}

              {/* Entry blocks positioned by real start_time */}
              {entries.map(e => {
                // Во время перетаскивания показываем время из drag, а не из базы
                const dg = drag && drag.id === e.id ? drag : null
                const startMin = dg ? dg.start : Math.round(timeToDecimal(e.start_time) * 60)
                const durMin = dg ? dg.end - dg.start : e.duration_min
                const top = Math.max(0, (startMin / 60 - 8) * 64)
                const heightPx = Math.max(28, (durMin / 60) * 64)
                const startLabel = e.start_time || dg ? minToLabel(startMin) : '—'
                const endLabel = minToLabel(startMin + durMin)
                const slot = slots.get(e.id) ?? { col: 0, cols: 1 }
                // В узкой колонке (записи рядом) время переносится под название, иначе название
                // обрезается до пары букв
                const stacked = slot.cols > 1 && heightPx >= 56
                const stop = (ev: React.SyntheticEvent) => ev.stopPropagation()
                const handleProps = {
                  onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: cancelDrag,
                  onClick: stop, onDoubleClick: stop,
                }

                return (
                  <div
                    key={e.id}
                    onDoubleClick={() => { if (Date.now() - lastMoveAt.current < 400) return; openEdit(e) }}
                    onClick={isTouch ? () => openEdit(e) : undefined}
                    onPointerDown={ev => { if (ev.pointerType !== 'touch' && ev.button === 0) beginDrag(ev, e, 'move') }}
                    onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}
                    title={isTouch ? 'Нажмите — редактировать' : 'Двойной клик — редактировать, потяните — сдвинуть по времени'}
                    className={`absolute rounded-lg border px-2 md:px-3 py-1.5
                                hover:brightness-125 overflow-hidden
                                ${dg ? 'transition-none select-none shadow-lg ring-1 ring-white/40 cursor-grabbing' : 'transition-all cursor-pointer md:cursor-grab'}
                                ${COLORS[e.activity_type]}`}
                    style={{
                      top: `${top}px`, height: `${heightPx}px`, zIndex: dg ? 10 : 5,
                      // Записи в одно время — рядом: колонка slot.col из slot.cols
                      left: `calc(${(slot.col / slot.cols) * 100}% + 6px)`,
                      width: `calc(${100 / slot.cols}% - 12px)`,
                    }}
                  >
                    <div className={stacked ? 'flex flex-col gap-0' : 'flex items-center justify-between gap-2'}>
                      <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                      <span className="text-[10px] num opacity-70 flex-shrink-0">
                        {startLabel}–{endLabel}
                      </span>
                    </div>
                    {heightPx > 30 && (
                      <p className="text-xs opacity-80 truncate">{e.description}</p>
                    )}
                    {/* Верхний край — время начала (на телефоне скрыт: там тянут за нижний) */}
                    <div
                      aria-label="Потяните, чтобы изменить время начала"
                      title="Потяните — изменить время начала"
                      onPointerDown={ev => beginDrag(ev, e, 'top')}
                      {...handleProps}
                      className="absolute left-0 right-0 top-0 h-1.5 cursor-ns-resize touch-none hover:bg-white/20 [@media(pointer:coarse)]:hidden"
                    />
                    {/* Нижний край — длительность; на сенсорном экране ручка выше и с видимой «полоской» */}
                    <div
                      aria-label="Потяните, чтобы изменить длительность"
                      title="Потяните — изменить длительность"
                      onPointerDown={ev => beginDrag(ev, e, 'bottom')}
                      {...handleProps}
                      className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize touch-none hover:bg-white/20 [@media(pointer:coarse)]:h-3.5"
                    >
                      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0.5 w-8 h-0.5 rounded-full bg-current opacity-30" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Side list */}
          <div className="w-full md:w-72 flex-shrink-0 border-t md:border-t-0 md:border-l border-navy-800 p-4
                          md:overflow-y-auto"
               style={{ maxHeight: undefined }}>
            {/* На телефоне список скрыт: те же записи уже видны на шкале дня выше
                и открываются одним касанием — здесь остаются только итоги */}
            <h3 className="hidden md:block text-xs font-medium text-navy-300 mb-3 uppercase tracking-wide">Записи дня</h3>
            {loading ? (
              <p className="hidden md:block text-navy-400 text-xs">Загрузка...</p>
            ) : entries.length === 0 ? (
              <p className="text-navy-400 text-xs">Нет записей. Нажмите на временной слот, чтобы добавить.</p>
            ) : (
              <div className="hidden md:block space-y-2">
                {entries.map(e => (
                  <div key={e.id}
                    onDoubleClick={() => openEdit(e)}
                    onClick={isTouch ? () => openEdit(e) : undefined}
                    className={`p-2.5 rounded-lg border cursor-pointer hover:brightness-125 transition-all
                                ${COLORS[e.activity_type]}`}
                    title={isTouch ? 'Нажмите — редактировать' : 'Двойной клик — редактировать'}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-xs font-semibold truncate">{e.matters?.clients?.name}</p>
                      {/* Карандаш раньше был просто картинкой — выглядел кнопкой, но не нажимался */}
                      <button type="button" aria-label="Редактировать запись"
                        onClick={ev => { ev.stopPropagation(); openEdit(e) }}
                        className="btn-ghost p-1.5 -m-1.5 flex-shrink-0 opacity-60 hover:opacity-100">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs opacity-90">{ACTIVITY_LABELS[e.activity_type]}</p>
                    <p className="text-xs opacity-70 truncate mt-0.5">{e.description}</p>
                    <div className="flex justify-between mt-1.5 text-xs">
                      <span className="num opacity-70">
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
              <div className="md:mt-4 md:pt-4 md:border-t border-navy-800 flex justify-between text-xs">
                <span className="text-navy-300">Итого часов:</span>
                <span className="text-navy-200 font-semibold">{totalHours.toFixed(2)}</span>
              </div>
            )}
            {entries.length > 0 && (
              <div className="flex justify-between text-xs mt-1">
                <span className="text-navy-300">К оплате:</span>
                <span className="text-navy-100 font-semibold">{formatMoney(totalAmount)} ₽</span>
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
