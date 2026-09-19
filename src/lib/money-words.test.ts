import { describe, it, expect } from 'vitest'
import { fmtMoneyWords, kopeckWord } from './money-words'

// Intl ставит между разрядами неразрывный пробел — сравниваем без разницы в пробелах
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ')

describe('сумма прописью для акта', () => {
  it('суммы из реальных актов и платежей', () => {
    expect(norm(fmtMoneyWords(14118)))
      .toBe('14 118 (четырнадцать тысяч сто восемнадцать) руб. 00 копеек')
    expect(norm(fmtMoneyWords(54505.34)))
      .toBe('54 505 (пятьдесят четыре тысячи пятьсот пять) руб. 34 копейки')
    expect(norm(fmtMoneyWords(48074)))
      .toBe('48 074 (сорок восемь тысяч семьдесят четыре) руб. 00 копеек')
  })

  it('тысяча — женского рода: одна, две', () => {
    expect(norm(fmtMoneyWords(1000))).toContain('(одна тысяча)')
    expect(norm(fmtMoneyWords(2354))).toContain('(две тысячи триста пятьдесят четыре)')
  })

  it('миллион и ноль', () => {
    expect(norm(fmtMoneyWords(1_000_000))).toContain('(один миллион)')
    expect(norm(fmtMoneyWords(0))).toBe('0 (ноль) руб. 00 копеек')
  })

  it('копейки без рублей', () => {
    expect(norm(fmtMoneyWords(0.5))).toBe('0 (ноль) руб. 50 копеек')
  })

  it('склонение слова «копейка»', () => {
    expect(kopeckWord(1)).toBe('копейка')
    expect(kopeckWord(2)).toBe('копейки')
    expect(kopeckWord(5)).toBe('копеек')
    expect(kopeckWord(11)).toBe('копеек')   // 11–14 — всегда «копеек»
    expect(kopeckWord(21)).toBe('копейка')
    expect(kopeckWord(22)).toBe('копейки')
  })
})
