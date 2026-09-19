import { describe, it, expect } from 'vitest'
import { calcNdfl, yearFraction, NDFL_BANDS } from './tax'

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
