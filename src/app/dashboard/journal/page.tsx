'use client'
import { useEffect, useState } from 'react'
import { BookOpen, Table2 } from 'lucide-react'
import TimelineView from './TimelineView'
import TableView from './TableView'
import PageHeader from '@/components/PageHeader'

type View = 'timeline' | 'table'

export default function JournalPage() {
  const [view, setView] = useState<View>('timeline')

  // Ссылка «Все записи» с Обзора и старый адрес /dashboard/entries ведут
  // на таблицу, а не на шкалу сегодняшнего дня — там обычно пусто.
  // Читаем из адреса после загрузки: useSearchParams потребовал бы обёртки
  // Suspense для всей страницы.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'table') setView('table')
  }, [])

  return (
    <div className="p-4 md:p-7">
      <PageHeader title="Журнал" icon={BookOpen}>
        <div className="flex gap-1 bg-navy-900 border border-navy-800 rounded-lg p-1">
          <button
            onClick={() => setView('timeline')}
            className={`tap flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === 'timeline' ? 'bg-gold-500 text-navy-950' : 'text-navy-400 hover:text-navy-200'
            }`}>
            <BookOpen className="w-3.5 h-3.5" /> Таймлайн
          </button>
          <button
            onClick={() => setView('table')}
            className={`tap flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === 'table' ? 'bg-gold-500 text-navy-950' : 'text-navy-400 hover:text-navy-200'
            }`}>
            <Table2 className="w-3.5 h-3.5" /> Таблица
          </button>
        </div>
      </PageHeader>

      {view === 'timeline' ? <TimelineView /> : <TableView />}
    </div>
  )
}
