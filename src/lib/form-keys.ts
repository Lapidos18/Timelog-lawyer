import { useEffect } from 'react'

/**
 * Клавиатура в формах: Esc — закрыть, Ctrl+Enter — сохранить.
 *
 * Приложением пользуются каждый день и вводят в него десятки записей;
 * тянуться мышью к «Отмена» после каждой — лишнее движение. В поиске по
 * Ctrl+K клавиши работали, в формах нет.
 */

/**
 * Esc закрывает открытую форму или модалку.
 *
 * Слушатель висит на окне, а не на самой форме: фокус может стоять где
 * угодно — на кнопке, на поле, вообще нигде.
 *
 * Пока открыт поиск по Ctrl+K, Esc отдаётся ему: иначе одно нажатие
 * закрыло бы разом и палитру, и форму под ней.
 */
export function useEscapeKey(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-palette-open]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])
}

/**
 * Ctrl+Enter (⌘+Enter на Mac) отправляет форму, внутри которой стоит курсор.
 *
 * Вешается прямо на <form onKeyDown={submitOnCtrlEnter}>, поэтому не нужен
 * ни ref, ни знание о том, какая именно форма сейчас открыта.
 *
 * requestSubmit, а не submit: он проходит штатную проверку required-полей
 * и вызывает onSubmit, тогда как form.submit() перезагрузил бы страницу.
 */
export function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.requestSubmit()
  }
}
