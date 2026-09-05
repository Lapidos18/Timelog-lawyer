'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, MatterType, MatterStatus, MATTER_TYPE_LABELS, MATTER_STATUS_LABELS } from '@/types'
import { Plus, Pencil, X, Check, Gavel, Briefcase } from 'lucide-react'
import toast from 'react-hot-toast'
import LoadError from '@/components/LoadError'
import PageHeader from '@/components/PageHeader'
import { SkeletonRows } from '@/components/Skeleton'

interface MatterWithClient extends Matter { clients: Client }

export default function MattersPage() {
  const supabase = createClient()
  const [matters, setMatters] = useState<MatterWithClient[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [paidByMatter, setPaidByMatter] = useState<Record<string, number>>({})
  const [workedByMatter, setWorkedByMatter] = useState<Record<string, number>>({})
  const [reimbByMatter, setReimbByMatter] = useState<Record<string, number>>({})
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterStatus, setFilterStatus] = useState<MatterStatus | 'all'>('active')

  const [form, setForm] = useState({
    client_id: '', title: '', agreement_no: '',
    matter_type: 'litigation' as MatterType, status: 'active' as MatterStatus,
    court: '', case_no: '', hourly_rate: '', fixed_fee: '',
    started_at: '', closed_at: '', notes: '',
  })

  const loadMatters = useCallback(async () => {
    setLoading(true)
    const q = supabase.from('matters').select('*, clients(*)').order('created_at', { ascending: false })

    // Оплаты и отработанное время нужны, чтобы показать остаток аванса по делу.
    // Платежи всегда вносятся с указанием дела, поэтому считаем строго по matter_id.
    // Дела грузим ВСЕ, независимо от фильтра статуса: фильтр применяется ниже,
    // на отображение. Итог по доверителю обязан считаться по всем его делам,
    // иначе он менялся бы при переключении фильтра и расходился бы с Обзором
    // и актом сверки — а он нужен именно чтобы совпадать с ними.
    const [mattersRes, paymentsRes, entriesRes, reimbRes] = await Promise.all([
      q,
      supabase.from('payments').select('matter_id, amount'),
      supabase.from('time_entries').select('matter_id, amount, is_billable'),
      // Предъявленные доверителю издержки: он платит их вместе с
      // вознаграждением, поэтому остаток аванса без них завышается
      supabase.from('reimbursable_expenses').select('matter_id, amount')
        .in('status', ['invoiced', 'reimbursed']),
    ])

    setLoadError(!!(mattersRes.error || paymentsRes.error || entriesRes.error || reimbRes.error))

    const paid: Record<string, number> = {}
    for (const p of (paymentsRes.data ?? [])) {
      if (p.matter_id) paid[p.matter_id] = (paid[p.matter_id] ?? 0) + Number(p.amount)
    }
    const worked: Record<string, number> = {}
    for (const e of (entriesRes.data ?? [])) {
      if (e.matter_id && e.is_billable) {
        worked[e.matter_id] = (worked[e.matter_id] ?? 0) + Number(e.amount)
      }
    }
    const reimbursed: Record<string, number> = {}
    for (const r of (reimbRes.data ?? [])) {
      if (r.matter_id) reimbursed[r.matter_id] = (reimbursed[r.matter_id] ?? 0) + Number(r.amount)
    }
    setPaidByMatter(paid)
    setWorkedByMatter(worked)
    setReimbByMatter(reimbursed)

    setMatters((mattersRes.data ?? []) as MatterWithClient[]); setLoading(false)
  }, [])

  useEffect(() => {
    supabase.from('clients').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setClients(data ?? []))
  }, [])

  useEffect(() => { loadMatters() }, [loadMatters])

  function resetForm() {
    setForm({ client_id: '', title: '', agreement_no: '', matter_type: 'litigation',
      status: 'active', court: '', case_no: '', hourly_rate: '', fixed_fee: '',
      started_at: '', closed_at: '', notes: '' })
    setEditId(null); setShowForm(false)
  }

  function startEdit(m: MatterWithClient) {
    setForm({
      client_id: m.client_id, title: m.title, agreement_no: m.agreement_no ?? '',
      matter_type: m.matter_type, status: m.status, court: m.court ?? '',
      case_no: m.case_no ?? '', hourly_rate: m.hourly_rate ? String(m.hourly_rate) : '',
      fixed_fee: m.fixed_fee ? String(m.fixed_fee) : '', started_at: m.started_at ?? '',
      closed_at: m.closed_at ?? '', notes: m.notes ?? '',
    })
    setEditId(m.id); setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault(); setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      client_id: form.client_id, title: form.title,
      agreement_no: form.agreement_no || null, matter_type: form.matter_type,
      status: form.status, court: form.court || null, case_no: form.case_no || null,
      hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
      fixed_fee: form.fixed_fee ? parseFloat(form.fixed_fee) : null,
      started_at: form.started_at || null, closed_at: form.closed_at || null,
      notes: form.notes || null,
    }
    const { error } = editId
      ? await supabase.from('matters').update(payload).eq('id', editId)
      : await supabase.from('matters').insert({ ...payload, created_by: user!.id })
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success(editId ? 'Дело обновлено' : 'Дело добавлено'); resetForm(); loadMatters() }
    setSubmitting(false)
  }

  const statusBadge = (s: MatterStatus) => ({
    active: 'badge-active',
    suspended: 'badge bg-amber-900/30 text-amber-400 border border-amber-800/40',
    closed: 'badge-inactive',
  }[s])

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  const visible = filterStatus === 'all' ? matters : matters.filter(m => m.status === filterStatus)

  /**
   * Дела, сгруппированные по доверителям.
   *
   * Итог группы считается по ВСЕМ делам доверителя, а список внутри группы
   * показывает только прошедшие фильтр. Иначе бы вышло, что общая сумма
   * зависит от того, какой фильтр включён, — а она нужна ровно затем, чтобы
   * совпадать с задолженностью на Обзоре и в акте сверки.
   *
   * Разбивка по делам после этого справочная: она объясняет, из чего сумма
   * сложилась. Платёж часто вносится с указанием одного дела, хотя покрывает
   * работу по нескольким, поэтому по отдельному делу может выйти цифра,
   * которая сама по себе ни о чём не говорит.
   */
  const groups = useMemo(() => {
    const order: string[] = []
    const shown: Record<string, MatterWithClient[]> = {}
    for (const m of visible) {
      if (!shown[m.client_id]) { shown[m.client_id] = []; order.push(m.client_id) }
      shown[m.client_id].push(m)
    }
    return order.map(clientId => {
      const all = matters.filter(m => m.client_id === clientId)
      let paid = 0, worked = 0, reimb = 0
      for (const m of all) {
        paid   += paidByMatter[m.id]   ?? 0
        worked += workedByMatter[m.id] ?? 0
        reimb  += reimbByMatter[m.id]  ?? 0
      }
      return {
        clientId,
        clientName: shown[clientId][0].clients?.name ?? '—',
        matters: shown[clientId],
        hidden: all.length - shown[clientId].length,
        balance: paid - worked - reimb,
        hasMoney: paid > 0 || worked > 0 || reimb > 0,
      }
    })
  }, [visible, matters, paidByMatter, workedByMatter, reimbByMatter])

  /** Итог по доверителю над группой дел */
  function GroupTotal({ g }: { g: (typeof groups)[number] }) {
    return (
      <div className="flex items-baseline justify-between gap-3 flex-wrap
                      px-4 pt-4 pb-2 md:px-4 border-b border-navy-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy-100">{g.clientName}</h2>
          {g.hidden > 0 && (
            <p className="text-xs text-navy-400 mt-0.5">
              итог по всем делам, {g.hidden}{' '}
              {g.hidden === 1 ? 'скрыто фильтром' : 'скрыты фильтром'}
            </p>
          )}
        </div>
        {g.hasMoney && (
          <p className="text-sm whitespace-nowrap">
            {g.balance < -0.005 ? (
              <><span className="text-navy-400">к выставлению </span>
                <span className="num font-semibold text-amber-400">{fmtMoney(-g.balance)} ₽</span></>
            ) : g.balance > 0.005 ? (
              <><span className="text-navy-400">остаток аванса </span>
                <span className="num font-semibold text-emerald-400">{fmtMoney(g.balance)} ₽</span></>
            ) : (
              <span className="text-navy-300">расчёты закрыты</span>
            )}
          </p>
        )}
      </div>
    )
  }

  /**
   * Строка «деньги по делу»: сколько получено, сколько отработано и что из этого следует.
   *
   * Остаток = оплачено − отработанное оплачиваемое время − предъявленные издержки:
   *   > 0  аванс ещё не отработан, выставлять нечего
   *   < 0  аванс закрыт, можно выставлять акт ровно на разницу
   * Платежи считаются строго по делу — они всегда вносятся с указанием дела.
   * Издержки вычитаются потому, что доверитель платит их той же суммой, что и
   * вознаграждение: без этого их компенсация выглядела бы как остаток аванса.
   */
  function renderMoneyLine(m: MatterWithClient) {
    const paid = paidByMatter[m.id] ?? 0
    const worked = workedByMatter[m.id] ?? 0
    const reimb = reimbByMatter[m.id] ?? 0
    const fixed = m.fixed_fee ? Number(m.fixed_fee) : null

    // По пустому делу показывать нечего
    if (!paid && !worked && !fixed && !reimb) return null

    const balance = paid - worked - reimb

    // Итог по деньгам показываем, только если по делу уже есть движение —
    // иначе на деле с одной лишь фиксированной суммой вылезло бы
    // «Аванс отработан полностью», хотя аванса и не было
    const hasActivity = paid > 0 || worked > 0 || reimb > 0

    return (
      <p className="text-xs mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {hasActivity && (
          <>
            <span className="text-navy-400">
              Оплачено <span className="num text-navy-200">{fmtMoney(paid)} ₽</span>
            </span>
            <span className="text-navy-400">·</span>
            <span className="text-navy-400">
              Отработано <span className="num text-navy-200">{fmtMoney(worked)} ₽</span>
            </span>
            <span className="text-navy-400">·</span>
            {reimb > 0 && (
              <>
                <span className="text-navy-400">
                  Возмещаемые расходы <span className="num text-navy-200">{fmtMoney(reimb)} ₽</span>
                </span>
                <span className="text-navy-400">·</span>
              </>
            )}
            {balance > 0.005 ? (
              <span className="text-emerald-400 font-medium">
                Остаток аванса <span className="num">{fmtMoney(balance)} ₽</span>
              </span>
            ) : balance < -0.005 ? (
              <span className="text-amber-400 font-medium">
                К выставлению <span className="num">{fmtMoney(-balance)} ₽</span>
              </span>
            ) : (
              <span className="text-navy-300">Аванс отработан полностью</span>
            )}
          </>
        )}
        {fixed && hasActivity && <span className="text-navy-400">·</span>}
        {fixed && (
          <>
            <span className="text-navy-400">
              По соглашению <span className="num text-navy-200">{fmtMoney(fixed)} ₽</span>
              <span className={worked > fixed ? 'text-amber-400' : 'text-navy-300'}>
                {' '}({Math.round((worked / fixed) * 100)}%)
              </span>
            </span>
          </>
        )}
      </p>
    )
  }

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Дела" icon={Briefcase}>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Новое дело
        </button>
      </PageHeader>

      {showForm && (
        <div className="card mb-6 border-gold-800/40">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-medium text-navy-200">{editId ? 'Редактировать дело' : 'Новое дело'}</h2>
            <button onClick={resetForm} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <div>
              <label className="label">Доверитель *</label>
              <select className="select" required value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">— выберите —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Название дела *</label>
              <input className="input" required value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Шипунова против Рудакова, дело о ремонте" />
            </div>
            <div>
              <label className="label">№ соглашения</label>
              <input className="input" value={form.agreement_no}
                onChange={e => setForm(f => ({ ...f, agreement_no: e.target.value }))} placeholder="1/2026" />
            </div>
            <div>
              <label className="label">Тип дела</label>
              <select className="select" value={form.matter_type}
                onChange={e => setForm(f => ({ ...f, matter_type: e.target.value as MatterType }))}>
                {(Object.entries(MATTER_TYPE_LABELS) as [MatterType, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Статус</label>
              <select className="select" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as MatterStatus }))}>
                {(Object.entries(MATTER_STATUS_LABELS) as [MatterStatus, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Суд</label>
              <input className="input" value={form.court}
                onChange={e => setForm(f => ({ ...f, court: e.target.value }))}
                placeholder="Октябрьский районный суд г. Новосибирска" />
            </div>
            <div>
              <label className="label">№ дела в суде</label>
              <input className="input" value={form.case_no}
                onChange={e => setForm(f => ({ ...f, case_no: e.target.value }))} placeholder="2-17/2026" />
            </div>
            <div>
              <label className="label">Ставка, руб./ч.</label>
              <input type="number" inputMode="decimal" className="input" value={form.hourly_rate}
                onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} placeholder="1290" />
            </div>
            <div>
              <label className="label">Дата начала</label>
              <input type="date" className="input" value={form.started_at}
                onChange={e => setForm(f => ({ ...f, started_at: e.target.value }))} />
            </div>
            <div>
              <label className="label">Дата закрытия</label>
              <input type="date" className="input" value={form.closed_at}
                onChange={e => setForm(f => ({ ...f, closed_at: e.target.value }))} />
            </div>
            <div className="md:col-span-3">
              <label className="label">Примечания</label>
              <textarea className="input resize-none" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="md:col-span-3 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['active', 'suspended', 'closed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === s
                ? 'bg-navy-700 text-navy-100'
                : 'text-navy-300 hover:text-navy-300'
            }`}>
            {{ active: 'Активные', suspended: 'Приостановленные', closed: 'Закрытые', all: 'Все' }[s]}
          </button>
        ))}
      </div>

      {!loading && !loadError && matters.length > 0 && (
        <p className="text-xs text-navy-400 mb-2">
          💡 <span className="hidden md:inline">Двойной клик по делу — редактировать</span>
          <span className="md:hidden">Нажмите на карандаш — редактировать</span>
        </p>
      )}

      {loadError && !loading && <LoadError onRetry={loadMatters} />}

      {!loadError && (
      <div className="card">
        {loading ? <SkeletonRows rows={5} />
          : visible.length === 0 ? (
            <p className="text-navy-300 text-sm text-center py-12">
              {matters.length === 0 ? 'Нет дел.' : 'Нет дел с таким статусом.'}
            </p>
          ) : groups.map(g => (
          <section key={g.clientId} className="mb-5 last:mb-0 -mx-5 md:mx-0">
            <GroupTotal g={g} />
            <>
            {/* Список (десктоп) */}
            <div className="hidden md:grid gap-2 pt-2">
              {g.matters.map(m => (
                <div key={m.id}
                  onDoubleClick={() => startEdit(m)}
                  title="Двойной клик — редактировать"
                  className="flex items-start gap-4 px-4 py-3 rounded-lg cursor-pointer
                                            hover:bg-navy-800/50 transition-colors border border-transparent
                                            hover:border-navy-700/50">
                  <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Gavel className="w-4 h-4 text-navy-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-navy-200 font-medium text-sm">{m.title}</p>
                      <span className={statusBadge(m.status)}>{MATTER_STATUS_LABELS[m.status]}</span>
                      <span className="badge bg-navy-800 text-navy-400 border border-navy-700">
                        {MATTER_TYPE_LABELS[m.matter_type]}
                      </span>
                    </div>
                    <p className="text-navy-300 text-xs mt-0.5">
                      {m.clients?.name}
                      {m.agreement_no && ` · Соглашение ${m.agreement_no}`}
                      {m.case_no && ` · Дело ${m.case_no}`}
                      {m.court && ` · ${m.court}`}
                      {m.hourly_rate && ` · ${m.hourly_rate} ₽/ч`}
                    </p>
                    {renderMoneyLine(m)}
                  </div>
                  <button onClick={() => startEdit(m)} className="btn-ghost p-1.5 flex-shrink-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Карточки (телефон). Строка денег на узком экране переносилась
                в четыре ряда точек-разделителей — здесь она разложена
                парами «подпись — сумма», по одной в ряд. */}
            <div className="md:hidden divide-y divide-navy-800/60 px-5">
              {g.matters.map(m => {
                const paid   = paidByMatter[m.id] ?? 0
                const worked = workedByMatter[m.id] ?? 0
                const reimb  = reimbByMatter[m.id] ?? 0
                const balance = paid - worked - reimb
                const hasMoney = paid > 0 || worked > 0 || reimb > 0
                return (
                  <div key={m.id} onClick={() => startEdit(m)}
                    className="py-3 cursor-pointer active:bg-navy-800/40">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-navy-200 font-medium text-sm">{m.title}</p>
                      <span className={`${statusBadge(m.status)} flex-shrink-0`}>
                        {MATTER_STATUS_LABELS[m.status]}
                      </span>
                    </div>
                    <p className="text-navy-300 text-xs mt-1">{m.clients?.name}</p>
                    <p className="text-navy-400 text-xs mt-0.5">
                      {MATTER_TYPE_LABELS[m.matter_type]}
                      {m.agreement_no && <> · Соглашение <span className="num">{m.agreement_no}</span></>}
                      {m.hourly_rate && <> · <span className="num">{m.hourly_rate}</span> ₽/ч</>}
                    </p>
                    {m.case_no && <p className="text-navy-400 text-xs mt-0.5">Дело <span className="num">{m.case_no}</span></p>}
                    {m.court && <p className="text-navy-400 text-xs mt-0.5">{m.court}</p>}

                    {hasMoney && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="text-navy-400">Оплачено</dt>
                        <dd className="num text-navy-200 text-right">{fmtMoney(paid)} ₽</dd>
                        <dt className="text-navy-400">Отработано</dt>
                        <dd className="num text-navy-200 text-right">{fmtMoney(worked)} ₽</dd>
                        {reimb > 0 && <>
                          <dt className="text-navy-400">Возмещаемые расходы</dt>
                          <dd className="num text-navy-200 text-right">{fmtMoney(reimb)} ₽</dd>
                        </>}
                        {balance > 0.005 ? <>
                          <dt className="text-emerald-400 font-medium">Остаток аванса</dt>
                          <dd className="num text-emerald-400 font-medium text-right">{fmtMoney(balance)} ₽</dd>
                        </> : balance < -0.005 ? <>
                          <dt className="text-amber-400 font-medium">К выставлению</dt>
                          <dd className="num text-amber-400 font-medium text-right">{fmtMoney(-balance)} ₽</dd>
                        </> : <>
                          <dt className="text-navy-300">Аванс отработан</dt>
                          <dd className="text-right text-navy-300">полностью</dd>
                        </>}
                      </dl>
                    )}
                    {m.fixed_fee && (
                      <p className="text-navy-400 text-xs mt-1.5">
                        По соглашению <span className="num text-navy-200">{fmtMoney(Number(m.fixed_fee))} ₽</span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            </>
          </section>
          ))}
      </div>
      )}
    </div>
  )
}
