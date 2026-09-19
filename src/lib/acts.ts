/**
 * Логика актов, вынесенная из страницы, чтобы её можно было проверить
 * автотестами отдельно от вёрстки.
 */

export type ActRow = {
  id: string
  work_date: string
  activity_type: string
  description: string
  hours: number
  hourly_rate: number
  amount: number
  performed_by: string
}

/**
 * Следующий номер акта: сквозная нумерация в пределах года — АКТ-2026-001.
 *
 * Максимум ищется среди уже существующих номеров этого года; номера,
 * набранные вручную в другом формате, под шаблон не попадают и на счёт
 * не влияют.
 */
export function nextActNo(existing: string[], year: number): string {
  const re = new RegExp(`^АКТ-${year}-(\\d+)$`)
  const used = existing
    .map(no => no.trim().match(re))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => parseInt(m[1], 10))
  const next = used.length > 0 ? Math.max(...used) + 1 : 1
  return `АКТ-${year}-${String(next).padStart(3, '0')}`
}

/**
 * Строки из представления report_view → строки акта.
 *
 * Числа из базы приходят строками (numeric), поэтому приводим явно:
 * иначе сумма «12» + «30» склеится в «1230».
 */
export function toActRows(data: Record<string, unknown>[]): ActRow[] {
  return data.map(r => ({
    id: String(r.id),
    work_date: String(r.work_date),
    activity_type: String(r.activity_type),
    description: String(r.description ?? ''),
    hours: Number(r.hours),
    hourly_rate: Number(r.hourly_rate),
    amount: Number(r.amount),
    performed_by: String(r.performed_by ?? ''),
  }))
}

export function actRowsTotal(rows: ActRow[]): number {
  // Сумма в копейках, чтобы не накапливать ошибку дробной арифметики
  // на длинном акте: 0,1 + 0,2 в числах с плавающей точкой — не 0,3
  return Math.round(rows.reduce((s, r) => s + Math.round(r.amount * 100), 0)) / 100
}
