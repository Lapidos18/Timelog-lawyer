import { describe, it, expect } from 'vitest'
import { checkInn } from './inn'

describe('контрольная сумма ИНН', () => {
  it('пустое поле допустимо — ИНН необязателен', () => {
    expect(checkInn('').valid).toBe(true)
    expect(checkInn('   ').valid).toBe(true)
  })

  it('принимает верные ИНН организаций (10 цифр)', () => {
    expect(checkInn('7707083893').valid).toBe(true)
    expect(checkInn('5405270340').valid).toBe(true)
  })

  it('принимает верный ИНН физлица (12 цифр) — ИНН самого кабинета', () => {
    expect(checkInn('540233730471').valid).toBe(true)
  })

  it('ловит изменённую цифру', () => {
    expect(checkInn('7707083894').valid).toBe(false)
    expect(checkInn('540233730472').valid).toBe(false)
  })

  it('ловит перестановку соседних цифр', () => {
    expect(checkInn('540233703471').valid).toBe(false)
  })

  it('отклоняет неверную длину и буквы с понятной причиной', () => {
    expect(checkInn('12345').reason).toMatch(/10 цифр/)
    expect(checkInn('54023373047a').reason).toMatch(/только из цифр/)
  })
})
