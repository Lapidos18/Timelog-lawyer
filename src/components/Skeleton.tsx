/**
 * Заглушки на время загрузки данных.
 *
 * Раньше на месте таблицы стояло слово «Загрузка...» — страница выглядела
 * пустой, и было непонятно, сломалось что-то или ещё грузится. Контуры
 * будущих строк показывают, что именно сейчас появится, и ожидание
 * ощущается короче при той же скорости.
 */

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`skeleton h-3.5 rounded ${className}`} />
}

/** Строки списка или таблицы */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2" aria-label="Загрузка данных">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <SkeletonLine className="w-24 flex-shrink-0" />
          <SkeletonLine className="flex-1" />
          <SkeletonLine className="w-20 flex-shrink-0 hidden sm:block" />
          <SkeletonLine className="w-24 flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Плитки со сводными числами */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4" aria-label="Загрузка данных">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card">
          <SkeletonLine className="w-2/3 h-3" />
          <SkeletonLine className="w-1/2 h-6 mt-2" />
        </div>
      ))}
    </div>
  )
}

/** Карточки-записи (мобильные списки) */
export function SkeletonCards({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 py-2" aria-label="Загрузка данных">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <SkeletonLine className="w-1/2" />
          <SkeletonLine className="w-3/4 h-3" />
          <SkeletonLine className="w-1/4 h-3" />
        </div>
      ))}
    </div>
  )
}
