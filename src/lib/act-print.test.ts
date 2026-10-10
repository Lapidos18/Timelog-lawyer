import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { actBodyHtml, actCss, buildActWord } from './act-print'
import { buildActDoc, ActDocInput } from './act-doc'
import { CABINET } from './print'

const norm = (s: string) => s.replace(/[\s  ]+/g, ' ')

const input = (over: Partial<ActDocInput> = {}): ActDocInput => ({
  cabinet: { ...CABINET },
  client: {
    name: 'ООО "Система"', type: 'legal_entity', inn: '5405006521', ogrn: '1175476084178',
    full_name: 'Общество с ограниченной ответственностью «СИСТЕМА»',
    representative: 'генерального директора Зарипова Раиса Юрьевича',
    signer_position: 'Генеральный директор', signer_short: 'Р.Ю. Зарипов',
  },
  matter: { title: 'Дело', agreement_no: '19/06-26', agreement_date: '2026-06-19', task_no: '3', started_at: '2026-07-06', expenses_clause: 'п. 2.4.' },
  periodFrom: '2026-09-01', periodTo: '2026-09-30',
  rows: [{ hours: 2.75, hourly_rate: 9412, amount: 25883, performed_by: 'Бухмин А.А.' }],
  expensesAmount: 387.34,
  ...over,
})

describe('печатная форма акта об оказании услуг', () => {
  it('содержит все части образца', () => {
    const html = norm(actBodyHtml(buildActDoc(input())))
    for (const part of [
      'АКТ ОБ ОКАЗАНИИ УСЛУГ', 'к соглашению об оказании юридической помощи № 19/06-26 от 19.06.2026',
      'г. Новосибирск', '30 сентября 2026 года', 'именуемый далее «Адвокат»', 'именуемое далее «Доверитель»',
      'Квалификация специалиста', 'Затраты времени, чел-ч', 'Стоимость 1 чел-ч', 'Общая стоимость по проекту',
      '25 883,00', 'ИТОГО', 'Подписи сторон:', 'Удостоверение адвоката №: 2301', 'ОГРН: 1175476084178', '/Р.Ю. Зарипов/', 'м.п.',
    ]) expect(html).toContain(part)
  })

  it('«<», «>» и «&» в названиях не вырезают текст документа', () => {
    const d = buildActDoc(input({
      matter: { title: 'x', task_no: '3', act_subject: 'представления интересов <в суде> по иску А&Б' },
      note: 'см. <приложение>',
    }))
    const html = actBodyHtml(d)
    expect(html).not.toContain('<в суде>')
    expect(html).toContain('&lt;в суде&gt;')
    expect(html).toContain('А&amp;Б')
    expect(html).toContain('&lt;приложение&gt;')
  })

  it('поля листа как в образце: слева 20 мм, справа и снизу 10, сверху 15', () => {
    expect(actCss()).toContain('margin:15mm 10mm 10mm 20mm')
  })
})

describe('Word акта', () => {
  it('собирается, внутри те же тексты и таблицы', async () => {
    const blob = await buildActWord(buildActDoc(input()))
    expect(blob.size).toBeGreaterThan(2000)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const text = norm(xml.replace(/<[^>]+>/g, ' '))
    for (const part of ['АКТ ОБ ОКАЗАНИИ УСЛУГ', '30 сентября 2026 года', 'Квалификация специалиста', '25 883,00', 'Подписи сторон:', 'Р.Ю. Зарипов']) {
      expect(text).toContain(part)
    }
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2) // таблица специалистов и таблица подписей
    expect(xml).toContain('w:pgSz w:w="11907" w:h="16839"')
    expect(xml).toContain('w:right')                    // правая табуляция «город … дата»
    expect(xml).toContain('Times New Roman')
  })
})
