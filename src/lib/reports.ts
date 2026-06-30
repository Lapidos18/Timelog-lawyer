import { ReportRow, ACTIVITY_LABELS } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

function formatDate(d: string) {
  return format(new Date(d), 'dd.MM.yyyy', { locale: ru })
}
function formatMinutes(min: number) {
  const h = Math.floor(min / 60); const m = min % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}
function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function formatHours(h: number) {
  return h.toFixed(2).replace('.', ',')
}

// ── Excel ────────────────────────────────────────────────────
export async function exportToExcel(rows: ReportRow[], title: string) {
  const XLSX = await import('xlsx')
  const headers = [
    '№','Дата','Клиент','Дело','№ соглашения','№ дела в суде',
    'Вид работы','Описание','Время','Часов','Ставка, руб.','Сумма, руб.',
    'Оплачиваемо','Исполнитель','Примечания'
  ]
  const data = rows.map((r, i) => [
    i + 1, formatDate(r.work_date), r.client_name, r.matter_title,
    r.agreement_no ?? '', r.case_no ?? '',
    ACTIVITY_LABELS[r.activity_type], r.description,
    formatMinutes(r.duration_min), Number(r.hours),
    Number(r.hourly_rate), Number(r.amount),
    r.is_billable ? 'Да' : 'Нет', r.performed_by, r.notes ?? '',
  ])
  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)
  data.push(['','','','','','','','ИТОГО:','',Math.round(totalHours*100)/100,'',totalAmount,'','',''])
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
  ws['!cols'] = [
    {wch:4},{wch:12},{wch:28},{wch:30},{wch:14},{wch:16},
    {wch:22},{wch:45},{wch:8},{wch:7},{wch:12},{wch:14},
    {wch:13},{wch:22},{wch:25}
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Отчёт')
  XLSX.writeFile(wb, `${title}.xlsx`)
}

// ── PDF — формат юридического отчёта ─────────────────────────
export function exportToPDF(
  rows: ReportRow[],
  title: string,
  subtitle?: string,
  meta?: {
    agreementNo?: string
    agreementDate?: string
    clientName?: string
    matterTitle?: string
    dateFrom?: string
    dateTo?: string
  }
) {
  const billableRows = rows.filter(r => r.is_billable)
  const totalHours   = billableRows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount  = billableRows.reduce((s, r) => s + Number(r.amount), 0)

  // Group by executor for "Детализация по специалистам"
  const byExecutor: Record<string, { rate: number; hours: number; amount: number }> = {}
  for (const r of billableRows) {
    const key = r.performed_by
    if (!byExecutor[key]) byExecutor[key] = { rate: Number(r.hourly_rate), hours: 0, amount: 0 }
    byExecutor[key].hours  += Number(r.hours)
    byExecutor[key].amount += Number(r.amount)
  }

  // Детализация по услугам
  const servicesRows = billableRows.map((r, i) => `
    <tr>
      <td>${formatDate(r.work_date)}</td>
      <td>${r.performed_by}</td>
      <td>${r.description || ACTIVITY_LABELS[r.activity_type]}</td>
      <td class="num">${formatHours(Number(r.hours))}</td>
    </tr>`).join('')

  // Детализация по специалистам
  const executorRows = Object.entries(byExecutor).map(([name, d]) => `
    <tr>
      <td>${name}</td>
      <td class="num">${formatMoney(d.rate)}</td>
      <td class="num">${formatHours(d.hours)}</td>
      <td class="num">${formatMoney(d.amount)}</td>
    </tr>`).join('')

  const periodStr = meta?.dateFrom && meta?.dateTo
    ? `с ${formatDate(meta.dateFrom)} по ${formatDate(meta.dateTo)}`
    : subtitle ?? ''

  const agreementStr = meta?.agreementNo
    ? `Соглашение ${meta.agreementNo}${meta.agreementDate ? ` от ${meta.agreementDate} г.` : ''}`
    : '—'

  const reportNo = title.replace(/[^0-9]/g, '') || '1'
  const reportDate = meta?.dateTo ? formatDate(meta.dateTo) : formatDate(new Date().toISOString().split('T')[0])

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, sans-serif;
    font-size: 10pt;
    color: #000;
    padding: 20mm 20mm 25mm 20mm;
  }
  .header {
    text-align: center;
    margin-bottom: 16px;
  }
  .header h1 {
    font-size: 11pt;
    font-weight: bold;
    margin-bottom: 2px;
  }
  .header h2 {
    font-size: 10pt;
    font-weight: normal;
  }
  .meta {
    margin-bottom: 20px;
    font-size: 10pt;
    line-height: 1.8;
  }
  .meta b { font-weight: bold; }
  h3 {
    font-size: 12pt;
    font-weight: bold;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 20px 0 10px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
    font-size: 9.5pt;
  }
  th {
    border: 1px solid #000;
    padding: 5px 6px;
    font-weight: bold;
    text-align: center;
    background: #f0f0f0;
  }
  td {
    border: 1px solid #000;
    padding: 4px 6px;
    vertical-align: top;
  }
  .num { text-align: right; }
  .total-row td {
    font-weight: bold;
    text-align: right;
    border-top: 2px solid #000;
    text-decoration: underline;
  }
  .footer {
    position: fixed;
    bottom: 10mm;
    left: 20mm;
    right: 20mm;
    font-size: 8pt;
    color: #444;
    border-top: 1px solid #aaa;
    padding-top: 4px;
    display: flex;
    justify-content: space-between;
  }
  @media print {
    body { padding: 15mm; }
    .footer { position: fixed; bottom: 8mm; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Отчёт №${reportNo} от ${reportDate} г.</h1>
  <h2>об оказанных услугах</h2>
</div>

<div class="meta">
  <b>Договор:</b>${agreementStr}<br>
  <b>Валюта:</b>Российский рубль<br>
  <b>Период:</b>${periodStr}
</div>

<h3>Детализация по оказанным услугам</h3>
<table>
  <thead>
    <tr>
      <th style="width:90px">Дата</th>
      <th style="width:140px">Квалификация</th>
      <th>Содержание услуг</th>
      <th style="width:55px">Часы</th>
    </tr>
  </thead>
  <tbody>
    ${servicesRows}
    <tr class="total-row">
      <td colspan="3" style="text-align:right">ИТОГО:</td>
      <td class="num">${formatHours(totalHours)}</td>
    </tr>
  </tbody>
</table>

<h3>Детализация по специалистам</h3>
<table>
  <thead>
    <tr>
      <th>Квалификация</th>
      <th style="width:90px">Ставка</th>
      <th style="width:55px">Часы</th>
      <th style="width:90px">Сумма</th>
    </tr>
  </thead>
  <tbody>
    ${executorRows}
    <tr class="total-row">
      <td colspan="3" style="text-align:right"></td>
      <td class="num">${formatMoney(totalAmount)}</td>
    </tr>
  </tbody>
</table>

<div class="footer">
  <span>Отчёт №${reportNo} от ${reportDate} по Договору №${meta?.agreementNo ?? '—'}</span>
  <span>Стр. 1 из 1</span>
</div>

</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) {
    alert('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и попробуйте снова.')
    return
  }
  w.document.write(html)
  w.document.close()

  // Ждём полной загрузки контента (шрифты, рендеринг) перед печатью
  w.onload = () => {
    w.focus()
    setTimeout(() => {
      w.print()
    }, 300)
  }

  // Закрываем окно после печати/отмены, чтобы не оставался пустой белый таб
  w.onafterprint = () => {
    w.close()
  }
}

// ── Word (DOCX) — формат юридического отчёта ─────────────────
export async function exportToWord(
  rows: ReportRow[],
  title: string,
  meta?: {
    agreementNo?: string
    agreementDate?: string
    clientName?: string
    matterTitle?: string
    dateFrom?: string
    dateTo?: string
  }
) {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType,
  } = await import('docx')
  const { saveAs } = await import('file-saver')

  const billableRows = rows.filter(r => r.is_billable)
  const totalHours  = billableRows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = billableRows.reduce((s, r) => s + Number(r.amount), 0)

  const byExecutor: Record<string, { rate: number; hours: number; amount: number }> = {}
  for (const r of billableRows) {
    const key = r.performed_by
    if (!byExecutor[key]) byExecutor[key] = { rate: Number(r.hourly_rate), hours: 0, amount: 0 }
    byExecutor[key].hours  += Number(r.hours)
    byExecutor[key].amount += Number(r.amount)
  }

  const periodStr = meta?.dateFrom && meta?.dateTo
    ? `с ${formatDate(meta.dateFrom)} по ${formatDate(meta.dateTo)}`
    : ''
  const agreementStr = meta?.agreementNo
    ? `Соглашение ${meta.agreementNo}${meta.agreementDate ? ` от ${meta.agreementDate} г.` : ''}`
    : '—'
  const reportDate = meta?.dateTo ? formatDate(meta.dateTo) : formatDate(new Date().toISOString().split('T')[0])
  const reportNo = title.replace(/[^0-9]/g, '') || '1'

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
    left: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
    right: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
  }

  function headerCell(text: string, width: number) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: cellBorder,
      shading: { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, size: 18 })],
      })],
    })
  }
  function cell(text: string, width: number, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: cellBorder,
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text, size: 18 })] })],
    })
  }

  // Table 1: Детализация по оказанным услугам
  const servicesHeader = new TableRow({
    children: [
      headerCell('Дата', 1200),
      headerCell('Квалификация', 2200),
      headerCell('Содержание услуг', 4800),
      headerCell('Часы', 900),
    ],
  })
  const servicesRows = billableRows.map(r => new TableRow({
    children: [
      cell(formatDate(r.work_date), 1200),
      cell(r.performed_by, 2200),
      cell(r.description || ACTIVITY_LABELS[r.activity_type], 4800),
      cell(formatHours(Number(r.hours)), 900, AlignmentType.RIGHT),
    ],
  }))
  const servicesTotalRow = new TableRow({
    children: [
      new TableCell({
        width: { size: 8200, type: WidthType.DXA }, columnSpan: 3, borders: cellBorder,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'ИТОГО:', bold: true, size: 18 })] })],
      }),
      new TableCell({
        width: { size: 900, type: WidthType.DXA }, borders: cellBorder,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: formatHours(totalHours), bold: true, size: 18 })] })],
      }),
    ],
  })

  // Table 2: Детализация по специалистам
  const execHeader = new TableRow({
    children: [
      headerCell('Квалификация', 3500),
      headerCell('Ставка', 1500),
      headerCell('Часы', 1100),
      headerCell('Сумма', 1500),
    ],
  })
  const execRows = Object.entries(byExecutor).map(([name, d]) => new TableRow({
    children: [
      cell(name, 3500),
      cell(formatMoney(d.rate), 1500, AlignmentType.RIGHT),
      cell(formatHours(d.hours), 1100, AlignmentType.RIGHT),
      cell(formatMoney(d.amount), 1500, AlignmentType.RIGHT),
    ],
  }))
  const execTotalRow = new TableRow({
    children: [
      new TableCell({
        width: { size: 6100, type: WidthType.DXA }, columnSpan: 3, borders: cellBorder,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [] })],
      }),
      new TableCell({
        width: { size: 1500, type: WidthType.DXA }, borders: cellBorder,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: formatMoney(totalAmount), bold: true, size: 18 })] })],
      }),
    ],
  })

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Отчёт №${reportNo} от ${reportDate} г.`, bold: true, size: 24 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [new TextRun({ text: 'об оказанных услугах', size: 22 })],
        }),
        new Paragraph({ children: [new TextRun({ text: 'Договор: ', bold: true, size: 20 }), new TextRun({ text: agreementStr, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: 'Валюта: ', bold: true, size: 20 }), new TextRun({ text: 'Российский рубль', size: 20 })] }),
        new Paragraph({
          spacing: { after: 300 },
          children: [new TextRun({ text: 'Период: ', bold: true, size: 20 }), new TextRun({ text: periodStr, size: 20 })],
        }),

        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 150 },
          children: [new TextRun({ text: 'Детализация по оказанным услугам', bold: true, size: 26 })],
        }),
        new Table({
          width: { size: 9100, type: WidthType.DXA },
          rows: [servicesHeader, ...servicesRows, servicesTotalRow],
        }),

        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 150 },
          children: [new TextRun({ text: 'Детализация по специалистам', bold: true, size: 26 })],
        }),
        new Table({
          width: { size: 7600, type: WidthType.DXA },
          rows: [execHeader, ...execRows, execTotalRow],
        }),

        new Paragraph({
          spacing: { before: 400 },
          children: [new TextRun({
            text: `Отчёт №${reportNo} от ${reportDate} по Договору №${meta?.agreementNo ?? '—'}`,
            size: 16, color: '666666',
          })],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${title}.docx`)
}
