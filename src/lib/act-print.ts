/**
 * Печать (PDF) и Word акта об оказании услуг. Состав и тексты — в act-doc.ts;
 * здесь только вёрстка. Лист A4, поля как в образце адвоката: слева 20 мм,
 * справа и снизу 10 мм, сверху 15 мм; Times New Roman 12 pt.
 *
 * Весь пользовательский текст в HTML идёт через escapeHtml (CLAUDE.md,
 * раздел про src/lib/html.ts).
 */
import { escapeHtml } from './html'
import { printDocument } from './print'
import { ActDoc, ActBlock } from './act-doc'

export function actCss(): string {
  return `
  @page{size:A4;margin:15mm 10mm 10mm 20mm}
  body{margin:0;font-size:12pt;line-height:1.2}
  @media print{body{margin:0}}
  p.a-t{text-align:center;font-weight:bold;margin:0}
  p.a-pd{display:flex;justify-content:space-between;font-weight:bold;margin:0}
  p.a-p{text-align:justify;margin:0 0 8pt}
  p.a-b{font-weight:bold}
  p.a-sp{margin:0;height:12pt}
  table.a-tbl{margin:4pt 0 10pt}
  table.a-tbl th,table.a-tbl td{font-size:11pt;padding:3pt 5pt;border:1px solid #000;text-align:center;vertical-align:middle}
  table.a-tbl td.l{text-align:left}
  table.a-tbl tr.b td{font-weight:bold}
  table.a-sg{table-layout:fixed;margin:6pt 0 0}
  table.a-sg td{border:none;padding:0 6pt 0 0;font-size:12pt;vertical-align:top;line-height:1.25}
  @media print{table.a-sg,p.a-p{break-inside:avoid;page-break-inside:avoid}}
`
}

const e = escapeHtml

function blockHtml(b: ActBlock): string {
  switch (b.kind) {
    case 'title':
      return `<p class="a-t">${e(b.text)}</p>`
    case 'placeDate':
      return `<p class="a-pd"><span>${e(b.place)}</span><span>${e(b.date)}</span></p>`
    case 'spacer':
      return '<p class="a-sp"></p>'
    case 'para':
      return `<p class="a-p${b.bold ? ' a-b' : ''}">${e(b.text)}</p>`
    case 'table': {
      const head = b.head.map(h => `<th>${e(h)}</th>`).join('')
      const body = b.rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${e(c)}</td>`).join('')}</tr>`).join('')
      const total = `<tr class="b">${b.total.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${e(c)}</td>`).join('')}</tr>`
      return `<table class="a-tbl"><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>`
    }
    case 'signs': {
      const col = (lines: string[]) => lines.map(l => (l ? e(l) : '&nbsp;')).join('<br>')
      return `<table class="a-sg"><colgroup><col style="width:50%"><col style="width:50%"></colgroup>` +
        `<tr><td>${col(b.left)}</td><td>${col(b.right)}</td></tr></table>`
    }
  }
}

export function actBodyHtml(doc: ActDoc): string {
  return doc.blocks.map(blockHtml).join('\n')
}

/** Печать / «Сохранить как PDF». false — браузер заблокировал окно */
export function printActDoc(doc: ActDoc): boolean {
  return printDocument(e(doc.fileName), actBodyHtml(doc), actCss())
}

// ── Word ────────────────────────────────────────────────────────────────

/** Собирает файл Word. Отдельно от скачивания, чтобы собранное можно было проверить без браузера */
export async function buildActWord(doc: ActDoc): Promise<Blob> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, Tab,
    WidthType, AlignmentType, BorderStyle, TabStopType, TableLayoutType, VerticalAlign,
  } = await import('docx')

  const FONT = 'Times New Roman'
  const SIZE = 24 // 12 pt
  // A4 11907 − поля слева 1134 и справа 567 = ширина текста
  const WIDTH = 11907 - 1134 - 567

  const run = (text: string, bold?: boolean, size = SIZE) => new TextRun({ text, bold, font: FONT, size })
  const para = (text: string, o: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) =>
    new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 0 }, children: [run(text, o.bold)] })

  const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const boxed = { top: line, bottom: line, left: line, right: line }
  const bare = { top: none, bottom: none, left: none, right: none }

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'title':
        children.push(para(b.text, { bold: true, align: AlignmentType.CENTER }))
        break
      case 'spacer':
        children.push(para(''))
        break
      case 'placeDate':
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
          children: [
            new TextRun({ text: b.place, bold: true, font: FONT, size: SIZE }),
            new TextRun({ children: [new Tab(), b.date], bold: true, font: FONT, size: SIZE }),
          ],
        }))
        break
      case 'para':
        children.push(para(b.text, { bold: b.bold, align: AlignmentType.JUSTIFIED, after: 160 }))
        break
      case 'table': {
        const W = [3500, 2250, 2150, WIDTH - 3500 - 2250 - 2150]
        const cell = (text: string, w: number, o: { bold?: boolean; left?: boolean } = {}) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA }, borders: boxed, verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: o.left ? AlignmentType.LEFT : AlignmentType.CENTER,
              children: [run(text, o.bold, 22)],
            })],
          })
        const rows = [
          new TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h, W[i], { bold: true })) }),
          ...b.rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, W[i], { left: i === 0 })) })),
          new TableRow({ cantSplit: true, children: b.total.map((c, i) => cell(c, W[i], { bold: true, left: i === 0 })) }),
        ]
        children.push(new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: W, layout: TableLayoutType.FIXED, rows }))
        children.push(para('', { after: 120 }))
        break
      }
      case 'signs': {
        const half = Math.floor(WIDTH / 2)
        const col = (lines: string[]) => new TableCell({
          width: { size: half, type: WidthType.DXA }, borders: bare,
          children: lines.map(l => para(l)),
        })
        children.push(new Table({
          width: { size: half * 2, type: WidthType.DXA }, columnWidths: [half, half], layout: TableLayoutType.FIXED,
          rows: [new TableRow({ cantSplit: true, children: [col(b.left), col(b.right)] })],
        }))
        break
      }
    }
  }

  const file = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { size: { width: 11907, height: 16839 }, margin: { top: 851, right: 567, bottom: 567, left: 1134 } } },
      children,
    }],
  })
  return Packer.toBlob(file)
}

export async function exportActWord(doc: ActDoc): Promise<void> {
  const blob = await buildActWord(doc)
  // Нативное скачивание через Blob URL — как в остальных выгрузках (reports.ts)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${doc.fileName}.docx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
