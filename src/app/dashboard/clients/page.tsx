'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, ClientType } from '@/types'
import { Plus, Pencil, X, Check, Building2, User, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { useEscapeKey, submitOnCtrlEnter } from '@/lib/form-keys'
import LoadError from '@/components/LoadError'
import PageHeader from '@/components/PageHeader'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'
import { checkInn } from '@/lib/inn'
import { SkeletonRows } from '@/components/Skeleton'

/** Реквизиты для актов (миграция 020). Необязательные: пусто — акт соберёт текст из названия */
const ACT_FIELDS = ['full_name', 'ogrn', 'representative', 'signer_position', 'signer_short'] as const
type ActField = typeof ACT_FIELDS[number]
const EMPTY_ACT: Record<ActField, string> = { full_name: '', ogrn: '', representative: '', signer_position: '', signer_short: '' }

const TYPE_LABELS: Record<ClientType, string> = {
  individual: 'Физическое лицо',
  legal_entity: 'Организация',
}

export default function ClientsPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    name: '', type: 'individual' as ClientType,
    inn: '', phone: '', email: '', address: '', notes: '', is_active: true,
    ...EMPTY_ACT,
  })

  const loadClients = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('clients').select('*').order('name')
    setLoadError(!!error)
    setClients(data ?? []); setLoading(false)
  }, [])

  useEffect(() => { loadClients() }, [])

  function resetForm() {
    setForm({ name: '', type: 'individual', inn: '', phone: '', email: '', address: '', notes: '', is_active: true, ...EMPTY_ACT })
    setEditId(null); setShowForm(false)
  }

  function startEdit(c: Client) {
    setForm({ name: c.name, type: c.type, inn: c.inn ?? '', phone: c.phone ?? '',
      email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '', is_active: c.is_active,
      full_name: c.full_name ?? '', ogrn: c.ogrn ?? '', representative: c.representative ?? '',
      signer_position: c.signer_position ?? '', signer_short: c.signer_short ?? '' })
    setEditId(c.id); setShowForm(true)
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault(); setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    // Реквизиты для актов отправляем, только если их ввели или изменили. Пока миграция 020
    // не выполнена, колонок в базе нет, и лишнее поле в запросе уронило бы сохранение
    // ЛЮБОГО доверителя — даже без этих реквизитов.
    const original = editId ? clients.find(x => x.id === editId) : undefined
    const actExtra: Partial<Record<ActField, string | null>> = {}
    for (const k of ACT_FIELDS) {
      const before = (original?.[k] ?? '').trim()
      if (form[k].trim() !== before) actExtra[k] = form[k].trim() || null
    }
    const payload = {
      name: form.name, type: form.type, is_active: form.is_active,
      inn: form.inn || null, phone: form.phone || null,
      email: form.email || null, address: form.address || null, notes: form.notes || null,
      ...actExtra,
    }
    const { error } = editId
      ? await supabase.from('clients').update(payload).eq('id', editId)
      : await supabase.from('clients').insert({ ...payload, created_by: user!.id })
    if (error) {
      toast.error(Object.keys(actExtra).length > 0 && /column|schema/i.test(error.message)
        ? 'Реквизиты для актов пока негде хранить: выполните миграцию 020 в Supabase'
        : 'Ошибка: ' + error.message)
    }
    else { toast.success(editId ? 'Доверитель обновлён' : 'Доверитель добавлен'); resetForm(); loadClients() }
    setSubmitting(false)
  }


  // Esc закрывает открытую форму или модалку — см. src/lib/form-keys.ts
  useEscapeKey(showForm, resetForm)

  // Контрольная сумма ИНН — см. src/lib/inn.ts
  const innCheck = checkInn(form.inn)

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Доверители" icon={Users}>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> Новый доверитель
        </button>
      </PageHeader>

      <Modal open={showForm} onClose={resetForm}
        title={editId ? 'Редактировать доверителя' : 'Новый доверитель'}>
          <form onKeyDown={submitOnCtrlEnter} onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <div className="md:col-span-1">
              <label className="label">Наименование / ФИО *</label>
              <input className="input" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Рудаков Евгений Владимирович" />
            </div>
            <div>
              <label className="label">Тип</label>
              <select className="select" value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as ClientType }))}>
                {(Object.entries(TYPE_LABELS) as [ClientType, string][]).map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">ИНН</label>
              <input className="input" value={form.inn} inputMode="numeric"
                onChange={e => setForm(f => ({ ...f, inn: e.target.value }))} placeholder="540200000000" />
              {/* Предупреждение, а не запрет: ИНН может быть известен не полностью,
                  а карточку доверителя всё равно надо сохранить */}
              {!innCheck.valid && (
                <p className="text-xs text-amber-400 mt-1">{innCheck.reason}</p>
              )}
            </div>
            <div>
              <label className="label">Телефон</label>
              <input className="input" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7 913 000-00-00" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Адрес</label>
              <input className="input" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="630099, г. Новосибирск, ул. Трудовая, д. 10" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Примечания</label>
              <textarea className="input resize-none" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            {/* Для актов и подписей. Всё необязательно: чего нет — акт возьмёт из названия */}
            <div className="md:col-span-2 border-t border-navy-800 pt-3">
              <p className="text-sm font-medium text-navy-200">Для актов (необязательно)</p>
              <p className="text-xs text-navy-400 mt-0.5">Попадает в шапку и подписи акта об оказании услуг.</p>
            </div>
            <div className="md:col-span-2">
              <label className="label">Полное наименование</label>
              <input className="input" value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder={form.type === 'legal_entity' ? 'Общество с ограниченной ответственностью «СИСТЕМА»' : 'Рудаков Евгений Владимирович'} />
              <p className="text-xs text-navy-400 mt-1">Пусто — соберётся из названия выше (ООО → Общество с ограниченной ответственностью)</p>
            </div>
            {form.type === 'legal_entity' && (
              <>
                <div>
                  <label className="label">ОГРН</label>
                  <input className="input" value={form.ogrn} inputMode="numeric"
                    onChange={e => setForm(f => ({ ...f, ogrn: e.target.value }))} placeholder="1175476084178" />
                </div>
                <div>
                  <label className="label">Должность подписанта</label>
                  <input className="input" value={form.signer_position}
                    onChange={e => setForm(f => ({ ...f, signer_position: e.target.value }))} placeholder="Генеральный директор" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Кто подписывает — после слов «в лице»</label>
                  <input className="input" value={form.representative}
                    onChange={e => setForm(f => ({ ...f, representative: e.target.value }))}
                    placeholder="генерального директора Зарипова Раиса Юрьевича" />
                  <p className="text-xs text-navy-400 mt-1">В родительном падеже, как в тексте акта</p>
                </div>
              </>
            )}
            <div>
              <label className="label">Подпись (инициалы и фамилия)</label>
              <input className="input" value={form.signer_short}
                onChange={e => setForm(f => ({ ...f, signer_short: e.target.value }))} placeholder="Р.Ю. Зарипов" />
            </div>
            {editId && (
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-gold-500" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="text-sm text-navy-300">Доверитель активен (снять — перевести в архив)</span>
                </label>
              </div>
            )}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                <Check className="w-4 h-4" /> {submitting ? 'Сохраняю...' : (editId ? 'Сохранить' : 'Добавить')}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">Отмена</button>
            </div>
          </form>
      </Modal>

      {!loading && clients.length > 0 && (
        <p className="text-xs text-navy-400 mb-2">
          💡 <span className="hidden md:inline">Двойной клик по доверителю — редактировать</span>
          <span className="md:hidden">Нажмите на карточку — редактировать</span>
        </p>
      )}

      {loadError && !loading && <LoadError onRetry={loadClients} />}

      {!loadError && (
      <div className="card">
        {loading ? <SkeletonRows rows={6} />
          : clients.length === 0 ? (
            <EmptyState icon={Users} title="Доверителей пока нет"
              description="С доверителя начинается всё остальное: дела, записи времени, акты и расчёты."
              action={<button onClick={() => setShowForm(true)} className="btn-primary">
                <Plus className="w-4 h-4" /> Добавить доверителя
              </button>} />
          ) : (
            <>
            {/* Список (десктоп) — всё в одну строку */}
            <div className="hidden md:grid gap-2">
              {clients.map(c => (
                <div key={c.id}
                  onDoubleClick={() => startEdit(c)}
                  title="Двойной клик — редактировать"
                  className="flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer
                                            hover:bg-navy-800/50 transition-colors border border-transparent
                                            hover:border-navy-700/50">
                  <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0">
                    {c.type === 'legal_entity'
                      ? <Building2 className="w-4 h-4 text-navy-400" />
                      : <User className="w-4 h-4 text-navy-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-navy-200 font-medium text-sm truncate">{c.name}</p>
                    <p className="text-navy-300 text-xs">
                      {TYPE_LABELS[c.type]}
                      {c.inn && ` · ИНН ${c.inn}`}
                      {c.phone && ` · ${c.phone}`}
                    </p>
                  </div>
                  <span className={c.is_active ? 'badge-active' : 'badge-inactive'}>
                    {c.is_active ? 'Активный' : 'Архив'}
                  </span>
                  <button aria-label="Редактировать доверителя" onClick={() => startEdit(c)} className="btn-ghost p-1.5">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Карточки (телефон) — реквизиты по строкам, а не в обрезаемую строку.
                Тап по карточке открывает правку: двойной тап на телефоне — это
                жест увеличения, им редактировать нельзя. */}
            <div className="md:hidden divide-y divide-navy-800/60">
              {clients.map(c => (
                <div key={c.id} onClick={() => startEdit(c)}
                  className="py-3 cursor-pointer active:bg-navy-800/40">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {c.type === 'legal_entity'
                        ? <Building2 className="w-4 h-4 text-navy-400" />
                        : <User className="w-4 h-4 text-navy-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-navy-200 font-medium text-sm">{c.name}</p>
                        <span className={`${c.is_active ? 'badge-active' : 'badge-inactive'} flex-shrink-0`}>
                          {c.is_active ? 'Активный' : 'Архив'}
                        </span>
                      </div>
                      <p className="text-navy-300 text-xs mt-0.5">{TYPE_LABELS[c.type]}</p>
                      {c.inn && <p className="text-navy-400 text-xs mt-0.5">ИНН <span className="num">{c.inn}</span></p>}
                      {c.phone && <p className="text-navy-400 text-xs mt-0.5 num">{c.phone}</p>}
                    </div>
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
