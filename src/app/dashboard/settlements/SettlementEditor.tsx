'use client'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, FileDown, FileText, Lock, Plus, RefreshCw, Save, Trash2, Unlock } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import {
  SettlementDoc, SettlementRow, SettlementStatus, Balance, Kop, Orientation,
  parseMoney, formatMoney, fmtDate, effectiveThem, tableTotals, conclusion, discrepancy,
  mirrorBalance, mirrorRows, sortRows,
} from '@/lib/settlement-act'

/** Сетка строки: на телефоне — карточка в два столбца, от md — одна строка */
const ROW_GRID = 'grid grid-cols-2 gap-2 md:grid-cols-[8.5rem_minmax(0,1fr)_8rem_8rem_2.75rem] md:items-center'

/** Ноль в поле не пишем: пустое поле с подсказкой «0,00» читается легче */
const show = (k: Kop) => (k === 0 ? '' : formatMoney(k))

/**
 * Поле суммы. Пока набираете, хранит текст как есть («1 234,5»), а в акт
 * отдаёт копейки, только если текст — число; иначе поле краснеет и в акт
 * не попадает. После ухода из поля текст приводится к виду «1 234,50».
 */
function MoneyInput({ value, onChange, disabled, label }: {
  value: Kop; onChange: (k: Kop) => void; disabled?: boolean; label: string
}) {
  const [text, setText] = useState(show(value))
  const [focused, setFocused] = useState(false)
  const [bad, setBad] = useState(false)

  // Значение изменилось снаружи (пересборка, зеркало) — обновляем текст,
  // если пользователь сейчас не печатает в этом поле
  useEffect(() => {
    if (!focused) { setText(show(value)); setBad(false) }
  }, [value, focused])

  return (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder="0,00"
      disabled={disabled}
      className={`input min-w-0 md:text-right num disabled:opacity-60 disabled:cursor-not-allowed ${bad ? 'border-red-500/70' : ''}`}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => {
        setText(e.target.value)
        const k = parseMoney(e.target.value)
        if (k === null) setBad(true)
        else { setBad(false); onChange(k) }
      }}
    />
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return <label className="label md:hidden">{children}</label>
}

function SumRow({ label, debit, credit, strong }: { label: string; debit: Kop; credit: Kop; strong?: boolean }) {
  return (
    <div className={`${ROW_GRID} py-2 border-t border-navy-800 text-sm ${strong ? 'font-semibold text-navy-100' : 'text-navy-200'}`}>
      <div className="col-span-2 md:col-span-2">{label}</div>
      <div className="md:text-right num"><span className="md:hidden text-xs text-navy-400 mr-1">Дебет</span>{formatMoney(debit)}</div>
      <div className="md:text-right num"><span className="md:hidden text-xs text-navy-400 mr-1">Кредит</span>{formatMoney(credit)}</div>
    </div>
  )
}

function SideTable({
  title, owner, other, currency, opening, rows, disabled, note, defaultDate, onOpening, onRows,
}: {
  title: string
  owner: string
  other: string
  currency: string
  opening: Balance
  rows: SettlementRow[]
  /** Правка закрыта: акт подписан или таблица — зеркало */
  disabled: boolean
  note?: string
  defaultDate: string
  onOpening: (b: Balance) => void
  onRows: (r: SettlementRow[]) => void
}) {
  const t = tableTotals(opening, rows)
  const c = conclusion(t.net, owner, other)
  const patch = (id: string, p: Partial<SettlementRow>) => onRows(rows.map(r => (r.id === id ? { ...r, ...p } : r)))

  // Строки идут по дате. Переставляем, когда пользователь ВЫШЕЛ из поля даты, а не на каждый
  // символ: в поле даты год набирается по цифрам («0002» … «2026»), и строка прыгала бы под рукой.
  function settleOrder(e: React.FocusEvent<HTMLInputElement>) {
    const sorted = sortRows(rows)
    if (sorted.every((r, i) => r === rows[i])) return
    const next = e.relatedTarget as HTMLElement | null
    onRows(sorted)
    // React переносит строку в разметке целиком, и фокус с поля, куда шёл пользователь,
    // слетает: возвращаем его туда
    if (next) setTimeout(() => { if (next.isConnected && document.activeElement !== next) next.focus() }, 0)
  }

  return (
    <section className="card mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h2 className="min-w-0">{title}</h2>
        <span className="text-xs text-navy-400">{currency}</span>
      </div>
      {note && <p className="text-xs text-navy-400 mb-3">{note}</p>}

      {/* Заголовки колонок — только на широком экране; на телефоне подписи внутри карточки строки */}
      <div className={`hidden md:grid md:grid-cols-[8.5rem_minmax(0,1fr)_8rem_8rem_2.75rem] gap-2 text-xs text-navy-400 uppercase tracking-wide pb-1`}>
        <div>Дата</div><div>Документ</div><div className="text-right">Дебет</div><div className="text-right">Кредит</div><div />
      </div>

      <div className={`${ROW_GRID} py-2 border-t border-navy-800`}>
        <div className="col-span-2 md:col-span-2 text-sm font-medium text-navy-200">Сальдо начальное</div>
        <div><Caption>Дебет</Caption>
          <MoneyInput label="Сальдо начальное, дебет" value={opening.debit} disabled={disabled} onChange={k => onOpening({ ...opening, debit: k })} /></div>
        <div><Caption>Кредит</Caption>
          <MoneyInput label="Сальдо начальное, кредит" value={opening.credit} disabled={disabled} onChange={k => onOpening({ ...opening, credit: k })} /></div>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-navy-400 py-3 border-t border-navy-800">Строк нет. {disabled ? '' : 'Добавьте строку или пересоберите акт из данных.'}</p>
      )}

      {rows.map(r => (
        <div key={r.id} className={`${ROW_GRID} py-2 border-t border-navy-800`}>
          <input type="date" aria-label="Дата" disabled={disabled}
            className="input order-1 md:order-none disabled:opacity-60 disabled:cursor-not-allowed"
            value={r.date} onChange={e => patch(r.id, { date: e.target.value })} onBlur={settleOrder} />
          {/* На телефоне корзина встаёт в первую строку рядом с датой, на широком — в конец */}
          {!disabled ? (
            <button type="button" aria-label="Удалить строку" title="Удалить строку"
              onClick={() => onRows(rows.filter(x => x.id !== r.id))}
              className="tap-icon order-2 md:order-last justify-self-end text-navy-400 hover:text-red-400">
              <Trash2 className="w-4 h-4" />
            </button>
          ) : <span className="order-2 md:order-last" />}
          <input type="text" aria-label="Документ" placeholder="Документ, например «Оплата №591 от 24.09.2026»" disabled={disabled}
            className="input order-3 col-span-2 md:col-span-1 md:order-none min-w-0 disabled:opacity-60 disabled:cursor-not-allowed"
            value={r.doc} onChange={e => patch(r.id, { doc: e.target.value })} />
          <div className="order-4 md:order-none"><Caption>Дебет</Caption>
            <MoneyInput label="Дебет" value={r.debit} disabled={disabled} onChange={k => patch(r.id, { debit: k })} /></div>
          <div className="order-5 md:order-none"><Caption>Кредит</Caption>
            <MoneyInput label="Кредит" value={r.credit} disabled={disabled} onChange={k => patch(r.id, { credit: k })} /></div>
        </div>
      ))}

      {!disabled && (
        <div className="flex gap-2 flex-wrap py-3 border-t border-navy-800">
          <button type="button" className="btn-secondary"
            onClick={() => onRows(sortRows([...rows, { id: crypto.randomUUID(), date: defaultDate, doc: '', debit: 0, credit: 0 }]))}>
            <Plus className="w-4 h-4" /> Добавить строку
          </button>
          {rows.length > 1 && (
            <span className="text-xs text-navy-400 self-center">Строки сами встают по дате, когда вы выходите из поля даты.</span>
          )}
        </div>
      )}

      <SumRow label="Обороты за период" debit={t.turnDebit} credit={t.turnCredit} strong />
      <SumRow label="Сальдо конечное" debit={t.closingDebit} credit={t.closingCredit} strong />
      <p className="text-sm mt-3 text-navy-200">
        <span className="text-navy-400">Вывод: </span>
        <strong className={c.favor === 'none' ? '' : 'text-gold-400'}>{c.text}</strong>
      </p>
    </section>
  )
}

export interface EditorProps {
  clientName: string
  doc: SettlementDoc
  status: SettlementStatus
  persisted: boolean
  dirty: boolean
  saving: boolean
  rebuilding: boolean
  tableMissing: boolean
  onChange: (d: SettlementDoc) => void
  onSave: () => void
  onSetStatus: (s: SettlementStatus) => void
  onRebuild: () => void
  onBack: () => void
  onPrint: () => void
  onWord: () => void
}

export default function SettlementEditor(p: EditorProps) {
  const { doc, status } = p
  const locked = status === 'signed'
  const them = effectiveThem(doc)
  const usT = tableTotals(doc.openingUs, doc.rowsUs)
  const themT = tableTotals(them.opening, them.rows)
  const to = fmtDate(doc.periodTo)
  const set = (patch: Partial<SettlementDoc>) => p.onChange({ ...doc, ...patch })
  const setUs = (patch: Partial<SettlementDoc['us']>) => set({ us: { ...doc.us, ...patch } })
  const setThem = (patch: Partial<SettlementDoc['them']>) => set({ them: { ...doc.them, ...patch } })

  const toggleMirror = (on: boolean) => {
    if (on) {
      const hasOwn = doc.rowsThem.length > 0
      if (hasOwn && !confirm('Таблица доверителя снова станет зеркалом вашей: внесённые в неё вручную строки пропадут. Продолжить?')) return
      set({ mirror: true })
    } else {
      // Выключая зеркало, не теряем то, что видели: копия зеркала становится самостоятельной таблицей
      set({ mirror: false, openingThem: mirrorBalance(doc.openingUs), rowsThem: mirrorRows(doc.rowsUs) })
    }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, opts?: { rows?: number }) => (
    <div>
      <label className="label">{label}</label>
      {opts?.rows
        ? <textarea className="input disabled:opacity-60" rows={opts.rows} value={value} disabled={locked} onChange={e => onChange(e.target.value)} />
        : <input type="text" className="input disabled:opacity-60" value={value} disabled={locked} onChange={e => onChange(e.target.value)} />}
    </div>
  )

  const cUs = conclusion(usT.net, doc.us.name, doc.them.name)
  const cThem = conclusion(themT.net, doc.them.name, doc.us.name)
  const disc = discrepancy(usT.net, themT.net)

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Акт взаимных расчётов" icon={ArrowLeftRight}
        description={`${p.clientName} · ${fmtDate(doc.periodFrom)} — ${to}`}>
        <button type="button" className="btn-secondary" onClick={p.onBack}>
          <ArrowLeft className="w-4 h-4" /> К списку
        </button>
      </PageHeader>

      {locked && (
        <div className="card mb-5 flex items-start gap-3 text-sm text-navy-200">
          <Lock className="w-4 h-4 mt-0.5 text-gold-400 flex-shrink-0" />
          <span>Акт подписан, править его нельзя. Чтобы изменить, верните его в черновик.</span>
        </div>
      )}
      {p.tableMissing && (
        <div className="card mb-5 text-sm text-amber-400">
          Таблица для сохранения актов ещё не создана в базе, поэтому «Сохранить» пока не сработает. Составлять, править, печатать и выгружать в Word акт можно уже сейчас.
          Чтобы акты сохранялись, один раз выполните SQL из файла supabase/migrations/019_settlement_acts.sql.
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-5 items-center">
        <button type="button" className="btn-primary" onClick={p.onSave} disabled={p.saving || locked || (!p.dirty && p.persisted)}>
          <Save className="w-4 h-4" /> {p.saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {status === 'draft'
          ? <button type="button" className="btn-secondary" onClick={() => p.onSetStatus('signed')} disabled={p.saving}>
              <Lock className="w-4 h-4" /> Отметить подписанным
            </button>
          : <button type="button" className="btn-secondary" onClick={() => p.onSetStatus('draft')} disabled={p.saving}>
              <Unlock className="w-4 h-4" /> Вернуть в черновик
            </button>}
        <button type="button" className="btn-secondary" onClick={p.onRebuild} disabled={locked || p.rebuilding}
          title="Заново собрать таблицу кабинета из журнала, издержек и платежей за период">
          <RefreshCw className={`w-4 h-4 ${p.rebuilding ? 'animate-spin' : ''}`} /> Пересобрать из данных
        </button>
        <button type="button" className="btn-secondary" onClick={p.onPrint}>
          <FileDown className="w-4 h-4" /> PDF / печать
        </button>
        <button type="button" className="btn-secondary" onClick={p.onWord}>
          <FileText className="w-4 h-4" /> Word
        </button>
        {p.dirty && !locked && <span className="text-xs text-amber-400">Есть несохранённые изменения</span>}
        {!p.dirty && p.persisted && <span className="text-xs text-navy-400">Сохранено</span>}
      </div>

      <section className="card mb-5">
        <h2 className="mb-3">Реквизиты</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          <div>
            <label className="label">Период с</label>
            <input type="date" className="input disabled:opacity-60" value={doc.periodFrom} disabled={locked} onChange={e => set({ periodFrom: e.target.value })} />
          </div>
          <div>
            <label className="label">Период по</label>
            <input type="date" className="input disabled:opacity-60" value={doc.periodTo} disabled={locked} onChange={e => set({ periodTo: e.target.value })} />
          </div>
          {field('Валюта', doc.currency, v => set({ currency: v }))}
          <div>
            <label className="label">Лист при печати</label>
            <select className="select disabled:opacity-60" value={doc.orientation} disabled={locked}
              onChange={e => set({ orientation: e.target.value as Orientation })}>
              <option value="portrait">Книжный</option>
              <option value="landscape">Альбомный</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-navy-400 mb-4">
          После смены периода нажмите «Пересобрать из данных»: строки и начальное сальдо подставятся за новый период.
          Книжный лист — две узкие таблицы рядом, как печатает 1С; альбомный — таблицы пошире.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-navy-200">Кабинет (слева)</h3>
            {field('Название', doc.us.name, v => setUs({ name: v }))}
            {field('Реквизиты во вводном абзаце', doc.us.intro, v => setUs({ intro: v }), { rows: 3 })}
            {field('Подпись под таблицей', doc.us.signer, v => setUs({ signer: v }))}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-navy-200">Доверитель (справа)</h3>
            {field('Название', doc.them.name, v => setThem({ name: v }))}
            {field('Реквизиты во вводном абзаце', doc.them.intro, v => setThem({ intro: v }), { rows: 3 })}
            {field('Подпись под таблицей — должность и ФИО подписанта', doc.them.signer, v => setThem({ signer: v }))}
          </div>
        </div>
      </section>

      <SideTable
        title={`По данным ${doc.us.name}`} owner={doc.us.name} other={doc.them.name} currency={doc.currency}
        opening={doc.openingUs} rows={doc.rowsUs} disabled={locked} defaultDate={doc.periodTo}
        onOpening={b => set({ openingUs: b })} onRows={r => set({ rowsUs: r })}
      />

      <label className="flex items-start gap-2 mb-3 cursor-pointer text-sm text-navy-200">
        <input type="checkbox" className="mt-0.5 accent-gold-500" checked={doc.mirror} disabled={locked}
          onChange={e => toggleMirror(e.target.checked)} />
        <span>
          Таблица доверителя — зеркало нашей (те же документы, дебет и кредит наоборот).
          <span className="block text-xs text-navy-400">
            Снимите галочку, когда доверитель пришлёт свои данные: тогда правую таблицу можно править отдельно, а расхождение будет видно ниже.
          </span>
        </span>
      </label>

      <SideTable
        title={`По данным ${doc.them.name}`} owner={doc.them.name} other={doc.us.name} currency={doc.currency}
        opening={them.opening} rows={them.rows} disabled={locked || doc.mirror} defaultDate={doc.periodTo}
        note={doc.mirror ? 'Таблица зеркальная и считается из левой. Чтобы править её отдельно, снимите галочку выше.' : undefined}
        onOpening={b => set({ openingThem: b })} onRows={r => set({ rowsThem: r })}
      />

      <section className="card">
        <h2 className="mb-3">Итог на {to}</h2>
        <p className="text-sm text-navy-200 mb-1">По данным {doc.us.name}: <strong className="text-navy-100">{cUs.text}</strong></p>
        <p className="text-sm text-navy-200 mb-3">По данным {doc.them.name}: <strong className="text-navy-100">{cThem.text}</strong></p>
        {doc.mirror
          ? <p className="text-xs text-navy-400">Таблица доверителя зеркальна, поэтому расхождений нет.</p>
          : disc === 0
            ? <p className="text-sm text-emerald-400">Стороны согласны: сальдо совпадают.</p>
            : <p className="text-sm text-amber-400">Расхождение сторон: {formatMoney(disc)} ₽. Найдите строку, по которой данные не совпали.</p>}
      </section>
    </div>
  )
}
