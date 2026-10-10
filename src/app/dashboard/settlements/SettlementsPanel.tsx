'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Client } from '@/types'
import { ArrowLeftRight, ClipboardList, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import PageHeader from '@/components/PageHeader'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'
import LoadError from '@/components/LoadError'
import { SkeletonRows } from '@/components/Skeleton'
import { useEscapeKey } from '@/lib/form-keys'
import { isTouchLayout } from '@/lib/touch-layout'
import { CABINET_LINE } from '@/lib/print'
import {
  SettlementActRecord, SettlementDoc, SettlementRow, SettlementStatus, Balance,
  buildRowsUs, openingFrom, newSettlementDoc, normalizeDoc, tableTotals,
  toKop, fmtDate, formatMoney,
} from '@/lib/settlement-act'
import { printSettlement, exportSettlementWord } from '@/lib/settlement-print'
import { isSubscription, subscriptionAccruals } from '@/lib/balance'
import { shortDate } from '@/lib/act-doc'
import SettlementEditor from './SettlementEditor'

interface Editing {
  /** null — акт ещё не сохранялся */
  id: string | null
  clientId: string
  status: SettlementStatus
  doc: SettlementDoc
}

/**
 * Таблицы ещё нет в базе: код выкатывается раньше, чем пользователь выполнит
 * миграцию 019 (CLAUDE.md, раздел про новую колонку). Тогда страница должна
 * работать без сохранения, а не падать.
 */
const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' ||
    (/settlement_acts/.test(e.message ?? '') && /(schema cache|does not exist)/i.test(e.message ?? '')))

const sumKop = (rows: { amount: number | string }[] | null) =>
  (rows ?? []).reduce((s, r) => s + toKop(r.amount), 0)

/** Короткая строка о сальдо для списка */
function balanceLabel(doc: SettlementDoc): string {
  const net = tableTotals(doc.openingUs, doc.rowsUs).net
  if (net > 0) return `долг доверителя ${formatMoney(net)} ₽`
  if (net < 0) return `переплата доверителя ${formatMoney(-net)} ₽`
  return 'расчёты закрыты'
}

/** Доверитель и период, выбранные в «Платежах»: акт нужно составить сразу, без формы */
export interface ActDeepLink { clientId: string; from: string; to: string }

/**
 * Вид «Акты сверки» раздела «Платежи и акты сверки»: список составленных актов
 * и редактор акта «как в 1С». Раньше это была отдельная страница
 * /dashboard/settlements, теперь — вкладка рядом с платежами (CLAUDE.md, п. 19).
 */
export default function SettlementsPanel({ clients, switcher, deepLink, onDeepLinkDone }: {
  clients: Client[]
  /** Переключатель «Платежи / Акты сверки» для шапки списка */
  switcher: React.ReactNode
  deepLink: ActDeepLink | null
  onDeepLinkDone: () => void
}) {
  const supabase = createClient()
  const [acts, setActs] = useState<SettlementActRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)

  const [editing, setEditing] = useState<Editing | null>(null)
  /** Как выглядел акт при открытии или последнем сохранении: по нему видно, правили ли его */
  const [snapshot, setSnapshot] = useState('')
  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [form, setForm] = useState({ clientId: '', from: '', to: '' })
  const [creating, setCreating] = useState(false)

  useEscapeKey(newOpen, () => setNewOpen(false))

  const dirty = !!editing && JSON.stringify({ doc: editing.doc, status: editing.status }) !== snapshot

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const ac = await supabase.from('settlement_acts').select('*, clients(name)')
      .order('period_to', { ascending: false }).order('created_at', { ascending: false })
    if (ac.error) {
      if (isMissingTable(ac.error)) { setTableMissing(true); setActs([]) }
      else setLoadError(true)
    } else {
      setTableMissing(false)
      setActs((ac.data ?? []) as SettlementActRecord[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // Уходить со страницы с несохранённым актом — спросить
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /**
   * Данные за период для таблицы кабинета.
   *  — услуги: оплачиваемые записи журнала (report_view);
   *  — издержки: предъявленные («выставлено» и «компенсировано»), по дате расхода;
   *  — оплаты: платежи по дате поступления;
   *  — начальное сальдо: всё начисленное минус всё оплаченное ДО начала периода.
   */
  async function loadSource(clientId: string, from: string, to: string): Promise<{ rowsUs: SettlementRow[]; openingUs: Balance }> {
    // Все поля дела: условия абонплаты (миграция 021) могут отсутствовать, пока миграция не выполнена
    const { data: ms, error: me } = await supabase.from('matters').select('*').eq('client_id', clientId)
    if (me) throw me
    const matterIds = (ms ?? []).map(m => m.id as string)
    // Абонентские дела: по ним начисление — абонплата за месяц, а часы денег не создают (src/lib/balance.ts)
    const subs = (ms ?? []).filter(m => isSubscription(m))
    const subIds = new Set(subs.map(m => m.id as string))
    // Нет дел — нет и издержек; пустой ответ той же формы, чтобы не плодить ветки
    const none: Promise<{ data: any[]; error: null }> = Promise.resolve({ data: [], error: null })
    const statuses = ['invoiced', 'reimbursed']

    const [svc, svcBefore, pay, payBefore, exp, expBefore, accr] = await Promise.all([
      supabase.from('report_view').select('work_date, matter_title, amount, matter_id')
        .eq('client_id', clientId).eq('is_billable', true).gte('work_date', from).lte('work_date', to),
      supabase.from('report_view').select('amount, matter_id')
        .eq('client_id', clientId).eq('is_billable', true).lt('work_date', from),
      supabase.from('payments').select('pay_date, doc_no, amount')
        .eq('client_id', clientId).gte('pay_date', from).lte('pay_date', to),
      supabase.from('payments').select('amount').eq('client_id', clientId).lt('pay_date', from),
      matterIds.length
        ? supabase.from('reimbursable_expenses').select('expense_date, description, doc_no, amount')
            .in('matter_id', matterIds).in('status', statuses).gte('expense_date', from).lte('expense_date', to)
        : none,
      matterIds.length
        ? supabase.from('reimbursable_expenses').select('amount')
            .in('matter_id', matterIds).in('status', statuses).lt('expense_date', from)
        : none,
      // Начисления по актам (миграция 022). Пока таблицы нет — их просто нет: не ошибка
      matterIds.length
        ? supabase.from('matter_accruals').select('accrual_date, amount, description')
            .in('matter_id', matterIds).lte('accrual_date', to)
        : none,
    ])
    for (const r of [svc, svcBefore, pay, payBefore, exp, expBefore]) if (r.error) throw r.error

    const accrRows = (accr.error ? [] : (accr.data ?? [])) as { accrual_date: string; amount: number | string; description: string | null }[]
    const actInPeriod = accrRows.filter(a => a.accrual_date >= from)
      .map(a => ({ date: a.accrual_date, kop: toKop(a.amount), doc: a.description?.trim() || `Акт от ${shortDate(a.accrual_date)}` }))
    const actBeforeKop = accrRows.filter(a => a.accrual_date < from).reduce((s, a) => s + toKop(a.amount), 0)
    const notSub = (r: { matter_id?: string | null }) => !(r.matter_id && subIds.has(r.matter_id))
    const subAccruals = subs.flatMap(m => subscriptionAccruals(m, to))
    const subInPeriod = subAccruals.filter(a => a.date >= from)
    const subBeforeKop = subAccruals.filter(a => a.date < from).reduce((s, a) => s + a.kop, 0)

    return {
      rowsUs: buildRowsUs({
        periodFrom: from, periodTo: to,
        services: (svc.data ?? []).filter(notSub), expenses: exp.data ?? [], payments: pay.data ?? [],
        subscriptions: subInPeriod,
        actAccruals: actInPeriod,
      }),
      openingUs: openingFrom(
        sumKop((svcBefore.data ?? []).filter(notSub)) + sumKop(expBefore.data) + subBeforeKop + actBeforeKop,
        sumKop(payBefore.data)),
    }
  }

  async function startNew(client: Client, from: string, to: string) {
    if (!from || !to || to < from) { toast.error('Проверьте период: «по» не может быть раньше «с»'); return }
    setCreating(true)
    try {
      const src = await loadSource(client.id, from, to)
      // Договор с доверителем один на все акты: подставляем из его последнего акта, где он указан
      const contract = acts
        .filter(a => a.client_id === client.id)
        .map(a => normalizeDoc(a.doc, { from: a.period_from, to: a.period_to }).contract ?? '')
        .find(c => c.trim() !== '')
      const doc = newSettlementDoc({
        periodFrom: from, periodTo: to, clientName: client.name, clientInn: client.inn,
        cabinetLine: CABINET_LINE, contract, ...src,
      })
      setEditing({ id: null, clientId: client.id, status: 'draft', doc })
      setSnapshot('') // новый акт ещё не сохранён — считается изменённым
      setNewOpen(false)
    } catch (e) {
      console.error(e)
      toast.error('Не удалось собрать данные для акта. Попробуйте ещё раз.')
    } finally {
      setCreating(false)
    }
  }

  // «Составить акт сверки» из вида «Платежи»: доверитель и период уже выбраны
  useEffect(() => {
    if (!deepLink || clients.length === 0) return
    const client = clients.find(x => x.id === deepLink.clientId)
    onDeepLinkDone()
    if (client) startNew(client, deepLink.from, deepLink.to)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, clients])

  function openNewForm() {
    const now = new Date()
    setForm({
      clientId: clients[0]?.id ?? '',
      from: `${now.getFullYear()}-01-01`,
      to: format(now, 'yyyy-MM-dd'),
    })
    setNewOpen(true)
  }

  function openAct(a: SettlementActRecord) {
    const doc = normalizeDoc(a.doc, { from: a.period_from, to: a.period_to })
    setEditing({ id: a.id, clientId: a.client_id, status: a.status, doc })
    setSnapshot(JSON.stringify({ doc, status: a.status }))
  }

  function back() {
    if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return
    setEditing(null)
  }

  async function save(nextStatus?: SettlementStatus) {
    if (!editing) return
    const status = nextStatus ?? editing.status
    const doc = editing.doc
    if (!doc.periodFrom || !doc.periodTo || doc.periodTo < doc.periodFrom) {
      toast.error('Проверьте период: «по» не может быть раньше «с»')
      return
    }
    setSaving(true)
    const payload = { client_id: editing.clientId, period_from: doc.periodFrom, period_to: doc.periodTo, status, doc }
    let id = editing.id
    let error: { code?: string; message: string } | null = null
    if (id) {
      error = (await supabase.from('settlement_acts').update(payload).eq('id', id)).error
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const r = await supabase.from('settlement_acts').insert({ ...payload, created_by: user?.id ?? null }).select('id').single()
      error = r.error
      id = r.data?.id ?? null
    }
    setSaving(false)
    if (error) {
      if (isMissingTable(error)) {
        setTableMissing(true)
        toast.error('Акты пока негде хранить: в базе нет таблицы (миграция 019).')
      } else {
        toast.error('Не удалось сохранить: ' + error.message)
      }
      return
    }
    setEditing({ ...editing, id, status })
    setSnapshot(JSON.stringify({ doc, status }))
    toast.success(status === 'signed' ? 'Акт отмечен подписанным' : 'Акт сохранён')
    load()
  }

  function setStatus(next: SettlementStatus) {
    if (next === 'signed' && !confirm('Отметить акт подписанным? После этого править его нельзя, пока не вернёте в черновик.')) return
    save(next)
  }

  async function rebuild() {
    if (!editing) return
    if (!confirm('Таблица кабинета будет собрана заново из журнала, издержек и платежей за период. Ваши ручные правки в ней пропадут. Продолжить?')) return
    setRebuilding(true)
    try {
      const src = await loadSource(editing.clientId, editing.doc.periodFrom, editing.doc.periodTo)
      setEditing({ ...editing, doc: { ...editing.doc, ...src } })
      toast.success('Таблица кабинета пересобрана')
    } catch (e) {
      console.error(e)
      toast.error('Не удалось собрать данные. Попробуйте ещё раз.')
    } finally {
      setRebuilding(false)
    }
  }

  function print() {
    if (!editing) return
    if (!printSettlement(editing.doc)) {
      toast.error('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и попробуйте снова.')
      return
    }
    toast.success('Откроется диалог печати — выберите «Сохранить как PDF»')
  }

  async function word() {
    if (!editing) return
    try { await exportSettlementWord(editing.doc) }
    catch (e) { console.error(e); toast.error('Не удалось сформировать файл Word') }
  }

  async function remove(a: SettlementActRecord) {
    if (a.status === 'signed') { toast.error('Подписанный акт сначала верните в черновик'); return }
    if (!confirm('Удалить акт? Это нельзя отменить.')) return
    const { error } = await supabase.from('settlement_acts').delete().eq('id', a.id)
    if (error) { toast.error('Не удалось удалить: ' + error.message); return }
    toast.success('Акт удалён')
    load()
  }

  if (editing) {
    const clientName = clients.find(c => c.id === editing.clientId)?.name ?? editing.doc.them.name
    return (
      <SettlementEditor
        clientName={clientName} doc={editing.doc} status={editing.status}
        persisted={!!editing.id} dirty={dirty} saving={saving} rebuilding={rebuilding} tableMissing={tableMissing}
        onChange={doc => setEditing({ ...editing, doc })}
        onSave={() => save()} onSetStatus={setStatus} onRebuild={rebuild}
        onBack={back} onPrint={print} onWord={word}
      />
    )
  }

  const newButton = (
    <button type="button" className="btn-primary" onClick={openNewForm} disabled={clients.length === 0}>
      <Plus className="w-4 h-4" /> Новый акт
    </button>
  )

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Платежи и акты сверки" icon={ClipboardList}
        description="Акт сверки взаимных расчётов — форма, которой обмениваются контрагенты (такую же готовит 1С): две таблицы рядом, по данным кабинета и по данным доверителя, с дебетом, кредитом и сальдо. Собирается из журнала, издержек и платежей; любую строку можно поправить.">
        {switcher}
        {newButton}
      </PageHeader>

      {tableMissing && (
        <div className="card mb-5 text-sm text-amber-400">
          Чтобы акты сохранялись, один раз выполните SQL из файла supabase/migrations/019_settlement_acts.sql в Supabase.
          Составлять, печатать и выгружать акт в Word можно и без этого, но сохранить его пока нельзя.
        </div>
      )}

      {loadError && !loading && <LoadError onRetry={load} />}

      {!loadError && (
        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-5"><SkeletonRows rows={3} /></div>
          ) : acts.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="Актов сверки пока нет"
              description="Составьте первый: выберите доверителя и период, акт соберётся сам, дальше его можно дополнить вручную."
              action={clients.length > 0 ? newButton : undefined} />
          ) : (
            <>
              <p className="text-xs text-navy-400 px-4 md:px-5 pt-3">
                <span className="hidden md:inline">Двойной клик по акту — открыть.</span>
                <span className="md:hidden">Нажмите на акт, чтобы открыть.</span>
              </p>
              <ul className="divide-y divide-navy-800/60">
                {acts.map(a => {
                  const doc = normalizeDoc(a.doc, { from: a.period_from, to: a.period_to })
                  return (
                    <li key={a.id}
                      onDoubleClick={() => openAct(a)}
                      onClick={() => { if (isTouchLayout()) openAct(a) }}
                      title="Двойной клик — открыть"
                      className="flex items-start gap-3 px-4 md:px-5 py-3 cursor-pointer hover:bg-navy-800/40">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-navy-100 break-words">{a.clients?.name ?? doc.them.name}</p>
                        <p className="text-xs text-navy-300 mt-0.5">
                          {fmtDate(a.period_from)} — {fmtDate(a.period_to)} · {balanceLabel(doc)}
                        </p>
                        <p className="text-xs text-navy-400 mt-0.5">обновлён {format(new Date(a.updated_at), 'dd.MM.yyyy')}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md flex-shrink-0 ${
                        a.status === 'signed' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-navy-800 text-navy-300'}`}>
                        {a.status === 'signed' && <Lock className="w-3 h-3" />}
                        {a.status === 'signed' ? 'Подписан' : 'Черновик'}
                      </span>
                      <button type="button" aria-label="Открыть акт" title="Открыть"
                        onClick={ev => { ev.stopPropagation(); openAct(a) }}
                        className="tap-icon text-navy-400 hover:text-navy-100 flex-shrink-0">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {a.status !== 'signed' && (
                        <button type="button" aria-label="Удалить акт" title="Удалить"
                          onClick={ev => { ev.stopPropagation(); remove(a) }}
                          className="tap-icon text-navy-400 hover:text-red-400 flex-shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Новый акт сверки">
        <div className="space-y-4">
          <div>
            <label className="label">Доверитель</label>
            <select className="select" value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Период с</label>
              <input type="date" className="input" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
            </div>
            <div>
              <label className="label">Период по</label>
              <input type="date" className="input" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-navy-400">
            Акт соберётся из оплачиваемых записей журнала (по делам и месяцам), предъявленных издержек и платежей.
            Всё, что было до начала периода, войдёт в начальное сальдо.
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-primary" disabled={creating || !form.clientId}
              onClick={() => { const c = clients.find(x => x.id === form.clientId); if (c) startNew(c, form.from, form.to) }}>
              {creating ? 'Собираю…' : 'Составить акт'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setNewOpen(false)}>Отмена</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
