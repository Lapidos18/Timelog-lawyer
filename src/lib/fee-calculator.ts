import { readRub } from './billing'
export function calculatorAmount(value: string): number | null {
  if (!value.trim()) return 0
  const kop = readRub(value)
  return kop === null || kop > 999999999999 ? null : kop / 100
}
export function calculateFee(amount: number, deduction: number, rate: number, reverse: boolean) {
  if (![amount, deduction, rate].every(Number.isFinite) || amount < 0 || deduction < 0 || rate < 0 || rate >= 1) throw Error('Некорректные параметры расчёта')
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const gross = reverse ? round(amount <= deduction ? amount : (amount - deduction * rate) / (1 - rate)) : round(amount)
  const ndfl = round(Math.max(0, gross - deduction) * rate)
  return { gross, ndfl, net: round(gross - ndfl) }
}
