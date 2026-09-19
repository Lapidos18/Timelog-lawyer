'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Что показать, если раздел сломался во время работы.
 *
 * Без этой страницы Next.js выводил стандартный экран на английском или
 * белый лист — посреди ввода записи на телефоне это выглядело как
 * «всё пропало». На деле данные на сервере не страдают: упал только
 * показ страницы в браузере.
 *
 * Страница стоит внутри раздела /dashboard, поэтому меню остаётся на
 * месте: можно уйти в другой раздел, не перезагружая приложение.
 * Недописанная запись журнала сохранена черновиком (src/lib/draft.ts)
 * и восстановится при следующем открытии формы.
 */
export default function DashboardError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // В консоль браузера — чтобы при разборе было с чего начать
    console.error('Ошибка в разделе:', error)
  }, [error])

  return (
    <div className="p-4 md:p-7">
      <div className="card max-w-lg mx-auto text-center py-10 px-6">
        <div className="w-12 h-12 rounded-xl bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
        </div>
        <h1 className="text-lg font-semibold text-navy-100 mb-2">Раздел не открылся</h1>
        <p className="text-sm text-navy-300 mb-1">
          Данные на сервере в сохранности — не удалось только показать страницу.
        </p>
        <p className="text-sm text-navy-400 mb-6">
          Недописанная запись журнала сохранена и восстановится при следующем открытии формы.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button onClick={reset} className="btn-primary">
            <RotateCcw className="w-4 h-4" /> Попробовать снова
          </button>
          <Link href="/dashboard" className="btn-secondary">На Обзор</Link>
        </div>
        {error.digest && (
          <p className="text-xs text-navy-400 mt-6">
            Код для разбора: <span className="num">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  )
}
