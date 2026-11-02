import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { buildNotification, NotifyEvent } from '@/lib/notify-text'
import { notificationParts,notificationDay,deliverTelegram } from '@/lib/notification-delivery'
import { readAllRows } from '@/lib/billing'

/**
 * Ежедневное напоминание о сроках и заседаниях в Телеграм.
 *
 * Запускается расписанием Vercel (vercel.json) раз в сутки, а также вручную
 * кнопкой «Проверить напоминание» в разделе «Сроки и заседания».
 *
 * Доступ: либо заголовок с CRON_SECRET (его подставляет сам Vercel при
 * запуске по расписанию), либо действующий вход пользователя. Без этого
 * адрес открыт всему интернету, и любой желающий мог бы слать сообщения
 * в чат адвоката.
 *
 * Читаем базу служебным ключом: у задания по расписанию нет входа, а
 * правила доступа (RLS) без входа не отдают ничего.
 *
 * Переменные окружения в Vercel:
 *   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID   — числовой идентификатор чата
 *   SUPABASE_SERVICE_ROLE_KEY — служебный ключ Supabase
 *   CRON_SECRET        — любая длинная случайная строка
 */

export const dynamic = 'force-dynamic'
export const maxDuration=60

async function authorized(req: NextRequest): Promise<boolean> {
  const header = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET

  if (secret && header === `Bearer ${secret}`) return true

  // Ручной запуск из приложения: проверяем, что это вошедший пользователь
  const token = header.replace(/^Bearer /, '')
  if (!token) return false
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false },global:{headers:{Authorization:header}} },
  )
  const { data, error } = await supabase.auth.getUser(token)
  if(error||!data.user)return false
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',data.user.id).single()
  return profile?.role==='advocate'
}

async function run(req:NextRequest){
 if(!(await authorized(req)))return NextResponse.json({status:'denied'},{status:401})
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID
 if(!serviceKey)return NextResponse.json({status:'not-configured',message:'Не настроен служебный доступ для напоминаний'})
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const check=async(status:string,error:string|null=null)=>{const {error:e}=await db.rpc('record_notification_check',{p_status:status,p_error:error});if(e)throw Error('delivery_log_unavailable')}
 try{
  if(!token||!chat){await check('failed','telegram_not_configured');return NextResponse.json({status:'not-configured',message:'Не настроен Telegram'})}
  await check('checked')
  const day=notificationDay(),today=new Date(day+'T12:00:00')
  const events=await readAllRows<NotifyEvent>(db,'court_events','id,title,event_date,event_time,kind,remind_days,done,matters(title,clients(name))',q=>q.eq('done',false))
  const text=buildNotification(events,today)
  if(!text){await check('nothing');return NextResponse.json({status:'nothing',message:'Напоминать не о чем'})}
  const parts=notificationParts(text)
  let jobs:any[]
  if(req.nextUrl.searchParams.get('retry')==='1'){
   jobs=(await readAllRows<any>(db,'notification_deliveries','*',q=>q.eq('notification_day',day))).filter(r=>r.part_no>0&&r.body===parts[r.part_no-1]&&['pending','failed','sending'].includes(r.status))
  }else{
   const {data,error}=await db.rpc('queue_notification',{p_day:day,p_parts:parts});if(error)throw Error('delivery_queue_unavailable');jobs=data||[]
  }
  const started=Date.now()
  for(const job of jobs){
   for(let attempt=0;attempt<3&&Date.now()-started<40000;attempt++){
    const {data:claim,error}=await db.rpc('claim_notification',{p_id:job.id});if(error)throw Error('delivery_claim_failed');if(!claim)break
    const result=await deliverTelegram(token,chat,claim.body)
    const {data:finished,error:finishError}=await db.rpc('finish_notification',{p_id:job.id,p_lease:claim.lease_id,p_status:result.status,p_message_id:result.messageId??null,p_error:result.code??null,p_retry_after:result.retryAfter??0})
    if(finishError||!finished)throw Error('delivery_result_not_saved')
    if(result.status!=='failed'||result.retryAfter===undefined||result.retryAfter>4)break
    await new Promise(r=>setTimeout(r,result.retryAfter!*1000))
   }
  }
  const ids=jobs.map(j=>j.id)
  const latest=ids.length?await readAllRows<any>(db,'notification_deliveries','id,status',q=>q.in('id',ids)):[]
  const failed=latest.filter(j=>j.status!=='sent').length
  return NextResponse.json({status:failed?'partial':jobs.length?'sent':'nothing',message:failed?'Не все части подтверждены. Смотрите состояние отправки ниже.':jobs.length?'Уведомление доставлено или уже было отправлено сегодня':'Нет подходящих уведомлений для повтора',parts:latest.length,unconfirmed:failed})
 }catch{
  try{await check('failed','notification_processing_failed')}catch{}
  return NextResponse.json({status:'error',message:'Не удалось завершить отправку. Проверьте состояние уведомлений; повтор не отправит подтверждённые части заново.'},{status:500})
 }
}

/** Запуск по расписанию Vercel */
export async function GET(req: NextRequest) { return run(req) }

/** Ручная проверка из приложения */
export async function POST(req: NextRequest) { return run(req) }
