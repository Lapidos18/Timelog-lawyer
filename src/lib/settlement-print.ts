/**
 * Печать (PDF) и Word акта сверки взаимных расчётов.
 *
 * Страница альбомная, таблицы идут РЯДОМ одной общей таблицей с пустой
 * колонкой-разделителем посередине — так делает 1С, и так строки обеих сторон
 * выровнены по одной линии. Если у сторон разное число строк, недостающие
 * ячейки остаются пустыми.
 *
 * Весь пользовательский текст в HTML идёт через escapeHtml (CLAUDE.md, раздел
 * про src/lib/html.ts): «<» и «>» в названии не должны вырезать часть документа.
 */
import { escapeHtml } from './html'
import { printDocument } from './print'
import {
  SettlementDoc, SettlementRow, Balance, Orientation, effectiveThem, tableTotals, conclusion,
  formatMoney, fmtDate, fileBaseName,
} from './settlement-act'

/**
 * Правила только для этого документа; идут после общих и перебивают их.
 * Классы вывода и подписей начинаются с sa-: в общей печати уже есть .sign
 * (width:45%), и таблица с таким именем сжималась в узкую колонку.
 */
/**
 * Ширины колонок и размер шрифта зависят от листа. На книжном (186 мм между
 * полями) каждая из двух таблиц получает ~92 мм, поэтому шрифт мельче, а
 * колонка «Документ» переносит текст на вторую-третью строку; на альбомном
 * места вдвое больше. Суммы в колонках — по ширине «124 000,00» при 8 pt.
 */
const LAYOUT = {
  portrait:  { side: [9, 19, 10.75, 10.75], sign: [28, 21.5], cell: 8,   pad: "2px 3px", head: 15, sub: 10.5, intro: 10, foot: 9.5,  cap: 7.5, signTop: 22 },
  landscape: { side: [7.5, 24.5, 8.75, 8.75],  sign: [30, 19.5], cell: 9.5, pad: "2px 5px", head: 16, sub: 11,   intro: 11, foot: 10.5, cap: 8.5, signTop: 26 },
} as const

export function settlementCss(o: Orientation): string {
  const L = LAYOUT[o]
  return `
  @page{size:A4 ${o};margin:12mm}
  body{margin:0}
  @media print{body{margin:0}}
  h2{text-transform:none;font-size:${L.head}pt;margin-bottom:6px}
  .sub{margin-bottom:10px;line-height:1.4;font-size:${L.sub}pt}
  .intro{margin:0 0 10px;font-size:${L.intro}pt;text-align:justify}
  table.sa{table-layout:fixed;margin-bottom:12px}
  table.sa th,table.sa td{font-size:${L.cell}pt;padding:${L.pad};border:1px solid #000;vertical-align:middle}
  table.sa th{text-align:center}
  table.sa th.l,table.sa td.l{text-align:left}
  table.sa td.r{text-align:right;white-space:nowrap}
  table.sa td.c{text-align:center;white-space:nowrap}
  table.sa tr.b td{font-weight:bold}
  table.sa th.gap,table.sa td.gap{border:none;padding:0}
  table.sa-end,table.sa-sign{table-layout:fixed;margin:0 0 6px}
  table.sa-end td,table.sa-sign td{border:none;padding:2px 4px;font-size:${L.foot}pt}
  table.sa-end td.who{font-weight:bold;padding-bottom:2px}
  table.sa-sign td.who{text-align:right;vertical-align:bottom;padding-top:${L.signTop}px}
  table.sa-sign td.line{border-bottom:1px solid #000}
  table.sa-sign td.cap{text-align:center;font-size:${L.cap}pt;padding-top:1px}
  table.sa-sign td.mp{text-align:right;font-size:${L.foot}pt}
  @media print{table.sa-end,table.sa-sign{break-inside:avoid;page-break-inside:avoid}}
`
}

const money = (k: number, blankZero: boolean) => (blankZero && k === 0 ? '' : formatMoney(k))

/** Цифры в ячейке: в строках документов ноль не пишем, в сальдо и оборотах — пишем */
function sideCells(r: SettlementRow | undefined): string {
  if (!r) return '<td></td><td></td><td></td><td></td>'
  return `<td class="c">${escapeHtml(fmtDate(r.date))}</td>` +
    `<td class="l">${escapeHtml(r.doc)}</td>` +
    `<td class="r">${money(r.debit, true)}</td><td class="r">${money(r.credit, true)}</td>`
}

function sumCells(label: string, d: number, c: number): string {
  return `<td colspan="2" class="l">${label}</td><td class="r">${formatMoney(d)}</td><td class="r">${formatMoney(c)}</td>`
}

export function settlementBodyHtml(doc: SettlementDoc): string {
  const them = effectiveThem(doc)
  const tUs = tableTotals(doc.openingUs, doc.rowsUs)
  const tThem = tableTotals(them.opening, them.rows)
  const cUs = conclusion(tUs.net, doc.us.name, doc.them.name)
  const cThem = conclusion(tThem.net, doc.them.name, doc.us.name)
  const e = escapeHtml
  const to = fmtDate(doc.periodTo)
  const L = LAYOUT[doc.orientation]
  const cols = L.side.map(w => `<col style="width:${w}%">`).join("")

  const n = Math.max(doc.rowsUs.length, them.rows.length)
  let body = ''
  for (let i = 0; i < n; i++) {
    body += `<tr>${sideCells(doc.rowsUs[i])}<td class="gap"></td>${sideCells(them.rows[i])}</tr>`
  }
  const bal = (b: Balance) => [b.debit, b.credit] as const
  const [oUd, oUc] = bal(doc.openingUs)
  const [oTd, oTc] = bal(them.opening)

  return `
<h2>Акт сверки</h2>
<div class="sub">взаимных расчетов за период: ${e(fmtDate(doc.periodFrom))} — ${e(to)}<br>между ${e(doc.us.name)} и ${e(doc.them.name)}</div>
<p class="intro">Мы, нижеподписавшиеся, ${e(doc.us.intro)}, с одной стороны, и ${e(doc.them.intro)}, с другой стороны, составили настоящий акт сверки о том, что состояние взаимных расчетов по данным учета следующее:</p>
<table class="sa">
  <colgroup>${cols}<col style="width:1%">${cols}</colgroup>
  <thead>
    <tr>
      <th colspan="2" class="l">По данным ${e(doc.us.name)}</th><th colspan="2">${e(doc.currency)}</th>
      <th class="gap"></th>
      <th colspan="2" class="l">По данным ${e(doc.them.name)}</th><th colspan="2">${e(doc.currency)}</th>
    </tr>
    <tr><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th><th class="gap"></th><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th></tr>
  </thead>
  <tbody>
    <tr class="b">${sumCells('Сальдо начальное', oUd, oUc)}<td class="gap"></td>${sumCells('Сальдо начальное', oTd, oTc)}</tr>
    ${body}
    <tr class="b">${sumCells('Обороты за период', tUs.turnDebit, tUs.turnCredit)}<td class="gap"></td>${sumCells('Обороты за период', tThem.turnDebit, tThem.turnCredit)}</tr>
    <tr class="b">${sumCells('Сальдо конечное', tUs.closingDebit, tUs.closingCredit)}<td class="gap"></td>${sumCells('Сальдо конечное', tThem.closingDebit, tThem.closingCredit)}</tr>
  </tbody>
</table>
<table class="sa-end">
  <colgroup><col style="width:49.5%"><col style="width:1%"><col style="width:49.5%"></colgroup>
  <tr><td>По данным ${e(doc.us.name)} на ${e(to)}</td><td></td><td>По данным ${e(doc.them.name)} на ${e(to)}</td></tr>
  <tr><td class="who">${e(cUs.text)}</td><td></td><td class="who">${e(cThem.text)}</td></tr>
</table>
<table class="sa-sign">
  <colgroup><col style="width:${L.sign[0]}%"><col style="width:${L.sign[1]}%"><col style="width:1%"><col style="width:${L.sign[0]}%"><col style="width:${L.sign[1]}%"></colgroup>
  <tr>
    <td class="who">${e(doc.us.signer)}</td><td class="line"></td><td></td>
    <td class="who">${e(doc.them.signer)}</td><td class="line"></td>
  </tr>
  <tr>
    <td class="mp">м.п.</td><td class="cap">(подпись)</td><td></td>
    <td class="mp">м.п.</td><td class="cap">(подпись)</td>
  </tr>
</table>`
}

/** Открывает окно печати (там же «Сохранить как PDF»). false — окно заблокировано */
export function printSettlement(doc: SettlementDoc): boolean {
  return printDocument(fileBaseName(doc), settlementBodyHtml(doc), settlementCss(doc.orientation))
}

// ── Word ────────────────────────────────────────────────────────────────

/** Собирает файл Word. Отдельно от скачивания, чтобы собранное можно было проверить без браузера */
export async function buildSettlementWord(doc: SettlementDoc): Promise<Blob> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    WidthType, AlignmentType, BorderStyle, PageOrientation, TableLayoutType, VerticalAlign,
  } = await import('docx')

  type Align = (typeof AlignmentType)[keyof typeof AlignmentType]

  const them = effectiveThem(doc)
  const tUs = tableTotals(doc.openingUs, doc.rowsUs)
  const tThem = tableTotals(them.opening, them.rows)
  const cUs = conclusion(tUs.net, doc.us.name, doc.them.name)
  const cThem = conclusion(tThem.net, doc.them.name, doc.us.name)
  const to = fmtDate(doc.periodTo)

  // Ширина между полями (поля по 567): альбомный 16838 − 1134 = 15704, книжный 11906 − 1134 = 10772.
  // Две стороны и разделитель укладываются в неё точно: 7700·2 + 300 и 5350·2 + 72.
  const land = doc.orientation === 'landscape'
  const W = land
    ? { side: [1000, 3400, 1650, 1650], gap: 300, sign: [4800, 2900], text: 19, foot: 21, cap: 17 }
    : { side: [850, 2350, 1075, 1075], gap: 72, sign: [3400, 1950], text: 16, foot: 18, cap: 14 }
  const SIDE = W.side
  const GAP = W.gap
  const COLS = [...SIDE, GAP, ...SIDE]
  const TOTAL = COLS.reduce((a, b) => a + b, 0)

  const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const boxed = { top: line, bottom: line, left: line, right: line }
  const bare = { top: none, bottom: none, left: none, right: none }

  function cell(text: string, width: number, o: { align?: Align; bold?: boolean; span?: number; borders?: typeof boxed; size?: number } = {}) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      columnSpan: o.span,
      borders: o.borders ?? boxed,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: o.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text, bold: o.bold, size: o.size ?? W.text })],
      })],
    })
  }
  const gap = () => new TableCell({ width: { size: GAP, type: WidthType.DXA }, borders: bare, children: [new Paragraph({ children: [] })] })

  // Одна сторона: четыре ячейки строки документа
  function side(r: SettlementRow | undefined): InstanceType<typeof TableCell>[] {
    if (!r) return SIDE.map(w => cell('', w))
    return [
      cell(fmtDate(r.date), SIDE[0], { align: AlignmentType.CENTER }),
      cell(r.doc, SIDE[1]),
      cell(r.debit ? formatMoney(r.debit) : '', SIDE[2], { align: AlignmentType.RIGHT }),
      cell(r.credit ? formatMoney(r.credit) : '', SIDE[3], { align: AlignmentType.RIGHT }),
    ]
  }
  // Строка итогов: подпись на два столбца и два числа
  function sums(label: string, d: number, c: number): InstanceType<typeof TableCell>[] {
    return [
      cell(label, SIDE[0] + SIDE[1], { span: 2, bold: true }),
      cell(formatMoney(d), SIDE[2], { align: AlignmentType.RIGHT, bold: true }),
      cell(formatMoney(c), SIDE[3], { align: AlignmentType.RIGHT, bold: true }),
    ]
  }

  const head = (name: string) => [
    cell(`По данным ${name}`, SIDE[0] + SIDE[1], { span: 2, bold: true }),
    cell(doc.currency, SIDE[2] + SIDE[3], { span: 2, bold: true, align: AlignmentType.CENTER }),
  ]
  const colHead = () => ['Дата', 'Документ', 'Дебет', 'Кредит'].map((t, i) => cell(t, SIDE[i], { bold: true, align: AlignmentType.CENTER }))

  const n = Math.max(doc.rowsUs.length, them.rows.length)
  const rows: InstanceType<typeof TableRow>[] = [
    new TableRow({ tableHeader: true, children: [...head(doc.us.name), gap(), ...head(doc.them.name)] }),
    new TableRow({ tableHeader: true, children: [...colHead(), gap(), ...colHead()] }),
    new TableRow({ children: [...sums('Сальдо начальное', doc.openingUs.debit, doc.openingUs.credit), gap(), ...sums('Сальдо начальное', them.opening.debit, them.opening.credit)] }),
  ]
  for (let i = 0; i < n; i++) {
    rows.push(new TableRow({ cantSplit: true, children: [...side(doc.rowsUs[i]), gap(), ...side(them.rows[i])] }))
  }
  rows.push(new TableRow({ children: [...sums('Обороты за период', tUs.turnDebit, tUs.turnCredit), gap(), ...sums('Обороты за период', tThem.turnDebit, tThem.turnCredit)] }))
  rows.push(new TableRow({ children: [...sums('Сальдо конечное', tUs.closingDebit, tUs.closingCredit), gap(), ...sums('Сальдо конечное', tThem.closingDebit, tThem.closingCredit)] }))

  const tableAll = new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: COLS, layout: TableLayoutType.FIXED, rows })

  // Вывод и подписи — таблицы без рамок в тех же колонках, чтобы всё стояло ровно под своей стороной
  const HALF = SIDE[0] + SIDE[1] + SIDE[2] + SIDE[3]
  const free = (text: string, width: number, o: { bold?: boolean; align?: Align; border?: boolean; size?: number } = {}) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: o.border ? { ...bare, bottom: line } : bare,
      verticalAlign: VerticalAlign.BOTTOM,
      children: [new Paragraph({ alignment: o.align ?? AlignmentType.LEFT, spacing: { before: 60 }, children: [new TextRun({ text, bold: o.bold, size: o.size ?? W.foot })] })],
    })

  const endTable = new Table({
    width: { size: TOTAL, type: WidthType.DXA }, columnWidths: [HALF, GAP, HALF], layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ children: [free(`По данным ${doc.us.name} на ${to}`, HALF), free('', GAP), free(`По данным ${doc.them.name} на ${to}`, HALF)] }),
      new TableRow({ children: [free(cUs.text, HALF, { bold: true }), free('', GAP), free(cThem.text, HALF, { bold: true })] }),
    ],
  })

  const SIGN = W.sign // подпись-слова и линия под ручку
  const signTable = new Table({
    width: { size: TOTAL, type: WidthType.DXA }, columnWidths: [SIGN[0], SIGN[1], GAP, SIGN[0], SIGN[1]], layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ children: [
        free(doc.us.signer, SIGN[0], { align: AlignmentType.RIGHT }), free('', SIGN[1], { border: true }), free('', GAP),
        free(doc.them.signer, SIGN[0], { align: AlignmentType.RIGHT }), free('', SIGN[1], { border: true }),
      ] }),
      new TableRow({ children: [
        free('м.п.', SIGN[0], { align: AlignmentType.RIGHT }), free('(подпись)', SIGN[1], { align: AlignmentType.CENTER, size: W.cap }), free('', GAP),
        free('м.п.', SIGN[0], { align: AlignmentType.RIGHT }), free('(подпись)', SIGN[1], { align: AlignmentType.CENTER, size: W.cap }),
      ] }),
    ],
  })

  const p = (text: string, o: { bold?: boolean; size?: number; align?: Align; after?: number; before?: number } = {}) =>
    new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 0, before: o.before ?? 0 }, children: [new TextRun({ text, bold: o.bold, size: o.size ?? 22 })] })

  const file = new Document({
    sections: [{
      properties: { page: { size: { orientation: land ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 567, bottom: 567, left: 567, right: 567 } } },
      children: [
        p('Акт сверки', { bold: true, size: 32, align: AlignmentType.CENTER, after: 80 }),
        p(`взаимных расчетов за период: ${fmtDate(doc.periodFrom)} — ${to}`, { align: AlignmentType.CENTER }),
        p(`между ${doc.us.name} и ${doc.them.name}`, { align: AlignmentType.CENTER, after: 200 }),
        p(`Мы, нижеподписавшиеся, ${doc.us.intro}, с одной стороны, и ${doc.them.intro}, с другой стороны, составили настоящий акт сверки о том, что состояние взаимных расчетов по данным учета следующее:`, { align: AlignmentType.JUSTIFIED, after: 200 }),
        tableAll,
        p('', { after: 160 }),
        endTable,
        p('', { after: 200 }),
        signTable,
      ],
    }],
  })

  return Packer.toBlob(file)
}

export async function exportSettlementWord(doc: SettlementDoc): Promise<void> {
  const blob = await buildSettlementWord(doc)
  // Нативное скачивание через Blob URL — как в остальных выгрузках (reports.ts)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileBaseName(doc)}.docx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
