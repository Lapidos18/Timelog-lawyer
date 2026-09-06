'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Client } from '@/types'
import { format } from 'date-fns'
import { Upload, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@/components/Modal'
import { parseStatement, StatementRow } from '@/lib/bank-statement'

/**
 * Загрузка банковской выписки и внесение поступлений.
 *
 * Ручной ввод платежа — то место, где уже случилась ошибка: сумма 48 074
 * была внесена как 45 294, и расхождение всплыло только через два месяца
 * при разборе задолженности. Выписка — первоисточник, из неё сумма и дата
 * попадают без переписывания от руки.
 *
 * Ничего не вносится молча: приложение показывает разобранные строки,
 * подставляет доверителя по ИНН и отмечает уже внесённые, а решение по
 * каждой строке остаётся за пользователем.
 */

type Match = 'new' | 'existing' | 'skip'

type Prepared = StatementRow & {
  clientId: string
  match: Match
  checked: boolean
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function ImportStatement({
  open, onClose, clients, onImported,
}: {
  open: boolean
  onClose: () => void
  clients: Client[]
  onImported: () => void
}) {
  const supabase = createClient()
  const [rows, setRows] = useState<Prepared[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const parsed = await parseStatement(file)

      // Уже внесённые определяем по дате и сумме: банк не выгружает наш
      // внутренний идентификатор, а совпадение и того и другого в один день
      // практически наверняка означает тот же самый платёж
      const { data: existing } = await supabase.from('payments').select('pay_date, amount')
      const seen = new Set((existing ?? []).map(p => `${p.pay_date}|${Number(p.amount).toFixed(2)}`))

      setRows(parsed.rows.map(r => {
        const client = clients.find(c => c.inn && c.inn.trim() === r.counterpartyInn)
        const match: Match = r.skipReason ? 'skip'
          : seen.has(`${r.date}|${r.amount.toFixed(2)}`) ? 'existing'
          : 'new'
        return {
          ...r,
          clientId: client?.id ?? '',
          match,
          // По умолчанию отмечены только новые поступления от доверителей
          checked: match === 'new',
        }
      }))
      setFileName(file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл')
    }
    setBusy(false)
  }

  const selected = rows?.filter(r => r.checked) ?? []
  const selectedTotal = selected.reduce((s, r) => s + r.amount, 0)

  async function doImport() {
    if (selected.length === 0) return
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()

    let ok = 0
    let failed = 0
    for (const r of selected) {
      const description = r.purpose || 'Поступление по выписке'
      // Как и в ручной форме: без доверителя платёж физически не помещается
      // в payments и уходит в manual_income
      const { error } = r.clientId
        ? await supabase.from('payments').insert({
            client_id: r.clientId, matter_id: null, pay_date: r.date,
            amount: r.amount, description, doc_no: r.docNo || null, created_by: user!.id,
          })
        : await supabase.from('manual_income').insert({
            income_date: r.date, client_id: null, matter_id: null,
            amount: r.amount, description, doc_no: r.docNo || null, created_by: user!.id,
          })
      if (error) failed++; else ok++
    }

    setBusy(false)
    if (failed > 0) toast.error(`Внесено ${ok}, не удалось ${failed}`)
    else toast.success(`Внесено поступлений: ${ok}`)
    setRows(null); setFileName('')
    onImported()
    onClose()
  }

  function close() {
    setRows(null); setFileName('')
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Загрузка банковской выписки" wide>
      {!rows ? (
        <div>
          <p className="text-sm text-navy-300 mb-4">
            Выберите файл выписки в формате Excel — тот, что выгружается из клиент-банка.
            Приложение возьмёт из него поступления, подставит доверителя по ИНН плательщика
            и покажет список до того, как что-либо внести.
          </p>
          <label className="btn-primary cursor-pointer inline-flex">
            <Upload className="w-4 h-4" /> {busy ? 'Читаю файл...' : 'Выбрать файл выписки'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
          <p className="text-xs text-navy-400 mt-4">
            Списания не загружаются: налоги, взносы и переводы на личный счёт доходом не являются.
            Возмещаемые расходы после загрузки отметьте в самом платеже — двойной клик по строке.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-xs text-navy-400 mb-3">
            {fileName} · разобрано поступлений: {rows.length}
          </p>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {rows.map(r => (
              <label key={r.index}
                className={`tap flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer ${
                  r.checked ? 'border-gold-600/50 bg-gold-500/5' : 'border-navy-800 hover:bg-navy-800/40'
                }`}>
                <input type="checkbox" className="w-4 h-4 mt-0.5 accent-gold-500 flex-shrink-0"
                  checked={r.checked}
                  onChange={e => setRows(rs => rs!.map(x =>
                    x.index === r.index ? { ...x, checked: e.target.checked } : x))} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-sm text-navy-100">
                      <span className="num">{format(new Date(r.date), 'dd.MM.yyyy')}</span>
                      {' · '}
                      <span className="num font-medium">{fmt(r.amount)} ₽</span>
                    </span>
                    {r.match === 'existing' && (
                      <span className="text-xs text-emerald-400">уже внесено</span>
                    )}
                    {r.skipReason === 'own' && (
                      <span className="text-xs text-amber-400">перевод со своего счёта — не доход</span>
                    )}
                    {r.skipReason === 'bank' && (
                      <span className="text-xs text-amber-400">от банка — не гонорар</span>
                    )}
                  </span>
                  <span className="block text-xs text-navy-300 truncate mt-0.5">
                    {r.counterpartyName}{r.counterpartyInn ? ` · ИНН ${r.counterpartyInn}` : ''}
                  </span>
                  <span className="block text-xs text-navy-400 truncate">{r.purpose}</span>
                  <select className="select mt-2 text-xs" value={r.clientId}
                    onClick={e => e.preventDefault()}
                    onChange={e => setRows(rs => rs!.map(x =>
                      x.index === r.index ? { ...x, clientId: e.target.value } : x))}>
                    <option value="">— без доверителя (уйдёт в «Доходы» отдельной строкой) —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-4 border-t border-navy-800">
            <p className="text-sm text-navy-300">
              Отмечено: <span className="num text-navy-100">{selected.length}</span>
              {' · '}
              <span className="num text-navy-100">{fmt(selectedTotal)} ₽</span>
            </p>
            <div className="flex gap-3">
              <button onClick={doImport} disabled={busy || selected.length === 0} className="btn-primary">
                <Check className="w-4 h-4" /> {busy ? 'Вношу...' : 'Внести отмеченные'}
              </button>
              <button onClick={() => { setRows(null); setFileName('') }} className="btn-secondary">
                Другой файл
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
