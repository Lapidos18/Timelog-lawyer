import { describe, it, expect } from 'vitest'
import { nextActNo, toActRows, actRowsTotal } from './acts'

describe('номер акта', () => {
  it('первый акт года — 001', () => {
    expect(nextActNo([], 2026)).toBe('АКТ-2026-001')
  })

  it('продолжает сквозную нумерацию с максимального', () => {
    expect(nextActNo(['АКТ-2026-001', 'АКТ-2026-007', 'АКТ-2026-003'], 2026)).toBe('АКТ-2026-008')
  })

  it('номера другого года и ручного формата на счёт не влияют', () => {
    expect(nextActNo(['АКТ-2025-099', 'АКТ-20260906-1430', 'Акт 5', 'АКТ-2026-002'], 2026))
      .toBe('АКТ-2026-003')
  })

  it('после 999 номер не обрезается', () => {
    expect(nextActNo(['АКТ-2026-999'], 2026)).toBe('АКТ-2026-1000')
  })
})

describe('строки и сумма акта', () => {
  it('числа из базы приходят строками — приводятся, а не склеиваются', () => {
    const rows = toActRows([
      { id: 'a', work_date: '2026-07-11', activity_type: 'research', description: 'Анализ',
        hours: '2.00', hourly_rate: '9412', amount: '18824.00', performed_by: 'Бухмин' },
    ])
    expect(rows[0].amount).toBe(18824)
    expect(typeof rows[0].hours).toBe('number')
  })

  it('сумма июльского акта по «Системе» — 54 118,00', () => {
    const rows = toActRows([
      { id: '1', work_date: '2026-07-11', activity_type: 'research', description: '', hours: 2,   hourly_rate: 9412, amount: 18824, performed_by: '' },
      { id: '2', work_date: '2026-07-12', activity_type: 'document_prep', description: '', hours: 2.5, hourly_rate: 9412, amount: 23530, performed_by: '' },
      { id: '3', work_date: '2026-07-17', activity_type: 'consultation', description: '', hours: 2,   hourly_rate: 5882, amount: 11764, performed_by: '' },
    ])
    expect(actRowsTotal(rows)).toBe(54118)
  })

  it('копейки не теряются на длинном акте', () => {
    // 0,1 + 0,2 в числах с плавающей точкой — не 0,3
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), work_date: '', activity_type: '', description: '',
      hours: 0, hourly_rate: 0, amount: 0.1, performed_by: '',
    }))
    expect(actRowsTotal(rows)).toBe(3)
  })

  it('пустой акт — ноль', () => {
    expect(actRowsTotal([])).toBe(0)
  })
})
