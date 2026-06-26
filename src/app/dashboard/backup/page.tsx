'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { format } from 'date-fns'
import { Download, Database, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface BackupResult {
  table: string
  count: number
  status: 'ok' | 'error'
}

export default function BackupPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [results, setResults] = useState<BackupResult[]>([])

  async function doBackup() {
    setLoading(true)
    setResults([])
    const backup: Record<string, any[]> = {}
    const newResults: BackupResult[] = []

    const tables = [
      'clients',
      'matters',
      'time_entries',
      'payments',
      'acts',
      'profiles',
    ]

    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*').order('created_at' as any)
      if (error) {
        newResults.push({ table, count: 0, status: 'error' })
      } else {
        backup[table] = data ?? []
        newResults.push({ table, count: (data ?? []).length, status: 'ok' })
      }
      setResults([...newResults])
    }

    // Add metadata
    const meta = {
      backup_date: new Date().toISOString(),
      backup_version: '1.0',
      tables: Object.keys(backup),
      total_records: Object.values(backup).reduce((s, arr) => s + arr.length, 0),
    }

    const fullBackup = { meta, data: backup }
    const json = JSON.stringify(fullBackup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `timelog_backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    const dateStr = format(new Date(), 'dd.MM.yyyy HH:mm')
    setLastBackup(dateStr)
    localStorage.setItem('last_backup', dateStr)
    toast.success('Бэкап скачан!')
    setLoading(false)
  }

  const totalRecords = results.filter(r => r.status === 'ok').reduce((s, r) => s + r.count, 0)

  const TABLE_LABELS: Record<string, string> = {
    clients:      'Клиенты',
    matters:      'Дела',
    time_entries: 'Записи времени',
    payments:     'Платежи',
    acts:         'Акты',
    profiles:     'Пользователи',
  }

  return (
    <div className="p-4 md:p-7 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-navy-100 mb-1">Резервная копия</h1>
        <p className="text-sm text-navy-500">
          Скачивает все данные из базы в файл JSON на ваш компьютер.
          Рекомендуется делать раз в месяц.
        </p>
      </div>

      {/* Info card */}
      <div className="card mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gold-500/10 border border-gold-500/20
                          flex items-center justify-center flex-shrink-0">
            <Database className="w-6 h-6 text-gold-400" />
          </div>
          <div className="flex-1">
            <h2 className="font-medium text-navy-200 mb-1">Что включается в бэкап</h2>
            <div className="grid grid-cols-2 gap-1 text-sm text-navy-400 mb-4">
              {Object.values(TABLE_LABELS).map(l => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold-500/60" />
                  {l}
                </span>
              ))}
            </div>
            {lastBackup && (
              <p className="text-xs text-navy-500">
                Последний бэкап: <span className="text-emerald-400">{lastBackup}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      {results.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-sm font-medium text-navy-300 mb-3">Прогресс</h2>
          <div className="space-y-2">
            {results.map(r => (
              <div key={r.table} className="flex items-center gap-3">
                {r.status === 'ok'
                  ? <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                <span className="text-sm text-navy-300 flex-1">{TABLE_LABELS[r.table] ?? r.table}</span>
                <span className={`text-xs font-mono ${r.status === 'ok' ? 'text-navy-400' : 'text-red-400'}`}>
                  {r.status === 'ok' ? `${r.count} записей` : 'ошибка'}
                </span>
              </div>
            ))}
          </div>
          {!loading && results.length === 6 && (
            <div className="mt-4 pt-4 border-t border-navy-800 flex items-center justify-between">
              <span className="text-sm text-navy-400">
                Итого: <strong className="text-navy-200">{totalRecords} записей</strong>
              </span>
              <span className="text-sm text-emerald-400 font-medium">✓ Бэкап скачан</span>
            </div>
          )}
        </div>
      )}

      {/* Action */}
      <button onClick={doBackup} disabled={loading} className="btn-primary w-full justify-center py-3">
        <Download className="w-5 h-5" />
        {loading ? 'Создаю бэкап...' : 'Скачать резервную копию'}
      </button>

      {/* Instructions */}
      <div className="mt-6 p-4 bg-navy-800/40 rounded-xl border border-navy-700/50">
        <h3 className="text-xs font-medium text-navy-300 mb-2">Как восстановить данные</h3>
        <p className="text-xs text-navy-500 leading-relaxed">
          Файл бэкапа содержит все данные в формате JSON. При необходимости восстановления
          обратитесь к разработчику — данные можно импортировать обратно в базу.
          Храните файл бэкапа в надёжном месте (например, в папке на рабочем столе или
          в облачном хранилище).
        </p>
      </div>
    </div>
  )
}
