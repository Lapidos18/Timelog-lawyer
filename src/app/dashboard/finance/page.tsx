'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import {
  Expense, ExpenseCategory, EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_RISKY,
  TaxSettings, TaxPayment, TaxPaymentType, TAX_PAYMENT_TYPE_LABELS,
  IncomeRow, ManualIncome, Client, Matter,
} from '@/types'
import { format } from 'date-fns'
import {
  Wallet, Receipt, Calculator, ShieldCheck, Plus, Trash2, X, Check,
  AlertTriangle, ChevronDown, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'
import CalculatorTab from './CalculatorTab'

function fmt2(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function quarterOf(dateStr: string) {
  const month = new Date(dateStr).getMonth() + 1
  return Math.ceil(month / 3)
}
const QUARTER_LABELS = ['I квартал (янв–март)', 'II квартал (апр–июнь)', 'III квартал (июль–сент)', 'IV квартал (окт–дек)']

type Tab = 'income' | 'expenses' | 'calc' | 'contributions' | 'calculator'
const EXPENSE_CATEGORY_OPTIONS = Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][]

const emptyExpenseForm = {
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  category: 'other' as ExpenseCategory,
  amount: '',
  description: '',
  is_documented: true,
  doc_no: '',
}

const emptyIncomeForm = {
  income_date: format(new Date(), 'yyyy-MM-dd'),
  client_id: '',
  matter_id: '',
  amount: '',
  description: '',
  doc_no: '',
}

export default function FinancePage() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('calc')
  const [loading, setLoading] = useState(true)
  const [year] = useState(2026)

  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null)
  const [taxPayments, setTaxPayments] = useState<TaxPayment[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])

  // manual income form state
  const [showIncomeForm, setShowIncomeForm] = useState(false)
  const [editIncomeId, setEditIncomeId] = useState<string | null>(null)
  const [incomeForm, setIncomeForm] = useState(emptyIncomeForm)

  // expense form state
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null)
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm)
  const [submitting, setSubmitting] = useState(false)

  // tax payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    payment_type: 'ndfl_advance_q1' as TaxPaymentType,
    amount: '',
    doc_no: '',
    notes: '',
  })

  // contributions payment form state (отдельная форма — своя вкладка, свой список)
  const [showContribPaymentForm, setShowContribPaymentForm] = useState(false)
  const [contribPaymentForm, setContribPaymentForm] = useState({
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    payment_type: 'fixed_contributions' as TaxPaymentType,
    amount: '',
    doc_no: '',
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [
      { data: paymentsData },
      { data: manualIncomeData },
      { data: expensesData },
      { data: settingsData },
      { data: taxPaymentsData },
      { data: clientsData },
      { data: mattersData },
    ] = await Promise.all([
      supabase.from('payments').select('*, clients(name), matters(title)').order('pay_date', { ascending: false }),
      supabase.from('manual_income').select('*, clients(name), matters(title)').order('income_date', { ascending: false }),
      supabase.from('expenses').select('*, matters(title, clients(name))').order('expense_date', { ascending: false }),
      supabase.from('tax_settings').select('*').eq('year', year).single(),
      supabase.from('tax_payments').select('*').eq('period_year', year).order('payment_date', { ascending: false }),
      supabase.from('clients').select('*').order('name'),
      supabase.from('matters').select('*, clients(*)').order('title'),
    ])

    const fromPayments: IncomeRow[] = (paymentsData || []).map((p: any) => ({
      id: p.id,
      pay_date: p.pay_date,
      pay_year: new Date(p.pay_date).getFullYear(),
      pay_quarter: quarterOf(p.pay_date),
      client_id: p.client_id,
      client_name: p.clients?.name ?? '—',
      matter_id: p.matter_id,
      matter_title: p.matters?.title ?? null,
      amount: p.amount,
      description: p.description,
      doc_no: p.doc_no,
      source: 'payment' as const,
    }))

    const fromManual: IncomeRow[] = (manualIncomeData || []).map((m: any) => ({
      id: m.id,
      pay_date: m.income_date,
      pay_year: new Date(m.income_date).getFullYear(),
      pay_quarter: quarterOf(m.income_date),
      client_id: m.client_id,
      client_name: m.clients?.name ?? '—',
      matter_id: m.matter_id,
      matter_title: m.matters?.title ?? null,
      amount: m.amount,
      description: m.description,
      doc_no: m.doc_no,
      source: 'manual' as const,
    }))

    const mappedIncomes = [...fromPayments, ...fromManual].sort(
      (a, b) => new Date(b.pay_date).getTime() - new Date(a.pay_date).getTime()
    )

    setIncomes(mappedIncomes.filter(i => i.pay_year === year))
    setExpenses(expensesData || [])
    setTaxSettings(settingsData || null)
    setTaxPayments(taxPaymentsData || [])
    setClients(clientsData || [])
    setMatters((mattersData || []) as (Matter & { clients: Client })[])
    setLoading(false)
  }, [supabase, year])

  useEffect(() => { loadAll() }, [loadAll])

  // ------------------------------------------------------------
  // Квартальные суммы (нарастающим итогом)
  // ------------------------------------------------------------
  const quarterlyCalc = useMemo(() => {
    if (!taxSettings) return null
    const incomeByQ = [0, 0, 0, 0]
    const expenseByQ = [0, 0, 0, 0]
    incomes.forEach(i => { incomeByQ[i.pay_quarter - 1] += i.amount })
    expenses.forEach(e => { expenseByQ[quarterOf(e.expense_date) - 1] += e.is_documented ? e.amount : 0 })

    const paidAdvanceByQ: Record<string, number> = {}
    taxPayments.forEach(p => {
      paidAdvanceByQ[p.payment_type] = (paidAdvanceByQ[p.payment_type] || 0) + p.amount
    })
    const paidCumulative = [
      paidAdvanceByQ['ndfl_advance_q1'] || 0,
      (paidAdvanceByQ['ndfl_advance_q1'] || 0) + (paidAdvanceByQ['ndfl_advance_q2'] || 0),
      (paidAdvanceByQ['ndfl_advance_q1'] || 0) + (paidAdvanceByQ['ndfl_advance_q2'] || 0) + (paidAdvanceByQ['ndfl_advance_q3'] || 0),
    ]

    const rows = [0, 1, 2, 3].map(qIdx => {
      const incomeCum = incomeByQ.slice(0, qIdx + 1).reduce((a, b) => a + b, 0)
      const expenseCum = expenseByQ.slice(0, qIdx + 1).reduce((a, b) => a + b, 0)
      const base = Math.max(0, incomeCum - expenseCum)
      const ndflCum = base <= taxSettings.ndfl_progressive_threshold
        ? base * taxSettings.ndfl_rate_low
        : taxSettings.ndfl_progressive_threshold * taxSettings.ndfl_rate_low +
          (base - taxSettings.ndfl_progressive_threshold) * taxSettings.ndfl_rate_high
      const paidBefore = qIdx < 3 ? (qIdx === 0 ? 0 : paidCumulative[qIdx - 1]) : paidCumulative[2]
      const advanceDue = Math.max(0, ndflCum - paidBefore)
      const actuallyPaidThisQ = qIdx < 3
        ? paidAdvanceByQ[(['ndfl_advance_q1', 'ndfl_advance_q2', 'ndfl_advance_q3'] as const)[qIdx]] || 0
        : paidAdvanceByQ['ndfl_annual'] || 0
      return {
        quarter: qIdx + 1,
        incomeQ: incomeByQ[qIdx],
        expenseQ: expenseByQ[qIdx],
        incomeCum, expenseCum, base, ndflCum, advanceDue, actuallyPaidThisQ,
        diff: actuallyPaidThisQ - advanceDue,
      }
    })
    return rows
  }, [incomes, expenses, taxPayments, taxSettings])

  // ------------------------------------------------------------
  // Взносы (фиксированные + 1% ОПС)
  // ------------------------------------------------------------
  const contributionsCalc = useMemo(() => {
    if (!taxSettings) return null
    const totalIncome = incomes.reduce((a, b) => a + b.amount, 0)

    let months = 12
    if (taxSettings.cabinet_start_date) {
      const start = new Date(taxSettings.cabinet_start_date)
      if (start.getFullYear() === year) {
        months = 12 - start.getMonth()
      }
    }
    const fixedDue = taxSettings.fixed_contribution_total * months / 12
    const opsBase = Math.max(0, totalIncome - taxSettings.ops_threshold)
    const opsDue = Math.min(opsBase * 0.01, taxSettings.ops_one_percent_cap)

    const paidFixed = taxPayments.filter(p => p.payment_type === 'fixed_contributions').reduce((a, b) => a + b.amount, 0)
    const paidOps = taxPayments.filter(p => p.payment_type === 'ops_one_percent').reduce((a, b) => a + b.amount, 0)

    return { totalIncome, months, fixedDue, opsBase, opsDue, paidFixed, paidOps }
  }, [incomes, taxPayments, taxSettings, year])

  // ------------------------------------------------------------
  // CRUD расходов
  // ------------------------------------------------------------
  function startEditExpense(e: Expense) {
    setEditExpenseId(e.id)
    setExpenseForm({
      expense_date: e.expense_date,
      category: e.category,
      amount: String(e.amount),
      description: e.description,
      is_documented: e.is_documented,
      doc_no: e.doc_no || '',
    })
    setShowExpenseForm(true)
  }

  function resetExpenseForm() {
    setExpenseForm(emptyExpenseForm)
    setEditExpenseId(null)
    setShowExpenseForm(false)
  }

  async function submitExpense() {
    const amountNum = parseFloat(expenseForm.amount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму'); return }
    setSubmitting(true)
    const payload = {
      expense_date: expenseForm.expense_date,
      category: expenseForm.category,
      amount: amountNum,
      description: expenseForm.description,
      is_documented: expenseForm.is_documented,
      doc_no: expenseForm.doc_no || null,
    }
    const { error } = editExpenseId
      ? await supabase.from('expenses').update(payload).eq('id', editExpenseId)
      : await supabase.from('expenses').insert(payload)

    setSubmitting(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success(editExpenseId ? 'Расход обновлён' : 'Расход добавлен')
    resetExpenseForm()
    loadAll()
  }

  async function deleteExpense(id: string) {
    if (!confirm('Удалить расход?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Удалено')
    loadAll()
  }

  // ------------------------------------------------------------
  // CRUD ручных доходов
  // ------------------------------------------------------------
  function startEditIncome(row: IncomeRow) {
    if (row.source !== 'manual') return // редактировать можно только ручные записи
    setEditIncomeId(row.id)
    setIncomeForm({
      income_date: row.pay_date,
      client_id: row.client_id ?? '',
      matter_id: row.matter_id ?? '',
      amount: String(row.amount),
      description: row.description,
      doc_no: row.doc_no || '',
    })
    setShowIncomeForm(true)
  }

  function resetIncomeForm() {
    setIncomeForm(emptyIncomeForm)
    setEditIncomeId(null)
    setShowIncomeForm(false)
  }

  async function submitIncome() {
    const amountNum = parseFloat(incomeForm.amount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму'); return }
    setSubmitting(true)
    const payload = {
      income_date: incomeForm.income_date,
      client_id: incomeForm.client_id || null,
      matter_id: incomeForm.matter_id || null,
      amount: amountNum,
      description: incomeForm.description,
      doc_no: incomeForm.doc_no || null,
    }
    const { error } = editIncomeId
      ? await supabase.from('manual_income').update(payload).eq('id', editIncomeId)
      : await supabase.from('manual_income').insert(payload)

    setSubmitting(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success(editIncomeId ? 'Доход обновлён' : 'Доход добавлен')
    resetIncomeForm()
    loadAll()
  }

  async function deleteIncome(id: string) {
    if (!confirm('Удалить запись о доходе?')) return
    const { error } = await supabase.from('manual_income').delete().eq('id', id)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Удалено')
    loadAll()
  }

  async function submitTaxPayment() {
    const amountNum = parseFloat(paymentForm.amount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму'); return }
    setSubmitting(true)
    const { error } = await supabase.from('tax_payments').insert({
      payment_date: paymentForm.payment_date,
      payment_type: paymentForm.payment_type,
      period_year: year,
      amount: amountNum,
      doc_no: paymentForm.doc_no || null,
      notes: paymentForm.notes || null,
    })
    setSubmitting(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Платёж добавлен')
    setShowPaymentForm(false)
    setPaymentForm({ payment_date: format(new Date(), 'yyyy-MM-dd'), payment_type: 'ndfl_advance_q1', amount: '', doc_no: '', notes: '' })
    loadAll()
  }

  async function submitContribPayment() {
    const amountNum = parseFloat(contribPaymentForm.amount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму'); return }
    setSubmitting(true)
    const { error } = await supabase.from('tax_payments').insert({
      payment_date: contribPaymentForm.payment_date,
      payment_type: contribPaymentForm.payment_type,
      period_year: year,
      amount: amountNum,
      doc_no: contribPaymentForm.doc_no || null,
    })
    setSubmitting(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Платёж добавлен')
    setShowContribPaymentForm(false)
    setContribPaymentForm({ payment_date: format(new Date(), 'yyyy-MM-dd'), payment_type: 'fixed_contributions', amount: '', doc_no: '' })
    loadAll()
  }

  async function deleteTaxPayment(id: string) {
    if (!confirm('Удалить запись об уплате?')) return
    const { error } = await supabase.from('tax_payments').delete().eq('id', id)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Удалено')
    loadAll()
  }

  const expensesTotal = expenses.filter(e => e.is_documented).reduce((a, b) => a + b.amount, 0)
  const incomeTotal = incomes.reduce((a, b) => a + b.amount, 0)

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'income', label: 'Доходы', icon: Wallet },
    { id: 'expenses', label: 'Расходы', icon: Receipt },
    { id: 'calc', label: 'Расчёт НДФЛ', icon: Calculator },
    { id: 'contributions', label: 'Взносы', icon: ShieldCheck },
    { id: 'calculator', label: 'Калькулятор', icon: Calculator },
  ]

  if (loading) {
    return <div className="p-7 text-navy-500 text-sm">Загрузка…</div>
  }

  return (
    <div className="p-4 md:p-7 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-navy-100 flex items-center gap-2">
          <Wallet className="w-6 h-6 text-gold-400" />
          Доходы и налоги
        </h1>
        <p className="text-sm text-navy-500 mt-1">
          Учёт доходов и профессиональных вычетов, расчёт НДФЛ и страховых взносов за {year} год
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-gold-500 text-navy-950' : 'bg-navy-800 text-navy-400 hover:text-navy-200'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ============ ДОХОДЫ ============ */}
      {tab === 'income' && (
        <div>
          <div className="card mb-4">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">Итого доходов за {year} год</span>
              <span className="text-xl font-bold text-emerald-400">{fmt2(incomeTotal)} ₽</span>
            </div>
            <p className="text-xs text-navy-600 mt-2">
              Оплаты по актам подтягиваются автоматически из раздела «Акты / Оплаты». Доходы, не проходящие через
              акты (авансы наличными, доходы по отдельным договорам), можно добавить вручную ниже.
            </p>
          </div>

          <div className="flex justify-between items-center mb-3">
            <p className="text-xs text-navy-600">💡 Двойной клик по ручной записи — редактировать</p>
            <button onClick={() => { resetIncomeForm(); setShowIncomeForm(true) }}
              className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400">
              <Plus className="w-4 h-4" /> Добавить доход
            </button>
          </div>

          {showIncomeForm && (
            <div className="card mb-4 border-gold-800/40">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-sm font-semibold text-gold-400">
                  {editIncomeId ? 'Редактировать доход' : 'Новый доход (ручная запись)'}
                </h2>
                <button onClick={resetIncomeForm} className="text-navy-400 hover:text-navy-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="label">Дата</label>
                  <input type="date" className="input" value={incomeForm.income_date}
                    onChange={e => setIncomeForm(f => ({ ...f, income_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Клиент</label>
                  <select className="select" value={incomeForm.client_id}
                    onChange={e => setIncomeForm(f => ({ ...f, client_id: e.target.value, matter_id: '' }))}>
                    <option value="">— не указан —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Дело</label>
                  <select className="select" value={incomeForm.matter_id}
                    onChange={e => setIncomeForm(f => ({ ...f, matter_id: e.target.value }))}>
                    <option value="">— не указано —</option>
                    {matters
                      .filter(m => !incomeForm.client_id || m.clients?.id === incomeForm.client_id)
                      .map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Сумма</label>
                  <input type="number" className="input" value={incomeForm.amount}
                    onChange={e => setIncomeForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Описание</label>
                  <input type="text" className="input" value={incomeForm.description}
                    onChange={e => setIncomeForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Например: аванс наличными по устной договорённости" />
                </div>
                <div>
                  <label className="label">№ документа</label>
                  <input type="text" className="input" value={incomeForm.doc_no}
                    onChange={e => setIncomeForm(f => ({ ...f, doc_no: e.target.value }))} />
                </div>
                <div className="flex items-end">
                  <button onClick={submitIncome} disabled={submitting}
                    className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400 disabled:opacity-50 w-full justify-center">
                    <Check className="w-4 h-4" /> {editIncomeId ? 'Сохранить' : 'Добавить'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Desktop table */}
          <div className="card overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-navy-500 border-b border-navy-800">
                  <th className="pb-2 font-medium">Дата</th>
                  <th className="pb-2 font-medium">Квартал</th>
                  <th className="pb-2 font-medium">Клиент</th>
                  <th className="pb-2 font-medium">Дело</th>
                  <th className="pb-2 font-medium">Источник</th>
                  <th className="pb-2 font-medium text-right">Сумма</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {incomes.map(i => (
                  <tr key={`${i.source}-${i.id}`}
                    onDoubleClick={() => startEditIncome(i)}
                    title={i.source === 'manual' ? 'Двойной клик — редактировать' : 'Из раздела Акты — редактируется там'}
                    className={`border-b border-navy-800/40 table-row-hover ${i.source === 'manual' ? 'cursor-pointer' : ''}`}>
                    <td className="py-2">{format(new Date(i.pay_date), 'dd.MM.yyyy')}</td>
                    <td className="py-2 text-navy-500">{QUARTER_LABELS[i.pay_quarter - 1]}</td>
                    <td className="py-2">{i.client_name}</td>
                    <td className="py-2 text-navy-500">{i.matter_title || '—'}</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        i.source === 'manual' ? 'bg-navy-700 text-navy-300' : 'bg-emerald-900/40 text-emerald-400'
                      }`}>
                        {i.source === 'manual' ? 'Вручную' : 'Акт/Оплата'}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium">{fmt2(i.amount)} ₽</td>
                    <td className="py-2 text-right">
                      {i.source === 'manual' && (
                        <button onClick={() => deleteIncome(i.id)} className="text-navy-600 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {incomes.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-navy-600">Нет данных за {year} год</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden">
            {incomes.length === 0 ? (
              <p className="card text-center text-navy-600 text-sm py-6">Нет данных за {year} год</p>
            ) : (
              <div className="space-y-2">
                {incomes.map(i => (
                  <div key={`${i.source}-${i.id}`}
                    onClick={() => i.source === 'manual' && startEditIncome(i)}
                    className={`card p-3 ${i.source === 'manual' ? 'active:bg-navy-800/60' : ''} transition-colors`}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-navy-200 text-sm font-medium truncate">{i.client_name}</p>
                        <p className="text-navy-500 text-xs truncate">{i.matter_title || '—'}</p>
                      </div>
                      <span className="text-navy-400 font-mono text-xs whitespace-nowrap flex-shrink-0">
                        {format(new Date(i.pay_date), 'dd.MM.yy')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-navy-800/60">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        i.source === 'manual' ? 'bg-navy-700 text-navy-300' : 'bg-emerald-900/40 text-emerald-400'
                      }`}>
                        {i.source === 'manual' ? 'Вручную' : 'Акт/Оплата'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{fmt2(i.amount)} ₽</span>
                        {i.source === 'manual' && (
                          <button onClick={ev => { ev.stopPropagation(); deleteIncome(i.id) }}
                            className="text-navy-600 hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ РАСХОДЫ ============ */}
      {tab === 'expenses' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="card !py-3 !px-4 inline-flex items-baseline gap-2">
              <span className="text-sm text-navy-500">Итого вычетов (документально подтверждённых)</span>
              <span className="text-lg font-bold text-gold-400">{fmt2(expensesTotal)} ₽</span>
            </div>
            <button
              onClick={() => { resetExpenseForm(); setShowExpenseForm(true) }}
              className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400"
            >
              <Plus className="w-4 h-4" /> Добавить расход
            </button>
          </div>

          {showExpenseForm && (
            <div className="card mb-4 border-gold-800/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Дата</label>
                  <input type="date" className="input" value={expenseForm.expense_date}
                    onChange={e => setExpenseForm(f => ({ ...f, expense_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Категория</label>
                  <select className="select" value={expenseForm.category}
                    onChange={e => setExpenseForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}>
                    {EXPENSE_CATEGORY_OPTIONS.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Сумма</label>
                  <div className="relative">
                    <input type="number" className="input pr-10" value={expenseForm.amount}
                      onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-500 text-sm">₽</span>
                  </div>
                </div>
                <div>
                  <label className="label">№ подтверждающего документа</label>
                  <input type="text" className="input" value={expenseForm.doc_no}
                    onChange={e => setExpenseForm(f => ({ ...f, doc_no: e.target.value }))} placeholder="необязательно" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Описание</label>
                  <input type="text" className="input" value={expenseForm.description}
                    onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-navy-300">
                    <input type="checkbox" checked={expenseForm.is_documented}
                      onChange={e => setExpenseForm(f => ({ ...f, is_documented: e.target.checked }))} />
                    Документально подтверждено (иначе не уменьшает базу НДФЛ — ст. 221 НК РФ)
                  </label>
                </div>
              </div>

              {EXPENSE_CATEGORY_RISKY[expenseForm.category] && (
                <div className="mt-3 flex gap-2 text-xs text-amber-400 bg-amber-950/20 border border-amber-900/40 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{EXPENSE_CATEGORY_RISKY[expenseForm.category]}</span>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button onClick={submitExpense} disabled={submitting}
                  className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400 disabled:opacity-50">
                  <Check className="w-4 h-4" /> {editExpenseId ? 'Сохранить' : 'Добавить'}
                </button>
                <button onClick={resetExpenseForm}
                  className="flex items-center gap-1.5 bg-navy-800 text-navy-400 py-2 px-4 rounded-lg text-sm font-medium hover:text-navy-200">
                  <X className="w-4 h-4" /> Отмена
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-navy-600 mb-2">
            <span className="hidden md:inline">Двойной клик по строке — редактировать</span>
            <span className="md:hidden">Нажмите на расход — редактировать</span>
          </p>

          {/* Desktop table */}
          <div className="card overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-navy-500 border-b border-navy-800">
                  <th className="pb-2 font-medium">Дата</th>
                  <th className="pb-2 font-medium">Категория</th>
                  <th className="pb-2 font-medium">Описание</th>
                  <th className="pb-2 font-medium">Подтв.</th>
                  <th className="pb-2 font-medium text-right">Сумма</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id}
                    onDoubleClick={() => startEditExpense(e)}
                    title="Двойной клик — редактировать"
                    className="border-b border-navy-800/40 table-row-hover cursor-pointer">
                    <td className="py-2">{format(new Date(e.expense_date), 'dd.MM.yyyy')}</td>
                    <td className="py-2">{EXPENSE_CATEGORY_LABELS[e.category]}</td>
                    <td className="py-2 text-navy-500">{e.description || '—'}</td>
                    <td className="py-2">
                      {e.is_documented
                        ? <Check className="w-4 h-4 text-emerald-400" />
                        : <X className="w-4 h-4 text-red-400" />}
                    </td>
                    <td className="py-2 text-right font-medium">{fmt2(e.amount)} ₽</td>
                    <td className="py-2 text-right">
                      <button onClick={(ev) => { ev.stopPropagation(); deleteExpense(e.id) }}
                        className="text-navy-600 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-navy-600">Пока нет расходов</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden">
            {expenses.length === 0 ? (
              <p className="card text-center text-navy-600 text-sm py-6">Пока нет расходов</p>
            ) : (
              <div className="space-y-2">
                {expenses.map(e => (
                  <div key={e.id}
                    onClick={() => startEditExpense(e)}
                    className="card p-3 active:bg-navy-800/60 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-navy-200 text-sm font-medium truncate">{EXPENSE_CATEGORY_LABELS[e.category]}</p>
                        <p className="text-navy-500 text-xs truncate">{e.description || '—'}</p>
                      </div>
                      <span className="text-navy-400 font-mono text-xs whitespace-nowrap flex-shrink-0">
                        {format(new Date(e.expense_date), 'dd.MM.yy')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-navy-800/60">
                      <span className="flex items-center gap-1 text-xs text-navy-500">
                        {e.is_documented
                          ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Подтверждено</>
                          : <><X className="w-3.5 h-3.5 text-red-400" /> Без подтверждения</>}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{fmt2(e.amount)} ₽</span>
                        <button onClick={ev => { ev.stopPropagation(); deleteExpense(e.id) }}
                          className="text-navy-600 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ РАСЧЁТ НДФЛ ============ */}
      {tab === 'calc' && quarterlyCalc && (
        <div className="space-y-4">
          {quarterlyCalc.map(row => (
            <div key={row.quarter} className="card">
              <h2 className="text-sm font-semibold text-navy-200 mb-3 pb-3 border-b border-navy-800">
                {QUARTER_LABELS[row.quarter - 1]}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                <div>
                  <div className="text-navy-500 text-xs mb-1">Доход нараст. итогом</div>
                  <div className="font-medium text-navy-100">{fmt2(row.incomeCum)} ₽</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs mb-1">Вычеты нараст. итогом</div>
                  <div className="font-medium text-navy-100">{fmt2(row.expenseCum)} ₽</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs mb-1">Налоговая база</div>
                  <div className="font-medium text-navy-100">{fmt2(row.base)} ₽</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs mb-1">НДФЛ нараст. итогом</div>
                  <div className="font-medium text-gold-400">{fmt2(row.ndflCum)} ₽</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm pt-3 border-t border-navy-800">
                <div>
                  <div className="text-navy-500 text-xs mb-1">Расчётный аванс к уплате</div>
                  <div className="font-semibold text-navy-100">{fmt2(row.advanceDue)} ₽</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs mb-1">Фактически уплачено</div>
                  <div className="font-semibold text-navy-100">{fmt2(row.actuallyPaidThisQ)} ₽</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs mb-1">Разница (уплачено − расчёт)</div>
                  <div className={`font-semibold ${row.diff < 0 ? 'text-red-400' : row.diff > 0 ? 'text-emerald-400' : 'text-navy-300'}`}>
                    {row.diff > 0 ? '+' : ''}{fmt2(row.diff)} ₽
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="card border-gold-800/40">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-gold-400">Внести фактическую уплату</h2>
              <button onClick={() => setShowPaymentForm(v => !v)} className="text-navy-400 hover:text-navy-200">
                <ChevronDown className={`w-4 h-4 transition-transform ${showPaymentForm ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {showPaymentForm && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="label">Дата платежа</label>
                  <input type="date" className="input" value={paymentForm.payment_date}
                    onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Тип платежа</label>
                  <select className="select" value={paymentForm.payment_type}
                    onChange={e => setPaymentForm(f => ({ ...f, payment_type: e.target.value as TaxPaymentType }))}>
                    {(Object.entries(TAX_PAYMENT_TYPE_LABELS) as [TaxPaymentType, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Сумма</label>
                  <input type="number" className="input" value={paymentForm.amount}
                    onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="label">№ платёжки</label>
                  <input type="text" className="input" value={paymentForm.doc_no}
                    onChange={e => setPaymentForm(f => ({ ...f, doc_no: e.target.value }))} />
                </div>
                <div className="md:col-span-4">
                  <button onClick={submitTaxPayment} disabled={submitting}
                    className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400 disabled:opacity-50">
                    <Check className="w-4 h-4" /> Записать уплату
                  </button>
                </div>
              </div>
            )}
            {/* Desktop table */}
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="text-left text-navy-500 border-b border-navy-800">
                  <th className="pb-2 font-medium">Дата</th>
                  <th className="pb-2 font-medium">Тип</th>
                  <th className="pb-2 font-medium">№ документа</th>
                  <th className="pb-2 font-medium text-right">Сумма</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {taxPayments.filter(p => p.payment_type.startsWith('ndfl')).map(p => (
                  <tr key={p.id} className="border-b border-navy-800/40 table-row-hover">
                    <td className="py-2">{format(new Date(p.payment_date), 'dd.MM.yyyy')}</td>
                    <td className="py-2">{TAX_PAYMENT_TYPE_LABELS[p.payment_type]}</td>
                    <td className="py-2 text-navy-500">{p.doc_no || '—'}</td>
                    <td className="py-2 text-right font-medium">{fmt2(p.amount)} ₽</td>
                    <td className="py-2 text-right">
                      <button onClick={() => deleteTaxPayment(p.id)} className="text-navy-600 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {taxPayments.filter(p => p.payment_type.startsWith('ndfl')).length === 0 ? (
                <p className="text-navy-600 text-sm text-center py-4">Платежи по НДФЛ ещё не внесены</p>
              ) : (
                taxPayments.filter(p => p.payment_type.startsWith('ndfl')).map(p => (
                  <div key={p.id} className="rounded-lg border border-navy-800 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-navy-200 text-sm">{TAX_PAYMENT_TYPE_LABELS[p.payment_type]}</p>
                      <span className="text-navy-400 font-mono text-xs whitespace-nowrap flex-shrink-0">
                        {format(new Date(p.payment_date), 'dd.MM.yy')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-navy-500 text-xs">{p.doc_no || '—'}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{fmt2(p.amount)} ₽</span>
                        <button onClick={() => deleteTaxPayment(p.id)} className="text-navy-600 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {taxSettings && (
            <p className="text-xs text-navy-600">
              Сроки авансов {year}: I кв. — {format(new Date(taxSettings.advance_q1_deadline!), 'dd.MM.yyyy')},
              полугодие — {format(new Date(taxSettings.advance_q2_deadline!), 'dd.MM.yyyy')},
              9 мес. — {format(new Date(taxSettings.advance_q3_deadline!), 'dd.MM.yyyy')} (п. 8 ст. 227 НК РФ).
              Итог года — {format(new Date(taxSettings.annual_deadline!), 'dd.MM.yyyy')} (3-НДФЛ).
            </p>
          )}
        </div>
      )}

      {/* ============ ВЗНОСЫ ============ */}
      {tab === 'contributions' && contributionsCalc && taxSettings && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-navy-200 mb-3 pb-3 border-b border-navy-800">
              Фиксированные взносы (ст. 430 НК РФ)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-navy-500 text-xs mb-1">Полная годовая сумма</div>
                <div className="font-medium text-navy-100">{fmt2(taxSettings.fixed_contribution_total)} ₽</div>
              </div>
              <div>
                <div className="text-navy-500 text-xs mb-1">Месяцев деятельности</div>
                <div className="font-medium text-navy-100">{contributionsCalc.months}</div>
              </div>
              <div>
                <div className="text-navy-500 text-xs mb-1">К уплате (пропорционально)</div>
                <div className="font-semibold text-gold-400">{fmt2(contributionsCalc.fixedDue)} ₽</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-navy-800 flex justify-between text-sm">
              <span className="text-navy-500">Уплачено фактически</span>
              <span className="font-medium text-navy-100">{fmt2(contributionsCalc.paidFixed)} ₽</span>
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-navy-200 mb-3 pb-3 border-b border-navy-800">
              1% ОПС с дохода свыше 300 000 ₽ (п. 1 ст. 430 НК РФ)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-navy-500 text-xs mb-1">Совокупный доход за год</div>
                <div className="font-medium text-navy-100">{fmt2(contributionsCalc.totalIncome)} ₽</div>
              </div>
              <div>
                <div className="text-navy-500 text-xs mb-1">Порог</div>
                <div className="font-medium text-navy-100">{fmt2(taxSettings.ops_threshold)} ₽</div>
              </div>
              <div>
                <div className="text-navy-500 text-xs mb-1">Предел взноса</div>
                <div className="font-medium text-navy-100">{fmt2(taxSettings.ops_one_percent_cap)} ₽</div>
              </div>
              <div>
                <div className="text-navy-500 text-xs mb-1">К уплате</div>
                <div className="font-semibold text-gold-400">{fmt2(contributionsCalc.opsDue)} ₽</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-navy-800 flex justify-between text-sm">
              <span className="text-navy-500">Уплачено фактически</span>
              <span className="font-medium text-navy-100">{fmt2(contributionsCalc.paidOps)} ₽</span>
            </div>
            <p className="text-xs text-navy-600 mt-3">
              Срок уплаты — не позднее {taxSettings.ops_deadline && format(new Date(taxSettings.ops_deadline), 'dd.MM.yyyy')} г.
              Взносы можно уплатить любыми частями в течение года, не дожидаясь срока (ст. 45 НК РФ) —
              это позволяет включить сумму в вычет уже в {year} году (абз. 4 п. 1 ст. 221 НК РФ: «начисленные либо уплаченные»).
            </p>
          </div>

          <div className="card border-gold-800/40">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-gold-400">Внести фактическую уплату взносов</h2>
              <button onClick={() => setShowContribPaymentForm(v => !v)} className="text-navy-400 hover:text-navy-200">
                <ChevronDown className={`w-4 h-4 transition-transform ${showContribPaymentForm ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {showContribPaymentForm && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="label">Дата платежа</label>
                  <input type="date" className="input" value={contribPaymentForm.payment_date}
                    onChange={e => setContribPaymentForm(f => ({ ...f, payment_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Тип взноса</label>
                  <select className="select" value={contribPaymentForm.payment_type}
                    onChange={e => setContribPaymentForm(f => ({ ...f, payment_type: e.target.value as TaxPaymentType }))}>
                    <option value="fixed_contributions">{TAX_PAYMENT_TYPE_LABELS['fixed_contributions']}</option>
                    <option value="ops_one_percent">{TAX_PAYMENT_TYPE_LABELS['ops_one_percent']}</option>
                  </select>
                </div>
                <div>
                  <label className="label">Сумма</label>
                  <input type="number" className="input" value={contribPaymentForm.amount}
                    onChange={e => setContribPaymentForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="label">№ платёжки</label>
                  <input type="text" className="input" value={contribPaymentForm.doc_no}
                    onChange={e => setContribPaymentForm(f => ({ ...f, doc_no: e.target.value }))} />
                </div>
                <div className="md:col-span-4">
                  <button onClick={submitContribPayment} disabled={submitting}
                    className="flex items-center gap-1.5 bg-gold-500 text-navy-950 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gold-400 disabled:opacity-50">
                    <Check className="w-4 h-4" /> Записать уплату
                  </button>
                </div>
              </div>
            )}
            {/* Desktop table */}
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="text-left text-navy-500 border-b border-navy-800">
                  <th className="pb-2 font-medium">Дата</th>
                  <th className="pb-2 font-medium">Тип</th>
                  <th className="pb-2 font-medium">№ документа</th>
                  <th className="pb-2 font-medium text-right">Сумма</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {taxPayments.filter(p => p.payment_type === 'fixed_contributions' || p.payment_type === 'ops_one_percent').map(p => (
                  <tr key={p.id} className="border-b border-navy-800/40 table-row-hover">
                    <td className="py-2">{format(new Date(p.payment_date), 'dd.MM.yyyy')}</td>
                    <td className="py-2">{TAX_PAYMENT_TYPE_LABELS[p.payment_type]}</td>
                    <td className="py-2 text-navy-500">{p.doc_no || '—'}</td>
                    <td className="py-2 text-right font-medium">{fmt2(p.amount)} ₽</td>
                    <td className="py-2 text-right">
                      <button onClick={() => deleteTaxPayment(p.id)} className="text-navy-600 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {taxPayments.filter(p => p.payment_type === 'fixed_contributions' || p.payment_type === 'ops_one_percent').length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-navy-600">Платежи по взносам ещё не внесены</td></tr>
                )}
              </tbody>
            </table>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {taxPayments.filter(p => p.payment_type === 'fixed_contributions' || p.payment_type === 'ops_one_percent').length === 0 ? (
                <p className="text-navy-600 text-sm text-center py-4">Платежи по взносам ещё не внесены</p>
              ) : (
                taxPayments.filter(p => p.payment_type === 'fixed_contributions' || p.payment_type === 'ops_one_percent').map(p => (
                  <div key={p.id} className="rounded-lg border border-navy-800 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-navy-200 text-sm">{TAX_PAYMENT_TYPE_LABELS[p.payment_type]}</p>
                      <span className="text-navy-400 font-mono text-xs whitespace-nowrap flex-shrink-0">
                        {format(new Date(p.payment_date), 'dd.MM.yy')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-navy-500 text-xs">{p.doc_no || '—'}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{fmt2(p.amount)} ₽</span>
                        <button onClick={() => deleteTaxPayment(p.id)} className="text-navy-600 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ КАЛЬКУЛЯТОР НДФЛ (разовый расчёт) ============ */}
      {tab === 'calculator' && <CalculatorTab />}
    </div>
  )
}
