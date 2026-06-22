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
