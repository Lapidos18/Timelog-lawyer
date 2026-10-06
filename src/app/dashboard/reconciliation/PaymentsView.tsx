'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, Matter, ReimbursableExpense } from '@/types'
import { format } from 'date-fns'
import { Plus, Trash2, Check, Upload, ArrowLeftRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import PageHeader from '@/components/PageHeader'
import ChangeHistory from '@/components/ChangeHistory'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'
import LoadError from '@/components/LoadError'
import { SkeletonRows } from '@/components/Skeleton'
import { useMounted } from '@/lib/use-mounted'
import { isTouchLayout } from '@/lib/touch-layout'
import ImportStatement from './ImportStatement'

/**
 * «Платежи» — единственное место ввода поступлений во всём приложении
 * (CLAUDE.md, п. 6) и список всего, что поступило, по доверителю и периоду.
 *
 * Раньше список платежей появлялся только после «Сформировать акт сверки» и
 * требовал выбрать доверителя; теперь он виден сразу, а акт сверки — отдельный
 * вид этой же страницы (форма «как в 1С», см. п. 19).
 */

interface Payment {
  id: string
  client_id: string
  matter_id: string | null
  pay_date: string
  amount: number
  description: string
  doc_no: string | null
  created_at: string
  clients?: { name: string } | null
  matters?: { title: string } | null
}

/** Поступление без доверителя (вознаграждение по назначению и т.п.), лежит в manual_income */
interface ManualRow {
  id: string
  income_date: string
  amount: number
  description: string
  doc_no: string | null
  client_id: string | null
  clients?: { name: string } | null
}

/** Одна строка общего списка: платёж доверителя или ручная запись */
interface ListRow {
  key: string
  date: string
  client: string
  matter: string
  docNo: string
  description: string
  amount: number
  /** Ровно одно из двух: платёж доверителя или ручное поступление без доверителя */
  payment?: Payment
  manual?: ManualRow
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDate(s: string) {
  return format(new Date(s), 'dd.MM.yyyy')
}

export default function PaymentsView({ clients, matters, switcher, openFormSignal, onMakeAct }: {
  clients: Client[]
  matters: (Matter & { clients: Client })[]
  /** Переключатель «Платежи / Акты сверки» — стоит в шапке */
  switcher: React.ReactNode
  /** Растёт на единицу, когда форму поступления нужно открыть (ссылка «Внести поступление» из «Доходов») */
  openFormSignal: number
  /** Составить акт сверки по выбранному доверителю и периоду */
  onMakeAct: (clientId: string, from: string, to: string) => void
}) {
  const supabase = createClient()
  // Даты периода зависят от «сегодня», а страница собирается заранее: в полях
  // их показываем только после загрузки в браузере (см. src/lib/use-mounted.ts)
  const mounted = useMounted()

  // Фильтр списка. Пустой доверитель = все
  const [selectedClient, setSelectedClient] = useState('')
  const [dateFrom, setDateFrom] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [payments, setPayments] = useState<Payment[]>([])
  const [manual, setManual] = useState<ManualRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /** Увеличивается, когда список нужно перечитать (внесли, изменили, удалили, импортировали) */
  const [tick, setTick] = useState(0)

  // Payment form
  const [showPayForm, setShowPayForm] = useState(false)
  // Форма поступления самостоятельна: свой выбор доверителя, не зависящий от
  // фильтра списка вверху. Пустой client_id = доход без доверителя
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
  // То же для ручного поступления (без доверителя, лежит в manual_income)
  const [editManualId, setEditManualId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  // Возмещаемые расходы доверителя, которые ещё не компенсированы.
  // Платёж от доверителя обычно включает и вознаграждение, и компенсацию издержек;
  // отмеченные здесь суммы не попадут в доход при расчёте НДФЛ.
  const [openReimb, setOpenReimb] = useState<ReimbursableExpense[]>([])
  const [coveredReimb, setCoveredReimb] = useState<string[]>([])

  // Esc закрывает форму поступления — см. src/lib/form-keys.ts
  useEscapeKey(showPayForm, () => { setShowPayForm(false); resetPayForm() })

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

  // Список: платежи доверителей и ручные поступления за период
  useEffect(() => {
    if (!dateFrom || !dateTo) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(false)
      let pq = supabase.from('payments').select('*, clients(name), matters(title)')
        .gte('pay_date', dateFrom).lte('pay_date', dateTo).order('pay_date', { ascending: false })
      let mq = supabase.from('manual_income').select('*, clients(name)')
        .gte('income_date', dateFrom).lte('income_date', dateTo).order('income_date', { ascending: false })
      if (selectedClient) {
        pq = pq.eq('client_id', selectedClient)
        mq = mq.eq('client_id', selectedClient)
      }
      const [p, m] = await Promise.all([pq, mq])
      if (cancelled) return
      if (p.error || m.error) setLoadError(true)
      else {
        setPayments((p.data ?? []) as Payment[])
        setManual((m.data ?? []) as ManualRow[])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, dateFrom, dateTo, tick])

  // Форма «Внести поступление» по ссылке из «Доходов»: открыть сразу
  useEffect(() => {
    if (openFormSignal > 0) openNewForm()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFormSignal])

  /**
   * Перечитать список после изменения. Если внесённое или изменённое поступление
   * не попало бы в текущий фильтр (другой доверитель, дата вне периода),
   * фильтр расширяется: «внёс и не вижу» — худшее, что может быть у формы ввода.
   */
  function afterChange(p?: { clientId: string; date: string }) {
    if (p) {
      if (selectedClient && p.clientId !== selectedClient) setSelectedClient('')
      if (p.date && p.date < dateFrom) setDateFrom(p.date)
      if (p.date && p.date > dateTo) setDateTo(p.date)
    }
    setTick(t => t + 1)
  }

  function resetPayForm() {
    setEditPayId(null)
    setEditManualId(null)
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
  }

  function startEditManual(m: ManualRow) {
    setEditManualId(m.id)
    setPayForm({
      client_id: m.client_id ?? '',
      pay_date: m.income_date,
      amount: String(m.amount),
      description: m.description,
      doc_no: m.doc_no ?? '',
      matter_id: '',
    })
    setShowPayForm(true)
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault()
    // Что внесли — запоминаем до сброса формы: по этому список поймёт, не спрятано ли оно фильтром
    const changed = { clientId: payForm.client_id, date: payForm.pay_date }

    // Возмещение — часть платежа, оно не может быть больше самого платежа
    const payAmount = parseFloat(payForm.amount)
    if (coveredTotal > payAmount + 0.005) {
      toast.error(`Отмечено возмещение на ${fmt(coveredTotal)} ₽, а поступление всего ${fmt(payAmount)} ₽`)
      return
    }

    setSavingPay(true)

    // Правка ручного поступления: у него нет ни дела, ни привязанных издержек
    if (editManualId) {
      const { error: mError } = await supabase.from('manual_income').update({
        income_date: payForm.pay_date,
        amount: payAmount,
        description: payForm.description,
        doc_no: payForm.doc_no || null,
      }).eq('id', editManualId)
      setSavingPay(false)
      if (mError) { toast.error('Ошибка: ' + mError.message); return }
      toast.success('Поступление изменено')
      setShowPayForm(false)
      resetPayForm()
      afterChange(changed)
      return
    }

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

      // Привязка расходов решает, вычтутся ли эти суммы из дохода по НДФЛ.
      // Если платёж сохранился, а привязка нет — цифры разъедутся молча,
      // поэтому о неудаче надо сказать прямо.
      let linkError: string | null = null
      if (unlinked.length > 0) {
        const { error } = await supabase.from('reimbursable_expenses')
          .update({ status: 'invoiced', payment_id: null, reimbursed_date: null })
          .in('id', unlinked)
        if (error) linkError = error.message
      }
      if (!linkError && coveredReimb.length > 0) {
        const { error } = await supabase.from('reimbursable_expenses')
          .update({ status: 'reimbursed', payment_id: editPayId, reimbursed_date: payForm.pay_date })
          .in('id', coveredReimb)
        if (error) linkError = error.message
      }

      if (linkError) {
        toast.error('Платёж изменён, но не удалось обновить возмещаемые расходы: ' + linkError)
      } else {
        toast.success('Платёж изменён')
      }
      setShowPayForm(false)
      resetPayForm()
      afterChange(changed)
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
      afterChange(changed)
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
    afterChange(changed)
    setSavingPay(false)
  }

  async function deletePayment(id: string) {
    if (!confirm('Удалить платёж?')) return

    // Если этим платежом были компенсированы издержки — возвращаем их
    // в «Выставлено доверителю». Иначе расход остался бы «Компенсировано»
    // без поступивших денег и продолжал бы уменьшать доход в расчёте НДФЛ.
    const { data: linked } = await supabase.from('reimbursable_expenses')
      .select('id').eq('payment_id', id)

    // Сначала отвязываем расходы, потом удаляем платёж. Если отвязать не
    // удалось — платёж НЕ удаляем: иначе расходы остались бы «Компенсировано»
    // со ссылкой на несуществующий платёж и продолжали бы уменьшать доход.
    if (linked && linked.length > 0) {
      const { error } = await supabase.from('reimbursable_expenses')
        .update({ status: 'invoiced', payment_id: null, reimbursed_date: null })
        .eq('payment_id', id)
      if (error) {
        toast.error('Платёж не удалён: не удалось открепить возмещаемые расходы. ' + error.message)
        return
      }
    }

    const { error: delError } = await supabase.from('payments').delete().eq('id', id)
    if (delError) {
      toast.error('Не удалось удалить платёж: ' + delError.message)
      afterChange()
      return
    }
    toast.success(linked && linked.length > 0
      ? `Платёж удалён, ${linked.length} возмещаемых расходов вернулись в «Выставлено доверителю»`
      : 'Удалено')
    afterChange()
  }

  async function deleteManual(id: string) {
    if (!confirm('Удалить поступление?')) return
    const { error } = await supabase.from('manual_income').delete().eq('id', id)
    if (error) { toast.error('Не удалось удалить: ' + error.message); return }
    toast.success('Удалено')
    afterChange()
  }

  function startEdit(r: ListRow) {
    if (r.payment) startEditPayment(r.payment)
    else if (r.manual) startEditManual(r.manual)
  }
  function removeRow(r: ListRow) {
    if (r.payment) deletePayment(r.payment.id)
    else if (r.manual) deleteManual(r.manual.id)
  }
  const editing = !!(editPayId || editManualId)

  const rows: ListRow[] = [
    ...payments.map(p => ({
      key: 'p' + p.id, date: p.pay_date, client: p.clients?.name ?? '—', matter: p.matters?.title ?? '—',
      docNo: p.doc_no ?? '—', description: p.description, amount: Number(p.amount), payment: p,
    })),
    ...manual.map(m => ({
      key: 'm' + m.id, date: m.income_date, client: m.clients?.name ?? 'без доверителя', matter: '—',
      docNo: m.doc_no ?? '—', description: m.description, amount: Number(m.amount), manual: m,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  // Сумма копейками: на длинном списке 0,1 + 0,2 в рублях не даёт 0,3
  const total = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100

  const openNewForm = () => {
    resetPayForm()
    setPayForm(f => ({ ...f, client_id: selectedClient }))
    setShowPayForm(true)
  }

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Платежи и акты сверки"
        description="Внесение поступлений и акты сверки взаимных расчётов с доверителями">
        {switcher}
      </PageHeader>

      {/* Filters */}
      <div className="card mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div className="md:col-span-2">
            <label className="label">Доверитель</label>
            <select className="select" value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
              <option value="">— все доверители —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Период с</label>
            <input type="date" className="input" value={mounted ? dateFrom : ''}
              onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Период по</label>
            <input type="date" className="input" value={mounted ? dateTo : ''}
              onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          {/* Единственное место ввода поступлений во всём приложении.
              Доверитель можно не выбирать: доход без доверителя тоже вносится здесь. */}
          <button onClick={openNewForm} className="btn-primary">
            <Plus className="w-4 h-4" /> Внести поступление
          </button>
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            <Upload className="w-4 h-4" /> Загрузить выписку
          </button>
          <button onClick={() => onMakeAct(selectedClient, dateFrom, dateTo)}
            disabled={!selectedClient} className="btn-secondary"
            title={selectedClient ? 'Составить акт сверки взаимных расчётов за этот период' : 'Выберите доверителя'}>
            <ArrowLeftRight className="w-4 h-4" /> Составить акт сверки
          </button>
          {!selectedClient && (
            <span className="text-xs text-navy-400">Чтобы составить акт сверки, выберите доверителя</span>
          )}
        </div>
      </div>

      <ImportStatement open={showImport} onClose={() => setShowImport(false)}
        clients={clients} matters={matters} onImported={() => afterChange()} />

      {/* Payment form */}
      <Modal open={showPayForm} onClose={() => { setShowPayForm(false); resetPayForm() }}
        title={editing ? 'Изменение поступления' : 'Новое поступление'} wide>
          <form onKeyDown={submitOnCtrlEnter} onSubmit={addPayment} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="label">Доверитель</label>
              {/* При правке доверителя не меняем: к платежу привязаны издержки
                  по делам этого доверителя, смена превратила бы связь в мусор */}
              <select className="select" value={payForm.client_id} disabled={editing}
                onChange={e => setPayForm(f => ({ ...f, client_id: e.target.value, matter_id: '' }))}>
                <option value="">— без доверителя (по назначению, иное) —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {editing && (
                <p className="text-xs text-navy-400 mt-1">
                  Доверителя изменить нельзя — удалите поступление и внесите заново
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
            {openReimb.length > 0 && !editManualId && (
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
                {savingPay ? 'Сохраняю...' : editing ? 'Сохранить изменения' : 'Добавить платёж'}
              </button>
              <button type="button" onClick={() => { setShowPayForm(false); resetPayForm() }}
                className="btn-secondary">Отмена</button>
            </div>
          </form>
          {/* История только при правке: у нового платежа её ещё нет */}
          {editPayId && <ChangeHistory table="payments" rowId={editPayId} />}
          {editManualId && <ChangeHistory table="manual_income" rowId={editManualId} />}
      </Modal>

      {loadError && !loading && <LoadError onRetry={() => setTick(t => t + 1)} />}

      {!loadError && (
        <div className="card">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
            <h2 className="font-medium text-navy-200 text-sm">Поступления за период</h2>
            {!loading && rows.length > 0 && (
              <span className="text-xs text-navy-400">{rows.length} шт. · итого <span className="num text-emerald-400 font-medium">{fmt(total)} ₽</span></span>
            )}
          </div>
          {!loading && rows.length > 0 && (
            <p className="text-xs text-navy-400 mb-3">
              <span className="hidden md:inline">Двойной клик по поступлению — изменить.</span>
              <span className="md:hidden">Нажмите на поступление, чтобы изменить.</span>
            </p>
          )}

          {loading ? (
            <SkeletonRows rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState title="За этот период поступлений нет"
              description="Измените период или доверителя либо внесите поступление."
              action={<button onClick={openNewForm} className="btn-primary"><Plus className="w-4 h-4" /> Внести поступление</button>} />
          ) : (
            <>
              {/* Table (desktop) */}
              <div className="hidden md:block overflow-x-auto xl:overflow-x-visible">
                <table className="w-full text-xs table-sticky">
                  <thead>
                    <tr className="border-b border-navy-800">
                      {['Дата', 'Доверитель / дело', '№ документа', 'Назначение', 'Сумма', ''].map(h => (
                        <th key={h} className={`pb-2 pr-3 text-navy-300 font-medium ${h === 'Сумма' ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key}
                        onDoubleClick={() => startEdit(r)}
                        title="Двойной клик — редактировать"
                        className="border-b border-navy-800/40 hover:bg-navy-800/30 cursor-pointer">
                        <td className="py-2 pr-3 num text-navy-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-3 text-navy-200">
                          <p className="max-w-[200px] truncate">{r.client}</p>
                          {r.matter !== '—' && <p className="max-w-[200px] truncate text-navy-400">{r.matter}</p>}
                        </td>
                        <td className="py-2 pr-3 text-navy-400 whitespace-nowrap">{r.docNo}</td>
                        <td className="py-2 pr-3 text-navy-300 w-full max-w-0 min-w-[140px]"><p className="truncate" title={r.description}>{r.description}</p></td>
                        <td className="py-2 pr-3 text-right num text-emerald-400 whitespace-nowrap">{fmt(r.amount)} ₽</td>
                        <td className="py-2 whitespace-nowrap">
                          <button aria-label="Удалить поступление" onClick={ev => { ev.stopPropagation(); removeRow(r) }}
                            className="tap-icon text-navy-400 hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Card list (mobile) */}
              <div className="md:hidden">
                {rows.map(r => (
                  <div key={r.key}
                    onClick={() => { if (isTouchLayout()) startEdit(r) }}
                    className="py-2.5 border-b border-navy-800/40 cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-navy-100 text-sm font-medium break-words">{r.client}</p>
                        {r.matter !== '—' && <p className="text-navy-400 text-xs break-words">{r.matter}</p>}
                        <p className="text-navy-300 text-xs break-words">{r.description}</p>
                        {r.docNo !== '—' && <p className="text-navy-400 text-xs">№ {r.docNo}</p>}
                      </div>
                      <span className="text-navy-400 num text-xs whitespace-nowrap flex-shrink-0">{fmtDate(r.date)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="num text-sm text-emerald-400 font-semibold">{fmt(r.amount)} ₽</span>
                      <button aria-label="Удалить поступление" onClick={ev => { ev.stopPropagation(); removeRow(r) }}
                        className="tap-icon text-navy-400 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
