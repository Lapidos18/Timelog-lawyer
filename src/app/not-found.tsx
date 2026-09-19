import Link from 'next/link'
import { Scale } from 'lucide-react'

/**
 * Несуществующий адрес — старая закладка или опечатка в ссылке.
 * По-русски и с дорогой обратно, вместо стандартного «404 This page could
 * not be found».
 */
export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                        flex items-center justify-center mx-auto mb-4">
          <Scale className="w-7 h-7 text-gold-400" />
        </div>
        <h1 className="text-xl font-semibold text-navy-100 mb-2">Такой страницы нет</h1>
        <p className="text-sm text-navy-400 mb-6">
          Возможно, ссылка устарела или в адресе опечатка.
        </p>
        <Link href="/dashboard" className="btn-primary inline-flex">На Обзор</Link>
      </div>
    </div>
  )
}
