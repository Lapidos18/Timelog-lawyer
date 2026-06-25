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
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2 }).format(n)
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

// ── PDF через print window (поддержка кириллицы) ─────────────
export function exportToPDF(rows: ReportRow[], title: string, subtitle?: string) {
  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = rows.filter(r => r.is_billable).reduce((s, r) => s + Number(r.amount), 0)

  const rowsHtml = rows.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${formatDate(r.work_date)}</td>
      <td>${r.client_name}</td>
      <td>${r.matter_title}</td>
      <td>${ACTIVITY_LABELS[r.activity_type]}</td>
      <td>${r.description}</td>
      <td style="text-align:right">${Number(r.hours).toFixed(2)}</td>
      <td style="text-align:right">${formatMoney(r.hourly_rate)}</td>
      <td style="text-align:right">${r.is_billable ? formatMoney(r.amount) : '—'}</td>
      <td>${r.performed_by}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 15mm; color: #111; }
  h2 { text-align: center; font-size: 13px; margin-bottom: 4px; }
  .sub { text-align: center; font-size: 10px; color: #555; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e3a5f; color: #fff; padding: 5px 4px; text-align: left; font-size: 9px; }
  td { padding: 4px; border-bottom: 1px solid #ddd; font-size: 9px; }
  tr:nth-child(even) td { background: #f5f7fa; }
  tfoot td { font-weight: bold; border-top: 2px solid #1e3a5f; background: #eef2f7; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h2>${title}</h2>
${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
<table>
  <thead>
    <tr>
      <th>№</th><th>Дата</th><th>Клиент</th><th>Дело</th><th>Вид работы</th>
      <th>Описание</th><th>Часов</th><th>Ставка</th><th>Сумма</th><th>Исполнитель</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    <tr>
      <td colspan="6" style="text-align:right">Итого:</td>
      <td style="text-align:right">${totalHours.toFixed(2)}</td>
      <td></td>
      <td style="text-align:right">${formatMoney(totalAmount)} руб.</td>
      <td></td>
    </tr>
  </tfoot>
</table>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1000,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 500)
}
