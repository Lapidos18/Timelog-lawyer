/**
 * Узнавание доверителя и дела в строке банковской выписки.
 *
 * Раньше сопоставление было одно: точное совпадение ИНН плательщика с ИНН
 * доверителя. Этого мало. Физические лица платят без ИНН, организация может
 * заплатить через представителя, а дело у платежа не определялось вообще —
 * все поступления ложились в базу без привязки к делу, хотя долг считается
 * именно по делам.
 *
 * Подсказка НЕ вносит платёж сама: она только заполняет выпадающие списки,
 * а рядом написано, откуда взялась, — чтобы было видно, чему верить.
 * Порядок проверки — от надёжного к слабому.
 */

export type ClientLike = { id: string; name: string; inn?: string | null }
export type MatterLike = {
  id: string
  client_id: string
  title: string
  agreement_no?: string | null
  case_no?: string | null
  status?: string | null
}

export type ClientReason = 'inn' | 'name'
export type MatterReason = 'agreement' | 'case' | 'single'

export type Suggestion = {
  clientId: string
  matterId: string
  clientReason: ClientReason | null
  matterReason: MatterReason | null
}

/** Организационные формы: в выписке «ООО "Система"», в базе «ООО Система» */
const LEGAL_FORMS = /(^|\s)(ооо|оао|зао|пао|ао|ип|нао|ано|фгуп|гуп|муп|тсж|снт|ук|аб|ка|кфх)(\s|$)/g

/**
 * Приводит название к виду, в котором его можно сравнивать: без кавычек,
 * организационных форм, лишних знаков и двойных пробелов.
 */
export function normalizeName(raw: string): string {
  let s = String(raw).toLowerCase().replace(/ё/g, 'е')
  s = s.replace(/[«»"'`]/g, ' ').replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  // Формы убираем в цикле: «ООО УК Альфа» содержит две подряд
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(LEGAL_FORMS, ' ').replace(/\s+/g, ' ').trim()
  }
  return s
}

/** Есть ли в назначении платежа такой номер (пробелы и регистр не важны) */
function purposeHas(purpose: string, token: string | null | undefined): boolean {
  if (!token) return false
  const norm = (s: string) => String(s).toLowerCase().replace(/\s+/g, '')
  const t = norm(token)
  // Короткие обрывки вроде «1/2» совпадут со случайной цифрой в тексте
  if (t.length < 4) return false
  return norm(purpose).includes(t)
}

function matchClient(
  row: { counterpartyInn: string; counterpartyName: string },
  clients: ClientLike[],
): { client: ClientLike; reason: ClientReason } | null {
  const inn = String(row.counterpartyInn ?? '').trim()
  if (inn) {
    const byInn = clients.find(c => (c.inn ?? '').trim() === inn)
    if (byInn) return { client: byInn, reason: 'inn' }
  }

  const name = normalizeName(row.counterpartyName ?? '')
  if (name.length >= 3) {
    const exact = clients.find(c => normalizeName(c.name) === name)
    if (exact) return { client: exact, reason: 'name' }

    // Частичное совпадение: «Система» в базе и «Система-Трейд» в платёжке.
    // Берём только если подходит ровно один доверитель — иначе подсказка
    // угадывает за пользователя и ошибается молча.
    const partial = clients.filter(c => {
      const n = normalizeName(c.name)
      return n.length >= 4 && (n.includes(name) || name.includes(n))
    })
    if (partial.length === 1) return { client: partial[0], reason: 'name' }
  }

  return null
}

function matchMatter(
  purpose: string,
  clientId: string,
  matters: MatterLike[],
): { matter: MatterLike; reason: MatterReason } | null {
  const own = matters.filter(m => m.client_id === clientId)
  if (own.length === 0) return null

  // Из нескольких подошедших берём самый длинный номер: «19/06-26» целиком
  // входит в «19/06-26-2», и короткий срабатывал бы первым, утаскивая платёж
  // в соседнее дело того же доверителя
  const longest = (a: MatterLike, b: MatterLike, field: 'agreement_no' | 'case_no') =>
    (b[field]?.length ?? 0) - (a[field]?.length ?? 0)

  const byAgreement = own
    .filter(m => purposeHas(purpose, m.agreement_no))
    .sort((a, b) => longest(a, b, 'agreement_no'))[0]
  if (byAgreement) return { matter: byAgreement, reason: 'agreement' }

  const byCase = own
    .filter(m => purposeHas(purpose, m.case_no))
    .sort((a, b) => longest(a, b, 'case_no'))[0]
  if (byCase) return { matter: byCase, reason: 'case' }

  // Единственное дело доверителя: выбирать не из чего, подставляем его
  const active = own.filter(m => (m.status ?? 'active') === 'active')
  if (active.length === 1) return { matter: active[0], reason: 'single' }
  if (own.length === 1) return { matter: own[0], reason: 'single' }

  return null
}

export function suggestForRow(
  row: { counterpartyInn: string; counterpartyName: string; purpose: string },
  clients: ClientLike[],
  matters: MatterLike[],
): Suggestion {
  const c = matchClient(row, clients)
  if (!c) return { clientId: '', matterId: '', clientReason: null, matterReason: null }

  const m = matchMatter(row.purpose ?? '', c.client.id, matters)
  return {
    clientId: c.client.id,
    matterId: m?.matter.id ?? '',
    clientReason: c.reason,
    matterReason: m?.reason ?? null,
  }
}

/**
 * Подпись под подсказкой — пользователю должно быть видно, чему верить.
 * Со строчной буквы и без точки: строка встраивается в предложение
 * «Подставлено: …. Проверьте», а сокращения вроде ИНН должны остаться
 * прописными — приводить всю фразу к нижнему регистру в вёрстке нельзя.
 */
export function reasonLabel(s: Suggestion): string {
  if (!s.clientId) return ''
  const c = s.clientReason === 'inn' ? 'по ИНН плательщика' : 'по названию плательщика'
  if (!s.matterId) return `доверитель ${c}`
  const m = s.matterReason === 'agreement' ? 'по номеру соглашения в назначении'
    : s.matterReason === 'case' ? 'по номеру дела в назначении'
    : 'единственное дело доверителя'
  return `доверитель ${c}, дело — ${m}`
}
