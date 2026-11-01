'use client'
import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Client, Matter } from '@/types'
import { format } from 'date-fns'
import { Upload, Check, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@/components/Modal'
import { parseStatement, StatementRow } from '@/lib/bank-statement'
import { readAllRows } from '@/lib/billing'
import { receiptMatch, receiptKey, sourceReceipt, Receipt } from '@/lib/statement-import'
import { suggestForRow, reasonLabel } from '@/lib/statement-match'

/**
 * Загрузка банковской выписки и внесение поступлений.
 *
 * Ручной ввод платежа — то место, где уже случилась ошибка: сумма 48 074
 * была внесена как 45 294, и расхождение всплыло только через два месяца
 * при разборе задолженности. Выписка — первоисточник, из неё сумма и дата
 * попадают без переписывания от руки.
 *
 * Ничего не вносится молча: приложение показывает разобранные строки,
 * подставляет доверителя по ИНН и отмечает уже внесённые, а решение по
 * каждой строке остаётся за пользователем.
 */

type Match = 'new' | 'possible' | 'skip' | 'duplicate'

type Prepared = StatementRow & {
  clientId: string
  matterId: string
  /** Откуда взялась подсказка; пустая строка — не узнали */
  hint: string
  match: Match
  checked: boolean
  status?: 'saved' | 'existing' | 'error'
  error?: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function ImportStatement({
  open, onClose, clients, matters, onImported,
}: {
  open: boolean
  onClose: () => void
  clients: Client[]
  matters: Matter[]
  onImported: () => void
}) {
  const supabase = createClient()
  const [rows, setRows] = useState<Prepared[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [autoAllocate,setAutoAllocate]=useState(true)
  const [account,setAccount]=useState('')
  const importing=useRef(false)

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const parsed = await parseStatement(file)

      if (!parsed.accountNo.trim()) throw Error('Не найден номер счёта выписки. Проверьте формат файла.')
      const [payments,incomes]=await Promise.all([
        readAllRows<any>(supabase,'payments','id,pay_date,amount,doc_no,description'),
        readAllRows<any>(supabase,'manual_income','id,income_date,amount,doc_no,description'),
      ])
      const existing:Receipt[]=[...payments.map(p=>({...p,date:p.pay_date})),...incomes.map(p=>({...p,date:p.income_date}))]
      const seen=new Set<string>()
      setRows(parsed.rows.map(r=>{
        const suggestion=suggestForRow(r,clients,matters)
        const key=receiptKey(parsed.accountNo,r)
        const match:Match=seen.has(key)?'duplicate':r.skipReason?'skip':receiptMatch(r,existing)
        seen.add(key)
        return {...r,clientId:suggestion.clientId,matterId:suggestion.matterId,hint:reasonLabel(suggestion),match,checked:match==='new'}
      }))
      setAccount(parsed.accountNo)
      setFileName(file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл')
    }
    setBusy(false)
  }

  const selected = rows?.filter(r => r.checked && !r.status?.match(/saved|existing/) && r.match!=='duplicate') ?? []
  const selectedTotal = selected.reduce((s, r) => s + r.amount, 0)

  async function doImport() {
    if (!selected.length || importing.current) return
    importing.current=true
    setBusy(true)
    let ok=0,failed=0,existing=0
    try {
      const {data:{user},error}=await supabase.auth.getUser()
      if(error || !user)throw Error('Сессия завершена. Войдите в сайт повторно.')
      for(const row of selected){
        try {
          const {data,error}=await supabase.rpc('import_bank_receipt',{p_source:sourceReceipt(account,row),p_client_id:row.clientId||null,p_matter_id:row.matterId||null,p_auto:autoAllocate})
          if(error)throw error
          if(!data?.id)throw Error('Не получено подтверждение сохранения')
          if(data.existing)existing++;else ok++
          setRows(rs=>rs!.map(r=>r.index===row.index?{...r,checked:false,status:data.existing?'existing':'saved',error:undefined}:r))
        }catch(e){
          failed++
          const message=e instanceof Error?e.message:(e as {message?:string})?.message||'Не удалось сохранить'
          setRows(rs=>rs!.map(r=>r.index===row.index?{...r,status:'error',error:message}:r))
        }
      }
      if(failed)toast.error('Внесено '+ok+', уже было '+existing+', ошибок '+failed+'. Повторите только строки с ошибкой.')
      else toast.success('Внесено '+ok+'; уже было '+existing)
    }catch(e){toast.error(e instanceof Error?e.message:'Не удалось выполнить импорт')}
    finally {importing.current=false;setBusy(false);onImported()}
  }

  function close() {
    if(busy || importing.current)return
    setRows(null);setFileName('');setAccount('');onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Загрузка банковской выписки" wide>
      {!rows ? (
        <div>
          <p className="text-sm text-navy-300 mb-4">
            Выберите файл выписки в формате Excel — тот, что выгружается из клиент-банка.
            Приложение возьмёт из него поступления, само подставит доверителя по ИНН или
            названию плательщика, а дело — по номеру соглашения в назначении платежа,
            и покажет список до того, как что-либо внести.
          </p>
          <label className="btn-primary cursor-pointer inline-flex">
            <Upload className="w-4 h-4" /> {busy ? 'Читаю файл...' : 'Выбрать файл выписки'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
          <p className="text-xs text-navy-400 mt-4">
            Списания не загружаются: налоги, взносы и переводы на личный счёт доходом не являются.
            Возмещаемые расходы после загрузки отметьте в самом платеже — двойной клик по строке.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-xs text-navy-400 mb-3">
            {fileName} · поступлений: {rows.length} · сохранено/уже было: {rows.filter(r=>r.status==='saved'||r.status==='existing').length}
            <span className="block mt-1">Совпадение даты и суммы требует проверки: это могут быть разные платежи. Отметьте такую строку только после сверки. Повтор уже импортированной операции не создаст дубль.</span>
          </p>

          <label className="flex items-start gap-3 mb-3 text-sm text-navy-300">
            <input type="checkbox" className="min-w-[44px] min-h-[44px] accent-gold-500" checked={autoAllocate} disabled={busy} onChange={e=>setAutoAllocate(e.target.checked)}/>
            <span>Распределять автоматически при точном совпадении с остатками заданий на дату платежа. При включении выбор задания в строке заменяется автоподбором; при неоднозначности платёж остаётся без распределения.</span>
          </label>
          {/* Своя прокрутка только на десктопе. На телефоне окно и так лист
              снизу со своей прокруткой — вложенная область внутри него
              превращается в две полосы прокрутки на одном экране. */}
          <div className="space-y-2 md:max-h-[45vh] md:overflow-y-auto md:pr-1">
            {rows.map(r => (
              <div key={r.index}
                className={`tap flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer ${
                  r.checked ? 'border-gold-600/50 bg-gold-500/5' : 'border-navy-800 hover:bg-navy-800/40'
                }`}>
                <input type="checkbox" className="w-6 h-6 min-w-[44px] min-h-[44px] accent-gold-500 flex-shrink-0"
                  checked={r.checked}
                  aria-label={'Внести поступление №'+(r.docNo || r.index+1)}
                  disabled={busy || r.status==='saved'||r.status==='existing'||r.match==='duplicate'}
                  onChange={e => setRows(rs => rs!.map(x =>
                    x.index === r.index ? { ...x, checked: e.target.checked } : x))} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-sm text-navy-100">
                      <span className="num">{format(new Date(r.date), 'dd.MM.yyyy')}</span>
                      {' · '}
                      <span className="num font-medium">{fmt(r.amount)} ₽</span>
                    </span>
                    {r.match === 'possible' && (
                      <span className="text-xs text-emerald-400">возможно уже внесено — проверьте</span>
                    )}
                    {r.match==='duplicate' && <span className="text-xs text-amber-400">повтор одинаковой строки в файле — проверьте документ</span>}
                  {r.status==='saved' && <span className="text-xs text-emerald-400">внесено</span>}
                  {r.status==='existing' && <span className="text-xs text-emerald-400">уже импортировано</span>}
                  {r.error && <span role="alert" className="block text-xs text-red-400 break-words">{r.error}</span>}
                  {r.skipReason === 'own' && (
                      <span className="text-xs text-amber-400">перевод со своего счёта — не доход</span>
                    )}
                    {r.skipReason === 'bank' && (
                      <span className="text-xs text-amber-400">от банка — не гонорар</span>
                    )}
                  </span>
                  <span className="block text-xs text-navy-300 truncate mt-0.5">
                    {r.counterpartyName}{r.counterpartyInn ? ` · ИНН ${r.counterpartyInn}` : ''}
                  </span>
                  <span className="block text-xs text-navy-400 truncate">{r.purpose}</span>

                  <select disabled={busy || r.status==='saved'||r.status==='existing'||r.match==='duplicate'} className="select mt-2 text-xs" value={r.clientId}
                    onChange={e => setRows(rs => rs!.map(x => x.index === r.index
                      // Сменили доверителя — прежнее дело больше не его,
                      // и подсказка тоже устарела
                      ? { ...x, clientId: e.target.value, matterId: '', hint: '' }
                      : x))}>
                    <option value="">— без доверителя (уйдёт в «Доходы» отдельной строкой) —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  {r.clientId && !autoAllocate && (
                    <select disabled={busy || r.status==='saved'||r.status==='existing'||r.match==='duplicate'} className="select mt-2 text-xs" value={r.matterId}
                      onChange={e => setRows(rs => rs!.map(x =>
                        x.index === r.index ? { ...x, matterId: e.target.value } : x))}>
                      <option value="">— без дела (долг считается по доверителю целиком) —</option>
                      {matters.filter(m => m.client_id === r.clientId)
                        .map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  )}

                  {r.hint && (
                    <span className="flex items-start gap-1.5 mt-1.5 text-xs text-navy-400">
                      <Wand2 className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>Подставлено: {r.hint}. Проверьте.</span>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-4 border-t border-navy-800">
            <p className="text-sm text-navy-300">
              Отмечено: <span className="num text-navy-100">{selected.length}</span>
              {' · '}
              <span className="num text-navy-100">{fmt(selectedTotal)} ₽</span>
            </p>
            <div className="flex gap-3">
              <button onClick={doImport} disabled={busy || selected.length === 0} className="btn-primary">
                <Check className="w-4 h-4" /> {busy ? 'Вношу...' : 'Внести отмеченные'}
              </button>
              <button disabled={busy} onClick={() => { setRows(null); setFileName('') }} className="btn-secondary">
                Другой файл
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
