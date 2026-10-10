import { describe, it, expect } from 'vitest'
import { calcNdfl, yearFraction, NDFL_BANDS, isContributionType, contributionExpenseText, contributionsInDeduction } from './tax'

describe('НДФЛ по шкале ст. 224 НК РФ', () => {
  it('ноль и отрицательная база дают ноль', () => {
    expect(calcNdfl(0)).toBe(0)
    expect(calcNdfl(-100)).toBe(0)
  })

  it('до 2,4 млн — 13 % со всей суммы', () => {
    expect(calcNdfl(500_000)).toBeCloseTo(65_000, 2)
    expect(calcNdfl(2_400_000)).toBeCloseTo(312_000, 2)
  })

  it('15 % только на превышение 2,4 млн, а не на всю базу', () => {
    // 2,4 млн × 13 % + 600 тыс. × 15 %
    expect(calcNdfl(3_000_000)).toBeCloseTo(402_000, 2)
  })

  it('граница второй ступени — 5 млн', () => {
    expect(calcNdfl(5_000_000)).toBeCloseTo(312_000 + 2_600_000 * 0.15, 2)
  })

  it('третья ступень — 18 % сверх 5 млн', () => {
    expect(calcNdfl(6_000_000)).toBeCloseTo(882_000, 2)
  })

  it('старая двухступенчатая формула занижала налог выше 5 млн', () => {
    const old = (b: number) => 2_400_000 * 0.13 + (b - 2_400_000) * 0.15
    expect(calcNdfl(6_000_000) - old(6_000_000)).toBeCloseTo(30_000, 2)
    expect(calcNdfl(25_000_000) - old(25_000_000)).toBeCloseTo(700_000, 2)
  })

  it('налог растёт непрерывно — без скачков на границах ступеней', () => {
    for (const band of NDFL_BANDS.slice(0, -1)) {
      const below = calcNdfl(band.upTo - 1)
      const above = calcNdfl(band.upTo + 1)
      expect(above - below).toBeLessThan(1)
    }
  })

  it('ступени идут по возрастанию и заканчиваются бесконечностью', () => {
    for (let i = 1; i < NDFL_BANDS.length; i++) {
      expect(NDFL_BANDS[i].upTo).toBeGreaterThan(NDFL_BANDS[i - 1].upTo)
      expect(NDFL_BANDS[i].rate).toBeGreaterThan(NDFL_BANDS[i - 1].rate)
    }
    expect(NDFL_BANDS[NDFL_BANDS.length - 1].upTo).toBe(Infinity)
  })
})

describe('страховые взносы в профвычете', () => {
  it('какие уплаты считаются взносами', () => {
    expect(isContributionType('fixed_contributions')).toBe(true)
    expect(isContributionType('ops_one_percent')).toBe(true)
    expect(isContributionType('ndfl_advance_q2')).toBe(false) // аванс НДФЛ — не взнос и в вычет не идёт
    expect(isContributionType('palata_dues')).toBe(false)
  })

  it('текст расхода называет год, за который уплачено', () => {
    expect(contributionExpenseText('fixed_contributions', 2026)).toBe('Фиксированные страховые взносы за 2026 год')
    expect(contributionExpenseText('ops_one_percent', 2025)).toBe('1% ОПС с дохода свыше 300 000 руб. за 2025 год')
  })

  it('сумма взносов среди расходов — только взносы и только подтверждённые', () => {
    const list = [
      { category: 'ops_one_percent', amount: 25726.04, is_documented: true },   // 1% ОПС за 2025, оплачен 02.07.2026
      { category: 'fixed_contributions', amount: '57390.00', is_documented: true }, // из базы numeric приходит строкой
      { category: 'fixed_contributions', amount: 1000, is_documented: false },  // без подтверждения в вычет не идёт
      { category: 'palata_dues', amount: 5100, is_documented: true },           // взносы в палату — другой расход
      { category: 'other', amount: 9090, is_documented: true },
    ]
    expect(contributionsInDeduction(list)).toBe(83116.04)
    expect(contributionsInDeduction([])).toBe(0)
  })

  it('копейки не накапливают дробную ошибку', () => {
    const list = Array.from({ length: 3 }, (_, i) => ({ category: 'ops_one_percent', amount: [0.1, 0.2, 0.3][i], is_documented: true }))
    expect(contributionsInDeduction(list)).toBe(0.6)
  })
})

describe('доля года для фиксированных взносов (п. 3 ст. 430 НК РФ)', () => {
  it('статус получен в прошлые годы — полный год (случай пользователя: 25.10.2019)', () => {
    expect(yearFraction(new Date(2019, 9, 25), 2026)).toBe(1)
  })

  it('с 1 января — полный год', () => {
    expect(yearFraction(new Date(2026, 0, 1), 2026)).toBeCloseTo(1, 10)
  })

  it('с 1 апреля — ровно 9 месяцев', () => {
    expect(yearFraction(new Date(2026, 3, 1), 2026) * 12).toBeCloseTo(9, 10)
  })

  it('неполный месяц считается по дням, а не целиком', () => {
    // с 25 октября: ноябрь, декабрь и 7 дней из 31 в октябре
    expect(yearFraction(new Date(2026, 9, 25), 2026) * 12).toBeCloseTo(2 + 7 / 31, 10)
  })

  it('старая формула «12 − номер месяца» завышала взносы', () => {
    const annual = 57_390
    const was = annual * (12 - 9) / 12
    const now = annual * yearFraction(new Date(2026, 9, 25), 2026)
    expect(was).toBeCloseTo(14_347.5, 2)
    expect(now).toBeCloseTo(10_644.92, 2)
  })

  it('начало в следующем году — за этот год взносов нет', () => {
    expect(yearFraction(new Date(2027, 2, 1), 2026)).toBe(0)
  })
})
