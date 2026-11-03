'use client'
import { useUnsavedChanges } from '@/lib/unsaved-changes'
import { useEffect, useRef, useState } from 'react'
import { Client, Matter, ReimbursableExpense } from '@/types'
import { createClient } from '@/lib/supabase'
import { Allocation, allocationError, allocationTotal, moneyText, readAllRows } from '@/lib/billing'
import Modal from './Modal'
import ChangeHistory from './ChangeHistory'
import { useEscapeKey } from '@/lib/form-keys'
import toast from 'react-hot-toast'

export interface AllocatedPayment {
  id: string; client_id: string; amount: number | string; pay_date: string; doc_no: string | null; revision?: number;
}
type Line = Allocation & { key: string }
export default function PaymentAllocationEditor({ payment, matters, onClose, onSaved }: {
  payment: AllocatedPayment; matters: (Matter & { clients: Client })[]; onClose: () => void; onSaved: () => void;
}) {
  const db = createClient()
  const [rows, setRows] = useState<Line[]>([])
  const [acts, setActs] = useState<{ id: string; act_no: string; matter_id: string }[]>([])
  const [expenses, setExpenses] = useState<ReimbursableExpense[]>([])
  const [revision, setRevision] = useState(payment.revision ?? 0)
  const [busy, setBusy] = useState(true), [error, setError] = useState('')
  const operation = useRef<string | null>(null)
  const original=useRef('[]')
  const dirty=JSON.stringify(rows)!==original.current
  useUnsavedChanges(dirty)
  const close=()=>{if(!busy&&(!dirty||confirm('Есть несохранённое распределение. Закрыть без сохранения?')))onClose()}
  useEscapeKey(!busy, close)
  const available = matters.filter(m => m.client_id === payment.client_id)
  useEffect(() => {
    let active = true
    Promise.all([
      readAllRows<Allocation>(db, 'effective_payment_allocations', '*', q => q.eq('payment_id', payment.id)),
      readAllRows<{ id: string; act_no: string; matter_id: string }>(db, 'acts', 'id,act_no,matter_id', q => q.eq('client_id', payment.client_id).eq('is_void', false)),
      readAllRows<ReimbursableExpense>(db, 'reimbursable_expenses', '*', q => q.eq('payment_id', payment.id)),
      db.from('payments').select('revision').eq('id', payment.id).single(),
    ]).then(([saved, docs, exp, version]) => {
      if (!active) return
      if (version.error) throw version.error
      const lines=saved.map(r=>({...r,key:crypto.randomUUID()}));original.current=JSON.stringify(lines);setRows(lines)
      setActs(docs); setExpenses(exp); setRevision(version.data.revision)
    }).catch(() => active && setError('Не удалось загрузить распределение. Проверьте связь и выполнение миграций 024–026.'))
      .finally(() => active && setBusy(false))
    return () => { active = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.id])
  const change = (key: string, patch: Partial<Line>) => {
    operation.current = null
    setRows(current => current.map(r => r.key === key ? { ...r, ...patch } : r))
  }
  async function save() {
    const issue = allocationError(rows, payment.amount)
    if (issue) { setError(issue); return }
    setBusy(true); setError('')
    operation.current ??= crypto.randomUUID()
    try {
      const { error: failure } = await db.rpc('save_payment_allocations', {
        p_payment_id: payment.id, p_expected_revision: revision, p_operation_id: operation.current,
        p_rows: rows.map(({ matter_id, act_id, fee_amount, expense_amount }) => ({
          matter_id, act_id: act_id || null, fee_amount: Number(String(fee_amount).replace(',', '.')),
          expense_amount: Number(String(expense_amount).replace(',', '.')),
        })),
      })
      if (failure) throw failure
      toast.success('Платёж распределён'); onSaved(); onClose()
    } catch (e) { setError((e as { message?: string }).message ?? 'Не удалось сохранить. Повторите попытку.') }
    finally { setBusy(false) }
  }
  const assigned = allocationTotal(rows) / 100
  return <Modal open onClose={close} title="Распределение платежа" wide>
    <p className="text-sm mb-3">{payment.pay_date} · № {payment.doc_no || '—'} · <strong>{moneyText(Number(payment.amount))} ₽</strong></p>
    <p className="text-xs text-navy-300 mb-4">Одно поступление можно разделить между заданиями и актами. Остаток остаётся без распределения; при отсутствии начислений это аванс. Возмещения должны совпадать с отмеченными расходами платежа. Чтобы снять распределение, уберите все части и сохраните: сам платёж и связи с расходами сохранятся.</p>
    {error && <p role="alert" className="text-red-300 text-sm mb-3">{error}</p>}
    {expenses.length > 0 && <div className="card text-xs mb-4">Связанные возмещения: {expenses.map(e => `${available.find(m => m.id === e.matter_id)?.title ?? 'Задание'} — ${moneyText(Number(e.amount))} ₽`).join('; ')}.</div>}
    <div className="space-y-4">{rows.map((r, i) => <fieldset key={r.key} disabled={busy} className="card min-w-0">
      <legend className="text-xs px-1">Часть {i + 1}</legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs min-w-0">Задание<select aria-label={`Задание ${i + 1}`} className="input mt-1 min-h-11" value={r.matter_id} onChange={e => change(r.key, { matter_id: e.target.value, act_id: null })}>
          <option value="">Выберите задание</option>{available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select></label>
        <label className="text-xs min-w-0">Акт<select aria-label={`Акт ${i + 1}`} className="input mt-1 min-h-11" value={r.act_id || ''} onChange={e => change(r.key, { act_id: e.target.value || null })}>
          <option value="">Аванс / без привязки к акту</option>{acts.filter(a => a.matter_id === r.matter_id).map(a => <option key={a.id} value={a.id}>{a.act_no}</option>)}
        </select></label>
        <label className="text-xs">Вознаграждение, ₽<input aria-label={`Вознаграждение ${i + 1}`} className="input mt-1 min-h-11" type="number" step="0.01" min="0" inputMode="decimal" value={r.fee_amount} onChange={e => change(r.key, { fee_amount: e.target.value })} /></label>
        <label className="text-xs">Возмещение, ₽<input aria-label={`Возмещение ${i + 1}`} className="input mt-1 min-h-11" type="number" step="0.01" min="0" inputMode="decimal" value={r.expense_amount} onChange={e => change(r.key, { expense_amount: e.target.value })} /></label>
      </div>
      <button type="button" className="btn-secondary min-h-11 mt-3" onClick={() => { operation.current = null; setRows(v => v.filter(x => x.key !== r.key)) }}>Убрать часть</button>
    </fieldset>)}</div>
    <button className="btn-secondary min-h-11 mt-4" disabled={busy} onClick={() => { operation.current = null; setRows(v => [...v, { key: crypto.randomUUID(), matter_id: '', act_id: null, fee_amount: '0.00', expense_amount: '0.00' }]) }}>Добавить задание</button>
    <div className="card mt-4 text-sm space-y-1"><p>Распределено: <strong>{moneyText(assigned)} ₽</strong></p><p>Осталось распределить: <strong>{moneyText(Number(payment.amount) - assigned)} ₽</strong></p></div>
    <button className="btn-primary min-h-11 mt-4" disabled={busy || !!error.startsWith('Не удалось загрузить')} onClick={save}>{busy ? 'Обработка…' : 'Сохранить распределение'}</button>
    <ChangeHistory table="payments" rowId={payment.id} />
  </Modal>
}
