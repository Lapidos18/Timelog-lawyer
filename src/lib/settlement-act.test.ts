import { describe, it, expect } from 'vitest'
import {
  toKop, parseMoney, formatMoney, monthLabel, lastDayOfMonth, fmtDate,
  buildRowsUs, paymentDoc, openingFrom, mirrorRows, mirrorBalance, effectiveThem,
  tableTotals, conclusion, discrepancy, newSettlementDoc, normalizeDoc,
  fileBaseName, sortRows, sortedDoc, SettlementRow,
} from './settlement-act'
import { fmtMoneyFull, rubleWord } from './money-words'

// Intl ставит неразрывные пробелы — сравниваем без разницы в пробелах
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ')

const row = (date: string, doc: string, debit: number, credit: number, id = doc): SettlementRow =>
  ({ id, date, doc, debit, credit })

describe('деньги в копейках', () => {
  it('рубли из базы → копейки без ошибки дробей', () => {
    expect(toKop(0.1) + toKop(0.2)).toBe(30) // в рублях 0.1 + 0.2 = 0.30000000000000004
    expect(toKop('14118.00')).toBe(1411800)
    expect(toKop('387.34')).toBe(38734)
    expect(toKop(2780)).toBe(278000)
  })

  it('разбор текста из поля ввода', () => {
    expect(parseMoney('1 234,56')).toBe(123456)
    expect(parseMoney('1234.5')).toBe(123450)
    expect(parseMoney('1 234,56')).toBe(123456) // неразрывный пробел из Intl
    expect(parseMoney('50 000')).toBe(5000000)
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('  ')).toBe(0)
    expect(parseMoney('0,5')).toBe(50)
  })

  it('больше двух знаков округляется, как в бухгалтерии: 5 и выше — вверх', () => {
    expect(parseMoney('12,345')).toBe(1235)
    expect(parseMoney('12,344')).toBe(1234)
    expect(parseMoney('1234.56')).toBe(123456) // не 123456.00000000001
  })

  it('не число — null, а не 0 и не NaN', () => {
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney('1,2,3')).toBeNull()
    expect(parseMoney('12 р')).toBeNull()
  })

  it('вывод на экран с копейками', () => {
    expect(norm(formatMoney(500000))).toBe('5 000,00')
    expect(norm(formatMoney(5))).toBe('0,05')
    expect(norm(formatMoney(12345678))).toBe('123 456,78')
  })
})

describe('сумма прописью для вывода', () => {
  it('форма из образца: пять тысяч рублей 00 копеек', () => {
    expect(norm(fmtMoneyFull(500000))).toBe('5 000,00 руб. (пять тысяч рублей 00 копеек)')
  })
  it('склонение рубля и копеек', () => {
    expect(rubleWord(1)).toBe('рубль')
    expect(rubleWord(2)).toBe('рубля')
    expect(rubleWord(5)).toBe('рублей')
    expect(rubleWord(11)).toBe('рублей')
    expect(rubleWord(21)).toBe('рубль')
    expect(rubleWord(1000)).toBe('рублей')
    expect(norm(fmtMoneyFull(10134))).toBe('101,34 руб. (сто один рубль 34 копейки)')
    expect(norm(fmtMoneyFull(10001))).toBe('100,01 руб. (сто рублей 01 копейка)')
  })
  it('знак не влияет: сумма прописью всегда положительная', () => {
    expect(fmtMoneyFull(-500000)).toBe(fmtMoneyFull(500000))
  })
})

describe('даты', () => {
  it('месяц словами и последний день месяца', () => {
    expect(monthLabel('2026-09-14')).toBe('сентябрь 2026')
    expect(monthLabel('2026-01-01')).toBe('январь 2026')
    expect(lastDayOfMonth('2026-09-14')).toBe('2026-09-30')
    expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(lastDayOfMonth('2028-02-10')).toBe('2028-02-29') // високосный
    expect(lastDayOfMonth('2026-12-01')).toBe('2026-12-31')
    expect(fmtDate('2026-09-30')).toBe('30.09.2026')
    expect(fmtDate('')).toBe('')
  })
})

describe('образец формы: акт сверки ИП Сидоров — ООО «Мокко»', () => {
  // Слева в образце ПОКУПАТЕЛЬ: оплаты у него в дебете, поставки в кредите
  const left = [
    row('2023-09-03', 'Оплата п/п №1 от 03.09.2023', 5000000, 0),
    row('2023-09-07', 'Поставка №1 от 07.09.2023', 0, 4900000),
    row('2023-10-03', 'Оплата п/п №2 от 03.10.2023', 2400000, 0),
    row('2023-10-07', 'Поставка №2 от 07.10.2023', 0, 2500000),
    row('2023-11-03', 'Оплата №3 от 03.11.2023', 5000000, 0),
    row('2023-11-07', 'Поставка №3 от 07.11.2023', 0, 4500000),
  ]
  const zero = { debit: 0, credit: 0 }

  it('обороты и сальдо левой таблицы совпадают с образцом', () => {
    const t = tableTotals(zero, left)
    expect(t.turnDebit).toBe(12400000)   // 124 000,00
    expect(t.turnCredit).toBe(11900000)  // 119 000,00
    expect(t.closingDebit).toBe(500000)  // 5 000,00 в дебете
    expect(t.closingCredit).toBe(0)
  })

  it('правая таблица — зеркало: те же документы, дебет и кредит наоборот', () => {
    const right = mirrorRows(left)
    const t = tableTotals(mirrorBalance(zero), right)
    expect(t.turnDebit).toBe(11900000)   // 119 000,00
    expect(t.turnCredit).toBe(12400000)  // 124 000,00
    expect(t.closingDebit).toBe(0)
    expect(t.closingCredit).toBe(500000) // 5 000,00 в кредите
    expect(right[0].debit).toBe(0)
    expect(right[0].credit).toBe(5000000)
  })

  it('обе стороны приходят к одному выводу: долг в пользу Сидорова 5 000 руб.', () => {
    const l = tableTotals(zero, left)
    const r = tableTotals(zero, mirrorRows(left))
    const cl = conclusion(l.net, 'ИП Сидоров', 'ООО «Мокко»')
    const cr = conclusion(r.net, 'ООО «Мокко»', 'ИП Сидоров')
    expect(norm(cl.text)).toBe('задолженность в пользу ИП Сидоров 5 000,00 руб. (пять тысяч рублей 00 копеек)')
    expect(norm(cr.text)).toBe(norm(cl.text))
    expect(cl.favor).toBe('owner')   // дебетовое сальдо — в пользу владельца таблицы
    expect(cr.favor).toBe('other')   // кредитовое — в пользу другой стороны
    expect(discrepancy(l.net, r.net)).toBe(0)
  })
})

describe('сборка таблицы кабинета из данных приложения', () => {
  const period = { periodFrom: '2026-09-01', periodTo: '2026-10-04' }

  it('услуги сводятся по делу и месяцу, а не по записям', () => {
    const rows = buildRowsUs({
      ...period,
      services: [
        { work_date: '2026-09-21', matter_title: 'Метизные решения', amount: '14118.00' },
        { work_date: '2026-09-24', matter_title: 'Метизные решения', amount: '9412.00' },
        { work_date: '2026-09-24', matter_title: 'Консультации', amount: '10293.75' },
      ],
      expenses: [], payments: [],
    })
    expect(rows).toHaveLength(2)
    const m = rows.find(r => r.doc.includes('Метизные'))!
    expect(m.debit).toBe(2353000)   // 14118 + 9412 = 23 530,00
    expect(m.credit).toBe(0)
    expect(m.doc).toBe('Услуги по делу «Метизные решения» за сентябрь 2026')
    expect(m.date).toBe('2026-09-30') // последний день месяца
  })

  it('один месяц разных лет и разные дела не склеиваются', () => {
    const rows = buildRowsUs({
      periodFrom: '2025-09-01', periodTo: '2026-10-04',
      services: [
        { work_date: '2025-09-10', matter_title: 'А', amount: 100 },
        { work_date: '2026-09-10', matter_title: 'А', amount: 200 },
        { work_date: '2026-09-11', matter_title: 'Б', amount: 300 },
      ],
      expenses: [], payments: [],
    })
    expect(rows).toHaveLength(3)
  })

  it('дата строки за неполный месяц не заходит за конец периода', () => {
    const rows = buildRowsUs({
      periodFrom: '2026-10-01', periodTo: '2026-10-04',
      services: [{ work_date: '2026-10-02', matter_title: 'А', amount: 500 }],
      expenses: [], payments: [],
    })
    expect(rows[0].date).toBe('2026-10-04')
  })

  it('издержки — в дебет, оплаты — в кредит, по одной строке', () => {
    const rows = buildRowsUs({
      ...period,
      services: [],
      expenses: [{ expense_date: '2026-09-19', description: 'Квитанция почты', doc_no: '144072', amount: '387.34' }],
      payments: [{ pay_date: '2026-09-24', doc_no: '591', amount: 224000 }],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: '2026-09-19', debit: 38734, credit: 0 })
    expect(rows[0].doc).toBe('Возмещаемые расходы: Квитанция почты (док. 144072)')
    expect(rows[1]).toMatchObject({ date: '2026-09-24', debit: 0, credit: 22400000 })
    expect(rows[1].doc).toBe('Оплата №591 от 24.09.2026')
  })

  it('оплата без номера документа и нулевые суммы не дают строк', () => {
    const rows = buildRowsUs({
      ...period,
      services: [{ work_date: '2026-09-01', matter_title: 'А', amount: 0 }],
      expenses: [{ expense_date: '2026-09-02', description: 'x', doc_no: null, amount: 0 }],
      payments: [{ pay_date: '2026-09-03', doc_no: null, amount: 1000 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].doc).toBe('Оплата от 03.09.2026')
  })

  it('строки идут по дате; в один день сначала начисление, потом оплата', () => {
    const rows = buildRowsUs({
      ...period,
      services: [],
      expenses: [{ expense_date: '2026-09-10', description: 'Почта', doc_no: null, amount: 100 }],
      payments: [
        { pay_date: '2026-09-10', doc_no: '1', amount: 100 },
        { pay_date: '2026-09-05', doc_no: '0', amount: 50 },
      ],
    })
    expect(rows.map(r => r.date)).toEqual(['2026-09-05', '2026-09-10', '2026-09-10'])
    expect(rows[1].debit).toBeGreaterThan(0)   // начисление
    expect(rows[2].credit).toBeGreaterThan(0)  // оплата
  })
})

describe('название документа оплаты', () => {
  it('голый номер — с «№» и датой оплаты', () => {
    expect(paymentDoc('591', '2026-09-24')).toBe('Оплата №591 от 24.09.2026')
    expect(paymentDoc('1498/2', '2026-07-08')).toBe('Оплата №1498/2 от 08.07.2026')
  })
  it('номер с буквами — как написан, дата дописывается', () => {
    expect(paymentDoc('п/п 12', '2026-09-24')).toBe('Оплата п/п 12 от 24.09.2026')
  })
  it('дата уже внутри номера — второй раз не повторяется', () => {
    expect(paymentDoc('ПП 31 от 27.04.2026', '2026-04-27')).toBe('Оплата ПП 31 от 27.04.2026')
    expect(paymentDoc('ПП 35 от 25.08.26', '2026-08-25')).toBe('Оплата ПП 35 от 25.08.26')
  })
  it('нет номера — только дата', () => {
    expect(paymentDoc(null, '2026-09-03')).toBe('Оплата от 03.09.2026')
    expect(paymentDoc('  ', '2026-09-03')).toBe('Оплата от 03.09.2026')
  })
})

describe('начальное сальдо', () => {
  it('начислено больше оплаченного — дебетовое (долг доверителя)', () => {
    expect(openingFrom(1000000, 400000)).toEqual({ debit: 600000, credit: 0 })
  })
  it('оплачено больше начисленного — кредитовое (аванс, переплата)', () => {
    expect(openingFrom(100000, 1000000)).toEqual({ debit: 0, credit: 900000 })
  })
  it('поровну — нули', () => {
    expect(openingFrom(500, 500)).toEqual({ debit: 0, credit: 0 })
  })
  it('попадает в итог: сальдо конечное = начальное + дебет − кредит', () => {
    const t = tableTotals({ debit: 0, credit: 900000 }, [row('2026-09-30', 'Услуги', 400000, 0)])
    expect(t.net).toBe(-500000)
    expect(t.closingCredit).toBe(500000)
    expect(t.closingDebit).toBe(0)
  })
})

describe('вывод и расхождение', () => {
  it('нулевое сальдо', () => {
    expect(conclusion(0, 'А', 'Б')).toEqual({ favor: 'none', amount: 0, text: 'задолженность отсутствует' })
  })
  it('сальдо в пользу доверителя при переплате', () => {
    const c = conclusion(-22400000, 'Адвокатский кабинет', 'ООО УК «Альфа»')
    expect(c.favor).toBe('other')
    expect(c.text).toContain('в пользу ООО УК «Альфа»')
    expect(norm(c.text)).toContain('224 000,00 руб. (двести двадцать четыре тысячи рублей 00 копеек)')
  })
  it('расхождение видно, когда правая таблица правлена вручную', () => {
    const us = tableTotals({ debit: 0, credit: 0 }, [row('2026-09-30', 'Услуги', 1000000, 0)])
    const them = tableTotals({ debit: 0, credit: 0 }, [row('2026-09-30', 'Услуги', 0, 900000)])
    expect(discrepancy(us.net, them.net)).toBe(100000) // 1 000,00 ₽ не сошлись
  })
})

describe('зеркало в документе', () => {
  const base = () => newSettlementDoc({
    periodFrom: '2026-09-01', periodTo: '2026-09-30', clientName: 'ООО "Система"', clientInn: '5406000000',
    cabinetLine: 'Адвокатский кабинет …', openingUs: { debit: 100000, credit: 0 },
    rowsUs: [row('2026-09-30', 'Услуги', 500000, 0, 'a')],
  })

  it('пока включено зеркало, правая таблица считается из левой', () => {
    const d = base()
    const e = effectiveThem(d)
    expect(e.opening).toEqual({ debit: 0, credit: 100000 })
    expect(e.rows[0]).toMatchObject({ debit: 0, credit: 500000 })
  })

  it('правка левой при включённом зеркале сразу видна справа', () => {
    const d = base()
    d.rowsUs[0].debit = 700000
    expect(effectiveThem(d).rows[0].credit).toBe(700000)
  })

  it('при выключенном зеркале правая живёт своей жизнью', () => {
    const d = base()
    d.mirror = false
    d.rowsThem = [row('2026-09-30', 'Услуги (по данным доверителя)', 0, 450000, 'x')]
    d.openingThem = { debit: 0, credit: 100000 }
    const e = effectiveThem(d)
    expect(e.rows).toHaveLength(1)
    expect(e.rows[0].credit).toBe(450000)
    const us = tableTotals(d.openingUs, d.rowsUs)
    const them = tableTotals(e.opening, e.rows)
    expect(discrepancy(us.net, them.net)).toBe(50000) // доверитель насчитал на 500 ₽ меньше
  })

  it('новый акт: реквизиты по умолчанию', () => {
    const d = base()
    expect(d.version).toBe(1)
    expect(d.currency).toBe('Российский рубль')
    expect(d.mirror).toBe(true)
    expect(d.them.intro).toBe('ООО "Система", ИНН 5406000000')
    expect(d.us.intro).toBe('Адвокатский кабинет …')
    // Название кабинета не склоняется и стоит после «в пользу» — поэтому сокращение
    expect(d.us.name).toBe('АК Бухмина А.А.')
    expect(d.orientation).toBe('portrait') // книжный лист — основной, как печатает 1С
  })
})

describe('разбор документа из базы', () => {
  const period = { from: '2026-09-01', to: '2026-09-30' }

  it('мусор вместо документа не роняет страницу', () => {
    for (const bad of [null, undefined, 42, 'строка', [], {}]) {
      const d = normalizeDoc(bad, period)
      expect(d.rowsUs).toEqual([])
      expect(d.periodFrom).toBe('2026-09-01')
      expect(d.mirror).toBe(true)
      expect(d.openingUs).toEqual({ debit: 0, credit: 0 })
    }
  })

  it('кривые строки чинятся: нечисловые суммы — нули, нет id — выдаётся', () => {
    const d = normalizeDoc({
      rowsUs: [{ doc: 'А', debit: '100', credit: NaN }, null, { id: 'k', date: 5, doc: 7, debit: 150.4, credit: 2 }],
    }, period)
    expect(d.rowsUs).toHaveLength(3)
    expect(d.rowsUs[0]).toMatchObject({ doc: 'А', debit: 0, credit: 0 }) // строка не число — 0, а не склейка
    expect(d.rowsUs[0].id).toBe('row-0')
    expect(d.rowsUs[2]).toMatchObject({ id: 'k', date: '', doc: '', debit: 150, credit: 2 })
  })

  it('ориентация листа: альбомная сохраняется, всё остальное и пустое — книжная', () => {
    expect(normalizeDoc({ orientation: 'landscape' }, period).orientation).toBe('landscape')
    expect(normalizeDoc({ orientation: 'portrait' }, period).orientation).toBe('portrait')
    for (const v of [undefined, null, '', 'diagonal', 1]) expect(normalizeDoc({ orientation: v }, period).orientation).toBe('portrait')
    expect(normalizeDoc({}, period).orientation).toBe('portrait') // акт, сохранённый до появления поля
  })

  it('сохранённый акт читается обратно без потерь', () => {
    const d = newSettlementDoc({
      periodFrom: '2026-09-01', periodTo: '2026-09-30', clientName: 'К', cabinetLine: 'С',
      openingUs: { debit: 5, credit: 0 }, rowsUs: [row('2026-09-30', 'Услуги', 123, 0, 'a')],
    })
    d.mirror = false
    d.rowsThem = [row('2026-09-30', 'Их строка', 0, 120, 'b')]
    const back = normalizeDoc(JSON.parse(JSON.stringify(d)), period)
    expect(back).toEqual(d)
  })
})

describe('имя файла', () => {
  it('без символов, запрещённых в Windows', () => {
    const d = newSettlementDoc({
      periodFrom: '2026-01-01', periodTo: '2026-09-30', clientName: 'ООО "Система"', cabinetLine: 'С',
      openingUs: { debit: 0, credit: 0 }, rowsUs: [],
    })
    expect(fileBaseName(d)).toBe('Акт сверки ООО -Система- 01.01.2026-30.09.2026')
    expect(fileBaseName(d)).not.toMatch(/[\\/:*?"<>|]/)
  })
})

describe('строки по дате', () => {
  it('ручные строки, добавленные в конец, встают по дате', () => {
    // как в жизни: оплаты из платежей, потом вручную добавленные «Акты выполненных работ»
    const rows = [
      row('2026-07-24', 'Оплата ПП 6', 0, 22400000),
      row('2026-08-25', 'Оплата ПП 35', 0, 22400000),
      row('2026-09-24', 'Оплата ПП 21', 0, 22400000),
      row('2026-07-31', 'Акт от 31.07', 22400000, 0),
      row('2026-08-31', 'Акт от 31.08', 22400000, 0),
      row('2026-09-30', 'Акт от 30.09', 22400000, 0),
    ]
    expect(sortRows(rows).map(r => r.doc)).toEqual([
      'Оплата ПП 6', 'Акт от 31.07', 'Оплата ПП 35', 'Акт от 31.08', 'Оплата ПП 21', 'Акт от 30.09',
    ])
  })

  it('строка без даты — в конце, одна дата — прежний порядок, исходный массив цел', () => {
    const rows = [row('', 'без даты', 1, 0), row('2026-05-02', 'второй', 0, 1, 'b'), row('2026-05-01', 'первый', 0, 1, 'a'), row('2026-05-02', 'второй-bis', 0, 1, 'c')]
    const before = rows.map(r => r.doc)
    expect(sortRows(rows).map(r => r.doc)).toEqual(['первый', 'второй', 'второй-bis', 'без даты'])
    expect(rows.map(r => r.doc)).toEqual(before)
  })

  it('уже упорядоченное остаётся теми же объектами (редактор не перерисовывает зря)', () => {
    const rows = [row('2026-01-01', 'а', 1, 0), row('2026-01-02', 'б', 1, 0)]
    const sorted = sortRows(rows)
    expect(sorted.every((r, i) => r === rows[i])).toBe(true)
  })

  it('акт, сохранённый с неупорядоченными строками, при открытии упорядочен', () => {
    const d = newSettlementDoc({
      periodFrom: '2026-07-01', periodTo: '2026-09-30', clientName: 'К', cabinetLine: 'С',
      openingUs: { debit: 0, credit: 0 },
      rowsUs: [row('2026-09-30', 'поздняя', 1, 0, 'a'), row('2026-07-31', 'ранняя', 1, 0, 'b')],
    })
    d.rowsThem = [row('2026-09-30', 'их поздняя', 0, 1, 'c'), row('2026-07-31', 'их ранняя', 0, 1, 'd')]
    const back = normalizeDoc(JSON.parse(JSON.stringify(d)), { from: '2026-07-01', to: '2026-09-30' })
    expect(back.rowsUs.map(r => r.doc)).toEqual(['ранняя', 'поздняя'])
    expect(back.rowsThem.map(r => r.doc)).toEqual(['их ранняя', 'их поздняя'])
  })

  it('в режиме «зеркало» строки сторон остаются напротив друг друга', () => {
    const d = newSettlementDoc({
      periodFrom: '2026-07-01', periodTo: '2026-09-30', clientName: 'К', cabinetLine: 'С',
      openingUs: { debit: 0, credit: 0 },
      rowsUs: [row('2026-09-30', 'поздняя', 5, 0, 'a'), row('2026-07-31', 'ранняя', 0, 3, 'b'), row('2026-07-31', 'ранняя-2', 4, 0, 'c')],
    })
    const s = sortedDoc(d)
    const them = effectiveThem(s)
    expect(s.rowsUs.map(r => r.doc)).toEqual(them.rows.map(r => r.doc))
    expect(them.rows[0].debit).toBe(3) // у доверителя дебет и кредит наоборот
  })
})
