/**
 * Единая типографика печатных документов: акта об оказании юридической
 * помощи, отчёта о работе и акта сверки.
 *
 * Эти три документа видит доверитель, и до сих пор каждый выглядел по-своему:
 * акт — с тёмно-синими плашками в шапках таблиц, акт сверки ещё и с
 * полосатыми строками, отчёт — уже без заливок. Разнобой читается как
 * небрежность в делопроизводстве, поэтому стиль вынесен в одно место.
 *
 * Принципы:
 * — только чёрное на белом: цветные заливки экономят внимание читателя,
 *   а при печати на монохромном принтере превращаются в серую грязь;
 * — Times New Roman: гарнитура делового документооборота, в отличие от
 *   Arial её ждут в бумаге, приложенной к соглашению;
 * — размеры в пунктах, поля в миллиметрах — как в любом печатном документе;
 * — таблицы не рвутся посреди строки и повторяют шапку на каждом листе.
 *
 * Номера страниц («стр. 1 из 3») тут сознательно не делаются: печать HTML
 * идёт через окно браузера, а Chrome не поддерживает поля страницы
 * (@page @bottom-right) и счётчики страниц. В Word-выгрузке номера есть —
 * там это умеет сам формат.
 */

export const PRINT_CSS = `
  body{font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.35;margin:20mm;color:#000}
  h1{text-align:center;font-size:14pt;font-weight:bold;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.02em}
  h2{text-align:center;font-size:13pt;font-weight:bold;margin:0 0 4px;text-transform:uppercase}
  .sub{text-align:center;font-size:11pt;margin-bottom:14px}
  .meta{font-size:11pt;margin-bottom:16px;line-height:1.6}
  h3{font-size:11pt;font-weight:bold;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse;margin-bottom:10px}
  th{padding:5px 4px;font-size:10pt;text-align:left;font-weight:bold;border:1px solid #000}
  td{padding:4px;font-size:10pt;border:1px solid #000;vertical-align:top}
  tfoot td{font-weight:bold}
  .r{text-align:right}
  .total{font-size:11pt;font-weight:bold;margin:12px 0 4px}
  .total-words{font-size:11pt;margin-bottom:12px}
  .signs{margin-top:36px;display:flex;justify-content:space-between}
  .sign{width:45%}
  .footer{margin-top:24px;padding-top:8px;border-top:1px solid #000;font-size:9pt;line-height:1.4}
  @media print{
    body{margin:15mm}
    /* Документ на несколько листов: шапка таблицы повторяется на каждом,
       строки не рвутся пополам, подписи не уезжают на отдельный лист */
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    h3{break-after:avoid;page-break-after:avoid}
    .signs,.total,.total-words,.footer{break-inside:avoid;page-break-inside:avoid}
  }
`

/** Реквизиты кабинета — одной строкой во всех документах */
export const CABINET_LINE =
  'Адвокатский кабинет Бухмина Антона Андреевича, рег. № 54/1831 в реестре адвокатов ' +
  'Новосибирской области, ИНН 540233730471'

export function printDocument(title: string, bodyHtml: string): boolean {
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>${title}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  // Не полагаемся на w.onload: для окна, заполненного через document.write,
  // в Chrome событие приходит ненадёжно и печать открывается на белом листе
  setTimeout(() => { w.print() }, 400)
  return true
}
