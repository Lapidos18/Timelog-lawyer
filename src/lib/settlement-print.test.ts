import { describe, it, expect } from 'vitest'
import { settlementBodyHtml, settlementCss } from './settlement-print'
import { newSettlementDoc, SettlementDoc, SettlementRow } from './settlement-act'

const norm = (s: string) => s.replace(/[\s  ]+/g, ' ')
const row = (date: string, doc: string, debit: number, credit: number, id: string): SettlementRow => ({ id, date, doc, debit, credit })

const sample = (): SettlementDoc => {
  const d = newSettlementDoc({
    periodFrom: '2023-09-01', periodTo: '2023-12-01', clientName: 'ООО «Мокко»', cabinetLine: 'ИП Сидоров Александр Иванович',
    openingUs: { debit: 0, credit: 0 },
    rowsUs: [
      row('2023-09-03', 'Оплата п/п №1 от 03.09.2023', 5000000, 0, 'a'),
      row('2023-09-07', 'Поставка №1 от 07.09.2023', 0, 4900000, 'b'),
      row('2023-10-03', 'Оплата п/п №2 от 03.10.2023', 2400000, 0, 'c'),
      row('2023-10-07', 'Поставка №2 от 07.10.2023', 0, 2500000, 'd'),
      row('2023-11-03', 'Оплата №3 от 03.11.2023', 5000000, 0, 'e'),
      row('2023-11-07', 'Поставка №3 от 07.11.2023', 0, 4500000, 'f'),
    ],
  })
  d.us = { name: 'ИП Сидоров Александр Иванович', intro: 'ИП Сидоров Александр Иванович', signer: 'ИП Сидоров А.И.' }
  return d
}

/** Ширины колонок из первой <colgroup> таблицы акта */
const widths = (html: string) =>
  Array.from((html.match(/<table class="sa">\s*<colgroup>([\s\S]*?)<\/colgroup>/) ?? ['', ''])[1].matchAll(/width:([\d.]+)%/g)).map(m => Number(m[1]))

describe('печатная форма акта сверки', () => {
  it('книжный лист — по умолчанию; колонки в сумме дают ровно 100%', () => {
    const d = sample()
    expect(d.orientation).toBe('portrait')
    const w = widths(settlementBodyHtml(d))
    expect(w).toHaveLength(9)                       // 4 + разделитель + 4
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
    expect(w[0]).toBe(w[5]); expect(w[1]).toBe(w[6]) // стороны одинаковой ширины
  })

  it('альбомный лист: те же правила, другие ширины', () => {
    const d = sample(); d.orientation = 'landscape'
    const w = widths(settlementBodyHtml(d))
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
    expect(w[1]).toBeGreaterThan(widths(settlementBodyHtml(sample()))[1]) // колонка «Документ» шире
  })

  it('размер листа в стилях совпадает с ориентацией', () => {
    expect(settlementCss('portrait')).toContain('size:A4 portrait')
    expect(settlementCss('landscape')).toContain('size:A4 landscape')
    expect(settlementCss('portrait')).not.toContain('landscape')
  })

  it('на книжном шрифт таблицы мельче, чем на альбомном', () => {
    const size = (css: string) => Number((css.match(/table\.sa th,table\.sa td\{font-size:([\d.]+)pt/) ?? [])[1])
    expect(size(settlementCss('portrait'))).toBeLessThan(size(settlementCss('landscape')))
  })

  it('содержит все части формы образца', () => {
    const html = norm(settlementBodyHtml(sample()))
    expect(html).toContain('<h2>Акт сверки</h2>')
    expect(html).toContain('взаимных расчетов за период: 01.09.2023 — 01.12.2023')
    expect(html).toContain('между ИП Сидоров Александр Иванович и ООО «Мокко»')
    expect(html).toContain('составили настоящий акт сверки о том, что состояние взаимных расчетов по данным учета следующее:')
    expect(html.match(/Сальдо начальное/g)).toHaveLength(2)
    expect(html.match(/Обороты за период/g)).toHaveLength(2)
    expect(html.match(/Сальдо конечное/g)).toHaveLength(2)
    expect(html).toContain('Российский рубль')
    expect(html.match(/\(подпись\)/g)).toHaveLength(2)
    expect(html.match(/м\.п\./g)).toHaveLength(2)
  })

  it('цифры образца: обороты и сальдо', () => {
    const html = norm(settlementBodyHtml(sample()))
    expect(html).toContain('124 000,00')
    expect(html).toContain('119 000,00')
    expect(html).toContain('5 000,00')
  })

  it('вывод под каждой таблицей с суммой прописью', () => {
    const html = norm(settlementBodyHtml(sample()))
    const found = html.match(/задолженность в пользу ИП Сидоров Александр Иванович 5 000,00 руб\. \(пять тысяч рублей 00 копеек\)/g)
    expect(found).toHaveLength(2) // слева и справа, как в образце
    expect(html).toContain('По данным ИП Сидоров Александр Иванович на 01.12.2023')
  })

  it('ноль в строках документов не пишется, а в сальдо и оборотах пишется', () => {
    const html = settlementBodyHtml(sample())
    const dataRows = html.match(/<tr><td class="c">[\s\S]*?<\/tr>/g) ?? []
    expect(dataRows).toHaveLength(6)
    // ячейка, в которой написан ровно ноль (а не «50 000,00», где «0,00» — хвост)
    expect(dataRows.some(r => r.includes('>0,00<'))).toBe(false)
    expect(html.includes('>0,00<')).toBe(true) // в сальдо начальном ноль есть
    expect(html.match(/<tr class="b">/g)).toHaveLength(3)
  })

  it('пользовательский текст экранируется: «<» и «>» не вырезают часть документа', () => {
    const d = sample()
    d.them = { name: 'ООО <Ромашка> & «Ко»', intro: 'ООО <Ромашка>', signer: '<b>Директор</b>' }
    d.rowsUs[0].doc = 'Оплата <script>alert(1)</script>'
    const html = settlementBodyHtml(d)
    expect(html).not.toContain('<Ромашка>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>Директор</b>')
    expect(html).toContain('&lt;Ромашка&gt;')
    expect(html).toContain('&amp;')
  })

  it('у сторон разное число строк: недостающие ячейки пустые, таблица не ломается', () => {
    const d = sample(); d.mirror = false
    d.openingThem = { debit: 0, credit: 0 }
    d.rowsThem = [row('2023-09-03', 'Оплата (по данным контрагента)', 0, 5000000, 'x')]
    const html = settlementBodyHtml(d)
    const mainTable = html.split('</table>')[0] // без таблиц вывода и подписей: они тоже из <tr><td>
    const dataRows = mainTable.match(/<tr><td[ >][\s\S]*?<\/tr>/g) ?? []
    expect(dataRows).toHaveLength(6) // по большей стороне
    expect(dataRows[5]).toContain('<td></td><td></td><td></td><td></td></tr>') // справа пусто
    expect(norm(html)).toContain('Оплата (по данным контрагента)')
  })

  it('пустой акт без строк печатается без ошибок', () => {
    const d = sample(); d.rowsUs = []
    const html = settlementBodyHtml(d)
    expect(html).toContain('Сальдо начальное')
    expect(norm(html)).toContain('задолженность отсутствует')
  })
})

describe('порядок строк в документе', () => {
  it('в печати строки по дате, даже если в акте они лежат вразнобой', () => {
    const d = sample()
    d.rowsUs = [d.rowsUs[5], d.rowsUs[0], d.rowsUs[3], d.rowsUs[1], d.rowsUs[4], d.rowsUs[2]]
    const html = norm(settlementBodyHtml(d))
    const at = (s: string) => html.indexOf(s)
    const order = ['Оплата п/п №1', 'Поставка №1', 'Оплата п/п №2', 'Поставка №2', 'Оплата №3', 'Поставка №3'].map(at)
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(d.rowsUs[0].id).toBe('f') // сам акт при печати не меняется
  })
})
