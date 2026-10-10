'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { shortDate } from '@/lib/act-doc'

interface Accrual {
  id: string
  accrual_date: string
  amount: number | string
  description: string
}

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/** Таблицы ещё нет в базе: код выкатывается раньше, чем выполнена миграция 022 */
const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' ||
    (/matter_accruals/.test(e.message ?? '') && /(schema cache|does not exist)/i.test(e.message ?? '')))

/**
 * Начисления по актам в карточке дела: работа на фиксированную сумму без записей
 * времени, закрытая актом («Акт от 31.08.2026», 7 000 ₽). Программа считает такую
 * запись начисленной везде — на Обзоре, в «Делах» и в акте сверки. Записывается
 * сразу, без кнопки «Сохранить» дела (как история изменений).
 *
 * Стоит ВНЕ формы дела: Enter в этих полях иначе сохранял бы само дело.
 */
export default function AccrualsBlock({ matterId, onChanged }: { matterId: string; onChanged: () => void }) {
  const supabase = createClient()
  const [list, setList] = useState<Accrual[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ accrual_date: '', amount: '', description: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('matter_accruals').select('id, accrual_date, amount, description')
      .eq('matter_id', matterId).order('accrual_date')
    if (error) setMissing(isMissingTable(error))
    else { setMissing(false); setList((data ?? []) as Accrual[]) }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId])

  useEffect(() => { load() }, [load])

  // Дату по умолчанию ставим в браузере: страница собирается заранее, и «сегодня» из неё устарело бы
  useEffect(() => { setForm(f => (f.accrual_date ? f : { ...f, accrual_date: format(new Date(), 'yyyy-MM-dd') })) }, [])

  async function add() {
    const amount = parseFloat(form.amount.replace(',', '.'))
    if (!form.accrual_date) { toast.error('Укажите дату акта'); return }
    if (!(amount > 0)) { toast.error('Укажите сумму акта'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('matter_accruals').insert({
      matter_id: matterId,
      accrual_date: form.accrual_date,
      amount,
      description: form.description.trim() || `Акт от ${shortDate(form.accrual_date)}`,
      created_by: user?.id ?? null,
    })
    setSaving(false)
    if (error) {
      toast.error(isMissingTable(error) ? 'Начисления пока негде хранить: выполните миграцию 022 в Supabase' : 'Ошибка: ' + error.message)
      return
    }
    toast.success('Начисление добавлено')
    setForm({ accrual_date: form.accrual_date, amount: '', description: '' })
    await load()
    onChanged()
  }

  async function remove(a: Accrual) {
    if (!confirm(`Удалить начисление «${a.description}» на ${fmt(Number(a.amount))} ₽?`)) return
    const { error } = await supabase.from('matter_accruals').delete().eq('id', a.id)
    if (error) { toast.error('Не удалось удалить: ' + error.message); return }
    toast.success('Удалено')
    await load()
    onChanged()
  }

  return (
    <div className="mt-4 pt-3 border-t border-navy-800">
      <p className="text-sm font-medium text-navy-200">Начисления по актам</p>
      <p className="text-xs text-navy-400 mt-0.5 mb-3">
        Для работы на фиксированную сумму без записей времени: добавьте акт — сумма станет начисленной на Обзоре,
        в «Делах» и в акте сверки. Если работа уже ведётся по часам, здесь её дублировать не нужно.
      </p>

      {missing ? (
        <p className="text-xs text-amber-400">Чтобы начисления сохранялись, один раз выполните SQL из файла supabase/migrations/022_matter_accruals.sql в Supabase.</p>
      ) : (
        <>
          {!loading && list.length === 0 && <p className="text-xs text-navy-400 mb-2">Начислений пока нет.</p>}
          {list.length > 0 && (
            <ul className="divide-y divide-navy-800/60 mb-3">
              {list.map(a => (
                <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="num text-navy-400 text-xs whitespace-nowrap">{shortDate(a.accrual_date)}</span>
                  <span className="flex-1 min-w-0 text-navy-200 break-words">{a.description}</span>
                  <span className="num text-navy-100 whitespace-nowrap">{fmt(Number(a.amount))} ₽</span>
                  <button type="button" aria-label="Удалить начисление" onClick={() => remove(a)}
                    className="tap-icon text-navy-400 hover:text-red-400 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Дата акта</label>
              <input type="date" className="input" value={form.accrual_date}
                onChange={e => setForm(f => ({ ...f, accrual_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Сумма, ₽</label>
              <input type="number" inputMode="decimal" className="input" value={form.amount} placeholder="7000"
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Подпись в акте сверки</label>
              <input type="text" className="input" value={form.description}
                placeholder={form.accrual_date ? `Акт от ${shortDate(form.accrual_date)}` : 'Акт от …'}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="md:col-span-4">
              <button type="button" onClick={add} disabled={saving || loading} className="btn-secondary">
                <Plus className="w-4 h-4" /> {saving ? 'Добавляю…' : 'Добавить начисление'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
