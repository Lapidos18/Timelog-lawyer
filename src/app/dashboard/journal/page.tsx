'use client'
import { useState } from 'react'
import { BookOpen, Table2 } from 'lucide-react'
import TimelineView from './TimelineView'
import TableView from './TableView'

type View = 'timeline' | 'table'

export default function JournalPage() {
  const [view, setView] = useState<View>('timeline')

  return (
    <div className="p-4 md:p-7">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold text-navy-100">Журнал</h1>
        <div className="flex gap-1 bg-navy-900 border border-navy-800 rounded-lg p-1">
          <button
            onClick={() => setView('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === 'timeline' ? 'bg-gold-500 text-navy-950' : 'text-navy-400 hover:text-navy-200'
            }`}>
            <BookOpen className="w-3.5 h-3.5" /> Таймлайн
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === 'table' ? 'bg-gold-500 text-navy-950' : 'text-navy-400 hover:text-navy-200'
            }`}>
            <Table2 className="w-3.5 h-3.5" /> Таблица
          </button>
        </div>
      </div>

      {view === 'timeline' ? <TimelineView /> : <TableView />}
    </div>
  )
}
