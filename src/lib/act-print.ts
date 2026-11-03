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

export function actCss(doc?: ActDoc): string {
  const subscription=doc?.layout==='subscription'
  return `
  @page{size:A4;margin:${subscription?'10mm 10mm 10mm 13mm':doc?.layout==='fixed'?'15mm 10mm 10mm 13mm':'15mm 10mm 10mm 20mm'}}
  body{margin:0;font-family:${subscription?'Calibri,Arial,sans-serif':"'Times New Roman',Times,serif"};font-size:${subscription?'11':'12'}pt;line-height:1.1}
  @media print{body{margin:0}}
  p.a-t{text-align:center;font-weight:bold;margin:0}
  p.a-pd{display:flex;justify-content:space-between;font-weight:bold;margin:0}
  p.a-p{text-align:justify;text-indent:10mm;margin:0}
  p.a-clause{display:block;text-indent:10mm}
  .a-num{display:inline-block;width:15mm;text-indent:0}
  .a-text{display:inline}
  p.a-b{font-weight:bold}
  p.a-sp{margin:0;height:12pt}
  table.a-tbl{margin:4pt 0 10pt;table-layout:fixed}
  table.a-tbl th,table.a-tbl td{font-size:12pt;padding:0 4pt;border:1px solid #000;text-align:center;vertical-align:middle;line-height:1.05}
  table.a-tbl th{background:#eaeaea;padding:10pt 4pt}
  table.a-tbl td.l{text-align:left}
  table.a-tbl tr.b td{font-weight:bold}
  table.a-sg{table-layout:fixed;margin:6pt 0 0}
  table.a-sg td{border:none;padding:0 6pt 0 6pt;font-size:${subscription?'11':'12'}pt;vertical-align:top;line-height:1.1}
  table.a-sg tr.a-signature td{padding-top:18mm}
  @media print{table.a-sg,p.a-p{break-inside:avoid;page-break-inside:avoid}}
`
}

const e = escapeHtml

export function actTextRuns(b: Extract<ActBlock,{kind:'para'}>): {text:string;bold?:boolean}[] {
  if(!b.emphasis?.length)return [{text:b.text,bold:b.bold}]
  const words=Array.from(new Set(b.emphasis)).filter(Boolean).sort((a,b)=>b.length-a.length)
  const expression=new RegExp('('+words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi')
  return b.text.split(expression).filter(Boolean).map(text=>({text,bold:words.some(w=>w.toLowerCase()===text.toLowerCase())}))
}

function signatureParts(lines:string[]) {
  const index=lines.findIndex(line=>line.startsWith('___'))
  if(index<0)return {details:lines,signature:[] as string[]}
  const details=lines.slice(0,index)
  while(details.at(-1)==='')details.pop()
  return {details,signature:lines.slice(index)}
}

function blockHtml(b: ActBlock): string {
  switch (b.kind) {
    case 'title':
      return `<p class="a-t">${e(b.text)}</p>`
    case 'placeDate':
      return `<p class="a-pd"><span>${e(b.place)}</span><span>${e(b.date)}</span></p>`
    case 'spacer':
      return '<p class="a-sp"></p>'
    case 'para':
      const content=actTextRuns(b).map(r=>r.bold?`<strong>${e(r.text)}</strong>`:e(r.text)).join('')
      return b.number?`<p class="a-p a-clause"><span class="a-num">${b.number}.</span><span class="a-text">${content}</span></p>`:`<p class="a-p${b.bold ? ' a-b' : ''}">${content}</p>`
    case 'table': {
      const head = b.head.map(h => `<th>${e(h).replace('Стоимость 1','Стоимость<br> 1')}</th>`).join('')
      const body = b.rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${e(c)}</td>`).join('')}</tr>`).join('')
      const total = `<tr class="b">${b.total.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${e(c)}</td>`).join('')}</tr>`
      return `<table class="a-tbl"><colgroup><col style="width:21%"><col style="width:24%"><col style="width:24%"><col style="width:31%"></colgroup><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>`
    }
    case 'signs': {
      const col = (lines: string[]) => lines.map((l,i) => (l ? i<2||(i===2&&lines[1]==='Адвокатский кабинет')?`<strong>${e(l)}</strong>`:e(l) : '&nbsp;')).join('<br>')
      const signature=(lines:string[])=>lines.map(l=>`<div${l==='м.п.'?' style="text-align:center"':''}>${e(l)}</div>`).join('')
      const left=signatureParts(b.left),right=signatureParts(b.right)
      return `<table class="a-sg"><colgroup><col style="width:50%"><col style="width:50%"></colgroup>` +
        `<tr><td>${col(left.details)}</td><td>${col(right.details)}</td></tr><tr class="a-signature"><td>${signature(left.signature)}</td><td>${signature(right.signature)}</td></tr></table>`
    }
  }
}

export function actBodyHtml(doc: ActDoc): string {
  return doc.blocks.map(blockHtml).join('\n')
}

/** Печать / «Сохранить как PDF». false — браузер заблокировал окно */
export function printActDoc(doc: ActDoc): boolean {
  return printDocument(doc.fileName, actBodyHtml(doc), actCss(doc))
}

// ── Word ────────────────────────────────────────────────────────────────

/** Собирает файл Word. Отдельно от скачивания, чтобы собранное можно было проверить без браузера */
export async function buildActWord(doc: ActDoc): Promise<Blob> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, Tab,
    WidthType, AlignmentType, BorderStyle, TabStopType, TableLayoutType, VerticalAlign,
  } = await import('docx')

  const subscription=doc.layout==='subscription'
  const FONT = subscription?'Calibri':'Times New Roman'
  const SIZE = subscription?22:24
  // A4 11907 − поля слева 1134 и справа 567 = ширина текста
  const WIDTH = 11907 - (doc.layout==='fixed'||subscription?737:1134) - 567

  const run = (text: string, bold?: boolean, size = SIZE) => new TextRun({ text, bold, font: FONT, size })
  const para = (text: string, o: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number;keepNext?:boolean } = {}) =>
    new Paragraph({ alignment: o.align, keepNext:o.keepNext, spacing: { after: o.after ?? 0 }, children: [run(text, o.bold)] })

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
        children.push(new Paragraph({alignment:AlignmentType.JUSTIFIED,
          indent:{firstLine:567},tabStops:b.number?[{type:TabStopType.LEFT,position:1440}]:undefined,
          spacing:{after:0},
          children:[...(b.number?[run(String(b.number)+'.'),new TextRun({children:[new Tab()]})]:[]),
            ...actTextRuns(b).map(r=>run(r.text,r.bold))]}))
        break
      case 'table': {
        const W = [Math.round(WIDTH*.21), Math.round(WIDTH*.24), Math.round(WIDTH*.24), WIDTH-Math.round(WIDTH*.21)-2*Math.round(WIDTH*.24)]
        const cell = (text: string, w: number, o: { bold?: boolean; left?: boolean; header?:boolean } = {}) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA }, borders: boxed, verticalAlign: VerticalAlign.CENTER,
            shading:o.header?{fill:'EAEAEA'}:undefined,
            margins: { top: o.header?120:0, bottom: o.header?120:0, left: 100, right: 100 },
            children: (o.header&&text==='Стоимость 1 чел-ч'?['Стоимость','1 чел-ч']:[text]).map(part=>new Paragraph({
              alignment: o.left ? AlignmentType.LEFT : AlignmentType.CENTER,
              children: [run(part, o.bold, 24)],
            })),
          })
        const rows = [
          new TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h,W[i],{bold:true,header:true})) }),
          ...b.rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, W[i], { left: i === 0 })) })),
          new TableRow({ cantSplit: true, children: b.total.map((c, i) => cell(c, W[i], { bold: true, left: i === 0 })) }),
        ]
        children.push(new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: W, layout: TableLayoutType.FIXED, rows }))
        break
      }
      case 'signs': {
        children.push(para('',{keepNext:true}))
        const half = Math.floor(WIDTH / 2)
        const col = (lines: string[],signature=false) => new TableCell({
          width: { size: half, type: WidthType.DXA }, borders: bare,
          margins:{top:signature?1020:0,bottom:0,left:100,right:100},
          children: lines.length?lines.map((l,i) => para(l,{bold:!signature&&(i<2||(i===2&&lines[1]==='Адвокатский кабинет')),keepNext:!signature,align:l==='м.п.'?AlignmentType.CENTER:undefined})):[para('',{keepNext:!signature})],
        })
        const left=signatureParts(b.left),right=signatureParts(b.right)
        children.push(new Table({
          width: { size: half * 2, type: WidthType.DXA }, columnWidths: [half, half], layout: TableLayoutType.FIXED,
          rows: [new TableRow({ cantSplit: true, children: [col(left.details), col(right.details)] }),
            new TableRow({cantSplit:true,children:[col(left.signature,true),col(right.signature,true)]})],
        }))
        break
      }
    }
  }

  const file = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { size: { width: 11907, height: 16839 }, margin: { top: subscription?567:851, right: 567, bottom: 567, left: subscription?737:1134 } } },
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
