'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Форма поверх страницы, а не разворотом сверху.
 *
 * Раньше формы раскрывались над списком: содержимое уезжало вниз, а если
 * список был длинный, форма открывалась за пределами экрана и выглядело
 * это так, будто ничего не произошло. В акте сверки пришлось добавлять
 * принудительную прокрутку к форме — модалка снимает саму причину.
 *
 * На телефоне это лист снизу на всю ширину с отступом под «полоску»
 * home indicator; на десктопе — окно по центру.
 *
 * Esc обрабатывается вызывающей страницей через useEscapeKey: там уже
 * учтено, что поверх может быть открыт поиск по Ctrl+K.
 */
export default function Modal({
  open, onClose, title, children, wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** Широкое окно для форм в три колонки (дела, акты, записи времени) */
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Пока окно открыто, страница под ним не прокручивается: иначе на
  // телефоне лист уезжает вместе с фоном и его невозможно докрутить
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const top = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .filter(el => el.getClientRects().length > 0).at(-1) === panel
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    ) ?? []).filter(el => el.getClientRects().length > 0)
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !top() || document.querySelector('[data-palette-open]')) return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); panel?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    const focus = (event: FocusEvent) => {
      if (top() && !document.querySelector('[data-palette-open]') && !panel?.contains(event.target as Node))
        (focusable()[0] ?? panel)?.focus()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea'
    )
    const t = setTimeout(() => first?.focus(), 60)
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-start md:justify-center
                    md:pt-[6vh] md:px-4"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div ref={panelRef}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`relative w-full ${wide ? 'md:max-w-4xl' : 'md:max-w-2xl'}
                    bg-navy-900 border border-navy-700
                    rounded-t-2xl md:rounded-xl shadow-2xl
                    max-h-[92dvh] md:max-h-[88dvh] overflow-y-auto
                    pb-[env(safe-area-inset-bottom)]`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3
                        px-5 py-4 bg-navy-900 border-b border-navy-800">
          <h2 className="font-medium text-navy-200">{title}</h2>
          <button aria-label="Закрыть" onClick={onClose} className="btn-ghost p-1 min-h-11 min-w-11">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
