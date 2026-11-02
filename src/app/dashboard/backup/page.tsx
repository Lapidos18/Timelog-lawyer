'use client'
import { createBackup } from '../../../../scripts/backup-format.mjs'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { format } from 'date-fns'
import { Download, Database, CheckCircle, AlertCircle, HardDrive } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/PageHeader'

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
  const [backupError, setBackupError] = useState('')
  const [backupSucceeded, setBackupSucceeded] = useState(false)

  async function doBackup() {
    setLoading(true)
    setResults([])
    setBackupError('')
    setBackupSucceeded(false)
    try {
      const {data: snapshot,error: snapshotError}=await supabase.rpc('backup_snapshot')
      if(snapshotError)throw new Error('Не удалось получить полный снимок базы: '+snapshotError.message)
      const payload=await createBackup(snapshot,'manual')
      const backup=payload.data
      setResults(payload.meta.tables.map((table:string)=>({table,status:'ok' as const,count:backup[table].length})))
      const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `timelog_backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      const dateStr = format(new Date(), 'dd.MM.yyyy HH:mm')
      setLastBackup(dateStr)
      // Недоступное хранилище браузера не отменяет уже сформированный файл.
      try { localStorage.setItem('last_backup', dateStr) } catch { /* только локальная отметка */ }
      setBackupSucceeded(true)
      toast.success('Бэкап скачан!')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось создать копию. Повторите попытку.'
      setBackupError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const [lastRun,setLastRun]=useState<{success:boolean;mirror_success:boolean;completed_at:string|null;message:string}|null>(null)
  useEffect(()=>{supabase.from('backup_runs').select('success,mirror_success,completed_at,message').order('started_at',{ascending:false}).limit(1)
    .then(({data})=>setLastRun(data?.[0]??null))},[])
  const totalRecords = results.filter(r => r.status === 'ok').reduce((s, r) => s + r.count, 0)

  const TABLE_LABELS: Record<string, string> = {
    cabinet_settings:'Настройки кабинета',rate_rules:'Правила ставок',document_source_claims:'Начисления в выпущенных документах',notification_deliveries:'Состояние доставки напоминаний',payment_allocations:'Распределения платежей',act_entry_claims:'Связь работ с актами',billing_periods:'Закрытые месяцы',backup_runs:'Состояние резервирования',financial_operations:'Защита от повторных операций',
    clients:               'Доверители',
    matters:               'Дела',
    time_entries:          'Записи времени',
    payments:              'Платежи',
    acts:                  'Акты',
    profiles:              'Пользователи',
    expenses:              'Расходы',
    tax_settings:          'Налоговые настройки',
    tax_payments:          'Уплата налогов и взносов',
    manual_income:         'Ручные доходы',
    reimbursable_expenses: 'Возмещаемые расходы',
    audit_log:             'История изменений',
    court_events:          'Сроки и заседания',
    settlement_acts:       'Акты сверки (форма 1С)',
    matter_accruals:       'Начисления по актам',
  }

  return (
    <div className="p-4 md:p-7 max-w-2xl">
      <PageHeader title="Резервная копия" icon={HardDrive}
        description="Скачивает все данные из базы одним файлом. Это копия «на руки» — например, перед крупными изменениями; ежедневная копия и так делается сама." />

      <div className="card mb-4 text-sm">
        <p className="font-medium">Автоматическое резервирование</p>
        {lastRun?<><p className="mt-2">Основная копия: {lastRun.success?'проверена':'не подтверждена'}</p><p>Вторая копия: {lastRun.mirror_success?'проверена':'не создана или не настроена'}</p><p className="text-xs text-navy-300 mt-2">{lastRun.message}</p><p className="num text-xs mt-2">{lastRun.completed_at?new Date(lastRun.completed_at).toLocaleString('ru-RU'): 'Запуск ещё не завершён'}</p></>:<p className="mt-2">Сведения о новом запуске пока отсутствуют. Отметка о ручном скачивании не подтверждает автоматическую или вторую копию.</p>}
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
              <p className="text-xs text-navy-300">
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
                <span className={`text-xs num ${r.status === 'ok' ? 'text-navy-400' : 'text-red-400'}`}>
                  {r.status === 'ok' ? `${r.count} записей` : 'ошибка'}
                </span>
              </div>
            ))}
          </div>
          {backupSucceeded && (
            <div className="mt-4 pt-4 border-t border-navy-800 flex items-center justify-between">
              <span className="text-sm text-navy-400">
                Итого: <strong className="text-navy-200">{totalRecords} записей</strong>
              </span>
              <span className="text-sm text-emerald-400 font-medium">✓ Бэкап скачан</span>
            </div>
          )}
        </div>
      )}

      {backupError && <p role="alert" className="text-sm text-red-400 mb-4">{backupError}</p>}

      {/* Action */}
      <button onClick={doBackup} disabled={loading} className="btn-primary w-full justify-center py-3">
        <Download className="w-5 h-5" />
        {loading ? 'Создаю бэкап...' : 'Скачать резервную копию'}
      </button>

      {/* Instructions */}
      <div className="mt-6 p-4 bg-navy-800/40 rounded-xl border border-navy-700/50">
        <h3 className="text-xs font-medium text-navy-300 mb-2">Копии делаются сами</h3>
        <p className="text-xs text-navy-300 leading-relaxed mb-3">
          Каждый день в 20:00 рабочий компьютер сохраняет такой же файл в папку
          «Документы\Timelog-backups» и, если установлен Google Диск, ещё и в него.
          Хранятся последние 30 копий, старые удаляются сами. Если компьютер в это
          время был выключен, копия сделается при первом включении.
        </p>
        <p className="text-xs text-navy-300 leading-relaxed">
          Файл содержит все данные в формате JSON. Для восстановления обратитесь к
          разработчику — данные загружаются обратно в базу. В файле есть сведения о
          доверителях, поэтому по ссылке его никому не открывать.
        </p>
      </div>
    </div>
  )
}
