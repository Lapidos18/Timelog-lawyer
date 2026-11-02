'use client'
import {useEffect,useState} from 'react'
import {createClient} from '@/lib/supabase'
import {notificationDay} from '@/lib/notification-delivery'
import {useCabinetSettings} from './CabinetSettings'
type Delivery={id:string;notification_day:string;part_no:number;status:string;attempts:number;updated_at:string;error_code:string|null;next_attempt_at?:string|null}
const labels:Record<string,string>={pending:'Ожидает отправки',sending:'Отправляется',sent:'Telegram подтвердил приём',failed:'Ошибка отправки',uncertain:'Результат неизвестен — проверьте Telegram',checked:'Расписание проверено',nothing:'Проверено: событий для напоминания нет'}
export default function NotificationStatus({refresh,onRetry}:{refresh:boolean;onRetry:()=>void}){
 const {settings,ready}=useCabinetSettings()
 const db=createClient(),[rows,setRows]=useState<Delivery[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function load(){const {data,error}=await db.from('notification_deliveries').select('id,notification_day,part_no,status,attempts,updated_at,error_code,next_attempt_at').order('updated_at',{ascending:false}).limit(12);if(error)setError('Не удалось проверить состояние отправки');else{setRows(data||[]);setError('')}}
 useEffect(()=>{load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},60000);return()=>clearInterval(t)},[refresh])
 const day=notificationDay(),important=rows.find(r=>r.notification_day===day&&['failed','uncertain','pending','sending'].includes(r.status))||rows[0]
 return <section className="card mb-5"><details><summary className="cursor-pointer min-h-11 text-sm font-medium">Состояние напоминаний{ready&&!settings.notificationsEnabled?' · Отключены в настройках':important?' · '+(important.error_code==='notifications_disabled'?'Отключено в настройках':labels[important.status]):''}</summary>
 {rows.length>0&&!rows.some(r=>r.notification_day===day)&&<p className="text-amber-400 text-sm mb-3">Сегодняшней подтверждённой проверки пока нет. Последняя: {rows[0].notification_day}.</p>}
 <p className="text-xs text-navy-400 mb-3">Приём сообщения Telegram не означает прочтение. Плановые проверки: 08:00 и 13:00 по Новосибирску; точное время зависит от запуска расписания сервером. Дневная проверка повторяет временно неудавшиеся отправки. Подтверждённые части повторно не отправляются.</p>
 {error&&<p role="alert" className="text-red-400 text-sm">{error} <button className="btn-secondary min-h-11" onClick={load}>Обновить</button></p>}
 {!rows.length&&!error&&<p className="text-sm text-navy-400">После обновления проверок ещё не было.</p>}
 {rows.map(r=><div key={r.id} className="border-t border-navy-700 py-3 text-sm"><p>{new Date(r.updated_at).toLocaleString('ru-RU',{timeZone:'Asia/Novosibirsk'})} · {r.part_no?'Часть '+r.part_no:'Проверка'} · {r.error_code==='notifications_disabled'?'Напоминания отключены в настройках':labels[r.status]||r.status}</p>
 {r.part_no>0&&<p className="text-xs text-navy-400">Попыток в текущей серии: {r.attempts}{r.error_code==='telegram_429'?' · Telegram временно ограничил отправку':r.status==='failed'?' · Проверьте подключение и настройки':''}</p>}
 {r.next_attempt_at&&new Date(r.next_attempt_at)>new Date()&&<p className="text-xs text-amber-400">Повтор не ранее {new Date(r.next_attempt_at).toLocaleString('ru-RU',{timeZone:'Asia/Novosibirsk'})}</p>}
 {(r.status==='uncertain'||r.status==='failed'&&r.attempts>=3)&&r.notification_day===notificationDay()&&<button type="button" disabled={busy} className="btn-secondary min-h-11 mt-2" onClick={async()=>{if(r.status==='uncertain'&&!confirm('Проверьте Telegram. Повтор может создать второе сообщение, если первое уже доставлено. Отправить ещё раз?'))return;setBusy(true);const {error}=await db.rpc('retry_uncertain_notification',{p_id:r.id});setBusy(false);if(error)setError(error.message);else onRetry()}}>{r.status==='uncertain'?'Повторить после проверки Telegram':'Повторить отправку'}</button>}
 </div>)}
 </details></section>
}
