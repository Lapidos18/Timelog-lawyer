import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseStatement } from './bank-statement'

/**
 * Выписка той же структуры, что выгружает банк кабинета, но с вымышленными
 * данными. Настоящую выписку в репозиторий класть нельзя: он на GitHub,
 * а в ней реальные суммы, счета и ИНН контрагентов.
 */
const OWN_INN = '540233730471'
const HEADER = [
  'Номер счёта', 'Тип операции', 'Дата проведения', 'Номер документа', 'Валюта операции',
  'Сумма в валюте счёта', 'Валюта счёта', 'Описание операции', 'Назначение платежа',
  'Счет плательщика', 'ИНН плательщика', 'КПП плательщика', 'Наименование плательщика',
  'БИК банка плательщика', 'Корр. счет плательщика', 'Счет получателя', 'Договор получателя',
  'ИНН получателя', 'КПП получателя', 'Наименование получателя', 'БИК банка получателя',
  'Корр. счет получателя', 'Счет контрагента', 'ИНН контрагента', 'Наименование контрагента',
  'БИК банка контрагента', 'Дебет', 'Кредит',
]

function row(type: 'Кредит' | 'Дебет', date: string, doc: string, amount: string,
             purpose: string, inn: string, name: string): string[] {
  const r = new Array(HEADER.length).fill('')
  r[1] = type; r[2] = date; r[3] = doc; r[5] = amount; r[8] = purpose
  r[23] = inn; r[24] = name
  return r
}

function makeStatement(ops: string[][], opts: { shuffleColumns?: boolean } = {}) {
  let header = [...HEADER]
  let body = ops
  if (opts.shuffleColumns) {
    // Банк может добавить столбец — разбор должен искать колонки по названию
    header = ['Новый столбец банка', ...header]
    body = ops.map(r => ['', ...r])
  }
  const grid = [
    ['Выписка по счёту №', '40802810800000000001'],
    ['Клиент', 'АДВОКАТСКИЙ КАБИНЕТ'],
    ['ИНН', OWN_INN],
    ['КПП', '0'],
    ['Входящий остаток', '0.00'],
    ['Исходящий остаток', '0.00'],
    [],
    [],
    [],
    header,
    ...body,
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'statement_xls')
  const buf: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  // В браузере приходит File; парсеру от него нужен только arrayBuffer()
  return { arrayBuffer: async () => buf } as unknown as File
}

const OPS = [
  row('Кредит', '27.04.2026', '31',   '224,000.00', 'Оплата по договору', '5400000001', 'ООО «Альфа»'),
  row('Дебет',  '27.04.2026', '4',    '150,000.00', 'Перевод себе', OWN_INN, 'АДВОКАТ'),
  row('Кредит', '08.07.2026', '1498', '48,074.00',  'Оплата по счёту № 7', '5400000002', 'ООО «Бета»'),
  row('Кредит', '08.07.2026', '9',    '106,861.08', 'Возврат со вклада', OWN_INN, 'Договор вклада'),
  row('Кредит', '08.07.2026', '36564', '573.83',    'Проценты на остаток', '7710140679', 'АО «ТБанк»'),
  row('Кредит', '28.08.2026', '2010', '54,505.34',  'Оплата юридических услуг', '5400000002', 'ООО «Бета»'),
]

describe('разбор банковской выписки', () => {
  it('читает номер счёта и собственный ИНН из шапки', async () => {
    const s = await parseStatement(makeStatement(OPS))
    expect(s.accountNo).toBe('40802810800000000001')
    expect(s.ownInn).toBe(OWN_INN)
  })

  it('берёт только поступления, списания пропускает', async () => {
    const s = await parseStatement(makeStatement(OPS))
    expect(s.rows).toHaveLength(5)
    expect(s.rows.every(r => r.amount > 0)).toBe(true)
  })

  it('разбирает суммы с разделителем тысяч и даты', async () => {
    const s = await parseStatement(makeStatement(OPS))
    const r = s.rows.find(x => x.docNo === '2010')!
    expect(r.amount).toBe(54505.34)
    expect(r.date).toBe('2026-08-28')
  })

  // Попади эти суммы в доход — налог вырос бы на деньгах, не бывших гонораром
  it('перевод со своего счёта помечен как «не доход»', async () => {
    const s = await parseStatement(makeStatement(OPS))
    expect(s.rows.find(x => x.amount === 106861.08)!.skipReason).toBe('own')
  })

  it('проценты банка помечены как «не гонорар»', async () => {
    const s = await parseStatement(makeStatement(OPS))
    expect(s.rows.find(x => x.amount === 573.83)!.skipReason).toBe('bank')
  })

  it('гонорары доверителей ничем не помечены', async () => {
    const s = await parseStatement(makeStatement(OPS))
    const fees = s.rows.filter(r => !r.skipReason)
    expect(fees.map(r => r.amount)).toEqual([224000, 48074, 54505.34])
  })

  it('находит колонки по названию, если банк добавит новый столбец', async () => {
    const s = await parseStatement(makeStatement(OPS, { shuffleColumns: true }))
    expect(s.rows).toHaveLength(5)
    expect(s.rows[0].amount).toBe(224000)
  })

  it('на файле без строки заголовков — понятная ошибка, а не пустой список', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['какая-то таблица']]), 'Лист1')
    const buf: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = { arrayBuffer: async () => buf } as unknown as File
    await expect(parseStatement(file)).rejects.toThrow(/выписку/)
  })
})
