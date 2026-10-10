/**
 * Акт об оказании услуг в форме, которую адвокат сам отправляет доверителям
 * (образец «Акт_30.09.2026 Задание № 3», 10.10.2026).
 *
 * Это договорной документ, а не таблица записей: стороны с реквизитами,
 * ссылка на соглашение и задание, итоговая сумма цифрами и прописью, одна
 * таблица «по специалистам» (часы × ставка), абзац о возмещении расходов,
 * подписи с реквизитами. Построчная детализация по датам в нём не нужна —
 * она в отчёте.
 *
 * Здесь только текст и состав документа, без вёрстки: из одних и тех же
 * блоков собираются и печатная версия (act-print.ts), и файл Word, и они не
 * могут разойтись. Всё, что можно посчитать, считается здесь и проверяется
 * тестами; деньги — в копейках целыми числами, как в остальных актах.
 */
import { fmtMoneyAct } from './money-words'

// ── Даты и номера ───────────────────────────────────────────────────────

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** 2026-09-30 → 30.09.2026 (без перевода часовых поясов: дата берётся как написана) */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/** 2026-09-30 → «30 сентября 2026 года» */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS_GEN[Number(m[2]) - 1]} ${m[1]} года`
}

/**
 * Соглашение как оно пишется в документах: «19/06-26 от 19.06.2026».
 * В номере дело бывает уже с датой («19/06-26 от 19.06.2026» — так внесено у части
 * дел), тогда второй раз её не добавляем.
 */
export function agreementRef(no?: string | null, dateIso?: string | null): string {
  const n = (no ?? '').trim()
  if (!n) return ''
  if (/\sот\s+\d{1,2}\.\d{1,2}\.\d{2,4}/i.test(n)) return n
  return dateIso ? `${n} от ${shortDate(dateIso)}` : n
}

/** Строка «Соглашение:» в отчёте: «19/06-26 от 19.06.2026, задание № 3» */
export function agreementLine(no?: string | null, dateIso?: string | null, taskNo?: string | null): string {
  const ref = agreementRef(no, dateIso)
  const task = (taskNo ?? '').trim()
  if (!ref) return task ? `задание № ${task}` : ''
  return task ? `${ref}, задание № ${task}` : ref
}

// ── Имена ───────────────────────────────────────────────────────────────

const LEGAL_FORMS: [RegExp, string][] = [
  [/^ООО\s+/, 'Общество с ограниченной ответственностью '],
  [/^ПАО\s+/, 'Публичное акционерное общество '],
  [/^ЗАО\s+/, 'Закрытое акционерное общество '],
  [/^АО\s+/, 'Акционерное общество '],
  [/^АБ\s+/, 'Адвокатское бюро '],
  [/^ИП\s+/, 'Индивидуальный предприниматель '],
]

/** Прямые кавычки "…" → «…» */
export function guillemets(s: string): string {
  return s.replace(/"([^"]*)"/g, '«$1»')
}

/**
 * Полное наименование из того, как доверитель записан в программе:
 * ООО УК "Альфа менеджмент" → Общество с ограниченной ответственностью
 * Управляющая компания «Альфа менеджмент». Регистр самого названия не трогаем
 * (в образце «СИСТЕМА» заглавными — это пишется в карточке доверителя вручную).
 */
export function expandLegalForm(name: string): string {
  let s = name.trim()
  for (const [re, full] of LEGAL_FORMS) {
    if (re.test(s)) { s = s.replace(re, full); break }
  }
  s = s.replace(/^(.*?(?:ответственностью|общество|бюро|предприниматель))\s+УК\s+/i, '$1 Управляющая компания ')
  return guillemets(s)
}

/** Кратко для подписи: ООО "Система" → ООО «Система» */
export function shortOrgName(name: string): string {
  return guillemets(name.trim())
}

/** Кадырова Наталья Викторовна → Н.В. Кадырова */
export function shortFio(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return full.trim()
  const initials = parts.slice(1).map(p => `${p.charAt(0).toUpperCase()}.`).join('')
  return `${initials} ${parts[0]}`
}

// ── Часы и деньги ───────────────────────────────────────────────────────

const money = (kop: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kop / 100)

/** Часы: 2,75 */
const hoursText = (hundredths: number) => (hundredths / 100).toFixed(2).replace('.', ',')

export interface ActRowIn {
  hours: number
  hourly_rate: number
  amount: number
  performed_by: string
}

export interface SpecialistLine {
  /** Как показано доверителю: «Адвокат» (п. 5 CLAUDE.md) */
  label: string
  /** Ставка в копейках */
  rateKop: number
  /** Часы в сотых долях */
  hours100: number
  /** Сумма в копейках */
  amountKop: number
}

/**
 * Часы и суммы по специалистам. Строка = исполнитель + ставка: если у одного
 * исполнителя в периоде записи по разным ставкам (например, «время в пути»
 * за полставки или запись, внесённая по ставке другого дела), строк будет
 * несколько. Иначе в одной строке стояли бы ставка первой записи и сумма всех
 * — и «9 412 × 2,75» не давало бы итог в соседней колонке, что доверитель
 * замечает первым делом.
 */
export function specialistLines(rows: ActRowIn[]): { lines: SpecialistLine[]; totalHours100: number; totalKop: number } {
  const lines: SpecialistLine[] = []
  const index: Record<string, number> = {}
  let totalHours100 = 0
  let totalKop = 0
  for (const r of rows) {
    const rateKop = Math.round(Number(r.hourly_rate) * 100)
    const key = `${r.performed_by}|${rateKop}`
    if (index[key] === undefined) {
      index[key] = lines.length
      lines.push({ label: 'Адвокат', rateKop, hours100: 0, amountKop: 0 })
    }
    const h = Math.round(Number(r.hours) * 100)
    const a = Math.round(Number(r.amount) * 100)
    lines[index[key]].hours100 += h
    lines[index[key]].amountKop += a
    totalHours100 += h
    totalKop += a
  }
  return { lines, totalHours100, totalKop }
}

// ── Состав документа ────────────────────────────────────────────────────

export type ActBlock =
  | { kind: 'title'; text: string }
  | { kind: 'placeDate'; place: string; date: string }
  | { kind: 'para'; text: string; bold?: boolean }
  | { kind: 'spacer' }
  | { kind: 'table'; head: string[]; rows: string[][]; total: string[] }
  | { kind: 'signs'; left: string[]; right: string[] }

export interface ActDoc {
  /** Имя файла и заголовок окна печати: «Акт_30.09.2026 Задание № 3» */
  fileName: string
  blocks: ActBlock[]
  /** Итог по работе, ₽ (то же, что в тексте и в таблице) */
  total: number
}

export interface ActCabinet {
  fullName: string
  regNo: string
  certNo: string
  inn: string
  signerShort: string
  city: string
}

export interface ActClientIn {
  name: string
  type: 'individual' | 'legal_entity'
  inn?: string | null
  full_name?: string | null
  ogrn?: string | null
  representative?: string | null
  signer_position?: string | null
  signer_short?: string | null
}

export interface ActMatterIn {
  title: string
  agreement_no?: string | null
  agreement_date?: string | null
  task_no?: string | null
  task_date?: string | null
  started_at?: string | null
  act_subject?: string | null
  expenses_clause?: string | null
}

export interface ActDocInput {
  cabinet: ActCabinet
  client: ActClientIn
  matter: ActMatterIn
  periodFrom: string
  periodTo: string
  rows: ActRowIn[]
  /** Возмещаемые расходы, ₽; 0 или пусто — абзаца о расходах нет */
  expensesAmount?: number | null
  /** Примечание к акту (поле «Примечание» при создании) */
  note?: string | null
}

const clean = (s?: string | null) => (s ?? '').trim()

export function actFileName(i: Pick<ActDocInput, 'periodTo' | 'matter'>): string {
  const task = clean(i.matter.task_no)
  const tail = task ? `Задание № ${task}` : i.matter.title
  return `Акт_${shortDate(i.periodTo)} ${tail}`.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

export function buildActDoc(input: ActDocInput): ActDoc {
  const { cabinet: cab, client: c, matter: m } = input
  const { lines, totalHours100, totalKop } = specialistLines(input.rows)
  const total = totalKop / 100

  // Соглашение и задание
  const agr = agreementRef(m.agreement_no, m.agreement_date)
  const agrTail = agr ? ` № ${agr}` : ''
  const taskNo = clean(m.task_no)
  const taskDate = clean(m.task_date) || clean(m.started_at)
  const taskRef = taskNo ? `№ ${taskNo}${taskDate ? ` от ${shortDate(taskDate)}` : ''}` : ''
  // «в соответствии с Заданием № 3 от … к Соглашению …» либо просто «с Соглашением …»
  const basisInstr = taskNo
    ? `Заданием ${taskRef} к Соглашению об оказании юридической помощи${agrTail}`
    : `Соглашением об оказании юридической помощи${agrTail}`
  const taskInstr = taskNo ? `Заданием ${taskRef}` : `Соглашением${agrTail}`

  // Предмет: что именно сделано
  const subject = clean(m.act_subject).replace(/\.+$/, '')
  const subjectText = subject ? ` в виде ${subject}` : ` по делу «${m.title}»`

  // Стороны
  const isOrg = c.type === 'legal_entity'
  const orgName = clean(c.full_name) || expandLegalForm(c.name)
  const clientInn = clean(c.inn)
  const ogrn = clean(c.ogrn)
  const reqs = [ogrn && `ОГРН ${ogrn}`, clientInn && `ИНН ${clientInn}`].filter(Boolean).join(', ')
  const rep = clean(c.representative)
  const lawyerPara = `${cab.fullName}, регистрационный номер в реестре адвокатов Новосибирской области № ${cab.regNo}, удостоверение адвоката № ${cab.certNo}, именуемый далее «Адвокат» с одной стороны и`
  const clientPara = isOrg
    ? `${orgName}${reqs ? ` (${reqs})` : ''}${rep ? ` в лице ${rep}` : ''}, именуемое далее «Доверитель», с другой стороны,`
    : `${clean(c.full_name) || c.name}${clientInn ? ` (ИНН ${clientInn})` : ''}, именуемый(ая) далее «Доверитель», с другой стороны,`

  const blocks: ActBlock[] = []
  blocks.push({ kind: 'title', text: 'АКТ ОБ ОКАЗАНИИ УСЛУГ' })
  blocks.push({ kind: 'title', text: `к соглашению об оказании юридической помощи${agrTail}` })
  blocks.push({ kind: 'spacer' })
  blocks.push({ kind: 'placeDate', place: cab.city, date: longDate(input.periodTo) })
  blocks.push({ kind: 'spacer' })
  blocks.push({ kind: 'para', text: lawyerPara, bold: true })
  blocks.push({ kind: 'para', text: clientPara, bold: true })
  blocks.push({ kind: 'para', text: 'совместно именуемые «Стороны»,' })
  blocks.push({ kind: 'spacer' })
  blocks.push({ kind: 'para', text: 'Составили настоящий акт о нижеследующем:', bold: true })
  blocks.push({
    kind: 'para',
    text: `Адвокат в соответствии с ${basisInstr} оказал Доверителю надлежащим образом в полном соответствии с условиями Соглашения юридическую помощь${subjectText}.`,
  })
  blocks.push({
    kind: 'para',
    text: `За оказанные в период с ${shortDate(input.periodFrom)} по ${shortDate(input.periodTo)} услуги Доверитель уплачивает Адвокату${taskNo ? ` в соответствии с Заданием ${taskRef}` : ''} сумму в размере ${fmtMoneyAct(total)}, исходя из данных учета трудозатрат Адвоката:`,
    bold: true,
  })
  blocks.push({
    kind: 'table',
    head: ['Квалификация специалиста', 'Затраты времени, чел-ч', 'Стоимость 1 чел-ч', 'Общая стоимость по проекту'],
    rows: lines.map(l => [l.label, hoursText(l.hours100), money(l.rateKop), money(l.amountKop)]),
    total: ['ИТОГО', 'Х', 'Х', money(totalKop)],
  })

  const expenses = Number(input.expensesAmount ?? 0)
  if (expenses > 0) {
    const clause = clean(m.expenses_clause)
    const against = clause
      ? `${clause} ${taskNo ? `Задания ${taskRef}` : `Соглашения${agrTail}`}`
      : taskInstr
    blocks.push({
      kind: 'para',
      text: `В соответствии с ${against} Доверитель возмещает Адвокату расходы в размере ${fmtMoneyAct(expenses)}`,
      bold: true,
    })
  }
  if (clean(input.note)) blocks.push({ kind: 'para', text: clean(input.note) })
  blocks.push({ kind: 'para', text: 'Доверитель не имеет претензий к качеству оказанных Адвокатом услуг.' })
  blocks.push({ kind: 'para', text: 'Настоящий акт составлен в 2 (двух) экземплярах, имеющих равную юридическую силу, по одному для каждой из сторон.' })
  blocks.push({ kind: 'para', text: 'Подписи сторон:' })

  // Подписи с реквизитами
  const line = (who: string) => `_______________________${who ? `/${who}/` : ''}`
  const firmRest = cab.fullName.replace(/^Адвокатский кабинет\s+/, '')
  const left = [
    'Адвокат:', 'Адвокатский кабинет', firmRest,
    `Рег. номер: ${cab.regNo}`, `Удостоверение адвоката №: ${cab.certNo}`, `ИНН: ${cab.inn}`,
    '', '', '', line(cab.signerShort), 'м.п.',
  ]
  const right = isOrg
    ? [
        'Доверитель:', shortOrgName(c.name),
        ...(ogrn ? [`ОГРН: ${ogrn}`] : []), ...(clientInn ? [`ИНН: ${clientInn}`] : []),
        '', '', clean(c.signer_position), '', '', line(clean(c.signer_short)), 'м.п.',
      ]
    : [
        'Доверитель:', clean(c.full_name) || c.name,
        ...(clientInn ? [`ИНН: ${clientInn}`] : []),
        '', '', '', '', line(clean(c.signer_short) || shortFio(c.name)),
      ]
  blocks.push({ kind: 'signs', left, right })

  return { fileName: actFileName(input), blocks, total }
}
