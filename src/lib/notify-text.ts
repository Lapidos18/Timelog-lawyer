/**
 * Текст ежедневного напоминания в Телеграм.
 *
 * Вынесено отдельно от отправки: текст — это то, что читает человек в шесть
 * утра одним глазом, и его нужно уметь проверить тестом, не дёргая Телеграм.
 *
 * Отправляется как обычный текст, без разметки: в названии дела попадаются
 * кавычки, «<» и «>», а любая разметка на них ломается — Телеграм вернёт
 * ошибку, и напоминание просто не придёт.
 */

import { daysUntil, untilLabel } from './deadlines'

export type NotifyEvent = {
  title: string
  event_date: string
  event_time: string | null
  kind: 'hearing' | 'deadline' | 'other'
  remind_days: number
  done: boolean
  matters?: { title: string; clients?: { name: string } | null } | null
}

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function line(e: NotifyEvent): string {
  const time = e.event_time ? ` в ${e.event_time.slice(0, 5)}` : ''
  const matter = e.matters
    ? ` — ${e.matters.clients?.name ?? ''}${e.matters.clients?.name ? ' / ' : ''}${e.matters.title}`
    : ''
  return `• ${fmtDay(e.event_date)}${time} — ${e.title}${matter}`
}

/**
 * Собирает текст напоминания.
 *
 * Берутся только незакрытые события, до которых осталось не больше их
 * собственного срока предупреждения, и всё просроченное. Если брать нечего —
 * возвращается null, и письмо не отправляется вовсе: ежедневное «ничего
 * нет» быстро перестают читать.
 */
export function buildNotification(events: NotifyEvent[], today = new Date()): string | null {
  const due = events
    .filter(e => !e.done && daysUntil(e.event_date, today) <= e.remind_days)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))

  if (due.length === 0) return null

  const overdue = due.filter(e => daysUntil(e.event_date, today) < 0)
  const todayList = due.filter(e => daysUntil(e.event_date, today) === 0)
  const soon = due.filter(e => daysUntil(e.event_date, today) > 0)

  const parts: string[] = ['Сроки и заседания']

  if (overdue.length > 0) {
    parts.push('', 'ПРОСРОЧЕНО:', ...overdue.map(e => `${line(e)} (${untilLabel(e.event_date, today)})`))
  }
  if (todayList.length > 0) {
    parts.push('', 'СЕГОДНЯ:', ...todayList.map(line))
  }
  if (soon.length > 0) {
    parts.push('', 'БЛИЖАЙШИЕ:', ...soon.map(e => `${line(e)} (${untilLabel(e.event_date, today)})`))
  }

  return parts.join('\n')
}
