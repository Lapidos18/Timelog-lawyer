import { Org } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Карточка адвокатского кабинета текущего пользователя.
 *
 * Запрос без фильтра — права доступа в базе всё равно вернут только свой
 * кабинет (см. миграцию 011). Возвращает null, если карточку получить
 * не удалось: документ в этом случае печатается без реквизитов, но печатается.
 */
export async function fetchOrg(supabase: SupabaseClient): Promise<Org | null> {
  const { data } = await supabase.from('orgs').select('*').limit(1).maybeSingle()
  return (data as Org) ?? null
}

/** Наименование для шапки документа. */
export function orgTitle(org: Org | null): string {
  return org?.full_name || org?.name || 'Адвокатский кабинет'
}

/**
 * Строка реквизитов под наименованием: «…, рег. № 54/1831, ИНН 540233730471».
 * Незаполненные поля просто не выводятся — пустых «рег. № —» в документе быть
 * не должно.
 */
export function orgRequisites(org: Org | null): string {
  const parts = [orgTitle(org)]
  if (org?.reg_no) parts.push(`рег. № ${org.reg_no}`)
  if (org?.inn) parts.push(`ИНН ${org.inn}`)
  return parts.join(', ')
}

/** Подпись в конце документа: «А.А. Бухмин». */
export function orgSignature(org: Org | null): string {
  return org?.signature_name || org?.advocate_name || org?.name || ''
}

/**
 * «Бухмин Антон Андреевич» → «А.А. Бухмин».
 * Используется как подсказка при заполнении настроек; вручную подпись можно
 * задать любую — у двойных фамилий и отчеств вроде «оглы» автоматика врёт.
 */
export function initialsSignature(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName.trim()
  const [last, ...rest] = parts
  const initials = rest.map(p => p[0].toUpperCase() + '.').join('')
  return `${initials} ${last}`
}
