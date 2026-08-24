/**
 * Сумма прописью для юридических документов.
 *
 * Формат: «15 000 (пятнадцать тысяч) руб. 50 копеек» — целые рубли цифрами
 * и прописью в скобках, копейки отдельно цифрами со словом.
 *
 * Это намеренное исключение из общего правила «деньги всегда с копейками»:
 * так принято в документообороте (акты, соглашения). Везде в интерфейсе
 * по-прежнему используется формат с двумя знаками после запятой.
 */

/** Целые рубли с разделителями разрядов — только для суммы прописью */
function fmtWhole(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n))
}

export function kopeckWord(n: number): string {
  const last2 = n % 100
  const last1 = n % 10
  if (last2 >= 11 && last2 <= 14) return 'копеек'
  if (last1 === 1) return 'копейка'
  if (last1 >= 2 && last1 <= 4) return 'копейки'
  return 'копеек'
}

export function numberToWordsRu(num: number): string {
  if (num === 0) return 'ноль'
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать']
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

  function triple(n: number, fem: boolean): string {
    const parts: string[] = []
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10
    if (h) parts.push(hundreds[h])
    if (t === 1) parts.push(teens[o])
    else {
      if (t) parts.push(tens[t])
      if (o) parts.push(fem ? onesF[o] : ones[o])
    }
    return parts.join(' ')
  }

  const millions = Math.floor(num / 1000000)
  const thousands = Math.floor((num % 1000000) / 1000)
  const rest = num % 1000

  const out: string[] = []
  if (millions) {
    out.push(triple(millions, false))
    const m = millions % 100
    if (m >= 11 && m <= 14) out.push('миллионов')
    else if (millions % 10 === 1) out.push('миллион')
    else if ([2,3,4].includes(millions % 10)) out.push('миллиона')
    else out.push('миллионов')
  }
  if (thousands) {
    out.push(triple(thousands, true))
    const t = thousands % 100
    if (t >= 11 && t <= 14) out.push('тысяч')
    else if (thousands % 10 === 1) out.push('тысяча')
    else if ([2,3,4].includes(thousands % 10)) out.push('тысячи')
    else out.push('тысяч')
  }
  if (rest || (!millions && !thousands)) out.push(triple(rest, false))

  return out.filter(Boolean).join(' ')
}

/** «15 000 (пятнадцать тысяч) руб. 50 копеек» */
export function fmtMoneyWords(n: number): string {
  const rubles = Math.floor(n)
  const kopecks = Math.round((n - rubles) * 100)
  return `${fmtWhole(rubles)} (${numberToWordsRu(rubles)}) руб. ${String(kopecks).padStart(2, '0')} ${kopeckWord(kopecks)}`
}
