'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, Matter, ACTIVITY_LABELS, ReimbursableExpense } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileDown, FileSpreadsheet, Plus, Trash2, X, Check, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import { escapeHtml } from '@/lib/html'
import PageHeader from '@/components/PageHeader'
import { printDocument, CABINET_LINE } from '@/lib/print'

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
  // Издержки, предъявленные доверителю за период. Он оплачивает их вместе с
  // вознаграждением, поэтому в сверке это отдельная строка НАЧИСЛЕНИЯ,
  // а не вычет из платежей.
  const [reimb, setReimb] = useState<ReimbursableExpense[]>([])
  const [generated, setGenerated] = useState(false)
  const [loading, setLoading] = useState(false)

  // Payment form
  const [showPayForm, setShowPayForm] = useState(false)
  // Форма поступления самостоятельна: свой выбор доверителя, не зависящий от
  // фильтра акта сверки вверху. Пустой client_id = доход без доверителя
  // (вознаграждение по назначению и т.п.) — он уходит в manual_income.
  const [payForm, setPayForm] = useState({
    client_id: '',
    pay_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    description: 'Оплата юридических услуг',
    doc_no: '',
    matter_id: '',
  })
  const [savingPay, setSavingPay] = useState(false)
  // id редактируемого платежа. Раньше исправить сумму можно было только
  // удалением и повторным вводом — легко потерять привязку издержек.
  const [editPayId, setEditPayId] = useState<string | null>(null)
  const payFormRef = useRef<HTMLDivElement>(null)

  // Возмещаемые расходы доверителя, которые ещё не компенсированы.
  // Платёж от доверителя обычно включает и вознаграждение, и компенсацию издержек;
  // отмеченные здесь суммы не попадут в доход при расчёте НДФЛ.
  const [openReimb, setOpenReimb] = useState<ReimbursableExpense[]>([])
  const [coveredReimb, setCoveredReimb] = useState<string[]>([])

  useEffect(() => {
    supabase.from('clients').select('*').order('name').then(({ data }) => setClients(data ?? []))
    supabase.from('matters').select('*, clients(*)').order('title').then(({ data }) => setMatters((data ?? []) as any))
  }, [])

  const clientMatters = matters.filter(m => m.client_id === selectedClient)

  // Невозмещённые расходы того доверителя, который выбран В ФОРМЕ поступления.
  // При редактировании добавляем ещё и те, что уже привязаны к этому платежу —
  // иначе они пропали бы из списка и галочку с них нельзя было бы снять.
  useEffect(() => {
    if (!payForm.client_id) { setOpenReimb([]); setCoveredReimb([]); return }
    const matterIds = matters.filter(m => m.client_id === payForm.client_id).map(m => m.id)
    if (matterIds.length === 0) { setOpenReimb([]); setCoveredReimb([]); return }
    let q = supabase.from('reimbursable_expenses')
      .select('*, matters(title)')
      .in('matter_id', matterIds)
    q = editPayId
      ? q.or(`status.neq.reimbursed,payment_id.eq.${editPayId}`)
      : q.neq('status', 'reimbursed')
    q.order('expense_date').then(({ data }) => {
      const rows = (data ?? []) as ReimbursableExpense[]
      setOpenReimb(rows)
      // Уже привязанные к этому платежу отмечаем сразу
      setCoveredReimb(editPayId
        ? rows.filter(r => r.payment_id === editPayId).map(r => r.id)
        : [])
    })
  }, [payForm.client_id, matters, editPayId])

  const coveredTotal = openReimb
    .filter(r => coveredReimb.includes(r.id))
    .reduce((s, r) => s + Number(r.amount), 0)

  async function generate() {
    if (!selectedClient) { toast.error('Выберите доверителя'); return }
    setLoading(true)
    const matterIds = matters.filter(m => m.client_id === selectedClient).map(m => m.id)
    const [svcRes, payRes, reimbRes] = await Promise.all([
      supabase.from('report_view').select('*')
        .eq('client_id', selectedClient)
        .gte('work_date', dateFrom).lte('work_date', dateTo)
        .eq('is_billable', true).order('work_date'),
      supabase.from('payments').select('*')
        .eq('client_id', selectedClient)
        .gte('pay_date', dateFrom).lte('pay_date', dateTo)
        .order('pay_date'),
      // Издержки берём по дате РАСХОДА: они относятся к работе того периода,
      // когда были понесены, даже если деньги пришли позже.
      // «Ожидает включения в счёт» не берём — доверителю ещё не предъявлено.
      matterIds.length > 0
        ? supabase.from('reimbursable_expenses').select('*, matters(title)')
            .in('matter_id', matterIds)
            .in('status', ['invoiced', 'reimbursed'])
            .gte('expense_date', dateFrom).lte('expense_date', dateTo)
            .order('expense_date')
        : Promise.resolve({ data: [] as ReimbursableExpense[] }),
    ])
    setServices((svcRes.data ?? []).map((r: any) => ({
      id: r.id, work_date: r.work_date, matter_title: r.matter_title,
      agreement_no: r.agreement_no, activity_type: r.activity_type,
      description: r.description, hours: Number(r.hours),
      hourly_rate: Number(r.hourly_rate), amount: Number(r.amount),
    })))
    setPayments(payRes.data ?? [])
    setReimb((reimbRes.data ?? []) as ReimbursableExpense[])
    setGenerated(true)
    setLoading(false)
  }

  function resetPayForm() {
    setEditPayId(null)
    setCoveredReimb([])
    setPayForm({
      client_id: '', pay_date: format(new Date(), 'yyyy-MM-dd'), amount: '',
      description: 'Оплата юридических услуг', doc_no: '', matter_id: '',
    })
  }

  function startEditPayment(p: Payment) {
    setEditPayId(p.id)
    setPayForm({
      client_id: p.client_id,
      pay_date: p.pay_date,
      amount: String(p.amount),
      description: p.description,
      doc_no: p.doc_no ?? '',
      matter_id: p.matter_id ?? '',
    })
    setShowPayForm(true)
    // Форма стоит вверху страницы, а платежи — в самом низу. Без прокрутки
    // двойной клик выглядит так, будто ничего не произошло.
    setTimeout(() => {
      payFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault()

    // Возмещение — часть платежа, оно не может быть больше самого платежа
    const payAmount = parseFloat(payForm.amount)
    if (coveredTotal > payAmount + 0.005) {
      toast.error(`Отмечено возмещение на ${fmt(coveredTotal)} ₽, а поступление всего ${fmt(payAmount)} ₽`)
      return
    }

    setSavingPay(true)

    // Правка существующего платежа. Доверителя не меняем (см. форму), поэтому
    // достаточно переписать поля и пересобрать привязку издержек.
    if (editPayId) {
      const { error: upError } = await supabase.from('payments').update({
        matter_id: payForm.matter_id || null,
        pay_date: payForm.pay_date,
        amount: payAmount,
        description: payForm.description,
        doc_no: payForm.doc_no || null,
      }).eq('id', editPayId)

      if (upError) { toast.error('Ошибка: ' + upError.message); setSavingPay(false); return }

      // Снятые галочки возвращаем в «Выставлено доверителю», отмеченные —
      // перепривязываем с актуальной датой платежа (она могла измениться)
      const unlinked = openReimb
        .filter(r => r.payment_id === editPayId && !coveredReimb.includes(r.id))
        .map(r => r.id)
      if (unlinked.length > 0) {
        await supabase.from('reimbursable_expenses')
          .update({ status: 'invoiced', payment_id: null, reimbursed_date: null })
          .in('id', unlinked)
      }
      if (coveredReimb.length > 0) {
        await supabase.from('reimbursable_expenses')
          .update({ status: 'reimbursed', payment_id: editPayId, reimbursed_date: payForm.pay_date })
          .in('id', coveredReimb)
      }

      toast.success('Платёж изменён')
      setShowPayForm(false)
      resetPayForm()
      if (generated) generate()
      setSavingPay(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()

    // Без доверителя (вознаграждение по назначению и т.п.) — в manual_income:
    // в payments доверитель обязателен на уровне базы. Для пользователя это
    // одна и та же форма, разделение техническое.
    if (!payForm.client_id) {
      const { error: miError } = await supabase.from('manual_income').insert({
        income_date: payForm.pay_date,
        client_id: null,
        matter_id: null,
        amount: payAmount,
        description: payForm.description,
        doc_no: payForm.doc_no || null,
        created_by: user!.id,
      })
      setSavingPay(false)
      if (miError) { toast.error('Ошибка: ' + miError.message); return }
      toast.success('Поступление внесено (без доверителя)')
      setShowPayForm(false)
      resetPayForm()
      if (generated) generate()
      return
    }

    // Нужен id созданного платежа, чтобы привязать к нему возмещения
    const { data: created, error } = await supabase.from('payments').insert({
      client_id: payForm.client_id,
      matter_id: payForm.matter_id || null,
      pay_date: payForm.pay_date,
      amount: payAmount,
      description: payForm.description,
      doc_no: payForm.doc_no || null,
      created_by: user!.id,
    }).select('id').single()

    if (error) { toast.error('Ошибка: ' + error.message); setSavingPay(false); return }

    // Отмеченные издержки помечаем компенсированными этим платежом.
    // reimbursed_date = дата платежа: именно по ней сумма исключается из дохода.
    if (coveredReimb.length > 0 && created) {
      const { error: linkError } = await supabase.from('reimbursable_expenses')
        .update({
          status: 'reimbursed',
          payment_id: created.id,
          reimbursed_date: payForm.pay_date,
        })
        .in('id', coveredReimb)
      if (linkError) {
        toast.error('Платёж внесён, но не удалось отметить возмещаемые расходы: ' + linkError.message)
      }
    }

    toast.success(coveredReimb.length > 0
      ? `Поступление внесено, возмещено расходов на ${fmt(coveredTotal)} ₽`
      : 'Поступление внесено')
    setShowPayForm(false)
    resetPayForm()
    if (generated) generate()
    setSavingPay(false)
  }

  async function deletePayment(id: string) {
    if (!confirm('Удалить платёж?')) return

    // Если этим платежом были компенсированы издержки — возвращаем их
    // в «Выставлено доверителю». Иначе расход остался бы «Компенсировано»
    // без поступивших денег и продолжал бы уменьшать доход в расчёте НДФЛ.
    const { data: linked } = await supabase.from('reimbursable_expenses')
      .select('id').eq('payment_id', id)

    if (linked && linked.length > 0) {
      await supabase.from('reimbursable_expenses')
        .update({ status: 'invoiced', payment_id: null, reimbursed_date: null })
        .eq('payment_id', id)
    }

    await supabase.from('payments').delete().eq('id', id)
    toast.success(linked && linked.length > 0
      ? `Платёж удалён, ${linked.length} возмещаемых расходов вернулись в «Выставлено доверителю»`
      : 'Удалено')
    if (generated) generate()
  }

  const totalServices = services.reduce((s, r) => s + r.amount, 0)
  const totalReimb = reimb.reduce((s, r) => s + Number(r.amount), 0)
  const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0)
  // Начислено = вознаграждение + предъявленные издержки. Без второго слагаемого
  // платёж, покрывший издержки, «съедал» вознаграждение и занижал долг.
  const totalCharged = totalServices + totalReimb
  const balance = totalCharged - totalPayments
  const client = clients.find(c => c.id === selectedClient)

  function exportPDF() {
    if (!generated) return
    const period = `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`
    const balLabel = balance > 0 ? 'Задолженность доверителя' : balance < 0 ? 'Переплата доверителя' : 'Сальдо'

    const svcRows = services.map((r, i) => `
      <tr>
        <td>${i+1}</td><td>${fmtDate(r.work_date)}</td><td>${escapeHtml(r.matter_title)}</td>
        <td>${escapeHtml(ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS])}</td>
        <td>${escapeHtml(r.description)}</td>
        <td class="r">${r.hours.toFixed(2)}</td>
        <td class="r">${fmt(r.hourly_rate)}</td>
        <td class="r">${fmt(r.amount)}</td>
      </tr>`).join('')

    const payRows = payments.map((p, i) => `
      <tr>
        <td>${i+1}</td><td>${fmtDate(p.pay_date)}</td>
        <td>${escapeHtml(p.doc_no ?? '—')}</td><td>${escapeHtml(p.description)}</td>
        <td class="r">${fmt(p.amount)}</td>
      </tr>`).join('')

    const reimbBlock = reimb.length === 0 ? '' : `
<h3>Возмещаемые расходы</h3>
<table>
  <thead><tr><th>№</th><th>Дата</th><th>Дело</th><th>Описание</th><th>Документ</th><th>Сумма, руб.</th></tr></thead>
  <tbody>${reimb.map((r, i) => `
      <tr>
        <td>${i+1}</td><td>${fmtDate(r.expense_date)}</td>
        <td>${escapeHtml(r.matters?.title ?? '—')}</td>
        <td>${escapeHtml(r.description)}</td>
        <td>${escapeHtml(r.doc_no ?? '—')}</td>
        <td class="r">${fmt(Number(r.amount))}</td>
      </tr>`).join('')}</tbody>
  <tfoot><tr><td colspan="5" class="r">Итого:</td><td class="r">${fmt(totalReimb)}</td></tr></tfoot>
</table>
<div class="total">Всего начислено (вознаграждение и возмещаемые расходы): ${fmt(totalCharged)} руб.</div>`

    const body = `
<h2>Акт сверки взаиморасчётов</h2>
<div class="sub">за период: ${period}</div>
<div class="meta">
  <b>Адвокат:</b> ${CABINET_LINE}<br>
  <b>Доверитель:</b> ${escapeHtml(client?.name ?? '')}${client?.inn ? `, ИНН ${escapeHtml(client.inn)}` : ''}
</div>
<h3>Оказанные услуги</h3>
<table>
  <thead><tr><th>№</th><th>Дата</th><th>Дело</th><th>Вид работы</th><th>Описание</th><th>Часов</th><th>Ставка, руб./ч.</th><th>Сумма, руб.</th></tr></thead>
  <tbody>${svcRows}</tbody>
  <tfoot><tr><td colspan="7" class="r">Итого:</td><td class="r">${fmt(totalServices)}</td></tr></tfoot>
</table>
${reimbBlock}
<h3>Поступившие оплаты</h3>
<table>
  <thead><tr><th>№</th><th>Дата</th><th>№ документа</th><th>Назначение</th><th>Сумма, руб.</th></tr></thead>
  <tbody>${payRows.length ? payRows : '<tr><td colspan="5" style="text-align:center">Платежей не поступало</td></tr>'}</tbody>
  <tfoot><tr><td colspan="4" class="r">Итого:</td><td class="r">${fmt(totalPayments)}</td></tr></tfoot>
</table>
<div class="total">${balLabel}: ${fmt(Math.abs(balance))} руб.</div>
<div class="signs">
  <div class="sign">
    <b>Адвокат:</b><br><br>
    _________________________ /А.А. Бухмин/
  </div>
  <div class="sign">
    <b>Доверитель:</b><br><br>
    _________________________ /${escapeHtml(client?.name ?? '')}/
  </div>
</div>
<div class="footer">${CABINET_LINE}</div>`

    if (!printDocument('Акт сверки', body)) {
      toast.error('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и попробуйте снова.')
      return
    }
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
      ...(reimb.length === 0 ? [] : [
        ['ВОЗМЕЩАЕМЫЕ РАСХОДЫ'],
        ['№','Дата','Дело','Описание','Документ','','','Сумма'],
        ...reimb.map((r, i) => [
          i+1, fmtDate(r.expense_date), r.matters?.title ?? '',
          r.description, r.doc_no ?? '', '', '', Number(r.amount),
        ]),
        ['','','','','','','Итого:', totalReimb],
        ['','','','','','','Всего начислено:', totalCharged],
        [],
      ]),
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
      <PageHeader title="Платежи / Акт сверки" icon={ClipboardList}
        description="Внесение фактических платежей и сверка расчётов с доверителем">
        {generated && (
          <>
            <button onClick={exportExcel} className="btn-secondary">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button onClick={exportPDF} className="btn-secondary">
              <FileDown className="w-4 h-4" /> PDF
            </button>
          </>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="card mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div className="md:col-span-2">
            <label className="label">Доверитель *</label>
            <select className="select" value={selectedClient}
              onChange={e => { setSelectedClient(e.target.value); setGenerated(false) }}>
              <option value="">— выберите доверителя —</option>
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
        <div className="flex gap-3 items-center flex-wrap">
          {/* Единственное место ввода поступлений во всём приложении.
              Доверитель вверху нужен только для акта сверки — форму можно
              открыть и без него. */}
          <button onClick={() => { resetPayForm(); setPayForm(f => ({ ...f, client_id: selectedClient })); setShowPayForm(true) }}
            className="btn-primary">
            <Plus className="w-4 h-4" /> Внести поступление
          </button>
          <button onClick={generate} disabled={loading} className="btn-secondary">
            {loading ? 'Загрузка...' : 'Сформировать акт сверки'}
          </button>
          {!selectedClient && (
            <span className="text-xs text-navy-400">Доверитель нужен только для акта сверки — поступление можно внести и без него</span>
          )}
        </div>
      </div>

      {/* Payment form */}
      {showPayForm && (
        <div ref={payFormRef} className="card mb-5 border-gold-800/40 scroll-mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-navy-200 text-sm">
              {editPayId ? 'Изменение поступления' : 'Новое поступление'}
            </h2>
            <button onClick={() => { setShowPayForm(false); resetPayForm() }} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={addPayment} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">Доверитель</label>
              {/* При правке доверителя не меняем: к платежу привязаны издержки
                  по делам этого доверителя, смена превратила бы связь в мусор */}
              <select className="select" value={payForm.client_id} disabled={!!editPayId}
                onChange={e => setPayForm(f => ({ ...f, client_id: e.target.value, matter_id: '' }))}>
                <option value="">— без доверителя (по назначению, иное) —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {editPayId && (
                <p className="text-xs text-navy-400 mt-1">
                  Доверителя изменить нельзя — удалите платёж и внесите заново
                </p>
              )}
            </div>
            <div>
              <label className="label">Дата *</label>
              <input type="date" className="input" required value={payForm.pay_date}
                onChange={e => setPayForm(f => ({ ...f, pay_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Сумма, руб. *</label>
              <input type="number" inputMode="decimal" className="input" required placeholder="50000"
                value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">№ платёжного поручения</label>
              <input type="text" className="input" placeholder="123"
                value={payForm.doc_no} onChange={e => setPayForm(f => ({ ...f, doc_no: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дело (необязательно)</label>
              <select className="select" value={payForm.matter_id} disabled={!payForm.client_id}
                onChange={e => setPayForm(f => ({ ...f, matter_id: e.target.value }))}>
                <option value="">— любое —</option>
                {matters.filter(m => m.client_id === payForm.client_id)
                  .map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="label">Назначение платежа</label>
              <input type="text" className="input" value={payForm.description}
                onChange={e => setPayForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {/* Возмещение издержек внутри платежа. Отмеченные суммы не попадут
                в доход при расчёте НДФЛ и 1% ОПС — это компенсация, а не гонорар. */}
            {openReimb.length > 0 && (
              <div className="md:col-span-4">
                <label className="label">Входит ли в платёж возмещение расходов?</label>
                <div className="rounded-lg border border-navy-700 divide-y divide-navy-800">
                  {openReimb.map(r => (
                    <label key={r.id}
                      className="tap flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-navy-800/40">
                      <input type="checkbox" className="w-4 h-4 mt-0.5 accent-gold-500 flex-shrink-0"
                        checked={coveredReimb.includes(r.id)}
                        onChange={e => setCoveredReimb(prev =>
                          e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-navy-200 truncate">{r.description}</span>
                        <span className="block text-xs text-navy-400">
                          {fmtDate(r.expense_date)} · {r.matters?.title ?? '—'}
                        </span>
                      </span>
                      <span className="num text-sm text-navy-200 whitespace-nowrap">
                        {fmt(Number(r.amount))} ₽
                      </span>
                    </label>
                  ))}
                </div>
                {coveredTotal > 0 && (
                  <p className="text-xs mt-2 flex flex-wrap gap-x-2">
                    <span className="text-navy-400">Возмещаемые расходы:</span>
                    <span className="num text-navy-200">{fmt(coveredTotal)} ₽</span>
                    <span className="text-navy-400">· вознаграждение:</span>
                    <span className="num text-navy-100">
                      {fmt(Math.max(0, (parseFloat(payForm.amount) || 0) - coveredTotal))} ₽
                    </span>
                    <span className="text-emerald-400">— в доход по НДФЛ пойдёт только вознаграждение</span>
                  </p>
                )}
              </div>
            )}

            <div className="md:col-span-4 flex gap-3">
              <button type="submit" disabled={savingPay} className="btn-primary">
                <Check className="w-4 h-4" />
                {savingPay ? 'Сохраняю...' : editPayId ? 'Сохранить изменения' : 'Добавить платёж'}
              </button>
              <button type="button" onClick={() => { setShowPayForm(false); resetPayForm() }}
                className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Result */}
      {generated && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 md:mb-5">
            <div className="stat-card">
              <p className="text-xs text-navy-400">Начислено доверителю</p>
              <p className="text-2xl font-semibold text-navy-100">{fmt(totalCharged)} ₽</p>
              {totalReimb > 0 && (
                <p className="text-xs text-navy-400 mt-1">
                  услуги {fmt(totalServices)} + возмещаемые расходы {fmt(totalReimb)}
                </p>
              )}
            </div>
            <div className="stat-card">
              <p className="text-xs text-navy-400">Оплачено</p>
              <p className="text-2xl font-semibold text-emerald-400">{fmt(totalPayments)} ₽</p>
            </div>
            <div className="stat-card">
              <p className="text-xs text-navy-400">{balance >= 0 ? 'Задолженность доверителя' : 'Переплата'}</p>
              {/* Цвет здесь несёт смысл, а не украшает: красный — долг,
                  янтарный — переплата (аванс, не проблема), зелёный — сошлось */}
              <p className={`text-2xl font-semibold ${balance > 0 ? 'text-red-400' : balance < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {fmt(Math.abs(balance))} ₽
              </p>
            </div>
          </div>

          {/* Services */}
          <div className="card mb-4">
            <h2 className="font-medium text-navy-200 mb-4 text-sm">Оказанные услуги</h2>
            {services.length === 0 ? (
              <p className="text-navy-300 text-sm text-center py-6">Нет оказанных услуг за период</p>
            ) : (
              <>
              {/* Table (desktop) */}
              <div className="hidden md:block overflow-x-auto lg:overflow-x-visible">
              <table className="w-full text-xs min-w-[640px] table-sticky">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','Дело','Вид работы','Описание','Часов','Ставка','Сумма'].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-300 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {services.map((r, i) => (
                    <tr key={r.id} className="border-b border-navy-800/40 hover:bg-navy-800/30">
                      <td className="py-2 pr-3 text-navy-400">{i+1}</td>
                      <td className="py-2 pr-3 num text-navy-400">{fmtDate(r.work_date)}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[140px] truncate">{r.matter_title}</td>
                      <td className="py-2 pr-3 text-navy-400">{ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS]}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[160px] truncate">{r.description}</td>
                      <td className="py-2 pr-3 text-right num text-navy-300">{r.hours.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right num text-navy-400">{fmt(r.hourly_rate)}</td>
                      <td className="py-2 text-right num text-navy-100">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={7} className="pt-2 text-right text-navy-400 font-medium pr-3 text-xs">Итого:</td>
                    <td className="pt-2 text-right num font-semibold text-navy-100 text-xs">{fmt(totalServices)} ₽</td>
                  </tr>
                </tbody>
              </table>
              </div>

              {/* Card list (mobile) */}
              <div className="md:hidden">
                {services.map(r => (
                  <div key={r.id} className="py-2.5 border-b border-navy-800/40">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-navy-300 text-xs max-w-[70%] truncate">{r.matter_title}</p>
                      <span className="text-navy-400 num text-xs whitespace-nowrap">{fmtDate(r.work_date)}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-navy-400 text-xs">{ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS]}</span>
                      <span className="text-navy-400 num text-xs">{r.hours.toFixed(2)} ч</span>
                    </div>
                    <p className="text-navy-300 text-xs mb-1.5 line-clamp-2">{r.description}</p>
                    <div className="flex justify-end">
                      <span className="num text-sm text-navy-100 font-semibold">{fmt(r.amount)} ₽</span>
                    </div>
                  </div>
                ))}
                <div className="pt-2.5 flex items-center justify-between text-xs">
                  <span className="text-navy-400 font-medium">Итого:</span>
                  <span className="num font-semibold text-navy-100">{fmt(totalServices)} ₽</span>
                </div>
              </div>
              </>
            )}
          </div>

          {/* Reimbursable expenses */}
          {reimb.length > 0 && (
            <div className="card mb-4">
              <h2 className="font-medium text-navy-200 mb-1 text-sm">Возмещаемые расходы</h2>
              <p className="text-xs text-navy-400 mb-4">
                Расходы, предъявленные доверителю к возмещению. Он оплачивает их
                вместе с вознаграждением, поэтому они входят в начисленную сумму.
              </p>

              {/* Table (desktop) */}
              <div className="hidden md:block overflow-x-auto lg:overflow-x-visible">
                <table className="w-full text-xs min-w-[560px] table-sticky">
                  <thead>
                    <tr className="border-b border-navy-800">
                      {['№','Дата','Дело','Описание','Документ','Статус','Сумма'].map(h => (
                        <th key={h} className="text-left pb-2 pr-3 text-navy-300 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reimb.map((r, i) => (
                      <tr key={r.id} className="border-b border-navy-800/40 hover:bg-navy-800/30">
                        <td className="py-2 pr-3 text-navy-400">{i+1}</td>
                        <td className="py-2 pr-3 num text-navy-400">{fmtDate(r.expense_date)}</td>
                        <td className="py-2 pr-3 text-navy-300 max-w-[140px] truncate">{r.matters?.title ?? '—'}</td>
                        <td className="py-2 pr-3 text-navy-300 max-w-[180px] truncate">{r.description}</td>
                        <td className="py-2 pr-3 text-navy-400">{r.doc_no ?? '—'}</td>
                        <td className="py-2 pr-3 text-navy-400">
                          {r.status === 'reimbursed'
                            ? `компенсировано${r.reimbursed_date ? ' ' + fmtDate(r.reimbursed_date) : ''}`
                            : 'выставлено'}
                        </td>
                        <td className="py-2 text-right num text-navy-100">{fmt(Number(r.amount))}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-navy-700">
                      <td colSpan={6} className="pt-2 text-right text-navy-400 font-medium pr-3 text-xs">Итого:</td>
                      <td className="pt-2 text-right num font-semibold text-navy-100 text-xs">{fmt(totalReimb)} ₽</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Card list (mobile) */}
              <div className="md:hidden">
                {reimb.map(r => (
                  <div key={r.id} className="py-2.5 border-b border-navy-800/40">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-navy-300 text-xs max-w-[70%] truncate">{r.matters?.title ?? '—'}</p>
                      <span className="text-navy-400 num text-xs whitespace-nowrap">{fmtDate(r.expense_date)}</span>
                    </div>
                    <p className="text-navy-300 text-xs mb-1.5 line-clamp-2">{r.description}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-navy-400 text-xs">
                        {r.status === 'reimbursed'
                          ? `компенсировано${r.reimbursed_date ? ' ' + fmtDate(r.reimbursed_date) : ''}`
                          : 'выставлено'}
                      </span>
                      <span className="num text-sm text-navy-100 font-semibold">{fmt(Number(r.amount))} ₽</span>
                    </div>
                  </div>
                ))}
                <div className="pt-2.5 flex items-center justify-between text-xs">
                  <span className="text-navy-400 font-medium">Итого:</span>
                  <span className="num font-semibold text-navy-100">{fmt(totalReimb)} ₽</span>
                </div>
              </div>
            </div>
          )}

          {/* Payments */}
          <div className="card">
            <h2 className="font-medium text-navy-200 mb-1 text-sm">Поступившие оплаты</h2>
            {payments.length > 0 && (
              <p className="text-xs text-navy-400 mb-4">Двойной клик по строке — изменить платёж</p>
            )}
            {payments.length === 0 ? (
              <p className="text-navy-300 text-sm text-center py-6">
                Нет платежей за период.{' '}
                <button onClick={() => { resetPayForm(); setPayForm(f => ({ ...f, client_id: selectedClient })); setShowPayForm(true) }}
                  className="text-gold-400 hover:underline">
                  Добавить →
                </button>
              </p>
            ) : (
              <>
              {/* Table (desktop) */}
              <div className="hidden md:block overflow-x-auto lg:overflow-x-visible">
              <table className="w-full text-xs min-w-[480px] table-sticky">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','№ документа','Назначение','Сумма',''].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-300 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={p.id}
                      onDoubleClick={() => startEditPayment(p)}
                      title="Двойной клик — редактировать"
                      className="border-b border-navy-800/40 hover:bg-navy-800/30 cursor-pointer">
                      <td className="py-2 pr-3 text-navy-400">{i+1}</td>
                      <td className="py-2 pr-3 num text-navy-400">{fmtDate(p.pay_date)}</td>
                      <td className="py-2 pr-3 text-navy-400">{p.doc_no ?? '—'}</td>
                      <td className="py-2 pr-3 text-navy-300 max-w-[200px] truncate">{p.description}</td>
                      <td className="py-2 pr-3 text-right num text-emerald-400">{fmt(p.amount)} ₽</td>
                      <td className="py-2">
                        <button onClick={ev => { ev.stopPropagation(); deletePayment(p.id) }}
                          className="btn-ghost p-1 hover:text-red-400 hover:bg-red-900/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={4} className="pt-2 text-right text-navy-400 font-medium pr-3">Итого:</td>
                    <td className="pt-2 text-right num font-semibold text-emerald-400">{fmt(totalPayments)} ₽</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              </div>

              {/* Card list (mobile) */}
              <div className="md:hidden">
                {payments.map(p => (
                  <div key={p.id} onClick={() => startEditPayment(p)}
                    className="py-2.5 border-b border-navy-800/40 cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-navy-300 text-xs truncate">{p.description}</p>
                        {p.doc_no && <p className="text-navy-300 text-xs">№ {p.doc_no}</p>}
                      </div>
                      <span className="text-navy-400 num text-xs whitespace-nowrap flex-shrink-0">{fmtDate(p.pay_date)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="num text-sm text-emerald-400 font-semibold">{fmt(p.amount)} ₽</span>
                      <button onClick={ev => { ev.stopPropagation(); deletePayment(p.id) }}
                        className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="pt-2.5 flex items-center justify-between text-xs">
                  <span className="text-navy-400 font-medium">Итого:</span>
                  <span className="num font-semibold text-emerald-400">{fmt(totalPayments)} ₽</span>
                </div>
              </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
