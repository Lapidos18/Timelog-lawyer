'use client'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export const THEME_KEY = 'timelog-theme'

/**
 * Переключатель светлой и тёмной темы.
 *
 * С 21.09.2026 обе темы — одна пара «Кабинет»: светлая — слоновая кость
 * и тёмно-зелёный, тёмная — синяя с золотом (22.09.2026 вернули исходные
 * цвета, между 21 и 22 сентября тёмная была зелёной с латунью); шрифты
 * и «шапочка» общие для любого варианта тёмной темы. Прежние варианты
 * сохранены в design/archive/ (светлая «в стиле Google Диска», зелёная
 * тёмная и тёмно-синяя с золотом — она же нынешняя, файл на случай если
 * понадобится схема цветов отдельно от кода) и отметками
 * theme-light-google-drive / theme-dark-green / theme-dark-navy в истории.
 *
 * Тема — это атрибут data-theme на <html>; все цвета в приложении заданы
 * переменными, поэтому смена атрибута перекрашивает разделы целиком.
 * Выбор хранится в браузере: у кабинета один пользователь, отдельная
 * настройка в базе тут ничего не даёт.
 *
 * Начальное значение выставляется до первой отрисовки скриптом в layout.tsx,
 * иначе на светлой теме страница на мгновение вспыхивала бы тёмным.
 */
export default function ThemeToggle() {
  const [light, setLight] = useState(false)

  // На сервере localStorage нет, поэтому читаем после монтирования
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === 'light')
  }, [])

  function toggle() {
    const next = !light
    setLight(next)
    const root = document.documentElement
    if (next) root.dataset.theme = 'light'
    else delete root.dataset.theme
    try {
      localStorage.setItem(THEME_KEY, next ? 'light' : 'dark')
    } catch {
      // приватный режим — тема просто не запомнится до конца сеанса
    }
  }

  return (
    <button onClick={toggle}
      title={light ? 'Тёмная тема' : 'Светлая тема'}
      className="tap flex items-center gap-2 w-full px-2 py-1.5 text-xs
                 text-navy-300 hover:text-navy-100 hover:bg-navy-800 rounded-lg transition-colors">
      {light
        ? <Moon className="w-3.5 h-3.5 flex-shrink-0" />
        : <Sun className="w-3.5 h-3.5 flex-shrink-0" />}
      {light ? 'Тёмная тема' : 'Светлая тема'}
    </button>
  )
}
