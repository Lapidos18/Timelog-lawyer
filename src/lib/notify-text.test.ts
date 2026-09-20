import { describe, it, expect } from 'vitest'
import { buildNotification, NotifyEvent } from './notify-text'
import { fromISO } from './deadlines'

const today = fromISO('2026-09-20')

const ev = (over: Partial<NotifyEvent>): NotifyEvent => ({
  title: 'Событие', event_date: '2026-09-21', event_time: null,
  kind: 'deadline', remind_days: 7, done: false, matters: null, ...over,
})

describe('текст напоминания', () => {
  it('молчит, когда ничего не горит', () => {
    expect(buildNotification([], today)).toBeNull()
    // до срока далеко: 20 дней при предупреждении за 7
    expect(buildNotification([ev({ event_date: '2026-10-10' })], today)).toBeNull()
  })

  it('исполненное не напоминает, даже если просрочено', () => {
    expect(buildNotification([ev({ event_date: '2026-09-01', done: true })], today)).toBeNull()
  })

  it('делит на просроченное, сегодня и ближайшее', () => {
    const text = buildNotification([
      ev({ title: 'Подать апелляционную жалобу', event_date: '2026-09-18' }),
      ev({ title: 'Заседание', event_date: '2026-09-20', event_time: '10:00:00', kind: 'hearing' }),
      ev({ title: 'Ознакомиться с делом', event_date: '2026-09-24' }),
    ], today)!

    expect(text).toContain('ПРОСРОЧЕНО:')
    expect(text).toContain('срок прошёл 2 дня назад')
    expect(text).toContain('СЕГОДНЯ:')
    expect(text).toContain('в 10:00')
    expect(text).toContain('БЛИЖАЙШИЕ:')
    expect(text).toContain('через 4 дня')
  })

  it('показывает доверителя и дело', () => {
    const text = buildNotification([
      ev({ title: 'Заседание', matters: { title: 'Метизные решения', clients: { name: 'ООО "Система"' } } }),
    ], today)!
    expect(text).toContain('ООО "Система" / Метизные решения')
  })

  it('у каждого события свой срок предупреждения', () => {
    // за 14 дней предупреждаем, значит событие через 10 дней уже в списке
    const text = buildNotification([ev({ event_date: '2026-09-30', remind_days: 14 })], today)
    expect(text).not.toBeNull()
    // а с обычными 7 днями — ещё нет
    expect(buildNotification([ev({ event_date: '2026-09-30', remind_days: 7 })], today)).toBeNull()
  })

  it('порядок — по дате, раньше сверху', () => {
    const text = buildNotification([
      ev({ title: 'Позже', event_date: '2026-09-25' }),
      ev({ title: 'Раньше', event_date: '2026-09-21' }),
    ], today)!
    expect(text.indexOf('Раньше')).toBeLessThan(text.indexOf('Позже'))
  })
})
