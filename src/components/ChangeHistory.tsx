'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { format } from 'date-fns'
import { History } from 'lucide-react'
import { REIMBURSEMENT_STATUS_LABELS } from '@/types'

/**
 * История изменений одной записи из audit_log (миграция 013).
 *
 * Пишет туда триггер в базе, приложение только читает. Показываем не сырой
 * снимок строки, а разницу: какие поля изменились, что было и что стало —
 * иначе это нечитаемо, а вопрос обычно один: «почему сумма другая».
 *
 * Поля-идентификаторы (дело, доверитель, привязанный платёж) содержат UUID.
 * Показывать его бессмысленно, поэтому по ним пишем только сам факт
 * изменения; разворачивать их в названия — лишние запросы ради строки,
 * которая и так почти не встречается.
 */

type Row = {
  id: string
  action: 'insert' | 'update' | 'delete'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_at: string
}

const LABELS: Record<string, string> = {
  pay_date: 'Дата платежа',
  income_date: 'Дата поступления',
  expense_date: 'Дата расхода',
  reimbursed_date: 'Дата компенсации',
  period_from: 'Период с',
  period_to: 'Период по',
  amount: 'Сумма',
  description: 'Назначение',
  doc_no: '№ документа',
  act_no: '№ акта',
  status: 'Статус',
  matter_id: 'Дело',
  client_id: 'Доверитель',
  payment_id: 'Связанный платёж',
  is_billable: 'Оплачиваемость',
}

const ID_FIELDS = new Set(['matter_id', 'client_id', 'payment_id'])

// Технические поля, которые меняются сами и в истории только мешают
const SKIP = new Set(['id', 'created_at', 'updated_at', 'created_by'])

const ACT_STATUS: Record<string, string> = {
  draft: 'Черновик', signed: 'Подписан', paid: 'Оплачен',
}

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'amount') {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number(v)) + ' ₽'
  }
  if (field === 'status') {
    const s = String(v)
    return REIMBURSEMENT_STATUS_LABELS[s as keyof typeof REIMBURSEMENT_STATUS_LABELS]
      ?? ACT_STATUS[s] ?? s
  }
  if (field === 'is_billable') return v ? 'да' : 'нет'
  if (/_date$|^period_/.test(field) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return format(new Date(v), 'dd.MM.yyyy')
  }
  return String(v)
}

function diff(row: Row): { field: string; from: string; to: string }[] {
  const before = row.old_data ?? {}
  const after = row.new_data ?? {}
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter(k => !SKIP.has(k))
    .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map(k => ({
      field: LABELS[k] ?? k,
      from: ID_FIELDS.has(k) ? '' : fmtValue(k, before[k]),
      to: ID_FIELDS.has(k) ? '' : fmtValue(k, after[k]),
    }))
}

export default function ChangeHistory({ table, rowId }: { table: string; rowId: string }) {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    supabase.from('audit_log')
      .select('id, action, old_data, new_data, changed_at')
      .eq('table_name', table).eq('row_id', rowId)
      .order('changed_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) { setFailed(true); return }
        setRows((data ?? []) as Row[])
      })
  }, [table, rowId])

  // Пока миграция 013 не выполнена, таблицы нет — молчим, а не пугаем ошибкой
  if (failed || rows === null || rows.length === 0) return null

  return (
    <div className="mt-5 pt-4 border-t border-navy-800">
      <h3 className="text-xs font-medium text-navy-300 mb-3 flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> История изменений
      </h3>
      <ol className="space-y-2.5">
        {rows.map(r => {
          const changes = diff(r)
          return (
            <li key={r.id} className="text-xs">
              <span className="num text-navy-400">
                {format(new Date(r.changed_at), 'dd.MM.yyyy HH:mm')}
              </span>
              <span className="text-navy-300 ml-2">
                {r.action === 'insert' ? 'создано'
                  : r.action === 'delete' ? 'удалено'
                  : 'изменено'}
              </span>
              {r.action === 'update' && changes.length > 0 && (
                <ul className="mt-1 ml-1 space-y-0.5">
                  {changes.map(c => (
                    <li key={c.field} className="text-navy-400">
                      {c.field}:{' '}
                      {c.from || c.to ? (
                        <>
                          <span className="line-through">{c.from}</span>
                          {' → '}
                          <span className="text-navy-200">{c.to}</span>
                        </>
                      ) : 'изменено'}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
