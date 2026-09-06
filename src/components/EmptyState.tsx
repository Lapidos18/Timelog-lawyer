import { LucideIcon } from 'lucide-react'

/**
 * Пустой список.
 *
 * Раньше на месте списка стояла одна строка вроде «Нет актов.» — она
 * сообщает, что ничего нет, но не говорит ни зачем этот раздел, ни что
 * делать дальше. Здесь то же самое, но с иконкой, пояснением и кнопкой
 * первого действия там, где оно есть.
 *
 * Отличать «здесь пока пусто» от «фильтр ничего не нашёл» важно: в первом
 * случае нужна кнопка «добавить», во втором — подсказка сменить фильтр,
 * и кнопка была бы неуместна. Поэтому текст задаётся вызывающей стороной.
 */
export default function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-navy-800 flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-navy-400" />
        </div>
      )}
      <p className="text-sm font-medium text-navy-200">{title}</p>
      {description && (
        <p className="text-sm text-navy-400 mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
