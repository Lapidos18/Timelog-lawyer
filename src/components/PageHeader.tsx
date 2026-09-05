import { LucideIcon } from 'lucide-react'

/**
 * Общая шапка раздела.
 *
 * До неё каждая страница верстала заголовок по-своему: где-то была подпись
 * под названием, где-то нет, отступы снизу шли от mb-5 до mb-7, иконка была
 * только у трёх разделов. Из-за этого при переходе между разделами заголовок
 * заметно «прыгал». Теперь высота и отступы одинаковые везде.
 *
 * children — кнопки действий справа от заголовка.
 */
export default function PageHeader({
  title, description, icon: Icon, children,
}: {
  title: string
  description?: React.ReactNode
  icon?: LucideIcon
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-5 md:mb-7">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold text-navy-100 flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 md:w-6 md:h-6 text-gold-400 flex-shrink-0" />}
          {title}
        </h1>
        {description && (
          <p className="text-sm text-navy-300 mt-1 max-w-3xl">{description}</p>
        )}
      </div>
      {children && <div className="flex gap-2 flex-wrap">{children}</div>}
    </div>
  )
}
