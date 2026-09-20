/**
 * Расчёт процессуальных сроков.
 *
 * Считать срок в уме — ровно то место, где ошибка стоит дороже всего:
 * пропущенный срок обжалования не лечится аккуратностью в остальном.
 * Поэтому формулы вынесены сюда и покрыты тестами, а в интерфейсе рядом с
 * каждой подставленной датой показывается норма, по которой она посчитана.
 *
 * ВАЖНО: расчёт — подсказка, а не заключение. Переносы выходных дней
 * устанавливаются ежегодно постановлением Правительства (рабочие субботы,
 * длинные майские) и здесь не учитываются; итоговую дату нужно сверять.
 */

export type DeadlineUnit = 'months' | 'working-days' | 'calendar-days'

export type DeadlineTemplate = {
  id: string
  /** Как называется в списке */
  label: string
  amount: number
  unit: DeadlineUnit
  /** С какого момента идёт отсчёт — подпись к полю даты */
  from: string
  /** Норма, по которой считаем */
  citation: string
}

/**
 * Шаблоны сроков.
 *
 * Дни в ГПК, АПК и КАС — РАБОЧИЕ (ч. 3 ст. 107 ГПК РФ, ч. 3 ст. 113 АПК РФ,
 * ч. 2 ст. 92 КАС РФ), а в УПК и КоАП срок в сутках — календарный
 * (ст. 128 УПК РФ, ст. 4.8 КоАП РФ). Это разные вещи, и путать их нельзя.
 */
export const DEADLINE_TEMPLATES: DeadlineTemplate[] = [
  {
    id: 'gpk-appeal',
    label: 'Апелляционная жалоба — ГПК',
    amount: 1, unit: 'months',
    from: 'со дня принятия решения в окончательной форме',
    citation: 'ч. 2 ст. 321 ГПК РФ',
  },
  {
    id: 'gpk-private',
    label: 'Частная жалоба на определение — ГПК',
    amount: 15, unit: 'working-days',
    from: 'со дня вынесения определения',
    citation: 'ч. 1 ст. 332 ГПК РФ, дни рабочие — ч. 3 ст. 107 ГПК РФ',
  },
  {
    id: 'gpk-cassation',
    label: 'Кассационная жалоба — ГПК',
    amount: 3, unit: 'months',
    from: 'со дня вступления решения в законную силу',
    citation: 'ч. 1 ст. 376.1 ГПК РФ',
  },
  {
    id: 'apk-appeal',
    label: 'Апелляционная жалоба — АПК',
    amount: 1, unit: 'months',
    from: 'со дня принятия решения в полном объёме',
    citation: 'ч. 1 ст. 259 АПК РФ',
  },
  {
    id: 'apk-cassation',
    label: 'Кассационная жалоба — АПК',
    amount: 2, unit: 'months',
    from: 'со дня вступления решения в законную силу',
    citation: 'ч. 1 ст. 276 АПК РФ',
  },
  {
    id: 'kas-appeal',
    label: 'Апелляционная жалоба — КАС',
    amount: 1, unit: 'months',
    from: 'со дня принятия решения в окончательной форме',
    citation: 'ч. 1 ст. 298 КАС РФ',
  },
  {
    id: 'upk-appeal',
    label: 'Апелляционная жалоба на приговор — УПК',
    amount: 15, unit: 'calendar-days',
    from: 'со дня постановления приговора',
    citation: 'ч. 1 ст. 389.4 УПК РФ, срок в сутках — ст. 128 УПК РФ',
  },
  {
    id: 'koap-complaint',
    label: 'Жалоба на постановление — КоАП',
    amount: 10, unit: 'calendar-days',
    from: 'со дня вручения или получения копии постановления',
    citation: 'ч. 1 ст. 30.3 КоАП РФ',
  },
]

/** Нерабочие праздничные дни, ст. 112 ТК РФ — как «месяц-день» */
const FIXED_HOLIDAYS = new Set([
  '01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08',
  '02-23', '03-08', '05-01', '05-09', '06-12', '11-04',
])

const pad = (n: number) => String(n).padStart(2, '0')

/** Date → «2026-09-20» (без часовых поясов: берём локальные поля) */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** «2026-09-20» → Date на полдень, чтобы переход на летнее время не сдвигал дату */
export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

function isFixedHoliday(d: Date): boolean {
  return FIXED_HOLIDAYS.has(`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

/**
 * Рабочий ли день.
 *
 * Праздник, выпавший на выходной, переносится на следующий рабочий день
 * (ч. 2 ст. 112 ТК РФ) — здесь это учтено в общем виде: если предыдущие
 * подряд идущие дни были праздничными и выходными, ближайший будний день
 * после них тоже считается нерабочим.
 */
export function isWorkingDay(d: Date): boolean {
  if (isWeekend(d) || isFixedHoliday(d)) return false

  // Перенос: идём назад, пока дни нерабочие, и смотрим, был ли среди них
  // праздник, выпавший на субботу или воскресенье
  const probe = new Date(d)
  let shifted = 0
  for (;;) {
    probe.setDate(probe.getDate() - 1)
    if (!isWeekend(probe) && !isFixedHoliday(probe)) break
    if (isFixedHoliday(probe) && isWeekend(probe)) shifted++
    // Длинные январские каникулы и так все нерабочие; ограничиваем просмотр
    if (shifted > 0) break
  }
  return shifted === 0
}

/** Ближайший рабочий день, начиная с указанного */
export function nextWorkingDay(d: Date): Date {
  const out = new Date(d)
  let guard = 0
  while (!isWorkingDay(out) && guard++ < 30) out.setDate(out.getDate() + 1)
  return out
}

/**
 * Прибавить месяцы: срок истекает в соответствующее число последнего месяца,
 * а если такого числа нет — в последний день этого месяца
 * (ч. 1 ст. 108 ГПК РФ; 31 января + 1 месяц = 28 или 29 февраля).
 */
export function addMonths(d: Date, months: number): Date {
  const day = d.getDate()
  const out = new Date(d.getFullYear(), d.getMonth() + months, 1, 12, 0, 0)
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
  out.setDate(Math.min(day, lastDay))
  return out
}

/** Прибавить рабочие дни, начиная со следующего дня после события */
export function addWorkingDays(d: Date, days: number): Date {
  const out = new Date(d)
  let left = days
  let guard = 0
  while (left > 0 && guard++ < 1000) {
    out.setDate(out.getDate() + 1)
    if (isWorkingDay(out)) left--
  }
  return out
}

export type DeadlineResult = {
  /** Последний день срока, «2026-10-20» */
  date: string
  /** Человеческое объяснение, откуда дата */
  explanation: string
  /** Сдвинут ли с нерабочего дня */
  shifted: boolean
}

/**
 * Последний день срока по шаблону.
 *
 * Течение срока начинается на следующий день после даты события
 * (ч. 3 ст. 107 ГПК РФ, ч. 4 ст. 113 АПК РФ, ст. 128 УПК РФ), а если
 * окончание приходится на нерабочий день — срок истекает в ближайший
 * следующий рабочий (ч. 2 ст. 108 ГПК РФ, ч. 4 ст. 114 АПК РФ,
 * ст. 93 КАС РФ, ч. 2 ст. 128 УПК РФ).
 */
export function computeDeadline(baseISO: string, t: DeadlineTemplate): DeadlineResult | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseISO)) return null
  const base = fromISO(baseISO)
  if (Number.isNaN(base.getTime())) return null

  let raw: Date
  if (t.unit === 'months') {
    raw = addMonths(base, t.amount)
  } else if (t.unit === 'working-days') {
    raw = addWorkingDays(base, t.amount)
  } else {
    raw = new Date(base)
    raw.setDate(raw.getDate() + t.amount)
  }

  const final = nextWorkingDay(raw)
  const shifted = toISO(final) !== toISO(raw)

  const unitWord = t.unit === 'months'
    ? (t.amount === 1 ? 'месяц' : t.amount < 5 ? 'месяца' : 'месяцев')
    : t.unit === 'working-days' ? 'рабочих дней' : 'календарных дней'

  return {
    date: toISO(final),
    explanation: shifted
      ? `${t.amount} ${unitWord} ${t.from} (${t.citation}); окончание пришлось на нерабочий день и перенесено на ближайший рабочий`
      : `${t.amount} ${unitWord} ${t.from} (${t.citation})`,
    shifted,
  }
}

/** Сколько дней осталось: 0 — сегодня, отрицательное — просрочено */
export function daysUntil(dateISO: string, today = new Date()): number {
  const a = fromISO(dateISO).getTime()
  const b = fromISO(toISO(today)).getTime()
  return Math.round((a - b) / 86_400_000)
}

/** «через 3 дня», «сегодня», «просрочено на 2 дня» */
export function untilLabel(dateISO: string, today = new Date()): string {
  const n = daysUntil(dateISO, today)
  if (n === 0) return 'сегодня'
  if (n === 1) return 'завтра'
  if (n === -1) return 'вчера, срок прошёл'
  const abs = Math.abs(n)
  const word = abs % 10 === 1 && abs % 100 !== 11 ? 'день'
    : [2, 3, 4].includes(abs % 10) && ![12, 13, 14].includes(abs % 100) ? 'дня'
    : 'дней'
  return n > 0 ? `через ${abs} ${word}` : `срок прошёл ${abs} ${word} назад`
}
