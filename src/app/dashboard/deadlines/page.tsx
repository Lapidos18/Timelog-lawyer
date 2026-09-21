'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { CourtEvent, CourtEventKind, EVENT_KIND_LABELS, Matter, Client } from '@/types'
import { format } from 'date-fns'
import { CalendarClock, Plus, Check, Trash2, Gavel, AlertTriangle, Calculator, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/PageHeader'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'
import { SkeletonRows } from '@/components/Skeleton'
import ChangeHistory from '@/components/ChangeHistory'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import { DEADLINE_TEMPLATES, computeDeadline, daysUntil, untilLabel, toISO } from '@/lib/deadlines'

/**
 * Сроки и заседания.
 *
 * Единственная по-настоящему дорогая ошибка в адвокатской работе —
 * пропущенный срок, поэтому раздел устроен вокруг двух вопросов: что горит
 * и когда. Расчёт срока встроен в форму: указываете дату решения и вид
 * обжалования — последний день считается сам, и рядом написано, по какой
 * норме (src/lib/deadlines.ts).
 *
 * Расчёт остаётся подсказкой: переносы выходных дней Правительство
 * устанавливает ежегодно, и в формуле их нет. Дату всегда можно исправить
 * руками, об этом прямо сказано в форме.
 */

type Filter = 'open' | 'past' | 'all'

const KIND_STYLE: Record<CourtEventKind, string> = {
  hearing:  'bg-gold-900/30 text-gold-400',
  deadline: 'bg-amber-500/15 text-amber-300',
  other:    'bg-navy-700 text-navy-300',
}

const fmtDate = (s: string) => format(new Date(s + 'T12:00:00'), 'dd.MM.yyyy')

/** Цвет строки: просрочено — красный, в пределах напоминания — янтарный */
function urgency(e: CourtEvent): 'over' | 'soon' | 'later' {
  if (e.done) return 'later'
  const left = daysUntil(e.event_date)
  if (left < 0) return 'over'
  return left <= e.remind_days ? 'soon' : 'later'
}

export default function DeadlinesPage() {
  const supabase = createClient()
  const [events, setEvents] = useState<CourtEvent[]>([])
  const [matters, setMatters] = useState<(Matter & { clients?: Client })[]>([])
  const [loading, setLoading] = useState(true)
  /** Таблицы ещё нет — миграция 017 не выполнена */
  const [noTable, setNoTable] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const empty = {
    kind: 'deadline' as CourtEventKind,
    title: '', matter_id: '', event_date: '', event_time: '',
    place: '', note: '', remind_days: '7',
    template_id: '', base_date: '',
  }
  const [form, setForm] = useState(empty)

  useEscapeKey(showForm, () => setShowForm(false))

  const load = useCallback(async () => {
    setLoading(true)
    const [evRes, mRes] = await Promise.all([
      supabase.from('court_events').select('*, matters(*, clients(*))').order('event_date'),
      supabase.from('matters').select('*, clients(*)').order('title'),
    ])
    // Код выкатывается раньше, чем пользователь выполнит миграцию, —
    // в этом случае таблицы ещё нет, и раздел должен объяснить, а не упасть
    if (evRes.error && /court_events/.test(evRes.error.message)) setNoTable(true)
    setEvents((evRes.data ?? []) as CourtEvent[])
    setMatters((mRes.data ?? []) as (Matter & { clients?: Client })[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const list = events.filter(e => {
      if (filter === 'all') return true
      const past = e.done || daysUntil(e.event_date) < 0
      return filter === 'past' ? past : !past
    })
    // Просроченное — наверх: оно требует решения сегодня
    return list.sort((a, b) => a.event_date.localeCompare(b.event_date))
  }, [events, filter])

  const openCount = events.filter(e => !e.done && daysUntil(e.event_date) >= 0).length
  const overCount = events.filter(e => !e.done && daysUntil(e.event_date) < 0).length

  /** Подсказка расчёта под полями «дата основания» + «вид срока» */
  const template = DEADLINE_TEMPLATES.find(t => t.id === form.template_id)
  const computed = template && form.base_date ? computeDeadline(form.base_date, template) : null

  function startNew() {
    setEditId(null)
    setForm({ ...empty, event_date: toISO(new Date()) })
    setShowForm(true)
  }

  function startEdit(e: CourtEvent) {
    setEditId(e.id)
    setForm({
      kind: e.kind,
      title: e.title,
      matter_id: e.matter_id ?? '',
      event_date: e.event_date,
      event_time: e.event_time ? e.event_time.slice(0, 5) : '',
      place: e.place ?? '',
      note: e.note ?? '',
      remind_days: String(e.remind_days),
      template_id: e.template_id ?? '',
      base_date: e.base_date ?? '',
    })
    setShowForm(true)
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.title.trim() || !form.event_date) {
      toast.error('Нужны название и дата')
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      matter_id: form.matter_id || null,
      kind: form.kind,
      title: form.title.trim(),
      event_date: form.event_date,
      event_time: form.event_time || null,
      place: form.place.trim() || null,
      note: form.note.trim() || null,
      remind_days: Math.max(0, Number(form.remind_days) || 0),
      template_id: form.template_id || null,
      base_date: form.base_date || null,
    }

    const { error } = editId
      ? await supabase.from('court_events').update(payload).eq('id', editId)
      : await supabase.from('court_events').insert({ ...payload, created_by: user!.id })

    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(editId ? 'Изменено' : 'Добавлено')
    setShowForm(false)
    load()
  }

  /**
   * Пробное напоминание: то же самое, что придёт утром по расписанию.
   * Запрос идёт с ключом текущего входа — иначе адрес был бы открыт всем,
   * и в чат мог бы писать кто угодно.
   */
  async function testNotify() {
    setTesting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const out = await res.json()
      if (out.status === 'sent') toast.success('Отправлено в Телеграм — проверьте телефон')
      else if (out.status === 'nothing') toast('Напоминать не о чем: ничего не горит', { icon: '🙂' })
      else if (out.status === 'not-configured') toast.error(out.message)
      else toast.error(out.message ?? 'Не получилось отправить')
    } catch {
      toast.error('Не получилось связаться с сервером')
    }
    setTesting(false)
  }

  async function toggleDone(e: CourtEvent) {
    const { error } = await supabase.from('court_events')
      .update({ done: !e.done, done_at: e.done ? null : new Date().toISOString() })
      .eq('id', e.id)
    if (error) { toast.error(error.message); return }
    load()
  }

  async function remove(e: CourtEvent) {
    if (!confirm(`Удалить «${e.title}»? Это нельзя отменить.`)) return
    const { error } = await supabase.from('court_events').delete().eq('id', e.id)
    if (error) { toast.error(error.message); return }
    toast.success('Удалено')
    load()
  }

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Сроки и заседания" icon={CalendarClock}
        description="Даты заседаний и процессуальных сроков. Ближайшие и просроченные видны на Обзоре.">
        <div className="flex gap-2 flex-wrap">
          <button onClick={testNotify} disabled={testing} className="btn-secondary">
            <Send className="w-4 h-4" /> {testing ? 'Отправляю...' : 'Проверить напоминание'}
          </button>
          <button onClick={startNew} className="btn-primary">
            <Plus className="w-4 h-4" /> Добавить
          </button>
        </div>
      </PageHeader>

      {noTable && (
        <div className="card mb-5 border-amber-800/50">
          <p className="text-sm text-amber-300 mb-1">Раздел не готов к работе</p>
          <p className="text-xs text-navy-300">
            В базе ещё нет таблицы для сроков. Выполните миграцию
            <span className="num"> 017_court_events.sql </span>
            в Supabase SQL Editor — после этого раздел заработает.
          </p>
        </div>
      )}

      {/* Фильтры. flex-wrap обязателен: в 375 px четыре кнопки в строку не влезают */}
      <div className="flex flex-wrap gap-2 mb-4">
        {([
          ['open', `Предстоящие${openCount ? ` · ${openCount}` : ''}`],
          ['past', 'Прошедшие и закрытые'],
          ['all', 'Все'],
        ] as [Filter, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`tap px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === v ? 'bg-navy-700 text-navy-100' : 'text-navy-300 hover:text-navy-100'
            }`}>
            {label}
          </button>
        ))}
        {overCount > 0 && (
          <span className="tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                           text-xs font-medium bg-red-500/15 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5" /> просрочено: {overCount}
          </span>
        )}
      </div>

      {loading ? (
        <div className="card"><SkeletonRows rows={5} /></div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={CalendarClock}
            title={filter === 'open' ? 'Предстоящих событий нет' : 'Ничего не найдено'}
            description="Заседание, процессуальный срок или иная дата, о которой нужно помнить."
            action={<button onClick={startNew} className="btn-primary">
              <Plus className="w-4 h-4" /> Добавить первое
            </button>} />
        </div>
      ) : (
        <>
          <p className="text-xs text-navy-400 mb-2">
            Двойной клик по строке — редактировать. Галочка слева — отметить исполненным.
          </p>
          <div className="card p-0 overflow-hidden">
            <ul className="divide-y divide-navy-800/60">
              {shown.map(e => {
                const u = urgency(e)
                return (
                  <li key={e.id}
                    onDoubleClick={() => startEdit(e)}
                    title="Двойной клик — редактировать"
                    className={`flex items-start gap-3 px-4 md:px-5 py-3 cursor-pointer
                                hover:bg-navy-800/40 ${
                      u === 'over' ? 'needs-attention' : ''
                    }`}>
                    <button onClick={() => toggleDone(e)}
                      aria-label={e.done ? 'Снять отметку' : 'Отметить исполненным'}
                      className={`tap-icon flex-shrink-0 mt-0.5 rounded-md border ${
                        e.done
                          ? 'bg-emerald-900/40 border-emerald-800/50 text-emerald-400'
                          : 'border-navy-700 text-navy-500 hover:text-navy-200'
                      }`}>
                      <Check className="w-3.5 h-3.5" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="text-sm text-navy-100 num">
                          {fmtDate(e.event_date)}
                          {e.event_time && <span className="text-navy-300"> · {e.event_time.slice(0, 5)}</span>}
                        </span>
                        <span className={`text-xs font-medium ${
                          u === 'over' ? 'text-red-400' : u === 'soon' ? 'text-amber-400' : 'text-navy-400'
                        }`}>
                          {e.done ? 'исполнено' : untilLabel(e.event_date)}
                        </span>
                      </div>

                      <p className={`text-sm mt-0.5 ${e.done ? 'text-navy-400 line-through' : 'text-navy-200'}`}>
                        {e.title}
                      </p>

                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-md ${KIND_STYLE[e.kind]}`}>
                          {EVENT_KIND_LABELS[e.kind]}
                        </span>
                        {e.matters && (
                          <span className="text-xs text-navy-300 truncate max-w-[60%]">
                            {e.matters.clients?.name} · {e.matters.title}
                          </span>
                        )}
                      </div>

                      {(e.place || e.note) && (
                        <p className="text-xs text-navy-400 mt-1">
                          {e.place}{e.place && e.note ? ' · ' : ''}{e.note}
                        </p>
                      )}
                    </div>

                    <button onClick={() => remove(e)} aria-label="Удалить"
                      className="tap-icon text-navy-400 hover:text-red-400 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {/* Форма */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editId ? 'Изменить событие' : 'Новое событие'} wide>
        <form onSubmit={handleSubmit} onKeyDown={submitOnCtrlEnter}
          className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <div>
            <label className="label">Что это *</label>
            <select className="select" value={form.kind}
              onChange={ev => setForm(f => ({ ...f, kind: ev.target.value as CourtEventKind }))}>
              {(Object.entries(EVENT_KIND_LABELS) as [CourtEventKind, string][])
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Дело</label>
            <select className="select" value={form.matter_id}
              onChange={ev => setForm(f => ({ ...f, matter_id: ev.target.value }))}>
              <option value="">— без привязки к делу —</option>
              {matters.map(m => (
                <option key={m.id} value={m.id}>{m.clients?.name} / {m.title}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="label">Название *</label>
            <input type="text" className="input" value={form.title}
              onChange={ev => setForm(f => ({ ...f, title: ev.target.value }))}
              placeholder={form.kind === 'hearing'
                ? 'напр. Судебное заседание по иску о взыскании'
                : 'напр. Подать апелляционную жалобу'} />
          </div>

          {/* Расчёт срока. Стоит перед полем даты: заполнив его, пользователь
              получает дату уже посчитанной */}
          {form.kind === 'deadline' && (
            <div className="md:col-span-2 rounded-lg border border-navy-700/50 bg-navy-800/40 p-4">
              <p className="text-xs font-medium text-navy-200 mb-3 flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5" /> Рассчитать срок
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Вид срока</label>
                  <select className="select" value={form.template_id}
                    onChange={ev => setForm(f => ({ ...f, template_id: ev.target.value }))}>
                    <option value="">— считать не нужно, укажу дату сам —</option>
                    {DEADLINE_TEMPLATES.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">
                    Дата {template ? template.from.replace(/^со дня /, '') : 'события, от которой идёт срок'}
                  </label>
                  <input type="date" className="input" value={form.base_date}
                    onChange={ev => setForm(f => ({ ...f, base_date: ev.target.value }))} />
                </div>
              </div>

              {computed && (
                <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-xs text-navy-300 flex-1 min-w-[200px]">
                    Последний день срока —{' '}
                    <span className="num font-semibold text-navy-100">{fmtDate(computed.date)}</span>.{' '}
                    <span className="text-navy-400">{computed.explanation}.</span>
                  </p>
                  <button type="button" className="btn-secondary text-xs"
                    onClick={() => setForm(f => ({ ...f, event_date: computed.date }))}>
                    Подставить дату
                  </button>
                </div>
              )}

              <p className="text-xs text-navy-400 mt-3">
                Расчёт — подсказка. Переносы выходных дней Правительство устанавливает
                ежегодно, и здесь они не учтены: дату стоит сверить.
              </p>
            </div>
          )}

          <div>
            <label className="label">{form.kind === 'deadline' ? 'Последний день срока *' : 'Дата *'}</label>
            <input type="date" className="input" value={form.event_date}
              onChange={ev => setForm(f => ({ ...f, event_date: ev.target.value }))} required />
          </div>

          {form.kind !== 'deadline' && (
            <div>
              <label className="label">Время</label>
              <input type="time" className="input" value={form.event_time}
                onChange={ev => setForm(f => ({ ...f, event_time: ev.target.value }))} />
            </div>
          )}

          <div>
            <label className="label">Предупредить за (дней)</label>
            <input type="number" inputMode="numeric" min={0} max={365} className="input"
              value={form.remind_days}
              onChange={ev => setForm(f => ({ ...f, remind_days: ev.target.value }))} />
          </div>

          <div className={form.kind === 'deadline' ? '' : 'md:col-span-2'}>
            <label className="label">{form.kind === 'hearing' ? 'Суд, адрес, зал' : 'Где / куда подавать'}</label>
            <input type="text" className="input" value={form.place}
              onChange={ev => setForm(f => ({ ...f, place: ev.target.value }))}
              placeholder="напр. Заельцовский районный суд, каб. 305" />
          </div>

          <div className="md:col-span-2">
            <label className="label">Примечание</label>
            <input type="text" className="input" value={form.note}
              onChange={ev => setForm(f => ({ ...f, note: ev.target.value }))}
              placeholder="что подготовить, кого известить" />
          </div>

          <div className="md:col-span-2 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              <Check className="w-4 h-4" /> {saving ? 'Сохраняю...' : editId ? 'Сохранить' : 'Добавить'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Отмена</button>
            {editId && (
              <span className="text-xs text-navy-400 self-center flex items-center gap-1.5">
                <Gavel className="w-3.5 h-3.5" /> изменения записываются в историю
              </span>
            )}
          </div>

          {editId && (
            <div className="md:col-span-2">
              <ChangeHistory table="court_events" rowId={editId} />
            </div>
          )}
        </form>
      </Modal>
    </div>
  )
}
