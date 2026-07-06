export type UserRole = 'advocate' | 'assistant'
export type ClientType = 'individual' | 'legal_entity'
export type MatterType = 'litigation' | 'consulting' | 'document' | 'corporate' | 'other'
export type MatterStatus = 'active' | 'suspended' | 'closed'
export type ActivityType =
  | 'consultation'
  | 'court_hearing'
  | 'document_prep'
  | 'correspondence'
  | 'research'
  | 'travel'
  | 'other'

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  consultation: 'Консультация',
  court_hearing: 'Судебное заседание',
  document_prep: 'Подготовка документов',
  correspondence: 'Переписка / переговоры',
  research: 'Правовой анализ',
  travel: 'Выезд',
  other: 'Иное',
}

export const MATTER_TYPE_LABELS: Record<MatterType, string> = {
  litigation: 'Судебное дело',
  consulting: 'Консультирование',
  document: 'Документы',
  corporate: 'Корпоративное',
  other: 'Иное',
}

export const MATTER_STATUS_LABELS: Record<MatterStatus, string> = {
  active: 'Активное',
  suspended: 'Приостановлено',
  closed: 'Закрыто',
}

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  hourly_rate: number | null
  created_at: string
}

export interface Client {
  id: string
  name: string
  type: ClientType
  inn: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Matter {
  id: string
  client_id: string
  title: string
  agreement_no: string | null
  matter_type: MatterType
  court: string | null
  case_no: string | null
  status: MatterStatus
  hourly_rate: number | null
  fixed_fee: number | null
  started_at: string | null
  closed_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  clients?: Client
}

export interface TimeEntry {
  id: string
  matter_id: string
  user_id: string
  work_date: string
  duration_min: number
  hourly_rate: number
  amount: number
  activity_type: ActivityType
  description: string
  is_billable: boolean
  notes: string | null
  created_at: string
  updated_at: string
  // joined
  matters?: Matter & { clients?: Client }
  profiles?: Profile
}

export interface ReportRow {
  id: string
  work_date: string
  client_name: string
  client_type: ClientType
  matter_title: string
  agreement_no: string | null
  case_no: string | null
  activity_type: ActivityType
  description: string
  duration_min: number
  hours: number
  hourly_rate: number
  amount: number
  is_billable: boolean
  performed_by: string
  notes: string | null
  created_at: string
}

export interface ReportFilters {
  date_from?: string
  date_to?: string
  client_id?: string
  matter_id?: string
  user_id?: string
  activity_type?: ActivityType
  is_billable?: boolean
}

// ============================================================
// Доходы и налоги
// ============================================================

export type ExpenseCategory =
  | 'fixed_contributions'
  | 'ops_one_percent'
  | 'palata_dues'
  | 'bank_service'
  | 'rent'
  | 'communication'
  | 'stationery'
  | 'legal_database'
  | 'literature'
  | 'equipment'
  | 'education'
  | 'travel'
  | 'advertising'
  | 'other'

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fixed_contributions: 'Фиксированные страховые взносы',
  ops_one_percent: '1% ОПС с дохода > 300 000 ₽',
  palata_dues: 'Взносы в адвокатскую палату',
  bank_service: 'РКО',
  rent: 'Аренда помещения',
  communication: 'Связь, интернет',
  stationery: 'Канцелярия, расходные материалы',
  legal_database: 'Информационно-правовые системы',
  literature: 'Профессиональная литература',
  equipment: 'Оргтехника, мебель',
  education: 'Повышение квалификации',
  travel: 'Транспортные / командировочные',
  advertising: 'Реклама',
  other: 'Прочее',
}

// Категории, по которым Минфин занимает формальную (невыгодную) позицию —
// показываем предупреждение в интерфейсе
export const EXPENSE_CATEGORY_RISKY: Partial<Record<ExpenseCategory, string>> = {
  education: 'Минфин считает, что повышение квалификации не связано напрямую с оказанием юр. помощи доверителю — позиция спорная, но без судебного спора не отбить.',
  equipment: 'Оформляйте как основное средство кабинета (акт ввода в эксплуатацию) — так вычет надёжнее.',
}

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  amount: number
  description: string
  is_documented: boolean
  doc_no: string | null
  matter_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  matters?: Matter & { clients?: Client }
}

export interface TaxSettings {
  year: number
  ndfl_rate_low: number
  ndfl_rate_high: number
  ndfl_progressive_threshold: number
  ops_threshold: number
  ops_one_percent_cap: number
  fixed_contribution_total: number
  cabinet_start_date: string | null
  advance_q1_deadline: string | null
  advance_q2_deadline: string | null
  advance_q3_deadline: string | null
  annual_deadline: string | null
  ops_deadline: string | null
  updated_at: string
}

export type TaxPaymentType =
  | 'ndfl_advance_q1'
  | 'ndfl_advance_q2'
  | 'ndfl_advance_q3'
  | 'ndfl_annual'
  | 'fixed_contributions'
  | 'ops_one_percent'

export const TAX_PAYMENT_TYPE_LABELS: Record<TaxPaymentType, string> = {
  ndfl_advance_q1: 'НДФЛ — аванс за I квартал',
  ndfl_advance_q2: 'НДФЛ — аванс за полугодие',
  ndfl_advance_q3: 'НДФЛ — аванс за 9 месяцев',
  ndfl_annual: 'НДФЛ — итог за год',
  fixed_contributions: 'Фиксированные страховые взносы',
  ops_one_percent: '1% ОПС',
}

export interface TaxPayment {
  id: string
  payment_date: string
  payment_type: TaxPaymentType
  period_year: number
  amount: number
  doc_no: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface IncomeRow {
  id: string
  pay_date: string
  pay_year: number
  pay_quarter: number
  client_id: string
  client_name: string
  matter_id: string | null
  matter_title: string | null
  amount: number
  description: string
  doc_no: string | null
}
