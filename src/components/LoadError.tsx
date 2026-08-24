'use client'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Показывается вместо списка, когда данные не удалось загрузить.
 *
 * Раньше при недоступной базе экраны просто оставались пустыми — выглядело
 * это как «все записи пропали», хотя данные на месте. Отсюда и формулировка:
 * первым делом успокоить, что ничего не потеряно.
 */
export default function LoadError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="card border-red-900/50 bg-red-950/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-navy-100 text-sm font-medium mb-1">
            Не удалось загрузить данные
          </p>
          <p className="text-navy-400 text-xs leading-relaxed mb-3">
            Нет связи с базой данных. Записи не потеряны — они на сервере, их просто
            не удалось сейчас получить. Проверьте подключение к интернету и повторите.
          </p>
          {onRetry && (
            <button onClick={onRetry} className="btn-secondary text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Повторить
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
