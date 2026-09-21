'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Plus, X, Check, Printer, Trash2, FileCheck, RefreshCw, Lock, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import { escapeHtml } from '@/lib/html'
import { printDocument, CABINET_LINE } from '@/lib/print'
import LoadError from '@/components/LoadError'
import { fmtMoneyWords } from '@/lib/money-words'
import { nextActNo as computeNextActNo, toActRows, actRowsTotal } from '@/lib/acts'
import { SkeletonRows, SkeletonCards } from '@/components/Skeleton'
import PageHeader from '@/components/PageHeader'
import ChangeHistory from '@/components/ChangeHistory'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'

interface Act {
  id: string
  act_no: string
  matter_id: string
  client_id: string
  period_from: string
  period_to: string
  amount: number
  description: string | null
  status: 'draft' | 'signed' | 'paid'
  created_at: string
  // Миграция 015: копия строк на момент создания. null — старый акт,
  // undefined — миграция ещё не выполнена
  rows?: ServiceRow[] | null
  matters: Matter & { clients: Client }
}

interface ServiceRow {
  id: string
  work_date: string
  activity_type: ActivityType
  description: string
  hours: number
  hourly_rate: number
  amount: number
  performed_by: string
}

const STATUS_LABELS = { draft: 'Черновик', signed: 'Подписан', paid: 'Оплачен' }
const STATUS_COLORS = {
  draft: 'text-navy-200 bg-navy-800',
  signed: 'text-amber-400 bg-amber-900/30',
  paid: 'text-emerald-400 bg-emerald-900/30',
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
// В актах для доверителя показываем роль вместо полного ФИО адвоката
function displayPerformer(fullName: string): string {
  return 'Адвокат'
}
function fmtDate(s: string) {
  return format(new Date(s), 'dd.MM.yyyy')
}

/**
 * Акт больше месяца лежит черновиком.
 *
 * Черновик не подписан и не оплачен: работа сделана, деньги не выставлены.
 * Через месяц про такой акт обычно уже забыли, поэтому отмечаем его в списке.
 */
function staleDraft(act: { status: string; created_at: string }) {
  if (act.status !== 'draft') return false
  const days = (Date.now() - new Date(act.created_at).getTime()) / 86_400_000
  return days > 30
}

export default function ActsPage() {
  const supabase = createClient()
  const [acts, setActs] = useState<Act[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewAct, setPreviewAct] = useState<{act: Act; rows: ServiceRow[]} | null>(null)

  // Подтверждение оплаты при переводе акта в статус "Оплачен"
  const [payConfirmAct, setPayConfirmAct] = useState<Act | null>(null)
  const [payConfirmDate, setPayConfirmDate] = useState('')
  const [payConfirmAmount, setPayConfirmAmount] = useState('')
  const [payConfirmDocNo, setPayConfirmDocNo] = useState('')
  const [payConfirmSaving, setPayConfirmSaving] = useState(false)

  const [form, setForm] = useState({
    act_no: '',
    matter_id: '',
    period_from: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'),
    period_to: format(new Date(), 'yyyy-MM-dd'),
    description: '',
  })
  /** Остаток неотработанного аванса по каждому делу; отрицательное — долг */
  const [advanceByMatter, setAdvanceByMatter] = useState<Record<string, number>>({})
  const [previewRows, setPreviewRows] = useState<ServiceRow[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const loadActs = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('acts')
      .select('*, matters(*, clients(*))')
      .order('created_at', { ascending: false })
    setLoadError(!!error)
    setActs((data ?? []) as Act[])
    setLoading(false)
  }, [])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      const [profileRes, mattersRes, paymentsRes, entriesRes, reimbRes] = await Promise.all([
        user ? supabase.from('profiles').select('*').eq('id', user.id).single() : Promise.resolve({ data: null }),
        supabase.from('matters').select('*, clients(*)').order('title'),
        // Остаток аванса по делу — та же формула, что в «Делах» и на Обзоре:
        // оплачено − отработанное время − предъявленные возмещаемые расходы.
        // Расходы вычитаются потому, что доверитель платит их одной суммой с
        // вознаграждением; без них остаток аванса был бы завышен (см. п. 11
        // в CLAUDE.md). Формулу держать одинаковой во всех четырёх местах,
        // иначе акт будет обещать не то, что показывают «Дела».
        supabase.from('payments').select('matter_id, amount'),
        supabase.from('time_entries').select('matter_id, amount, is_billable'),
        supabase.from('reimbursable_expenses').select('matter_id, amount')
          .in('status', ['invoiced', 'reimbursed']),
      ])
      if (profileRes.data) setProfile(profileRes.data)
      setMatters((mattersRes.data ?? []) as (Matter & { clients: Client })[])

      const balance: Record<string, number> = {}
      for (const p of (paymentsRes.data ?? []) as { matter_id: string | null; amount: number }[]) {
        if (p.matter_id) balance[p.matter_id] = (balance[p.matter_id] ?? 0) + Number(p.amount)
      }
      for (const e of (entriesRes.data ?? []) as { matter_id: string | null; amount: number; is_billable: boolean }[]) {
        if (e.matter_id && e.is_billable) balance[e.matter_id] = (balance[e.matter_id] ?? 0) - Number(e.amount)
      }
      for (const r of (reimbRes.data ?? []) as { matter_id: string | null; amount: number }[]) {
        if (r.matter_id) balance[r.matter_id] = (balance[r.matter_id] ?? 0) - Number(r.amount)
      }
      setAdvanceByMatter(balance)

      loadActs()
    }
    init()
  }, [])

  // Load preview when matter + period selected
  useEffect(() => {
    if (!form.matter_id || !form.period_from || !form.period_to) {
      setPreviewRows([]); setPreviewTotal(0); return
    }
    setLoadingPreview(true)
    const m = matters.find(x => x.id === form.matter_id)
    if (!m) return
    supabase.from('report_view').select('*')
      .eq('matter_id', form.matter_id)
      .gte('work_date', form.period_from)
      .lte('work_date', form.period_to)
      .eq('is_billable', true)
      .order('work_date')
      .then(({ data }) => {
        const rows = (data ?? []).map((r: any) => ({
          id: r.id, work_date: r.work_date, activity_type: r.activity_type,
          description: r.description, hours: Number(r.hours),
          hourly_rate: Number(r.hourly_rate), amount: Number(r.amount),
          performed_by: r.performed_by,
        }))
        setPreviewRows(rows)
        setPreviewTotal(actRowsTotal(rows))
        setLoadingPreview(false)
      })
  }, [form.matter_id, form.period_from, form.period_to])

  /**
   * Следующий номер акта: сквозная нумерация в пределах года — АКТ-2026-001.
   *
   * Раньше подставлялось «АКТ-20260906-1430» — дата со временем. Это не
   * совпадало с форматом в подсказке поля, не давало сквозного счёта и
   * ломалось, если два акта создать в одну минуту.
   *
   * Максимум ищется среди уже существующих номеров этого года; номера,
   * набранные вручную в другом формате, просто не попадают под шаблон
   * и на счёт не влияют.
   */
  const nextActNo = computeNextActNo(acts.map(a => a.act_no), new Date().getFullYear())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    if (previewTotal === 0) { toast.error('Нет оплачиваемых записей за период'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const m = matters.find(x => x.id === form.matter_id)!
    const actNo = form.act_no || nextActNo
    const base = {
      act_no: actNo,
      matter_id: form.matter_id,
      client_id: m.client_id,
      period_from: form.period_from,
      period_to: form.period_to,
      amount: previewTotal,
      description: form.description || null,
      created_by: user!.id,
    }
    // Копия строк — чтобы акт печатался таким, каким был создан, а не
    // тем, что лежит в журнале сегодня (миграция 015).
    let { error } = await supabase.from('acts').insert({ ...base, rows: previewRows })
    // Сайт выкатывается раньше, чем выполнена миграция. Пока колонки rows
    // нет, создаём акт без копии — это старое поведение, лучше, чем отказ.
    if (error && /rows/.test(error.message) && /column|schema/i.test(error.message)) {
      ({ error } = await supabase.from('acts').insert(base))
      if (!error) toast('Акт создан без сохранения состава — выполните миграцию 015', { icon: '⚠️' })
    }
    if (error) {
      // 23505 — нарушение уникальности: акт с таким номером уже существует.
      // Показываем это по-человечески, а не текстом ошибки базы.
      if (error.code === '23505') {
        toast.error(`Акт № ${actNo} уже существует. Укажите другой номер.`)
      } else {
        toast.error('Ошибка: ' + error.message)
      }
    }
    else { toast.success('Акт создан'); setShowForm(false); loadActs() }
    setSubmitting(false)
  }

  /** Текущий состав из журнала — для актов без копии и для «Обновить из журнала» */
  async function fetchLiveRows(act: Act): Promise<ServiceRow[] | null> {
    const { data, error } = await supabase.from('report_view').select('*')
      .eq('matter_id', act.matter_id)
      .gte('work_date', act.period_from)
      .lte('work_date', act.period_to)
      .eq('is_billable', true)
      .order('work_date')
    if (error) return null
    return toActRows(data ?? []) as ServiceRow[]
  }

  async function openPreview(act: Act) {
    // Акт показывается и печатается из своей копии — таким, каким был создан.
    // Из журнала — только старые акты, созданные до миграции 015.
    if (Array.isArray(act.rows)) {
      setPreviewAct({ act, rows: act.rows as ServiceRow[] })
      return
    }
    const rows = await fetchLiveRows(act)
    if (!rows) {
      toast.error('Не удалось загрузить содержание акта. Проверьте связь и попробуйте снова.')
      return
    }
    setPreviewAct({ act, rows })
  }

  /**
   * Пересобрать черновик из журнала.
   *
   * Только для черновика: подписанный акт — это документ, который видел
   * доверитель, и меняться он не должен. Сумма нового состава показывается
   * до сохранения, чтобы расхождение не прошло незамеченным.
   */
  async function refreshDraft(act: Act) {
    if (act.status !== 'draft') return
    const rows = await fetchLiveRows(act)
    if (!rows) { toast.error('Не удалось получить записи журнала'); return }
    const total = actRowsTotal(rows)
    const was = Number(act.amount)
    const msg = Math.abs(total - was) < 0.005
      ? `Сумма не изменится: ${fmt(total)} руб. Обновить состав акта из журнала?`
      : `Сумма акта изменится: было ${fmt(was)} руб., станет ${fmt(total)} руб. Обновить?`
    if (!confirm(msg)) return
    const { error } = await supabase.from('acts').update({ rows, amount: total }).eq('id', act.id)
    if (error) { toast.error('Не удалось обновить акт: ' + error.message); return }
    toast.success('Состав акта обновлён из журнала')
    setPreviewAct({ act: { ...act, rows, amount: total }, rows })
    loadActs()
  }

  async function changeStatus(id: string, status: Act['status']) {
    const act = acts.find(a => a.id === id)

    // При переводе в "Оплачен" — всегда предложить зафиксировать фактический платёж
    // через модалку (пользователь может отказаться, если уже внёс оплату вручную).
    // Раньше здесь была эвристика поиска "уже существующего" платежа по подстроке
    // номера акта в описании — она ненадёжна в обе стороны (не находит платёж,
    // если он был создан через "Акт сверки" с типовым описанием без номера акта;
    // либо ложно находит чужой платёж при коротком номере акта) и могла как создать
    // задвоение, так и молча пропустить фиксацию платежа. Решение по факту оплаты
    // теперь всегда принимает пользователь в модалке, а не автоматика.
    if (status === 'paid' && act) {
      setPayConfirmAct(act)
      setPayConfirmDate(format(new Date(), 'yyyy-MM-dd'))
      setPayConfirmAmount(String(act.amount))
      setPayConfirmDocNo('')
      return // статус пока не меняем — дождёмся подтверждения в модалке
    }

    const { error } = await supabase.from('acts').update({ status }).eq('id', id)
    if (error) { toast.error('Не удалось изменить статус: ' + error.message); return }
    loadActs()
    toast.success('Статус обновлён')
  }

  async function confirmPaymentAndMarkPaid() {
    if (!payConfirmAct) return
    const amountNum = parseFloat(payConfirmAmount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму оплаты'); return }

    setPayConfirmSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error: payError } = await supabase.from('payments').insert({
      client_id: payConfirmAct.client_id,
      matter_id: payConfirmAct.matter_id,
      pay_date: payConfirmDate,
      amount: amountNum,
      description: `Оплата по акту № ${payConfirmAct.act_no}`,
      doc_no: payConfirmDocNo || null,
      created_by: user?.id,
    })

    if (payError) {
      setPayConfirmSaving(false)
      toast.error('Ошибка при записи платежа: ' + payError.message)
      return
    }

    const { error: statusError } = await supabase.from('acts').update({ status: 'paid' }).eq('id', payConfirmAct.id)
    setPayConfirmSaving(false)

    if (statusError) {
      toast.error('Платёж записан, но не удалось обновить статус акта: ' + statusError.message)
    } else {
      toast.success('Оплата зафиксирована, статус акта обновлён')
    }
    setPayConfirmAct(null)
    loadActs()
  }

  async function markPaidWithoutPayment() {
    if (!payConfirmAct) return
    const { error } = await supabase.from('acts').update({ status: 'paid' }).eq('id', payConfirmAct.id)
    if (error) { toast.error('Не удалось изменить статус: ' + error.message); return }
    toast.success('Статус обновлён без записи платежа')
    setPayConfirmAct(null)
    loadActs()
  }

  async function deleteAct(id: string) {
    if (!confirm('Удалить акт?')) return
    const { error } = await supabase.from('acts').delete().eq('id', id)
    if (error) { toast.error('Не удалось удалить: ' + error.message); return }
    toast.success('Удалено'); loadActs()
  }

  function printAct(act: Act, rows: ServiceRow[]) {
    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${fmtDate(r.work_date)}</td>
        <td>${escapeHtml(ACTIVITY_LABELS[r.activity_type])}</td>
        <td>${escapeHtml(r.description)}</td>
        <td style="text-align:right">${r.hours.toFixed(2)}</td>
        <td style="text-align:right">${fmt(r.hourly_rate)}</td>
        <td style="text-align:right">${fmt(r.amount)}</td>
        <td>${escapeHtml(displayPerformer(r.performed_by))}</td>
      </tr>`).join('')

    const total = actRowsTotal(rows)

    const body = `
<h2>Акт об оказании юридической помощи</h2>
<div class="sub">${escapeHtml(act.act_no)} от ${fmtDate(act.created_at.split('T')[0])}</div>
<div class="meta">
  <b>Адвокат:</b> ${CABINET_LINE}<br>
  <b>Доверитель:</b> ${escapeHtml(act.matters.clients.name)}${act.matters.clients.inn ? `, ИНН ${escapeHtml(act.matters.clients.inn)}` : ''}<br>
  <b>Дело:</b> ${escapeHtml(act.matters.title)}${act.matters.agreement_no ? ` по соглашению № ${escapeHtml(act.matters.agreement_no)}` : ''}<br>
  <b>Период:</b> ${fmtDate(act.period_from)} — ${fmtDate(act.period_to)}
</div>
<p>Адвокатский кабинет Бухмина А.А. оказал, а Доверитель принял следующую юридическую помощь:</p>
<table>
  <thead><tr>
    <th>№</th><th>Дата</th><th>Вид работы</th><th>Описание</th>
    <th>Часов</th><th>Ставка, руб./ч.</th><th>Сумма, руб.</th><th>Исполнитель</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="6" class="r">Итого:</td>
    <td class="r">${fmt(total)}</td><td></td>
  </tr></tfoot>
</table>
<div class="total">Итого к оплате: ${fmt(total)} руб. (НДС не облагается)</div>
<div class="total-words">Сумма прописью: ${fmtMoneyWords(total)}</div>
${act.description ? `<p>${escapeHtml(act.description)}</p>` : ''}
<p>Доверитель не имеет претензий к объёму, качеству и срокам оказанной юридической помощи.</p>
<div class="signs">
  <div class="sign">
    <b>Адвокат:</b><br><br><br>
    _________________ /А.А. Бухмин/
  </div>
  <div class="sign">
    <b>Доверитель:</b><br><br><br>
    _________________ /${escapeHtml(act.matters.clients.name)}/
  </div>
</div>
<div class="footer">${CABINET_LINE}</div>`

    if (!printDocument(escapeHtml(act.act_no), body)) {
      toast.error('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и попробуйте снова.')
      return
    }
    toast.success('Открыт диалог печати')
  }


  // Esc закрывает открытую форму или модалку — см. src/lib/form-keys.ts
  useEscapeKey(showForm, () => setShowForm(false))
  useEscapeKey(!!previewAct, () => setPreviewAct(null))
  useEscapeKey(!!payConfirmAct, () => setPayConfirmAct(null))

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Акты об оказании юридической помощи" icon={FileCheck}>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary">
          <Plus className="w-4 h-4" /> Новый акт
        </button>
      </PageHeader>

      {/* Form */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={'Создать акт'} wide>
          <form onKeyDown={submitOnCtrlEnter} onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Номер акта</label>
              <input type="text" className="input" placeholder={nextActNo}
                value={form.act_no} onChange={e => setForm(f => ({ ...f, act_no: e.target.value }))} />
              <p className="text-xs text-navy-400 mt-1">Оставьте пустым — подставится {nextActNo}</p>
            </div>
            <div>
              <label className="label">Период с</label>
              <input type="date" className="input" value={form.period_from}
                onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Период по</label>
              <input type="date" className="input" value={form.period_to}
                onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} required />
            </div>
            <div className="md:col-span-3">
              <label className="label">Дело *</label>
              <select className="select" value={form.matter_id}
                onChange={e => setForm(f => ({ ...f, matter_id: e.target.value }))} required>
                <option value="">— выберите дело —</option>
                {matters.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.clients?.name} / {m.title}{m.agreement_no ? ` (${m.agreement_no})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label">Примечание к акту (необязательно)</label>
              <input type="text" className="input"
                placeholder="Дополнительные условия..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {/* Остаток аванса по делу.
                Акт уходит доверителю, и без этой строки легко выставить
                документ на сумму, которую он уже оплатил авансом: в форме
                видно только отработанное время за период. Предупреждение,
                а не запрет — акт всё равно составляется на объём работы. */}
            {form.matter_id && (advanceByMatter[form.matter_id] ?? 0) > 0.005 && (
              <div className="md:col-span-3 flex items-start gap-2.5 px-4 py-3 rounded-lg
                              bg-amber-900/20 border border-amber-800/50">
                <Wallet className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                {/* Сумму акта из остатка аванса НЕ вычитать: остаток уже
                    посчитан с учётом всего отработанного времени, в том числе
                    того, что войдёт в этот акт. Вычитание давало «к доплате
                    29 416 ₽» по делу, где доверитель, наоборот, переплатил. */}
                <p className="text-xs text-amber-300 leading-relaxed">
                  По этому делу доверитель заплатил вперёд: неотработанный аванс{' '}
                  <span className="num font-semibold">{fmt(advanceByMatter[form.matter_id])} ₽</span>.{' '}
                  {previewTotal > 0
                    ? `Работа на ${fmt(previewTotal)} ₽, вошедшая в акт, уже покрыта поступившими деньгами — доплачивать по этому акту нечего.`
                    : 'Работа, которая войдёт в акт, уже покрыта поступившими деньгами.'}
                </p>
              </div>
            )}

            {/* Preview of entries */}
            {form.matter_id && (
              <div className="md:col-span-3">
                {loadingPreview ? (
                  <p className="text-navy-300 text-sm">Загрузка...</p>
                ) : previewRows.length === 0 ? (
                  <p className="text-red-400 text-sm">Нет оплачиваемых записей за выбранный период</p>
                ) : (
                  <div className="bg-navy-800/40 rounded-lg border border-navy-700/50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-navy-700/50 flex justify-between items-center">
                      <span className="text-sm text-navy-300">{previewRows.length} записей войдут в акт</span>
                      <span className="text-navy-100 font-semibold text-sm">{fmt(previewTotal)} руб.</span>
                    </div>
                    {/* Семь колонок в ширину телефона не влезают, поэтому
                        на узком экране тот же состав идёт карточками —
                        как в окне просмотра акта */}
                    <table className="hidden md:table w-full text-xs">
                      <thead>
                        <tr className="border-b border-navy-700/50">
                          {['Дата','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-navy-300 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(r => (
                          <tr key={r.id} className="border-b border-navy-800/40">
                            <td className="px-3 py-1.5 num text-navy-400">{fmtDate(r.work_date)}</td>
                            <td className="px-3 py-1.5 text-navy-400">{ACTIVITY_LABELS[r.activity_type]}</td>
                            <td className="px-3 py-1.5 text-navy-300 max-w-[160px] truncate">{r.description}</td>
                            <td className="px-3 py-1.5 text-right num text-navy-300">{r.hours.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right num text-navy-400">{fmt(r.hourly_rate)}</td>
                            <td className="px-3 py-1.5 text-right num text-navy-100">{fmt(r.amount)}</td>
                            <td className="px-3 py-1.5 text-navy-300">{displayPerformer(r.performed_by)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="md:hidden divide-y divide-navy-800/40">
                      {previewRows.map(r => (
                        <div key={r.id} className="px-4 py-2.5">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="num text-navy-400 text-xs">{fmtDate(r.work_date)}</span>
                            <span className="num text-navy-100 text-xs font-medium whitespace-nowrap">
                              {fmt(r.amount)} ₽
                            </span>
                          </div>
                          <p className="text-navy-300 text-xs mb-1">{r.description}</p>
                          <p className="text-navy-400 text-xs">
                            {ACTIVITY_LABELS[r.activity_type]} · <span className="num">{r.hours.toFixed(2)}</span> ч ·{' '}
                            <span className="num">{fmt(r.hourly_rate)}</span> ₽/ч
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-3 flex gap-3">
              <button type="submit" disabled={submitting || previewTotal === 0} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Создаю...' : `Создать акт на ${fmt(previewTotal)} руб.`}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Отмена</button>
            </div>
          </form>
      </Modal>

      {loadError && !loading && <LoadError onRetry={loadActs} />}

      {/* List (desktop) */}
      <div className={`card hidden ${loadError ? '' : 'md:block'}`}>
        {loading ? (
          <SkeletonRows rows={6} />
        ) : acts.length === 0 ? (
          <EmptyState icon={FileCheck} title="Актов пока нет"
            description="Акт закрывает работу за период: подтверждает объём и сумму, подписывается доверителем."
            action={<button onClick={() => setShowForm(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Создать первый акт
            </button>} />
        ) : (
          <table className="w-full text-sm table-sticky">
            <thead>
              <tr className="border-b border-navy-800">
                {['Номер','Дело','Доверитель','Период','Сумма','Статус',''].map(h => (
                  <th key={h} className="text-left pb-2.5 pr-4 text-xs text-navy-300 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {acts.map(act => (
                <tr key={act.id} className={`border-b border-navy-800/40 table-row-hover ${
                  staleDraft(act) ? 'needs-attention' : ''
                }`}>
                  <td className="py-3 pr-4">
                    <button onClick={() => openPreview(act)}
                      className="text-gold-400 hover:underline num text-xs">{act.act_no}</button>
                  </td>
                  <td className="py-3 pr-4 text-navy-300 text-xs max-w-[150px] truncate">{act.matters?.title}</td>
                  <td className="py-3 pr-4 text-navy-400 text-xs max-w-[130px] truncate">{act.matters?.clients?.name}</td>
                  <td className="py-3 pr-4 text-navy-400 text-xs whitespace-nowrap">
                    {fmtDate(act.period_from)} — {fmtDate(act.period_to)}
                  </td>
                  <td className="py-3 pr-4 num text-navy-100 text-xs whitespace-nowrap">{fmt(act.amount)} ₽</td>
                  <td className="py-3 pr-4">
                    <select value={act.status}
                      onChange={e => changeStatus(act.id, e.target.value as Act['status'])}
                      className={`no-zoom tap text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS_COLORS[act.status]}`}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button aria-label="Просмотр и печать акта" onClick={() => openPreview(act)} className="btn-ghost p-1.5" title="Просмотр / печать">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label="Удалить акт" onClick={() => deleteAct(act.id)}
                        className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* List (mobile) — card list, тап по карточке открывает предпросмотр/печать */}
      <div className={loadError ? 'hidden' : 'md:hidden'}>
        {loading ? (
          <SkeletonCards rows={4} />
        ) : acts.length === 0 ? (
          <EmptyState icon={FileCheck} title="Актов пока нет"
            description="Акт закрывает работу за период: подтверждает объём и сумму, подписывается доверителем."
            action={<button onClick={() => setShowForm(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Создать первый акт
            </button>} />
        ) : (
          <div className="space-y-2">
            {acts.map(act => (
              <div key={act.id}
                onClick={() => openPreview(act)}
                className={`card p-3 active:bg-navy-800/60 transition-colors ${
                  staleDraft(act) ? 'needs-attention' : ''
                }`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-navy-200 text-sm font-medium truncate">{act.matters?.clients?.name}</p>
                    <p className="text-navy-300 text-xs truncate">{act.matters?.title}</p>
                  </div>
                  <span className="text-navy-200 num text-xs whitespace-nowrap flex-shrink-0">{act.act_no}</span>
                </div>
                <p className="text-navy-400 text-xs mb-2">
                  {fmtDate(act.period_from)} — {fmtDate(act.period_to)}
                </p>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <select value={act.status}
                    onClick={ev => ev.stopPropagation()}
                    onChange={e => changeStatus(act.id, e.target.value as Act['status'])}
                    className={`no-zoom tap text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS_COLORS[act.status]}`}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <span className="num text-sm text-navy-100 font-semibold">{fmt(act.amount)} ₽</span>
                </div>
                <div className="flex items-center justify-end gap-1 pt-2 border-t border-navy-800/60">
                  <button aria-label="Просмотр и печать акта" onClick={ev => { ev.stopPropagation(); openPreview(act) }}
                    className="btn-ghost p-1.5" title="Просмотр / печать">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Удалить акт" onClick={ev => { ev.stopPropagation(); deleteAct(act.id) }}
                    className="btn-ghost p-1.5 hover:text-red-400 hover:bg-red-900/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Print preview modal */}
      {previewAct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-navy-900 rounded-xl border border-navy-700 w-full max-w-3xl max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-4 border-b border-navy-800">
              <h2 className="font-semibold text-navy-200 truncate">{previewAct.act.act_no}</h2>
              <div className="flex gap-2 flex-shrink-0">
                <button aria-label="Просмотр и печать акта" onClick={() => printAct(previewAct.act, previewAct.rows)} className="btn-primary">
                  <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Печать / </span>PDF
                </button>
                <button aria-label="Закрыть" onClick={() => setPreviewAct(null)} className="btn-ghost p-2"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="overflow-y-auto p-4 md:p-6 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
              <p className="text-xs text-navy-400 mb-3">
                <b className="text-navy-300">Доверитель:</b> {previewAct.act.matters.clients.name} &nbsp;·&nbsp;
                <b className="text-navy-300">Дело:</b> {previewAct.act.matters.title} &nbsp;·&nbsp;
                <b className="text-navy-300">Период:</b> {fmtDate(previewAct.act.period_from)} — {fmtDate(previewAct.act.period_to)}
              </p>

              {/* Откуда взят состав акта — от этого зависит, что можно сделать */}
              {!Array.isArray(previewAct.act.rows) ? (
                <p className="text-xs text-amber-400 mb-3">
                  Акт создан до сохранения состава — строки показаны по текущему журналу.
                </p>
              ) : previewAct.act.status === 'draft' ? (
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3 px-3 py-2 rounded-lg bg-navy-800/60">
                  <p className="text-xs text-navy-300">
                    Черновик: состав зафиксирован при создании. Если после этого правили журнал — обновите.
                  </p>
                  <button onClick={() => refreshDraft(previewAct.act)} className="btn-secondary text-xs">
                    <RefreshCw className="w-3.5 h-3.5" /> Обновить из журнала
                  </button>
                </div>
              ) : (
                <p className="text-xs text-navy-400 mb-3 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  Акт {previewAct.act.status === 'paid' ? 'оплачен' : 'подписан'}: состав зафиксирован,
                  записи из него в журнале изменить нельзя. Чтобы исправить — переведите акт в «Черновик».
                </p>
              )}
              {/* Таблица (десктоп) */}
              <div className="hidden md:block overflow-x-auto lg:overflow-x-visible -mx-6 px-6">
              <table className="w-full text-xs mb-4 min-w-[640px] table-sticky">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-300 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewAct.rows.map((r, i) => (
                    <tr key={r.id} className="border-b border-navy-800/40">
                      <td className="py-1.5 pr-3 text-navy-400">{i+1}</td>
                      <td className="py-1.5 pr-3 num text-navy-400">{fmtDate(r.work_date)}</td>
                      <td className="py-1.5 pr-3 text-navy-400">{ACTIVITY_LABELS[r.activity_type]}</td>
                      <td className="py-1.5 pr-3 text-navy-300 max-w-[180px] truncate">{r.description}</td>
                      <td className="py-1.5 pr-3 text-right num text-navy-300">{r.hours.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right num text-navy-400">{fmt(r.hourly_rate)}</td>
                      <td className="py-1.5 pr-3 text-right num text-navy-100">{fmt(r.amount)}</td>
                      <td className="py-1.5 text-navy-300">{displayPerformer(r.performed_by)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={6} className="pt-2 text-right text-navy-400 font-medium pr-3">Итого:</td>
                    <td className="pt-2 text-right num font-bold text-navy-100">
                      {fmt(actRowsTotal(previewAct.rows))} ₽
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              </div>

              {/* Список карточек (мобильный) — то же содержимое, без прокрутки вбок */}
              <div className="md:hidden mb-4 divide-y divide-navy-800/40">
                {previewAct.rows.map((r, i) => (
                  <div key={r.id} className="py-2.5 first:pt-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-navy-300 text-xs">
                        <span className="text-navy-400 mr-1.5">{i+1}.</span>
                        {ACTIVITY_LABELS[r.activity_type]}
                      </span>
                      <span className="text-navy-400 num text-xs whitespace-nowrap flex-shrink-0">
                        {fmtDate(r.work_date)}
                      </span>
                    </div>
                    <p className="text-navy-300 text-xs mb-1.5">{r.description}</p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-navy-300 num">
                        {r.hours.toFixed(2)} ч × {fmt(r.hourly_rate)} ₽
                      </span>
                      <span className="num text-navy-100 font-semibold">{fmt(r.amount)} ₽</span>
                    </div>
                    <p className="text-navy-400 text-xs mt-0.5">{displayPerformer(r.performed_by)}</p>
                  </div>
                ))}
                <div className="pt-2.5 flex items-center justify-between text-xs">
                  <span className="text-navy-400 font-medium">Итого:</span>
                  <span className="num font-bold text-navy-100">
                    {fmt(actRowsTotal(previewAct.rows))} ₽
                  </span>
                </div>
              </div>

              <ChangeHistory table="acts" rowId={previewAct.act.id} />
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение фактической оплаты при переводе акта в статус "Оплачен" */}
      {payConfirmAct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          {/* Высота ограничена и включена прокрутка: на телефоне при открытой
              клавиатуре видимая часть экрана сжимается примерно вдвое, и без
              этого нижние кнопки оказывались за краем окна без возможности
              их докрутить */}
          <div className="bg-navy-900 rounded-xl border border-navy-700 w-full max-w-md
                          max-h-[90dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 z-10 bg-navy-900 flex items-center justify-between px-6 py-4 border-b border-navy-800">
              <h2 className="font-semibold text-navy-200">Зафиксировать оплату?</h2>
              <button onClick={() => setPayConfirmAct(null)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-navy-400">
                Акт № <span className="text-navy-100 num">{payConfirmAct.act_no}</span> переводится в статус «Оплачен».
                Чтобы задолженность на Обзоре и Доходы обновились автоматически, зафиксируйте фактический платёж —
                либо пропустите этот шаг, если оплата уже внесена вручную ранее.
              </p>
              <div>
                <label className="label">Дата оплаты</label>
                <input type="date" className="input" value={payConfirmDate}
                  onChange={e => setPayConfirmDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Сумма</label>
                <input type="number" inputMode="decimal" className="input" value={payConfirmAmount}
                  onChange={e => setPayConfirmAmount(e.target.value)} />
              </div>
              <div>
                <label className="label">№ платёжного поручения (необязательно)</label>
                <input type="text" className="input" value={payConfirmDocNo}
                  onChange={e => setPayConfirmDocNo(e.target.value)} placeholder="напр. 512" />
              </div>
            </div>
            <div className="px-6 pb-6 flex flex-wrap gap-3">
              <button onClick={confirmPaymentAndMarkPaid} disabled={payConfirmSaving} className="btn-primary">
                <Check className="w-4 h-4" /> {payConfirmSaving ? 'Сохраняю...' : 'Записать оплату и подтвердить'}
              </button>
              <button onClick={markPaidWithoutPayment} className="btn-secondary">
                Без записи платежа
              </button>
              <button onClick={() => setPayConfirmAct(null)} className="btn-secondary text-navy-300">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
