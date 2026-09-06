/**
 * Разбор банковской выписки в формате Excel.
 *
 * Формат снят с реальной выгрузки по счёту адвокатского кабинета:
 * восемь строк шапки (счёт, клиент, ИНН, остатки, обороты), строка
 * заголовков колонок и дальше операции. Колонки ищем по названию, а не по
 * номеру: банк может добавить столбец, и жёсткая привязка к позиции
 * сломалась бы молча — с деньгами это недопустимо.
 */

export type StatementRow = {
  /** Порядковый номер строки в файле — чтобы отличать одинаковые операции */
  index: number
  date: string           // yyyy-MM-dd
  docNo: string
  amount: number
  purpose: string
  counterpartyInn: string
  counterpartyName: string
  /** Почему строку не стоит вносить как доход от доверителя */
  skipReason?: 'own' | 'bank'
}

export type ParsedStatement = {
  accountNo: string
  ownInn: string
  rows: StatementRow[]
}

/** «224,000.00» → 224000 */
function parseAmount(raw: string): number {
  const n = parseFloat(String(raw).replace(/\s/g, '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** «27.04.2026» → «2026-04-27» */
function parseDate(raw: string): string {
  const m = String(raw).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

/** Банки, чьи поступления — проценты на остаток и кэшбэк, а не гонорар */
const BANK_INNS = new Set(['7710140679']) // АО «ТБанк»

export async function parseStatement(file: File): Promise<ParsedStatement> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })

  // Собственный ИНН из шапки: по нему отсеиваются переводы между своими счетами
  const innRow = grid.find(r => String(r[0]).trim() === 'ИНН')
  const accRow = grid.find(r => String(r[0]).trim().startsWith('Выписка по счёту'))
  const ownInn = innRow ? String(innRow[1]).trim() : ''
  const accountNo = accRow ? String(accRow[1]).trim() : ''

  const headerIdx = grid.findIndex(r => r.some(c => String(c).trim() === 'Тип операции'))
  if (headerIdx === -1) {
    throw new Error('Не похоже на банковскую выписку: не найдена строка заголовков')
  }
  const header = grid[headerIdx].map(c => String(c).trim())
  const col = (name: string) => header.indexOf(name)

  const cType    = col('Тип операции')
  const cDate    = col('Дата проведения')
  const cDoc     = col('Номер документа')
  const cAmount  = col('Сумма в валюте счёта')
  const cPurpose = col('Назначение платежа')
  const cInn     = col('ИНН контрагента')
  const cName    = col('Наименование контрагента')

  if ([cType, cDate, cAmount].some(i => i === -1)) {
    throw new Error('В выписке не хватает колонок: тип операции, дата или сумма')
  }

  const rows: StatementRow[] = []
  grid.slice(headerIdx + 1).forEach((r, i) => {
    // Берём только поступления: списания — это налоги, взносы и переводы себе,
    // доходом они не являются
    if (String(r[cType]).trim() !== 'Кредит') return

    const inn = String(r[cInn] ?? '').trim()
    const amount = parseAmount(r[cAmount])
    const date = parseDate(r[cDate])
    if (!date || amount <= 0) return

    rows.push({
      index: i,
      date,
      docNo: String(r[cDoc] ?? '').trim(),
      amount,
      purpose: String(r[cPurpose] ?? '').trim(),
      counterpartyInn: inn,
      counterpartyName: String(r[cName] ?? '').trim(),
      // Свой же ИНН — это возврат собственных средств со вклада или другого
      // счёта. В доход такие суммы не идут, и попади они туда, НДФЛ вырос бы
      // на пустом месте.
      skipReason: inn && inn === ownInn ? 'own'
        : BANK_INNS.has(inn) ? 'bank'
        : undefined,
    })
  })

  return { accountNo, ownInn, rows }
}
