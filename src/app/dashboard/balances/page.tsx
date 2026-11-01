'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { BillingEvent, moneyText, readAllRows, summarizeLedger } from '@/lib/billing'
import { Client, Matter } from '@/types'
import PageHeader from '@/components/PageHeader'
import ChangeHistory from '@/components/ChangeHistory'
import Modal from '@/components/Modal'
import { toISO } from '@/lib/deadlines'

const kindLabel: Record<string,string> = { work:'Работа',subscription:'Абонплата',accrual:'Начисление',reduction:'Уменьшение стоимости',expense:'Расход',payment:'Оплата',unallocated:'Оплата без распределения' }
export default function BalancesPage() {
 const db=createClient(), request=useRef(0)
 const [clients,setClients]=useState<Client[]>([]),[matters,setMatters]=useState<Matter[]>([])
 const [client,setClient]=useState(''),[matter,setMatter]=useState('')
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[events,setEvents]=useState<BillingEvent[]>([])
 const [error,setError]=useState(''),[busy,setBusy]=useState(true),[tick,setTick]=useState(0)
 const [history,setHistory]=useState<BillingEvent|null>(null)
 useEffect(()=>{
  const p=new URLSearchParams(window.location.search),today=toISO(new Date())
  setFrom(p.get('from')||today.slice(0,4)+'-01-01');setTo(p.get('to')||today);setMatter(p.get('matter')||'')
  Promise.all([readAllRows<Client>(db,'clients'),readAllRows<Matter>(db,'matters')]).then(([c,m])=>{
   setClients(c);setMatters(m);setClient(p.get('client')||c[0]?.id||'')
  }).catch(()=>{setError('Не удалось загрузить доверителей и задания');setBusy(false)})
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 useEffect(()=>{
  if(!client||!to)return
  const n=++request.current;setBusy(true);setEvents([]);setError('')
  readAllRows<BillingEvent>(db,'billing_events','*',q=>q.eq('client_id',client).lte('event_date',to)).then(data=>{if(n===request.current)setEvents(data)})
   .catch(()=>n===request.current&&setError('Не удалось получить полный расчёт. Проверьте связь и повторите загрузку.'))
   .finally(()=>n===request.current&&setBusy(false))
  return ()=>{request.current++}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[client,to,tick])
 const chosen=matter?events.filter(e=>e.matter_id===matter):events
 const summary=summarizeLedger(chosen,from,to)
 const unallocated=-events.filter(e=>e.kind==='unallocated').reduce((s,e)=>s+Number(e.amount),0)
 return <div className="p-4 md:p-7">
  <PageHeader title="Расшифровка расчётов" description="Каждая сумма связана с работой, начислением, расходом или поступлением. Положительный остаток — долг доверителя; отрицательный — аванс." />
  <div className="card grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
   <label className="text-xs min-w-0">Доверитель<select className="input min-h-11 mt-1" value={client} onChange={e=>{setClient(e.target.value);setMatter('')}}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="text-xs min-w-0">Задание<select className="input min-h-11 mt-1" value={matter} onChange={e=>setMatter(e.target.value)}><option value="">Все задания</option>{matters.filter(m=>m.client_id===client).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
   <label className="text-xs">С даты<input className="input min-h-11 mt-1" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
   <label className="text-xs">По дату<input className="input min-h-11 mt-1" type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
  </div>
  {error?<div role="alert" className="card"><p>{error}</p><button className="btn-secondary min-h-11 mt-3" onClick={()=>setTick(x=>x+1)}>Повторить</button></div>:busy?<p>Загрузка расчёта…</p>:!from||from>to?<p role="alert">Проверьте даты периода</p>:<>
   <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">{[
    ['Начальный остаток',summary.opening],['Начислено за период',summary.debit],['Оплаты и уменьшения',summary.credit],
    [summary.balance<0?'Аванс на конец периода':'Долг на конец периода',Math.abs(summary.balance)],
   ].map(([label,value])=><div className="card" key={String(label)}><p className="text-xs text-navy-300">{label}</p><p className="num text-lg mt-1">{moneyText(Number(value)/100)} ₽</p></div>)}</div>
   {unallocated>0&&<p className="card text-sm mb-4">У доверителя есть {moneyText(unallocated)} ₽ без распределения между заданиями. <a className="text-gold-400 underline" href="/dashboard/reconciliation">Распределить поступления</a>{matter?' Эти суммы ещё не уменьшают остаток выбранного задания.':''}</p>}
   <div className="space-y-2">{summary.period.sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.id.localeCompare(b.id)).map(e=><div key={e.id} className="card grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-2 text-sm min-w-0">
    <div><p className="num">{e.event_date.split('-').reverse().join('.')}</p><p className="text-xs text-navy-400">{kindLabel[e.kind]||e.kind}</p></div>
    <div className="min-w-0"><p className="break-words">{e.title}</p><p className="text-xs text-navy-400 break-words">{matters.find(m=>m.id===e.matter_id)?.title||'Без распределения по заданиям'}</p></div>
    <div><p className="num font-medium">{Number(e.amount)>0?'+':'−'}{moneyText(Math.abs(Number(e.amount)))} ₽</p><button className="btn-secondary min-h-11 mt-1" onClick={()=>setHistory(e)}>Источник и история</button></div>
   </div>)}</div>
   {!summary.period.length&&<p className="card">За выбранный период операций нет.</p>}
  </>}
  {history&&<Modal open onClose={()=>setHistory(null)} title="Источник расчёта"><p className="text-sm mb-3">{history.title}</p><p className="text-xs text-navy-400">{history.event_date} · {kindLabel[history.kind]}</p><ChangeHistory table={history.source} rowId={history.source_id}/></Modal>}
 </div>
}
