/**
 * Акт сверки взаимных расчётов — форма, которую контрагенты используют между
 * собой (такую же готовит 1С): две таблицы рядом, «по данным кабинета» и
 * «по данным доверителя», колонки Дата / Документ / Дебет / Кредит, сальдо
 * начальное, обороты, сальдо конечное и вывод «задолженность в пользу …».
 *
 * Вся арифметика и сборка здесь, а не в вёрстке страницы: формулу денег надо
 * уметь проверить отдельно (см. settlement-act.test.ts).
 *
 * ДЕНЬГИ ЗДЕСЬ — В КОПЕЙКАХ ЦЕЛЫМИ ЧИСЛАМИ. В базе суммы лежат рублями
 * (numeric, приходят строками), на экране и в файле нужны рубли с запятой,
 * а считать в рублях нельзя: 0,1 + 0,2 в числах с плавающей точкой — не 0,3,
 * и на длинном акте копейки расходились бы. Перевод туда и обратно — только
 * через toKop() и formatMoney().
 *
 * СМЫСЛ ДЕБЕТА И КРЕДИТА. Кабинет — исполнитель, поэтому в ЕГО таблице услуги
 * и предъявленные издержки — это ДЕБЕТ (доверитель стал должен), а оплаты —
 * КРЕДИТ. Положительное сальдо (дебетовое) = «долг доверителя». Таблица
 * доверителя — зеркальная: у него то же самое записано наоборот.
 * Универсальное правило вывода для ЛЮБОЙ из двух таблиц: дебетовое сальдо —
 * «в пользу владельца таблицы», кредитовое — «в пользу другой стороны».
 * Проверено на образце формы (тест «образец формы»): там слева покупатель,
 * у которого оплаты стоят в дебете, и вывод сходится.
 */
import { fmtMoneyFull } from './money-words'

export type Kop = number

export interface SettlementRow {
  id: string
  /** ГГГГ-ММ-ДД или пусто, если дата не указана */
  date: string
  doc: string
  debit: Kop
  credit: Kop
}

export interface Balance { debit: Kop; credit: Kop }

export interface SettlementParty {
  /** Короткое название: «По данным …», «в пользу …» */
  name: string
  /** Как сторона представлена во вводном абзаце (с реквизитами) */
  intro: string
  /** Подпись под таблицей: должность и ФИО; пусто — линия для рукописи */
  signer: string
}

/** Содержимое акта, как оно лежит в базе (колонка doc, jsonb) */
export interface SettlementDoc {
  version: 1
  periodFrom: string
  periodTo: string
  currency: string
  /** Ориентация листа; у актов без этого поля (старых) — книжная */
  orientation: Orientation
  /** Кабинет — левая таблица */
  us: SettlementParty
  /** Доверитель — правая таблица */
  them: SettlementParty
  openingUs: Balance
  rowsUs: SettlementRow[]
  /**
   * true — правая таблица всегда зеркало левой и не редактируется.
   * false — правая живёт своей жизнью (данные доверителя, внесённые вручную).
   */
  mirror: boolean
  openingThem: Balance
  rowsThem: SettlementRow[]
}

export type SettlementStatus = 'draft' | 'signed'

/** Лист при печати и в Word. Книжный — как печатает 1С; альбомный — таблицы пошире */
export type Orientation = 'portrait' | 'landscape'

/** Строка таблицы settlement_acts */
export interface SettlementActRecord {
  id: string
  client_id: string
  period_from: string
  period_to: string
  status: SettlementStatus
  doc: SettlementDoc
  created_by: string | null
  created_at: string
  updated_at: string
  clients?: { name: string } | null
}

// ── Деньги ──────────────────────────────────────────────────────────────

/** Рубли из базы (число или строка numeric) → копейки */
export function toKop(rub: number | string): Kop {
  return Math.round(Number(rub) * 100)
}

/**
 * Текст из поля ввода → копейки. Пусто = 0. Не число (буквы, минус, две
 * запятые) = null: поле подсвечивается и в акт не попадает.
 *
 * Разбираем по частям, а не parseFloat(...) * 100: «1234.56» · 100 даёт
 * 123456.00000000001, и на «0.285» округление уходит не туда.
 */
export function parseMoney(text: string): Kop | null {
  const s = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (s === '') return 0
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const two = (frac + '00').slice(0, 2)
  let kop = parseInt(whole, 10) * 100 + parseInt(two, 10)
  if (frac.length > 2 && frac[2] >= '5') kop += 1 // третий знак ≥ 5 — округляем вверх
  return kop
}

/** Копейки → «1 234,56» (пробел между разрядами неразрывный) */
export function formatMoney(kop: Kop): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kop / 100)
}

// ── Даты ────────────────────────────────────────────────────────────────

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

/** «2026-09-14» → «сентябрь 2026» */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** Последний день месяца, в котором лежит дата: «2026-02-10» → «2026-02-28» */
export function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate() // нулевой день следующего месяца
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** «2026-09-30» → «30.09.2026»; пусто остаётся пустым */
export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// ── Сборка строк из данных приложения ──────────────────────────────────

/** Оплачиваемая работа из журнала; сумма в рублях, как в базе */
export interface ServiceInput { work_date: string; matter_title: string; amount: number | string }
/** Предъявленный возмещаемый расход (статусы «выставлен» и «компенсирован») */
export interface ExpenseInput { expense_date: string; description: string; doc_no: string | null; amount: number | string }
/** Поступившая оплата */
export interface PaymentInput { pay_date: string; doc_no: string | null; amount: number | string }

/**
 * Строки таблицы КАБИНЕТА за период.
 *
 * Услуги сводятся по делу и месяцу — одной строкой «Услуги по делу «…» за
 * сентябрь 2026», как принято в акте сверки (подробный перечень записей
 * остаётся в обычном акте сверки). Датой строки ставится последний день
 * месяца, но не позже конца периода. Издержки и оплаты — по одной строке:
 * их мало, и в акте каждая нужна отдельным документом.
 *
 * Издержки в начислении — по дате РАСХОДА (CLAUDE.md, п. 11), оплаты — по
 * дате поступления.
 */
export function buildRowsUs(input: {
  periodFrom: string
  periodTo: string
  services: ServiceInput[]
  expenses: ExpenseInput[]
  payments: PaymentInput[]
}): SettlementRow[] {
  const rows: SettlementRow[] = []

  const groups = new Map<string, { title: string; ym: string; kop: Kop }>()
  for (const s of input.services) {
    const ym = s.work_date.slice(0, 7)
    const key = `${s.matter_title}\u0000${ym}`
    const g = groups.get(key) ?? { title: s.matter_title, ym, kop: 0 }
    g.kop += toKop(s.amount)
    groups.set(key, g)
  }
  let i = 0
  for (const g of Array.from(groups.values())) {
    if (g.kop === 0) continue
    const monthEnd = lastDayOfMonth(`${g.ym}-01`)
    rows.push({
      id: `svc-${i++}`,
      date: monthEnd > input.periodTo ? input.periodTo : monthEnd,
      doc: `Услуги по делу «${g.title}» за ${monthLabel(`${g.ym}-01`)}`,
      debit: g.kop,
      credit: 0,
    })
  }

  input.expenses.forEach((e, k) => {
    const kop = toKop(e.amount)
    if (kop === 0) return
    rows.push({
      id: `exp-${k}`,
      date: e.expense_date,
      doc: `Возмещаемые расходы: ${e.description}${e.doc_no ? ` (док. ${e.doc_no})` : ''}`,
      debit: kop,
      credit: 0,
    })
  })

  input.payments.forEach((p, k) => {
    const kop = toKop(p.amount)
    if (kop === 0) return
    rows.push({
      id: `pay-${k}`,
      date: p.pay_date,
      doc: `Оплата${p.doc_no ? ` №${p.doc_no}` : ''} от ${fmtDate(p.pay_date)}`,
      debit: 0,
      credit: kop,
    })
  })

  // По дате; в один день сначала начисление, потом оплата — так читается как
  // «выставили → оплатили», а не наоборот
  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    Number(b.debit > 0) - Number(a.debit > 0) ||
    a.doc.localeCompare(b.doc, 'ru'))
}

/** Начальное сальдо из начислений и оплат ДО начала периода */
export function openingFrom(chargedKop: Kop, paidKop: Kop): Balance {
  const net = chargedKop - paidKop
  return { debit: Math.max(net, 0), credit: Math.max(-net, 0) }
}

// ── Зеркало ─────────────────────────────────────────────────────────────

export const mirrorBalance = (b: Balance): Balance => ({ debit: b.credit, credit: b.debit })

/** У доверителя те же документы записаны наоборот: что у нас дебет, у него кредит */
export const mirrorRows = (rows: SettlementRow[]): SettlementRow[] =>
  rows.map(r => ({ ...r, id: `${r.id}~m`, debit: r.credit, credit: r.debit }))

/** Правая таблица с учётом переключателя «зеркало» */
export function effectiveThem(doc: SettlementDoc): { opening: Balance; rows: SettlementRow[] } {
  return doc.mirror
    ? { opening: mirrorBalance(doc.openingUs), rows: mirrorRows(doc.rowsUs) }
    : { opening: doc.openingThem, rows: doc.rowsThem }
}

// ── Итоги и вывод ───────────────────────────────────────────────────────

export interface TableTotals {
  turnDebit: Kop
  turnCredit: Kop
  /** Дебет минус кредит с учётом начального сальдо: >0 — дебетовое сальдо */
  net: Kop
  closingDebit: Kop
  closingCredit: Kop
}

export function tableTotals(opening: Balance, rows: SettlementRow[]): TableTotals {
  const turnDebit = rows.reduce((s, r) => s + r.debit, 0)
  const turnCredit = rows.reduce((s, r) => s + r.credit, 0)
  const net = opening.debit - opening.credit + turnDebit - turnCredit
  return { turnDebit, turnCredit, net, closingDebit: Math.max(net, 0), closingCredit: Math.max(-net, 0) }
}

export interface Conclusion {
  favor: 'owner' | 'other' | 'none'
  amount: Kop
  text: string
}

/**
 * Вывод под таблицей. Дебетовое сальдо — в пользу владельца таблицы,
 * кредитовое — в пользу другой стороны (см. шапку файла).
 */
export function conclusion(net: Kop, owner: string, other: string): Conclusion {
  if (net > 0) return { favor: 'owner', amount: net, text: `задолженность в пользу ${owner} ${fmtMoneyFull(net)}` }
  if (net < 0) return { favor: 'other', amount: -net, text: `задолженность в пользу ${other} ${fmtMoneyFull(-net)}` }
  return { favor: 'none', amount: 0, text: 'задолженность отсутствует' }
}

/**
 * Расхождение сторон. У согласованных таблиц сальдо зеркальны (net кабинета
 * = −net доверителя), поэтому их сумма — 0. Не ноль — стороны считают по-разному.
 */
export function discrepancy(usNet: Kop, themNet: Kop): Kop {
  return Math.abs(usNet + themNet)
}

// ── Новый акт и разбор из базы ──────────────────────────────────────────

export function newSettlementDoc(p: {
  periodFrom: string
  periodTo: string
  clientName: string
  clientInn?: string | null
  /** Реквизиты кабинета одной строкой (CABINET_LINE) */
  cabinetLine: string
  rowsUs: SettlementRow[]
  openingUs: Balance
}): SettlementDoc {
  return {
    version: 1,
    periodFrom: p.periodFrom,
    periodTo: p.periodTo,
    currency: 'Российский рубль',
    orientation: 'portrait',
    us: {
      // Сокращение, а не «Адвокатский кабинет …»: название не склоняется, а в
      // выводе оно стоит после «в пользу» — «в пользу АК Бухмина А.А.» читается,
      // «в пользу Адвокатский кабинет …» нет. Полное наименование — в реквизитах (intro)
      name: 'АК Бухмина А.А.',
      intro: p.cabinetLine,
      signer: 'Адвокат Бухмин А.А.',
    },
    them: {
      name: p.clientName,
      intro: `${p.clientName}${p.clientInn ? `, ИНН ${p.clientInn}` : ''}`,
      // Должность и ФИО подписанта в базе не хранятся — их допишет пользователь
      signer: p.clientName,
    },
    openingUs: p.openingUs,
    rowsUs: p.rowsUs,
    mirror: true,
    openingThem: mirrorBalance(p.openingUs),
    rowsThem: [],
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const kop = (v: unknown): Kop => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)

function cleanRows(v: unknown): SettlementRow[] {
  if (!Array.isArray(v)) return []
  return v.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    return { id: str(o.id, `row-${i}`), date: str(o.date), doc: str(o.doc), debit: kop(o.debit), credit: kop(o.credit) }
  })
}
const cleanBalance = (v: unknown): Balance => {
  const o = (v ?? {}) as Record<string, unknown>
  return { debit: kop(o.debit), credit: kop(o.credit) }
}
const cleanParty = (v: unknown, fallback: SettlementParty): SettlementParty => {
  const o = (v ?? {}) as Record<string, unknown>
  return { name: str(o.name, fallback.name), intro: str(o.intro, fallback.intro), signer: str(o.signer, fallback.signer) }
}

/**
 * Документ из базы → безопасный SettlementDoc. Колонка jsonb может содержать
 * что угодно (правили вручную, формат когда-нибудь поменяется), а страница
 * не должна падать белым экраном на одной кривой записи.
 */
export function normalizeDoc(raw: unknown, fallbackPeriod: { from: string; to: string }): SettlementDoc {
  const o = (raw ?? {}) as Record<string, unknown>
  const empty: SettlementParty = { name: '', intro: '', signer: '' }
  return {
    version: 1,
    periodFrom: str(o.periodFrom, fallbackPeriod.from),
    periodTo: str(o.periodTo, fallbackPeriod.to),
    currency: str(o.currency, 'Российский рубль'),
    orientation: o.orientation === 'landscape' ? 'landscape' : 'portrait',
    us: cleanParty(o.us, empty),
    them: cleanParty(o.them, empty),
    openingUs: cleanBalance(o.openingUs),
    rowsUs: cleanRows(o.rowsUs),
    mirror: o.mirror !== false,
    openingThem: cleanBalance(o.openingThem),
    rowsThem: cleanRows(o.rowsThem),
  }
}

/** Имя файла: без символов, недопустимых в Windows */
export function fileBaseName(doc: SettlementDoc): string {
  return `Акт сверки ${doc.them.name} ${fmtDate(doc.periodFrom)}-${fmtDate(doc.periodTo)}`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
