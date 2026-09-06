'use client'
import { useEffect, useRef } from 'react'

/**
 * Черновик заполняемой формы в памяти браузера.
 *
 * На телефоне вкладку выгружают легко: пришёл звонок, переключились в
 * другое приложение — и половина набранной записи пропала. Черновик
 * восстанавливает её при следующем открытии формы.
 *
 * Хранится только в этом браузере и только до сохранения записи: на сервер
 * ничего не уходит, и это осознанно — черновик может содержать фрагмент
 * описания по делу доверителя, а лишних мест хранения таких сведений
 * лучше не заводить.
 *
 * Черновик ведётся ТОЛЬКО для новой записи. При редактировании
 * существующей подставлять его нельзя: он затёр бы реальные данные
 * записи набором из совсем другого сеанса.
 */

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    // приватный режим или испорченные данные — просто нет черновика
    return null
  }
}

export function clearDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* не критично */ }
}

/**
 * Сохраняет форму, пока она открыта и не в режиме правки.
 *
 * Запись идёт с задержкой в секунду после последнего нажатия клавиши:
 * писать в хранилище на каждый символ незачем.
 */
export function useDraft<T>(key: string, value: T, active: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* не критично */ }
    }, 1000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [key, value, active])
}
