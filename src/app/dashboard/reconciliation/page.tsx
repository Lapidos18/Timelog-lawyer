'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, Matter, ACTIVITY_LABELS } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileDown, FileSpreadsheet, Plus, Trash2, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'

interface Payment {
  id: string
  client_id: string
  matter_id: string | null
  pay_date: string
  amount: number
  description: string
  doc_no: string | null
  created_at: string
}

interface ServiceRow {
  id: string
  work_date: string
  matter_title: string
  agreement_no: string | null
  activity_type: string
  description: string
  hours: number
  hourly_rate: number
  amount: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDate(s: string) {
  return format(new Date(s), 'dd.MM.yyyy')
}

export default function ReconciliationPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [selectedClient, setSelectedClient] = useState('')
  const [dateFrom, setDateFrom] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [services, setServices] = useState<ServiceRow[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [generated, setGenerated] = useState(false)
  const [loading, setLoading] = useState(false)

  // Payment form
  const [showPayForm, setShowPayForm] = useState(false)
  const [payForm, setPayForm] = useState({
    pay_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    description: 'Оплата юридических услуг',
    doc_no: '',
    matter_id: '',
  })
  const [savingPay, setSavingPay] = useState(false)

  useEffect(() => {
    supabase.from('clients').select('*').order('name').then(({ data }) => setClients(data ?? []))
    supabase.from('matters').select('*, clients(*)').order('title').then(({ data }) => setMatters((data ?? []) as any))
  }, [])

  const clientMatters = matters.filter(m => m.client_id === selectedClient)

  async function generate() {
    if (!selectedClient) { toast.error('Выберите клиента'); return }
    setLoading(true)
    const [svcRes, payRes] = await Promise.all([
      supabase.from('report_view').select('*')
        .eq('client_name', clients.find(c => c.id === selectedClient)?.name ?? '')
        .gte('work_date', dateFrom).lte('work_date', dateTo)
        .eq('is_billable', true).order('work_date'),
      supabase.from('payments').select('*')
        .eq('client_id', selectedClient)
        .gte('pay_date', dateFrom).lte('pay_date', dateTo)
        .order('pay_date'),
    ])
    setServices((svcRes.data ?? []).map((r: any) => ({
      id: r.id, work_date: r.work_date, matter_title: r.matter_title,
      agreement_no: r.agreement_no, activity_type: r.activity_type,
      description: r.description, hours: Number(r.hours),
      hourly_rate: Number(r.hourly_rate), amount: Number(r.amount),
    })))
    setPayments(payRes.data ?? [])
    setGenerated(true)
    setLoading(false)
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClient) return
    setSavingPay(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('payments').insert({
      client_id: selectedClient,
      matter_id: payForm.matter_id || null,
      pay_date: payForm.pay_date,
      amount: parseFloat(payForm.amount),
      description: payForm.description,
      doc_no: payForm.doc_no || null,
      created_by: user!.id,
    })
    if (error) { toast.error('Ошибка: ' + error.message) }
    else {
      toast.success('Платёж добавлен')
      setShowPayForm(false)
      setPayForm({ pay_date: format(new Date(), 'yyyy-MM-dd'), amount: '', description: 'Оплата юридических услуг', doc_no: '', matter_id: '' })
      if (generated) generate()
    }
    setSavingPay(false)
  }

  async function deletePayment(id: string) {
    if (!confirm('Удалить платёж?')) return
    await supabase.from('payments').delete().eq('id', id)
    toast.success('Удалено')
    if (generated) generate()
  }

  const totalServices = services.reduce((s, r) => s + r.amount, 0)
  const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0)
  const balance = totalServices - totalPayments
  const client = clients.find(c => c.id === selectedClient)

  function exportPDF() {
    if (!generated) return
    const period = `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`
    const balLabel = balance > 0 ? 'Задолженность доверителя' : balance < 0 ? 'Переплата доверителя' : 'Сальдо'

    const svcRows = services.map((r, i) => `
      <tr>
        <td>${i+1}</td><td>${fmtDate(r.work_date)}</td><td>${r.matter_title}</td>
        <td>${ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS]}</td>
        <td>${r.description}</td>
        <td style="text-align:right">${r.hours.toFixed(2)}</td>
        <td style="text-align:right">${fmt(r.hourly_rate)}</td>
        <td style="text-align:right">${fmt(r.amount)}</td>
      </tr>`).join('')

    const payRows = payments.map((p, i) => `
      <tr>
        <td>${i+1}</td><td>${fmtDate(p.pay_date)}</td>
        <td>${p.doc_no ?? '—'}</td><td>${p.description}</td>
        <td style="text-align:right">${fmt(p.amount)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>Акт сверки</title>
<style>
  body{font-family:Arial,sans-serif;font-size:10px;margin:15mm;color:#111}
  h2{text-align:center;font-size:14px;margin-bottom:4px}
  .sub{text-align:center;font-size:10px;color:#555;margin-bottom:6px}
  .meta{font-size:10px;margin-bottom:14px}
  h3{font-size:11px;margin:14px 0 4px}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  th{background:#1e3a5f;color:#fff;padding:5px 4px;font-size:9px;text-align:left}
  td{padding:4px;border-bottom:1px solid #ddd;font-size:9px}
  tr:nth-child(even) td{background:#f5f7fa}
  tfoot td{font-weight:bold;border-top:2px solid #1e3a5f;background:#eef2f7}
  .balance{font-size:12px;font-weight:bold;margin:16px 0;padding:10px;background:#f0f4f8;border-left:4px solid #1e3a5f}
  .signs{margin-top:30px;display:flex;justify-content:space-between;font-size:10px}
  .sign-block{width:45%}
  @media print{body{margin:10mm}}
</style></head><body>
<h2>АКТ СВЕРКИ ВЗАИМОРАСЧЁТОВ</h2>
<div class="sub">за период: ${period}</div>
<div class="meta">
  <b>Адвокат:</b> Адвокатский кабинет Бухмина Антона Андреевича, рег. № 54/1831, ИНН 540233730471<br>
  <b>Доверитель:</b> ${client?.name ?? ''}${client?.inn ? `, ИНН ${client.inn}` : ''}
</div>
<h3>Оказанные услуги</h3>
<table>
  <thead><tr><th>№</th><th>Дата</th><th>Дело</th><th>Вид работы</th><th>Описание</th><th>Часов</th><th>Ставка</th><th>Сумма, руб.</th></tr></thead>
  <tbody>${svcRows}</tbody>
  <tfoot><tr><td colspan="7" style="text-align:right">Итого:</td><td style="text-align:right">${fmt(totalServices)}</td></tr></tfoot>
</table>
<h3>Поступившие оплаты</h3>
<table>
  <thead><tr><th>№</th><th>Дата</th><th>№ документа</th><th>Назначение</th><th>Сумма, руб.</th></tr></thead>
  <tbody>${payRows.length ? payRows : '<tr><td colspan="5" style="text-align:center;color:#999">Платежей не поступало</td></tr>'}</tbody>
  <tfoot><tr><td colspan="4" style="text-align:right">Итого:</td><td style="text-align:right">${fmt(totalPayments)}</td></tr></tfoot>
</table>
<div class="balance">${balLabel}: ${fmt(Math.abs(balance))} руб.</div>
<div class="signs">
  <div class="sign-block">
    <b>Адвокат:</b><br><br>
    _________________________ /А.А. Бухмин/
  </div>
  <div class="sign-block">
    <b>Доверитель:</b><br><br>
    _________________________ /${client?.name ?? ''}/
  </div>
</div>
</body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) {
      toast.error('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для сайта.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 400)
    toast.success('Откроется диалог печати — выберите «Сохранить как PDF»')
  }

  async function exportExcel() {
    if (!generated) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const header = [
      [`АКТ СВЕРКИ ВЗАИМОРАСЧЁТОВ`],
      [`Период: ${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`],
      [`Адвокат: АК Бухмин А.А., рег. № 54/1831`],
      [`Доверитель: ${client?.name ?? ''}${client?.inn ? `  ИНН ${client.inn}` : ''}`],
      [],
      ['ОКАЗАННЫЕ УСЛУГИ'],
      ['№','Дата','Дело','Вид работы','Описание','Часов','Ставка','Сумма'],
      ...services.map((r, i) => [
        i+1, fmtDate(r.work_date), r.matter_title,
        ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS],
        r.description, r.hours, r.hourly_rate, r.amount
      ]),
      ['','','','','','','Итого:', totalServices],
      [],
      ['ПОСТУПИВШИЕ ОПЛАТЫ'],
      ['№','Дата','№ документа','Назначение','Сумма'],
      ...payments.map((p, i) => [i+1, fmtDate(p.pay_date), p.doc_no ?? '', p.description, Number(p.amount)]),
      ['','','','Итого:', totalPayments],
      [],
      [balance > 0 ? 'Задолженность доверителя:' : 'Переплата:', Math.abs(balance)],
    ]

    const ws = XLSX.utils.aoa_to_sheet(header)
    ws['!cols'] = [{wch:4},{wch:12},{wch:25},{wch:22},{wch:40},{wch:8},{wch:12},{wch:14}]
    XLSX.utils.book_append_sheet(wb, ws, 'Акт сверки')
    XLSX.writeFile(wb, `Акт_сверки_${client?.name ?? ''}_${dateFrom}_${dateTo}.xlsx`)
    toast.success('Excel сохранён')
  }

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-navy-100">Акт сверки</h1>
        {generated && (
          <div className="flex gap-2">
            <button onClick={exportExcel} className="btn-secondary">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button onClick={exportPDF} className="btn-secondary">
              <FileDown className="w-4 h-4" /> PDF
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div className="col-span-2">
            <label className="label">Клиент *</label>
            <select className="select" value={selectedClient}
              onChange={e => { setSelectedClient(e.target.value); setGenerated(false) }}>
              <option value="">— выберите клиента —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Период с</label>
            <input type="date" className="input" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setGenerated(false) }} />
          </div>
          <div>
            <label className="label">Период по</label>
            <input type="date" className="input" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setGenerated(false) }} />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={generate} disabled={loading} className="btn-primary">
            {loading ? 'Загрузка...' : 'Сформировать акт'}
          </button>
          {selectedClient && (
            <button onClick={() => setShowPayForm(true)} className="btn-secondary">
              <Plus className="w-4 h-4" /> Добавить платёж
            </button>
          )}
        </div>
      </div>

      {/* Payment form */}
      {showPayForm && (
        <div className="card mb-5 border-gold-800/40">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-navy-200 text-sm">Новый платёж</h2>
            <button onClick={() => setShowPayForm(false)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={addPayment} className="grid grid-cols-4 gap-3">
            <div>
              <label className="label">Дата *</label>
              <input type="date" className="input" required value={payForm.pay_date}
                onChange={e => setPayForm(f => ({ ...f, pay_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Сумма, руб. *</label>
              <input type="number" className="input" required placeholder="50000"
                value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">№ п/п или квитанции</label>
              <input type="text" className="input" placeholder="123"
                value={payForm.doc_no} onChange={e => setPayForm(f => ({ ...f, doc_no: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дело (необязательно)</label>
              <select className="select" value={payForm.matter_id}
                onChange={e => setPayForm(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">— любое —</option>
                {clientMatters.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
            <div className="col-span-4">
              <label className="label">Назначение платежа</label>
              <input type="text" className="input" value={payForm.description}
                onChange={e => setPayForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-4 flex gap-3">
              <button type="submit" disabled={savingPay} className="btn-primary">
                <Check className="w-4 h-4" /> {savingPay ? 'Сохраняю...' : 'Добавить платёж'}
              </button>
              <button type="button" onClick={() => setShowPayForm(false)} className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Result */}
      {generated && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-4 md:mb-5">
            <div className="stat-card">
              <p className="text-xs text-navy-400">Оказано услуг</p>
              <p className="text-2xl font-semibold text-navy-100">{fmt(totalServices)} ₽</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-navy-400">Оплачено</p>
              <p className="text-2xl font-semibold text-emerald-400">{fmt(totalPayments)} ₽</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-navy-400">{balance >= 0 ? 'Задолженность доверителя' : 'Переплата'}</p>
              <p className={`text-2xl font-semibold ${balance > 0 ? 'text-red-400' : balance < 0 ? 'text-gold-400' : 'text-emerald-400'}`}>
                {fmt(Math.abs(balance))} ₽
              </p>
            </div>
          </div>

          {/* Services */}
          <div className="card mb-4">
            <h2 className="font-medium text-navy-200 mb-4 text-sm">Оказанные услуги</h2>
            {services.length === 0 ? (
              <p className="text-navy-500 text-sm text-center py-6">Нет оказанных услуг за период</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','Дело','Вид работы','Описание','Часов','Ставка','Сумма'].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {services.map((r, i) => (
                    <tr key={r.id} className="border-b border-navy-800/40 hover:bg-navy-800/30">
                      <td className="py-2 pr-3 text-navy-600">{i+1}</td>
                      <td className="py-2 pr-3 font-mono text-navy-400">{fmtDate(r.work_date)}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[140px] truncate">{r.matter_title}</td>
                      <td className="py-2 pr-3 text-navy-400">{ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS]}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[160px] truncate">{r.description}</td>
                      <td className="py-2 pr-3 text-right font-mono text-navy-300">{r.hours.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-navy-400">{fmt(r.hourly_rate)}</td>
                      <td className="py-2 text-right font-mono text-gold-400">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={7} className="pt-2 text-right text-navy-400 font-medium pr-3 text-xs">Итого:</td>
                    <td className="pt-2 text-right font-mono font-semibold text-gold-400 text-xs">{fmt(totalServices)} ₽</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Payments */}
          <div className="card">
            <h2 className="font-medium text-navy-200 mb-4 text-sm">Поступившие оплаты</h2>
            {payments.length === 0 ? (
              <p className="text-navy-500 text-sm text-center py-6">
                Нет платежей за период.{' '}
                <button onClick={() => setShowPayForm(true)} className="text-gold-400 hover:underline">
                  Добавить →
                </button>
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','№ документа','Назначение','Сумма',''].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={p.id} className="border-b border-navy-800/40 hover:bg-navy-800/30">
                      <td className="py-2 pr-3 text-navy-600">{i+1}</td>
                      <td className="py-2 pr-3 font-mono text-navy-400">{fmtDate(p.pay_date)}</td>
                      <td className="py-2 pr-3 text-navy-400">{p.doc_no ?? '—'}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[200px] truncate">{p.description}</td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-400">{fmt(p.amount)} ₽</td>
                      <td className="py-2">
                        <button onClick={() => deletePayment(p.id)}
                          className="btn-ghost p-1 hover:text-red-400 hover:bg-red-900/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={4} className="pt-2 text-right text-navy-400 font-medium pr-3">Итого:</td>
                    <td className="pt-2 text-right font-mono font-semibold text-emerald-400">{fmt(totalPayments)} ₽</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
