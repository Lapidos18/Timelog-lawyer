/**
 * Что начислено доверителю по делу — одно место для всех экранов.
 *
 * Раньше «начислено» считалось отдельно в четырёх местах (Обзор, «Дела», форма
 * акта, акт сверки), и любая новая статья начисления грозила разойтись между
 * ними. Теперь по часам и по абонентской плате решает эта функция.
 *
 * АБОНЕНТСКАЯ ПЛАТА (решение пользователя 10.10.2026, клиент — ООО УК «Альфа
 * менеджмент»: 224 000 ₽ в месяц, платят 25-го независимо от объёма работы):
 * у дела задаётся сумма в месяц и месяц начала (и по желанию месяц окончания).
 * Начисляется по одной сумме на ПОСЛЕДНИЙ ДЕНЬ каждого месяца — как «Акт от
 * 31.07» в акте сверки адвоката: текущий месяц считается начисленным, только
 * когда он закончился. ЧАСЫ по такому делу денег не создают, даже если записаны
 * оплачиваемыми: иначе начисление задвоилось бы.
 *
 * Деньги внутри — в копейках целыми числами.
 */

export interface FeeTerms {
  /** Сумма в месяц, ₽. Пусто или 0 — дело почасовое, как раньше */
  monthly_fee?: number | string | null
  /** С какого месяца (берётся месяц этой даты, месяц начинается целиком) */
  fee_from?: string | null
  /** По какой месяц включительно; пусто — пока идёт */
  fee_to?: string | null
}

export interface Accrual {
  /** Последний день месяца, ГГГГ-ММ-ДД */
  date: string
  kop: number
}

/** Сумма в месяц, копейками (нечисловое значение — 0) */
export function feeKop(t: FeeTerms): number {
  const n = Number(t.monthly_fee ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** Дело с абонплатой: есть и сумма, и месяц начала (без начала считать не с чего) */
export function isSubscription(t: FeeTerms): boolean {
  return feeKop(t) > 0 && !!t.fee_from
}

const ymOf = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : NaN
}
const pad = (n: number) => String(n).padStart(2, '0')

/** Начисления абонплаты до даты asOf включительно, по одному на месяц */
export function subscriptionAccruals(t: FeeTerms, asOf: string): Accrual[] {
  if (!isSubscription(t)) return []
  const first = ymOf(t.fee_from as string)
  let last = ymOf(asOf)
  if (t.fee_to) last = Math.min(last, ymOf(t.fee_to))
  if (!Number.isFinite(first) || !Number.isFinite(last)) return []
  const kop = feeKop(t)
  const out: Accrual[] = []
  for (let idx = first; idx <= last && out.length < 600; idx++) {
    const y = Math.floor(idx / 12)
    const m = (idx % 12) + 1
    const date = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
    if (date <= asOf) out.push({ date, kop })
  }
  return out
}

/** Сумма начислений абонплаты до asOf, копейки; с from — только начиная с этой даты */
export function subscriptionKop(t: FeeTerms, asOf: string, from?: string): number {
  return subscriptionAccruals(t, asOf)
    .filter(a => !from || a.date >= from)
    .reduce((s, a) => s + a.kop, 0)
}

/**
 * Начислено вознаграждения по делу на дату, ₽: по абонплате — накопленные
 * начисления, по почасовому делу — сумма оплачиваемых часов (hoursAmount).
 */
export function matterFeeAccrued(t: FeeTerms, hoursAmount: number, asOf: string): number {
  return isSubscription(t) ? subscriptionKop(t, asOf) / 100 : hoursAmount
}
