'use client'
import { useEffect, useRef } from 'react'

const checks = new Set<() => boolean>()
const message = 'Есть несохранённые изменения. Покинуть форму и потерять их?'
export function mayLeaveForms() {
  return !Array.from(checks).some(check => check()) || window.confirm(message)
}

/** Snapshot at opening; successful saves close directly, user cancellation goes through close(). */
export function useFormGuard(active: boolean, value: unknown) {
  const signature = JSON.stringify(value)
  const initial = useRef(signature)
  const wasActive = useRef(false)
  if (active && !wasActive.current) initial.current = signature
  wasActive.current = active
  const dirty = active && signature !== initial.current
  const ownCheck = useUnsavedChanges(dirty)
  const close = (callback: () => void) => {
    if (mayLeaveForms()) callback()
  }
  return Object.assign(close, { maySave: () =>
    !Array.from(checks).some(check => check !== ownCheck && check()) ||
    window.confirm('В дополнительных формах есть несохранённые изменения. Сохранить основную форму и закрыть без сохранения остальных?')
  })
}

export function useUnsavedChanges(dirty: boolean) {
  const current = useRef(dirty)
  current.current = dirty
  const check = useRef(() => current.current).current
  useEffect(() => {
    checks.add(check)
    return () => { checks.delete(check) }
  }, [check])
  return check
}

/** Refresh/tab closing and normal links, including Next Link, before its router runs. */
export function useNavigationGuard() {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!Array.from(checks).some(check => check())) return
      event.preventDefault(); event.returnValue = ''
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, location.href)
      if (url.href === location.href || url.href.startsWith('javascript:')) return
      if (!mayLeaveForms()) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
    }
  }, [])
}
