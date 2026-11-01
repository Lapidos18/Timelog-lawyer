export interface Allocation {
  id?: string; payment_id?: string; matter_id: string; act_id?: string | null;
  fee_amount: number | string; expense_amount: number | string;
}
export interface BillingEvent {
  id: string; client_id: string; matter_id: string | null; event_date: string;
  kind: string; amount: number | string; title: string; source: string; source_id: string;
}
export const moneyKop = (value: number | string) => Math.round(Number(value) * 100)
export const moneyText = (value: number) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value)

/** Поля ввода: без скрытого округления и частичного parseFloat('12abc'). */
export function readRub(text: string): number | null {
  const s = text.replace(/[\s\u00a0]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const parts = s.split('.')
  const kop = Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(kop) ? kop : null
}
export function allocationTotal(rows: Allocation[]): number {
  return rows.reduce((sum, r) => sum + moneyKop(r.fee_amount) + moneyKop(r.expense_amount), 0)
}
export function allocationError(rows: Allocation[], paymentAmount: number | string): string | null {
  if (rows.some(r => !r.matter_id)) return 'Выберите задание в каждой строке'
  for (const r of rows) {
    const fee = readRub(String(r.fee_amount)), expense = readRub(String(r.expense_amount))
    if (fee === null || expense === null || fee + expense <= 0) return 'Укажите положительные суммы с точностью до копейки'
  }
  if (allocationTotal(rows) > moneyKop(paymentAmount)) return 'Распределение превышает сумму платежа'
  return null
}
export function summarizeLedger(events: BillingEvent[], from: string, to: string) {
  const before = events.filter(e => e.event_date < from)
  const period = events.filter(e => e.event_date >= from && e.event_date <= to)
  const opening = before.reduce((s, e) => s + moneyKop(e.amount), 0)
  const debit = period.filter(e => Number(e.amount) > 0).reduce((s, e) => s + moneyKop(e.amount), 0)
  const credit = -period.filter(e => Number(e.amount) < 0).reduce((s, e) => s + moneyKop(e.amount), 0)
  return { opening, debit, credit, balance: opening + debit - credit, period }
}
/** Не считать первую страницу полного финансового ответа окончательным итогом. */
export async function readAllRows<T>(client: any, table: string, columns = '*', filter?: (query: any) => any, orderColumn = 'id'): Promise<T[]> {
  const all: T[] = []
  for (let start = 0; ;) {
    let query = client.from(table).select(columns, { count: 'exact' })
    if (filter) query = filter(query)
    const { data, error, count } = await query.order(orderColumn).range(start, start + 499)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Получен неполный ответ базы')
    all.push(...data)
    if (data.length === 0 || (typeof count === 'number' && all.length >= count)) return all
    start += data.length
  }
}
export async function readAllResult(client: any, table: string, columns: string, filter?: (query: any) => any): Promise<{data:any[]|null;error:any}> {
  try{return {data:await readAllRows(client,table,columns,filter),error:null}}
  catch(error){return {data:null,error}}
}
