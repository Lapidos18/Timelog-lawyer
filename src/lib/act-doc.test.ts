import { describe, it, expect } from 'vitest'
import {
  buildActDoc, specialistLines, agreementRef, agreementLine, expandLegalForm, shortOrgName, shortFio,
  shortDate, longDate, actFileName, ActDocInput, ActBlock,
} from './act-doc'
import { fmtMoneyAct } from './money-words'
import { CABINET } from './print'

// Intl ставит неразрывные пробелы — сравниваем без разницы в пробелах
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ')

/** Образец адвоката «Акт_30.09.2026 Задание № 3» (ООО «Система», 10.10.2026) */
const sample = (over: Partial<ActDocInput> = {}): ActDocInput => ({
  cabinet: { ...CABINET },
  client: {
    name: 'ООО "Система"', type: 'legal_entity', inn: '5405006521',
    full_name: 'Общество с ограниченной ответственностью «СИСТЕМА»', ogrn: '1175476084178',
    representative: 'генерального директора Зарипова Раиса Юрьевича',
    signer_position: 'Генеральный директор', signer_short: 'Р.Ю. Зарипов',
  },
  matter: {
    title: 'Метизные решения/ взыскание за непоставку товара',
    agreement_no: '19/06-26', agreement_date: '2026-06-19',
    task_no: '3', started_at: '2026-07-06',
    act_subject: 'представления интересов доверителя при взыскании задолженности по договору поставки №04062025-75 от 04.06.2025, заключенного с ООО «Метизные решения» (ИНН 9721212720)',
    expenses_clause: 'п. 2.4.',
  },
  periodFrom: '2026-09-01', periodTo: '2026-09-30',
  // Записи сентября; запись от 16.09 в базе внесена по ставке 8 235 вместо 9 412
  rows: [
    { hours: 1, hourly_rate: 9412, amount: 9412, performed_by: 'Бухмин А.А.' },
    { hours: 0.25, hourly_rate: 8235, amount: 2058.75, performed_by: 'Бухмин А.А.' },
    { hours: 1.5, hourly_rate: 9412, amount: 14118, performed_by: 'Бухмин А.А.' },
  ],
  expensesAmount: 387.34,
  ...over,
})

const texts = (blocks: ActBlock[]) => blocks.flatMap(b => b.kind === 'para' || b.kind === 'title' ? [norm(b.text)] : [])
const find = (blocks: ActBlock[], re: RegExp) => texts(blocks).find(t => re.test(t))

describe('акт об оказании услуг: тексты как в образце адвоката', () => {
  const doc = buildActDoc(sample())

  it('заголовок, место и дата', () => {
    expect(texts(doc.blocks).slice(0, 2)).toEqual([
      'АКТ ОБ ОКАЗАНИИ УСЛУГ',
      'к соглашению об оказании юридической помощи № 19/06-26 от 19.06.2026',
    ])
    const pd = doc.blocks.find(b => b.kind === 'placeDate')
    expect(pd).toEqual({ kind: 'placeDate', place: 'г. Новосибирск', date: '30 сентября 2026 года' })
  })

  it('стороны: адвокат с реквизитами, доверитель с ОГРН, ИНН и представителем', () => {
    expect(find(doc.blocks, /именуемый далее «Адвокат»/)).toBe(
      'Адвокатский кабинет Бухмина Антона Андреевича, регистрационный номер в реестре адвокатов Новосибирской области № 54/1831, удостоверение адвоката № 2301, именуемый далее «Адвокат» с одной стороны и')
    expect(find(doc.blocks, /именуемое далее «Доверитель»/)).toBe(
      'Общество с ограниченной ответственностью «СИСТЕМА» (ОГРН 1175476084178, ИНН 5405006521) в лице генерального директора Зарипова Раиса Юрьевича, именуемое далее «Доверитель», с другой стороны,')
    expect(find(doc.blocks, /^совместно/)).toBe('совместно именуемые «Стороны»,')
    expect(find(doc.blocks, /^Составили/)).toBe('Составили настоящий акт о нижеследующем:')
  })

  it('предмет, сумма цифрами и прописью, расходы', () => {
    expect(find(doc.blocks, /^Адвокат в соответствии/)).toBe(
      'Адвокат в соответствии с Заданием № 3 от 06.07.2026 к Соглашению об оказании юридической помощи № 19/06-26 от 19.06.2026 оказал Доверителю надлежащим образом в полном соответствии с условиями Соглашения юридическую помощь в виде представления интересов доверителя при взыскании задолженности по договору поставки №04062025-75 от 04.06.2025, заключенного с ООО «Метизные решения» (ИНН 9721212720).')
    expect(find(doc.blocks, /^За оказанные/)).toBe(
      'За оказанные в период с 01.09.2026 по 30.09.2026 услуги Доверитель уплачивает Адвокату в соответствии с Заданием № 3 от 06.07.2026 сумму в размере 25 588 (Двадцать пять тысяч пятьсот восемьдесят восемь) рублей 75 коп., исходя из данных учета трудозатрат Адвоката:')
    expect(find(doc.blocks, /возмещает/)).toBe(
      'В соответствии с п. 2.4. Задания № 3 от 06.07.2026 Доверитель возмещает Адвокату расходы в размере 387 (Триста восемьдесят семь) рублей 34 коп.')
    expect(find(doc.blocks, /претензий/)).toBe('Доверитель не имеет претензий к качеству оказанных Адвокатом услуг.')
    expect(find(doc.blocks, /экземплярах/)).toBe('Настоящий акт составлен в 2 (двух) экземплярах, имеющих равную юридическую силу, по одному для каждой из сторон.')
  })

  it('подписи сторон с реквизитами', () => {
    const s = doc.blocks.find(b => b.kind === 'signs')
    if (!s || s.kind !== 'signs') throw new Error('нет блока подписей')
    expect(s.left).toEqual([
      'Адвокат:', 'Адвокатский кабинет', 'Бухмина Антона Андреевича',
      'Рег. номер: 54/1831', 'Удостоверение адвоката №: 2301', 'ИНН: 540233730471',
      '', '', '', '_______________________/А.А. Бухмин/', 'м.п.',
    ])
    expect(s.right).toEqual([
      'Доверитель:', 'ООО «Система»', 'ОГРН: 1175476084178', 'ИНН: 5405006521',
      '', '', 'Генеральный директор', '', '', '_______________________/Р.Ю. Зарипов/', 'м.п.',
    ])
  })

  it('имя файла — как называет файл адвокат', () => {
    expect(doc.fileName).toBe('Акт_30.09.2026 Задание № 3')
  })
})

describe('таблица «по специалистам»', () => {
  it('записи по разным ставкам — разные строки, и в каждой часы × ставка = сумма', () => {
    // Так выходит на данных образца: запись от 16.09 внесена по ставке 8 235, остальные — 9 412
    const t = buildActDoc(sample()).blocks.find(b => b.kind === 'table')
    if (!t || t.kind !== 'table') throw new Error('нет таблицы')
    expect(t.head).toEqual(['Квалификация специалиста', 'Затраты времени, чел-ч', 'Стоимость 1 чел-ч', 'Общая стоимость по проекту'])
    expect(t.rows.map(r => r.map(norm))).toEqual([
      ['Адвокат', '2,50', '9 412,00', '23 530,00'],
      ['Адвокат', '0,25', '8 235,00', '2 058,75'],
    ])
    expect(t.total.map(norm)).toEqual(['ИТОГО', 'Х', 'Х', '25 588,75'])
  })

  it('когда ставка одна, строка одна: 2,75 ч × 9 412 = 25 883', () => {
    const rows = [
      { hours: 1, hourly_rate: 9412, amount: 9412, performed_by: 'Бухмин А.А.' },
      { hours: 0.25, hourly_rate: 9412, amount: 2353, performed_by: 'Бухмин А.А.' },
      { hours: 1.5, hourly_rate: 9412, amount: 14118, performed_by: 'Бухмин А.А.' },
    ]
    const r = specialistLines(rows)
    expect(r.lines).toEqual([{ label: 'Адвокат', rateKop: 941200, hours100: 275, amountKop: 2588300 }])
    expect(r.totalKop).toBe(2588300)
    expect(r.totalHours100).toBe(275)
    expect(r.lines[0].hours100 * r.lines[0].rateKop / 100).toBe(r.lines[0].amountKop) // 2,75 × 9 412 — ровно итог
  })

  it('разные исполнители с одной ставкой тоже разные строки (ключ — реальное имя, п. 5)', () => {
    const r = specialistLines([
      { hours: 1, hourly_rate: 5000, amount: 5000, performed_by: 'А' },
      { hours: 2, hourly_rate: 5000, amount: 10000, performed_by: 'Б' },
    ])
    expect(r.lines).toHaveLength(2)
    expect(r.lines.every(l => l.label === 'Адвокат')).toBe(true) // в документе роль, не ФИО
  })

  it('копейки не накапливают дробную ошибку', () => {
    const rows = Array.from({ length: 10 }, () => ({ hours: 0.1, hourly_rate: 1, amount: 0.1, performed_by: 'А' }))
    expect(specialistLines(rows).totalKop).toBe(100)
  })
})

describe('что в документе меняется от данных', () => {
  it('без возмещаемых расходов абзаца о них нет', () => {
    const d = buildActDoc(sample({ expensesAmount: 0 }))
    expect(find(d.blocks, /возмещает/)).toBeUndefined()
    expect(find(buildActDoc(sample({ expensesAmount: null })).blocks, /возмещает/)).toBeUndefined()
  })

  it('расходы без пункта задания: «в соответствии с Заданием № 3 …»', () => {
    const d = buildActDoc(sample({ matter: { ...sample().matter, expenses_clause: '' } }))
    expect(find(d.blocks, /возмещает/)).toBe(
      'В соответствии с Заданием № 3 от 06.07.2026 Доверитель возмещает Адвокату расходы в размере 387 (Триста восемьдесят семь) рублей 34 коп.')
  })

  it('без задания: ссылка только на соглашение, дело — по названию, если предмет не заполнен', () => {
    const m = { ...sample().matter, task_no: '', act_subject: '' }
    const d = buildActDoc(sample({ matter: m }))
    expect(find(d.blocks, /^Адвокат в соответствии/)).toBe(
      'Адвокат в соответствии с Соглашением об оказании юридической помощи № 19/06-26 от 19.06.2026 оказал Доверителю надлежащим образом в полном соответствии с условиями Соглашения юридическую помощь по делу «Метизные решения/ взыскание за непоставку товара».')
    expect(find(d.blocks, /^За оказанные/)).toContain('Адвокату сумму в размере') // без «в соответствии с Заданием»
    expect(find(d.blocks, /возмещает/)).toBe(
      'В соответствии с п. 2.4. Соглашения № 19/06-26 от 19.06.2026 Доверитель возмещает Адвокату расходы в размере 387 (Триста восемьдесят семь) рублей 34 коп.')
    expect(d.fileName).toBe('Акт_30.09.2026 Метизные решения- взыскание за непоставку товара')
  })

  it('дата задания по умолчанию — начало дела', () => {
    const d = buildActDoc(sample({ matter: { ...sample().matter, task_date: null, started_at: '2026-07-06' } }))
    expect(find(d.blocks, /^Адвокат в соответствии/)).toContain('Заданием № 3 от 06.07.2026')
    const d2 = buildActDoc(sample({ matter: { ...sample().matter, task_date: '2026-07-10' } }))
    expect(find(d2.blocks, /^Адвокат в соответствии/)).toContain('Заданием № 3 от 10.07.2026')
  })

  it('дата соглашения уже внесена в номер — второй раз не дописывается', () => {
    const m = { ...sample().matter, agreement_no: '19/06-26 от 19.06.2026', agreement_date: '2026-06-19' }
    const d = buildActDoc(sample({ matter: m }))
    expect(texts(d.blocks)[1]).toBe('к соглашению об оказании юридической помощи № 19/06-26 от 19.06.2026')
  })

  it('физическое лицо: ФИО, ИНН (если есть), подпись по инициалам', () => {
    const d = buildActDoc(sample({ client: { name: 'Кадырова Наталья Викторовна', type: 'individual' } }))
    expect(find(d.blocks, /именуемый\(ая\)/)).toBe('Кадырова Наталья Викторовна, именуемый(ая) далее «Доверитель», с другой стороны,')
    const s = d.blocks.find(b => b.kind === 'signs')
    if (!s || s.kind !== 'signs') throw new Error('нет блока подписей')
    expect(s.right).toEqual(['Доверитель:', 'Кадырова Наталья Викторовна', '', '', '', '', '_______________________/Н.В. Кадырова/'])
  })

  it('юрлицо без заполненных реквизитов: полное наименование собирается из названия, подпись — пустая линия', () => {
    const d = buildActDoc(sample({ client: { name: 'ООО УК "Альфа менеджмент"', type: 'legal_entity', inn: '5406828355' } }))
    expect(find(d.blocks, /именуемое/)).toBe(
      'Общество с ограниченной ответственностью Управляющая компания «Альфа менеджмент» (ИНН 5406828355), именуемое далее «Доверитель», с другой стороны,')
    const s = d.blocks.find(b => b.kind === 'signs')
    if (!s || s.kind !== 'signs') throw new Error('нет блока подписей')
    expect(s.right[s.right.length - 2]).toBe('_______________________')
  })

  it('примечание к акту идёт отдельным абзацем перед «претензий»', () => {
    const d = buildActDoc(sample({ note: 'Оплата в течение 5 дней' }))
    const t = texts(d.blocks)
    expect(t.indexOf('Оплата в течение 5 дней')).toBe(t.findIndex(x => /претензий/.test(x)) - 1)
  })
})

describe('помощники', () => {
  it('даты', () => {
    expect(shortDate('2026-09-30')).toBe('30.09.2026')
    expect(longDate('2026-09-30')).toBe('30 сентября 2026 года')
    expect(longDate('2026-01-05')).toBe('5 января 2026 года')
    expect(longDate('2026-12-31')).toBe('31 декабря 2026 года')
  })

  it('соглашение и строка отчёта', () => {
    expect(agreementRef('19/06-26', '2026-06-19')).toBe('19/06-26 от 19.06.2026')
    expect(agreementRef('19/06-26', null)).toBe('19/06-26')
    expect(agreementRef('19/06-26 от 19.06.2026', '2026-06-19')).toBe('19/06-26 от 19.06.2026')
    expect(agreementRef('', '2026-06-19')).toBe('')
    expect(agreementLine('19/06-26', '2026-06-19', '3')).toBe('19/06-26 от 19.06.2026, задание № 3')
    expect(agreementLine('19/06-26', null, null)).toBe('19/06-26')
    expect(agreementLine('19/06-26', '2026-06-19', ' ')).toBe('19/06-26 от 19.06.2026')
    expect(agreementLine(null, null, '3')).toBe('задание № 3')
    expect(agreementLine(null, null, null)).toBe('')
  })

  it('полное наименование из краткого', () => {
    expect(expandLegalForm('ООО "Система"')).toBe('Общество с ограниченной ответственностью «Система»')
    expect(expandLegalForm('ООО УК "Альфа менеджмент"')).toBe('Общество с ограниченной ответственностью Управляющая компания «Альфа менеджмент»')
    expect(expandLegalForm('АБ "Гребнева и партнеры"')).toBe('Адвокатское бюро «Гребнева и партнеры»')
    expect(expandLegalForm('ПАО "Банк"')).toBe('Публичное акционерное общество «Банк»')
    expect(expandLegalForm('Иванов Иван')).toBe('Иванов Иван')
    expect(shortOrgName('ООО "Система"')).toBe('ООО «Система»')
  })

  it('инициалы', () => {
    expect(shortFio('Кадырова Наталья Викторовна')).toBe('Н.В. Кадырова')
    expect(shortFio('Иванов Иван')).toBe('И. Иванов')
    expect(shortFio('Иванов')).toBe('Иванов')
  })

  it('сумма в тексте акта: слова с заглавной, «коп.»', () => {
    expect(norm(fmtMoneyAct(25588.75))).toBe('25 588 (Двадцать пять тысяч пятьсот восемьдесят восемь) рублей 75 коп.')
    expect(norm(fmtMoneyAct(387.34))).toBe('387 (Триста восемьдесят семь) рублей 34 коп.')
    expect(norm(fmtMoneyAct(25883))).toBe('25 883 (Двадцать пять тысяч восемьсот восемьдесят три) рубля 00 коп.')
    expect(norm(fmtMoneyAct(1000.05))).toBe('1 000 (Одна тысяча) рублей 05 коп.')
    expect(norm(fmtMoneyAct(0.1 + 0.2))).toBe('0 (Ноль) рублей 30 коп.') // 0,30000000000000004 → ровно 30 копеек
  })

  it('имя файла без символов, запрещённых в Windows', () => {
    const f = actFileName({ periodTo: '2026-09-30', matter: { title: 'A/B: "C"', task_no: '' } })
    expect(f).toBe('Акт_30.09.2026 A-B- -C-')
    expect(f).not.toMatch(/[\\/:*?"<>|]/)
  })
})
