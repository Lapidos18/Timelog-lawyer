'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { moneyText, readAllRows } from '@/lib/billing'
import { Client } from '@/types'
import PageHeader from '@/components/PageHeader'
import ChangeHistory from '@/components/ChangeHistory'
import { toISO } from '@/lib/deadlines'
import toast from 'react-hot-toast'
type Checks={opening:number;accrued:number;credits:number;balance:number;unallocated:number;unbilled:number;drafts:number;pending_expenses:number}
type Period={id:string;client_id:string;period_month:string;closed:boolean;closed_at:string;note:string}
export default function ClosingPage(){
 const db=createClient(),request=useRef(0)
 const [clients,setClients]=useState<Client[]>([]),[client,setClient]=useState(''),[month,setMonth]=useState('')
 const [checks,setChecks]=useState<Checks|null>(null),[period,setPeriod]=useState<Period|null>(null)
 const [confirmed,setConfirmed]=useState({rates:false,expenses:false,documents:false}),[note,setNote]=useState('')
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0)
 useEffect(()=>{const now=new Date();now.setDate(1);now.setMonth(now.getMonth()-1);setMonth(toISO(now).slice(0,7))
  readAllRows<Client>(db,'clients').then(c=>{setClients(c);setClient(c[0]?.id||'');if(!c.length)setBusy(false)}).catch(()=>{setError('Не удалось загрузить доверителей');setBusy(false)})
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 useEffect(()=>{
  if(!client||!month)return
  const n=++request.current;setBusy(true);setError('');setChecks(null);setPeriod(null);setConfirmed({rates:false,expenses:false,documents:false});setNote('')
  Promise.all([db.rpc('month_checks',{p_client_id:client,p_month:month+'-01'}),db.from('billing_periods').select('*').eq('client_id',client).eq('period_month',month+'-01').maybeSingle()])
   .then(([c,p])=>{if(c.error||p.error)throw c.error||p.error;if(n===request.current){setChecks(c.data);setPeriod(p.data)}})
   .catch(()=>n===request.current&&setError('Не удалось проверить месяц. Закрытие недоступно до получения полного расчёта.'))
   .finally(()=>n===request.current&&setBusy(false))
  return ()=>{request.current++}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[client,month,tick])
 async function act(reopen=false){
  if(reopen&&!note.trim()){setError('Укажите причину открытия месяца');return}
  if(!window.confirm(reopen?'Открыть месяц для исправлений?':'Закрыть месяц? Правка записей этого доверителя за месяц станет недоступна до повторного открытия.'))return
  setBusy(true);setError('')
  try{const {error:failure}=await db.rpc(reopen?'reopen_billing_month':'close_billing_month',reopen?
   {p_client_id:client,p_month:month+'-01',p_reason:note.trim()}:
   {p_client_id:client,p_month:month+'-01',p_confirmations:confirmed,p_note:note.trim()})
   if(failure)throw failure;toast.success(reopen?'Месяц открыт с сохранением истории':'Месяц закрыт');setTick(x=>x+1)
  }catch(e){setError((e as {message?:string}).message||'Не удалось изменить состояние месяца')}
  finally{setBusy(false)}
 }
 const from=month+'-01',end=month?toISO(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0)):''
 return <div className="p-4 md:p-7 max-w-5xl">
  <PageHeader title="Закрытие месяца" description="Проверка расчётов и документов по доверителю. Закрытый месяц защищён от случайных изменений; открыть его можно с указанием причины."/>
  <div className="card grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"><label className="text-xs">Доверитель<select className="input min-h-11 mt-1" value={client} onChange={e=>setClient(e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-xs">Месяц<input type="month" className="input min-h-11 mt-1" value={month} onChange={e=>setMonth(e.target.value)}/></label></div>
  {error&&<p role="alert" className="card text-red-300 mb-4">{error}<button className="btn-secondary min-h-11 ml-2" onClick={()=>setTick(x=>x+1)}>Перепроверить</button></p>}
  {busy&&!checks?<p>Проверка…</p>:checks&&<>
   <div className="card mb-4"><p className="font-medium">{period?.closed?'Месяц закрыт':'Месяц открыт'}</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-sm">{[['Начальный остаток',checks.opening],['Начислено',checks.accrued],['Оплаты и уменьшения',checks.credits],['Конечный остаток',checks.balance]].map(([label,value])=><p key={String(label)}>{label}: <strong className="num">{moneyText(Number(value))} ₽</strong></p>)}</div></div>
   <div className="card mb-4 space-y-2 text-sm"><p>Работы без выпущенного акта: <strong>{checks.unbilled}</strong></p><p>Черновики актов: <strong>{checks.drafts}</strong></p><p>Непредъявленные расходы: <strong>{checks.pending_expenses}</strong></p><p>Поступления без распределения: <strong>{moneyText(checks.unallocated)} ₽</strong></p><p className="text-xs text-navy-400">Если оставляете незавершённые действия или поступления без распределения, укажите причину в примечании. Она сохранится вместе с расчётом.</p></div>
   <div className="flex gap-2 flex-wrap mb-4"><a className="btn-secondary min-h-11" href={`/dashboard/balances?client=${client}&from=${from}&to=${end}`}>Проверить расчёт</a><a className="btn-secondary min-h-11" href={`/dashboard/reports?client=${client}&from=${from}&to=${end}`}>Подготовить отчёт</a><a className="btn-secondary min-h-11" href={`/dashboard/acts?from=${from}&to=${end}`}>Подготовить акт</a><a className="btn-secondary min-h-11" href={`/dashboard/reconciliation?view=acts&client=${client}&from=${from}&to=${end}`}>Сверка</a></div>
   {!period?.closed&&<div className="card mb-4 space-y-2">{([['rates','Проверил часы, ставки и начисления'],['expenses','Проверил предъявление и компенсацию расходов'],['documents','Проверил отчёты, акты и состояние оплаты']] as const).map(([key,label])=><label key={key} className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" checked={confirmed[key]} onChange={e=>setConfirmed(v=>({...v,[key]:e.target.checked}))}/>{label}</label>)}</div>}
   <label className="label" htmlFor="closing-note">{period?.closed?'Причина открытия месяца':'Примечание / причина незавершённых действий'}</label><textarea id="closing-note" className="input min-h-24" value={note} onChange={e=>setNote(e.target.value)}/>
   <button className="btn-primary min-h-11 mt-4" disabled={busy||(!period?.closed&&!Object.values(confirmed).every(Boolean))} onClick={()=>act(!!period?.closed)}>{busy?'Сохранение…':period?.closed?'Открыть месяц с указанием причины':'Закрыть месяц'}</button>
   {period&&<ChangeHistory table="billing_periods" rowId={period.id}/>}
  </>}
 </div>
}
