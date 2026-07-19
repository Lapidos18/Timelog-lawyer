'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Matter, Client, Profile, ACTIVITY_LABELS, ActivityType } from '@/types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Plus, X, Check, Printer, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

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
  draft: 'text-navy-400 bg-navy-800',
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

export default function ActsPage() {
  const supabase = createClient()
  const [acts, setActs] = useState<Act[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [previewRows, setPreviewRows] = useState<ServiceRow[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const loadActs = useCallback(async () => {
    const { data } = await supabase
      .from('acts')
      .select('*, matters(*, clients(*))')
      .order('created_at', { ascending: false })
    setActs((data ?? []) as Act[])
    setLoading(false)
  }, [])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      const [profileRes, mattersRes] = await Promise.all([
        user ? supabase.from('profiles').select('*').eq('id', user.id).single() : Promise.resolve({ data: null }),
        supabase.from('matters').select('*, clients(*)').order('title'),
      ])
      if (profileRes.data) setProfile(profileRes.data)
      setMatters((mattersRes.data ?? []) as (Matter & { clients: Client })[])
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
      .eq('matter_title', m.title)
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
        setPreviewTotal(rows.reduce((s: number, r: ServiceRow) => s + r.amount, 0))
        setLoadingPreview(false)
      })
  }, [form.matter_id, form.period_from, form.period_to])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.matter_id) { toast.error('Выберите дело'); return }
    if (previewTotal === 0) { toast.error('Нет оплачиваемых записей за период'); return }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const m = matters.find(x => x.id === form.matter_id)!
    const { error } = await supabase.from('acts').insert({
      act_no: form.act_no || `АКТ-${format(new Date(), 'yyyyMMdd-HHmm')}`,
      matter_id: form.matter_id,
      client_id: m.client_id,
      period_from: form.period_from,
      period_to: form.period_to,
      amount: previewTotal,
      description: form.description || null,
      created_by: user!.id,
    })
    if (error) { toast.error('Ошибка: ' + error.message) }
    else { toast.success('Акт создан'); setShowForm(false); loadActs() }
    setSubmitting(false)
  }

  async function openPreview(act: Act) {
    const { data } = await supabase.from('report_view').select('*')
      .eq('matter_title', act.matters.title)
      .gte('work_date', act.period_from)
      .lte('work_date', act.period_to)
      .eq('is_billable', true)
      .order('work_date')
    setPreviewAct({
      act,
      rows: (data ?? []).map((r: any) => ({
        id: r.id, work_date: r.work_date, activity_type: r.activity_type,
        description: r.description, hours: Number(r.hours),
        hourly_rate: Number(r.hourly_rate), amount: Number(r.amount),
        performed_by: r.performed_by,
      }))
    })
  }

  async function changeStatus(id: string, status: Act['status']) {
    const act = acts.find(a => a.id === id)

    // При переводе в "Оплачен" — предложить сразу зафиксировать фактический платёж,
    // чтобы задолженность на Обзоре и Доходы обновились автоматически, а не расходились с актом.
    if (status === 'paid' && act) {
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('matter_id', act.matter_id)
        .ilike('description', `%${act.act_no}%`)
        .limit(1)

      if (!existing || existing.length === 0) {
        setPayConfirmAct(act)
        setPayConfirmDate(format(new Date(), 'yyyy-MM-dd'))
        setPayConfirmAmount(String(act.amount))
        setPayConfirmDocNo('')
        return // статус пока не меняем — дождёмся подтверждения в модалке
      }
    }

    await supabase.from('acts').update({ status }).eq('id', id)
    loadActs()
    toast.success('Статус обновлён')
  }

  async function confirmPaymentAndMarkPaid() {
    if (!payConfirmAct) return
    const amountNum = parseFloat(payConfirmAmount)
    if (!amountNum || amountNum <= 0) { toast.error('Укажите сумму оплаты'); return }

    setPayConfirmSaving(true)
    const { error: payError } = await supabase.from('payments').insert({
      client_id: payConfirmAct.client_id,
      matter_id: payConfirmAct.matter_id,
      pay_date: payConfirmDate,
      amount: amountNum,
      description: `Оплата по акту № ${payConfirmAct.act_no}`,
      doc_no: payConfirmDocNo || null,
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
    await supabase.from('acts').update({ status: 'paid' }).eq('id', payConfirmAct.id)
    toast.success('Статус обновлён без записи платежа')
    setPayConfirmAct(null)
    loadActs()
  }

  async function deleteAct(id: string) {
    if (!confirm('Удалить акт?')) return
    await supabase.from('acts').delete().eq('id', id)
    toast.success('Удалено'); loadActs()
  }

  function printAct(act: Act, rows: ServiceRow[]) {
    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${fmtDate(r.work_date)}</td>
        <td>${ACTIVITY_LABELS[r.activity_type]}</td>
        <td>${r.description}</td>
        <td style="text-align:right">${r.hours.toFixed(2)}</td>
        <td style="text-align:right">${fmt(r.hourly_rate)}</td>
        <td style="text-align:right">${fmt(r.amount)}</td>
        <td>${displayPerformer(r.performed_by)}</td>
      </tr>`).join('')

    const total = rows.reduce((s, r) => s + r.amount, 0)
    const amountWords = fmt(total) // TODO: прописью

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>${act.act_no}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:10pt;margin:20mm;color:#000}
  h2{text-align:center;font-size:13pt;margin-bottom:4px}
  .sub{text-align:center;font-size:10pt;margin-bottom:16px}
  .meta{font-size:10pt;margin-bottom:16px;line-height:1.8}
  table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th{background:#1e3a5f;color:#fff;padding:5px 4px;font-size:9pt;text-align:left;border:1px solid #ccc}
  td{padding:4px;border:1px solid #ddd;font-size:9pt}
  tfoot td{font-weight:bold;background:#f5f5f5}
  .total{font-size:11pt;font-weight:bold;margin:12px 0}
  .signs{margin-top:40px;display:flex;justify-content:space-between}
  .sign{width:45%}
  @media print{body{margin:15mm}}
</style></head><body>
<h2>АКТ ОБ ОКАЗАНИИ ЮРИДИЧЕСКОЙ ПОМОЩИ</h2>
<div class="sub">${act.act_no} от ${fmtDate(act.created_at.split('T')[0])}</div>
<div class="meta">
  <b>Адвокат:</b> Адвокатский кабинет Бухмина Антона Андреевича, рег. № 54/1831, ИНН 540233730471<br>
  <b>Доверитель:</b> ${act.matters.clients.name}${act.matters.clients.inn ? `, ИНН ${act.matters.clients.inn}` : ''}<br>
  <b>Дело:</b> ${act.matters.title}${act.matters.agreement_no ? ` по соглашению № ${act.matters.agreement_no}` : ''}<br>
  <b>Период:</b> ${fmtDate(act.period_from)} — ${fmtDate(act.period_to)}
</div>
<p>Адвокатский кабинет Бухмина А.А. оказал, а Доверитель принял следующую юридическую помощь:</p>
<table>
  <thead><tr>
    <th>№</th><th>Дата</th><th>Вид работы</th><th>Описание</th>
    <th>Часов</th><th>Ставка, руб.</th><th>Сумма, руб.</th><th>Исполнитель</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="6" style="text-align:right">Итого:</td>
    <td style="text-align:right">${fmt(total)}</td><td></td>
  </tr></tfoot>
</table>
<div class="total">Итого к оплате: ${fmt(total)} руб. (НДС не облагается)</div>
${act.description ? `<p>${act.description}</p>` : ''}
<p>Доверитель не имеет претензий к объёму, качеству и срокам оказанной юридической помощи.</p>
<div class="signs">
  <div class="sign">
    <b>Адвокат:</b><br><br><br>
    _________________ /А.А. Бухмин/
  </div>
  <div class="sign">
    <b>Доверитель:</b><br><br><br>
    _________________ /${act.matters.clients.name}/
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
    toast.success('Открыт диалог печати')
  }

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-5 md:mb-7">
        <h1 className="text-2xl font-semibold text-navy-100">Акты об оказании помощи</h1>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary">
          <Plus className="w-4 h-4" /> Новый акт
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-6 border-gold-800/40">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-medium text-navy-200">Создать акт</h2>
            <button onClick={() => setShowForm(false)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Номер акта</label>
              <input type="text" className="input" placeholder="АКТ-2026-001"
                value={form.act_no} onChange={e => setForm(f => ({ ...f, act_no: e.target.value }))} />
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

            {/* Preview of entries */}
            {form.matter_id && (
              <div className="md:col-span-3">
                {loadingPreview ? (
                  <p className="text-navy-500 text-sm">Загрузка записей...</p>
                ) : previewRows.length === 0 ? (
                  <p className="text-red-400 text-sm">Нет оплачиваемых записей за выбранный период</p>
                ) : (
                  <div className="bg-navy-800/40 rounded-lg border border-navy-700/50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-navy-700/50 flex justify-between items-center">
                      <span className="text-sm text-navy-300">{previewRows.length} записей войдут в акт</span>
                      <span className="text-gold-400 font-semibold text-sm">{fmt(previewTotal)} руб.</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-navy-700/50">
                          {['Дата','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-navy-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(r => (
                          <tr key={r.id} className="border-b border-navy-800/40">
                            <td className="px-3 py-1.5 font-mono text-navy-400">{fmtDate(r.work_date)}</td>
                            <td className="px-3 py-1.5 text-navy-400">{ACTIVITY_LABELS[r.activity_type]}</td>
                            <td className="px-3 py-1.5 text-navy-300 max-w-[160px] truncate">{r.description}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-navy-300">{r.hours.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-navy-400">{fmt(r.hourly_rate)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-gold-400">{fmt(r.amount)}</td>
                            <td className="px-3 py-1.5 text-navy-500">{displayPerformer(r.performed_by)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
        </div>
      )}

      {/* List */}
      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-navy-500 text-sm text-center py-12">Загрузка...</p>
        ) : acts.length === 0 ? (
          <p className="text-navy-500 text-sm text-center py-12">Нет актов. <button onClick={() => setShowForm(true)} className="text-gold-400 hover:underline">Создать первый →</button></p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-800">
                {['Номер','Дело','Клиент','Период','Сумма','Статус',''].map(h => (
                  <th key={h} className="text-left pb-2.5 pr-4 text-xs text-navy-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {acts.map(act => (
                <tr key={act.id} className="border-b border-navy-800/40 table-row-hover">
                  <td className="py-3 pr-4">
                    <button onClick={() => openPreview(act)}
                      className="text-gold-400 hover:underline font-mono text-xs">{act.act_no}</button>
                  </td>
                  <td className="py-3 pr-4 text-navy-300 text-xs max-w-[150px] truncate">{act.matters?.title}</td>
                  <td className="py-3 pr-4 text-navy-400 text-xs max-w-[130px] truncate">{act.matters?.clients?.name}</td>
                  <td className="py-3 pr-4 text-navy-400 text-xs whitespace-nowrap">
                    {fmtDate(act.period_from)} — {fmtDate(act.period_to)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-gold-400 text-xs whitespace-nowrap">{fmt(act.amount)} ₽</td>
                  <td className="py-3 pr-4">
                    <select value={act.status}
                      onChange={e => changeStatus(act.id, e.target.value as Act['status'])}
                      className={`text-xs px-2 py-1 rounded-md border-0 cursor-pointer ${STATUS_COLORS[act.status]}`}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openPreview(act)} className="btn-ghost p-1.5" title="Просмотр / печать">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteAct(act.id)}
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

      {/* Print preview modal */}
      {previewAct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-navy-900 rounded-xl border border-navy-700 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
              <h2 className="font-semibold text-navy-200">{previewAct.act.act_no}</h2>
              <div className="flex gap-2">
                <button onClick={() => printAct(previewAct.act, previewAct.rows)} className="btn-primary">
                  <Printer className="w-4 h-4" /> Печать / PDF
                </button>
                <button onClick={() => setPreviewAct(null)} className="btn-ghost p-2"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              <p className="text-xs text-navy-400 mb-3">
                <b className="text-navy-300">Клиент:</b> {previewAct.act.matters.clients.name} &nbsp;·&nbsp;
                <b className="text-navy-300">Дело:</b> {previewAct.act.matters.title} &nbsp;·&nbsp;
                <b className="text-navy-300">Период:</b> {fmtDate(previewAct.act.period_from)} — {fmtDate(previewAct.act.period_to)}
              </p>
              <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-xs mb-4 min-w-[640px]">
                <thead>
                  <tr className="border-b border-navy-800">
                    {['№','Дата','Вид работы','Описание','Часов','Ставка','Сумма','Исполнитель'].map(h => (
                      <th key={h} className="text-left pb-2 pr-3 text-navy-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewAct.rows.map((r, i) => (
                    <tr key={r.id} className="border-b border-navy-800/40">
                      <td className="py-1.5 pr-3 text-navy-600">{i+1}</td>
                      <td className="py-1.5 pr-3 font-mono text-navy-400">{fmtDate(r.work_date)}</td>
                      <td className="py-1.5 pr-3 text-navy-400">{ACTIVITY_LABELS[r.activity_type]}</td>
                      <td className="py-1.5 pr-3 text-navy-300 max-w-[180px] truncate">{r.description}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-navy-300">{r.hours.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-navy-400">{fmt(r.hourly_rate)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-gold-400">{fmt(r.amount)}</td>
                      <td className="py-1.5 text-navy-500">{displayPerformer(r.performed_by)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-navy-700">
                    <td colSpan={6} className="pt-2 text-right text-navy-400 font-medium pr-3">Итого:</td>
                    <td className="pt-2 text-right font-mono font-bold text-gold-400">
                      {fmt(previewAct.rows.reduce((s,r) => s+r.amount, 0))} ₽
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение фактической оплаты при переводе акта в статус "Оплачен" */}
      {payConfirmAct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-navy-900 rounded-xl border border-navy-700 w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-navy-800">
              <h2 className="font-semibold text-navy-200">Зафиксировать оплату?</h2>
              <button onClick={() => setPayConfirmAct(null)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-navy-400">
                Акт № <span className="text-gold-400 font-mono">{payConfirmAct.act_no}</span> переводится в статус «Оплачен».
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
                <input type="number" className="input" value={payConfirmAmount}
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
              <button onClick={() => setPayConfirmAct(null)} className="btn-secondary text-navy-500">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
