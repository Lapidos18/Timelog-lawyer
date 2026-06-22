import { ReportRow, ACTIVITY_LABELS } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

function formatDate(d: string) {
  return format(new Date(d), 'dd.MM.yyyy', { locale: ru })
}

function formatMinutes(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2 }).format(n)
}

// ── Excel ────────────────────────────────────────────────────
export async function exportToExcel(rows: ReportRow[], title: string) {
  const XLSX = await import('xlsx')

  const headers = [
    '№', 'Дата', 'Клиент', 'Дело', '№ соглашения', '№ дела в суде',
    'Вид работы', 'Описание', 'Время', 'Часов', 'Ставка, руб.', 'Сумма, руб.',
    'Оплачиваемо', 'Исполнитель', 'Примечания'
  ]

  const data = rows.map((r, i) => [
    i + 1,
    formatDate(r.work_date),
    r.client_name,
    r.matter_title,
    r.agreement_no ?? '',
    r.case_no ?? '',
    ACTIVITY_LABELS[r.activity_type],
    r.description,
    formatMinutes(r.duration_min),
    Number(r.hours),
    Number(r.hourly_rate),
    Number(r.amount),
    r.is_billable ? 'Да' : 'Нет',
    r.performed_by,
    r.notes ?? '',
  ])

  // Итоговая строка
  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)
  data.push([
    '', '', '', '', '', '', '', 'ИТОГО:',
    '', Math.round(totalHours * 100) / 100, '', totalAmount,
    '', '', ''
  ])

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

  // Ширины столбцов
  ws['!cols'] = [
    {wch:4}, {wch:12}, {wch:28}, {wch:30}, {wch:14}, {wch:16},
    {wch:22}, {wch:45}, {wch:8}, {wch:7}, {wch:12}, {wch:14},
    {wch:13}, {wch:22}, {wch:25}
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Отчёт')
  XLSX.writeFile(wb, `${title}.xlsx`)
}

// ── PDF ──────────────────────────────────────────────────────
export async function exportToPDF(rows: ReportRow[], title: string, subtitle?: string) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Шрифт для кириллицы нужен — используем встроенный Helvetica с транслитерацией
  // или подключаем кастомный. Для простоты транслитерируем только заголовки,
  // тело генерируем через autoTable который поддерживает UTF-8 при правильном шрифте.
  // В реальном деплое нужно добавить кириллический шрифт через addFont.

  doc.setFontSize(14)
  doc.text(title, 148, 15, { align: 'center' })
  if (subtitle) {
    doc.setFontSize(10)
    doc.text(subtitle, 148, 22, { align: 'center' })
  }

  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)

  autoTable(doc, {
    startY: 28,
    head: [[
      '№', 'Дата', 'Клиент', 'Дело', 'Вид работы', 'Описание',
      'Часов', 'Ставка', 'Сумма', 'Исполнитель'
    ]],
    body: [
      ...rows.map((r, i) => [
        i + 1,
        formatDate(r.work_date),
        r.client_name,
        r.matter_title,
        ACTIVITY_LABELS[r.activity_type],
        r.description,
        Number(r.hours).toFixed(2),
        formatMoney(r.hourly_rate),
        r.is_billable ? formatMoney(r.amount) : '—',
        r.performed_by,
      ]),
      ['', '', '', '', '', 'ИТОГО:',
        totalHours.toFixed(2), '', formatMoney(totalAmount), '']
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 20 },
      2: { cellWidth: 35 },
      3: { cellWidth: 35 },
      4: { cellWidth: 28 },
      5: { cellWidth: 55 },
      6: { cellWidth: 14 },
      7: { cellWidth: 18 },
      8: { cellWidth: 20 },
      9: { cellWidth: 27 },
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    foot: [],
  })

  doc.save(`${title}.pdf`)
}
