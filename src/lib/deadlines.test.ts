import { describe, it, expect } from 'vitest'
import {
  DEADLINE_TEMPLATES, computeDeadline, addMonths, addWorkingDays,
  isWorkingDay, nextWorkingDay, fromISO, toISO, daysUntil, untilLabel,
} from './deadlines'

const tpl = (id: string) => DEADLINE_TEMPLATES.find(t => t.id === id)!

describe('рабочие и нерабочие дни', () => {
  it('выходные и праздники нерабочие', () => {
    expect(isWorkingDay(fromISO('2026-09-20'))).toBe(false)  // воскресенье
    expect(isWorkingDay(fromISO('2026-09-21'))).toBe(true)   // понедельник
    expect(isWorkingDay(fromISO('2026-05-01'))).toBe(false)  // Праздник весны и труда
    expect(isWorkingDay(fromISO('2026-06-12'))).toBe(false)  // День России
  })

  it('праздник, выпавший на выходной, переносится на понедельник', () => {
    // 8 марта 2026 — воскресенье, значит 9 марта нерабочий (ч. 2 ст. 112 ТК РФ)
    expect(isWorkingDay(fromISO('2026-03-08'))).toBe(false)
    expect(isWorkingDay(fromISO('2026-03-09'))).toBe(false)
    expect(isWorkingDay(fromISO('2026-03-10'))).toBe(true)
  })

  it('ближайший рабочий день после праздника среди недели', () => {
    // 1 мая 2026 — пятница, дальше суббота и воскресенье
    expect(toISO(nextWorkingDay(fromISO('2026-05-01')))).toBe('2026-05-04')
  })
})

describe('месячные сроки', () => {
  it('истекают в то же число следующего месяца', () => {
    expect(toISO(addMonths(fromISO('2026-03-16'), 1))).toBe('2026-04-16')
    expect(toISO(addMonths(fromISO('2026-06-30'), 3))).toBe('2026-09-30')
  })

  it('если такого числа нет — последний день месяца (31 января + месяц)', () => {
    expect(toISO(addMonths(fromISO('2026-01-31'), 1))).toBe('2026-02-28')
  })

  it('апелляция по ГПК: месяц со дня изготовления решения', () => {
    const r = computeDeadline('2026-03-16', tpl('gpk-appeal'))!
    expect(r.date).toBe('2026-04-16')
    expect(r.shifted).toBe(false)
    expect(r.explanation).toContain('ч. 2 ст. 321 ГПК РФ')
  })

  it('окончание на выходном переносится на рабочий день', () => {
    // 31 января + месяц = 28 февраля, суббота → понедельник 2 марта
    const r = computeDeadline('2026-01-31', tpl('gpk-appeal'))!
    expect(r.date).toBe('2026-03-02')
    expect(r.shifted).toBe(true)
    expect(r.explanation).toContain('перенесено')
  })
})

describe('сроки в рабочих днях (ГПК, АПК, КАС)', () => {
  it('23 февраля не считается: пятница + 3 рабочих дня = четверг', () => {
    expect(toISO(addWorkingDays(fromISO('2026-02-20'), 3))).toBe('2026-02-26')
  })

  it('частная жалоба — 15 рабочих дней, а не календарных', () => {
    const r = computeDeadline('2026-09-21', tpl('gpk-private'))!
    // 15 рабочих дней от понедельника 21 сентября — это 12 октября
    expect(r.date).toBe('2026-10-12')
    expect(r.explanation).toContain('рабочих дней')
  })
})

describe('сроки в сутках (УПК, КоАП)', () => {
  it('апелляция на приговор — 15 суток календарных', () => {
    const r = computeDeadline('2026-06-01', tpl('upk-appeal'))!
    expect(r.date).toBe('2026-06-16')
    expect(r.explanation).toContain('ст. 389.4 УПК РФ')
  })

  it('жалоба по КоАП — 10 суток со дня вручения', () => {
    const r = computeDeadline('2026-09-21', tpl('koap-complaint'))!
    expect(r.date).toBe('2026-10-01')
  })
})

describe('защита от мусора на входе', () => {
  it('пустая или неполная дата не даёт расчёта', () => {
    expect(computeDeadline('', tpl('gpk-appeal'))).toBeNull()
    expect(computeDeadline('2026-13', tpl('gpk-appeal'))).toBeNull()
  })
})

describe('сколько осталось', () => {
  const today = fromISO('2026-09-20')

  it('считает дни до срока', () => {
    expect(daysUntil('2026-09-20', today)).toBe(0)
    expect(daysUntil('2026-09-27', today)).toBe(7)
    expect(daysUntil('2026-09-18', today)).toBe(-2)
  })

  it('по-русски и с правильным окончанием', () => {
    expect(untilLabel('2026-09-20', today)).toBe('сегодня')
    expect(untilLabel('2026-09-21', today)).toBe('завтра')
    expect(untilLabel('2026-09-23', today)).toBe('через 3 дня')
    expect(untilLabel('2026-09-25', today)).toBe('через 5 дней')
    expect(untilLabel('2026-10-11', today)).toBe('через 21 день')
    expect(untilLabel('2026-09-18', today)).toBe('срок прошёл 2 дня назад')
  })
})
