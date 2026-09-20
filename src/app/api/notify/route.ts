import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { buildNotification, NotifyEvent } from '@/lib/notify-text'
import { toISO } from '@/lib/deadlines'

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
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) return { ok: false, error: 'Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID' }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Без parse_mode: в названиях дел встречаются кавычки и «<», на которых
    // разметка ломается, и сообщение не доходит вовсе
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `Телеграм ответил ${res.status}: ${body.slice(0, 200)}` }
  }
  return { ok: true }
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ status: 'denied' }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json(
      { status: 'not-configured', message: 'В Vercel не задан SUPABASE_SERVICE_ROLE_KEY' },
      { status: 200 },
    )
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Полгода вперёд с запасом; что из этого пора показывать, решает
  // remind_days каждого события внутри buildNotification
  const horizon = toISO(new Date(Date.now() + 180 * 86_400_000))
  const { data, error } = await supabase
    .from('court_events')
    .select('title, event_date, event_time, kind, remind_days, done, matters(title, clients(name))')
    .eq('done', false)
    .lte('event_date', horizon)
    .order('event_date')

  if (error) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 })
  }

  const text = buildNotification((data ?? []) as unknown as NotifyEvent[])
  if (!text) {
    return NextResponse.json({ status: 'nothing', message: 'Напоминать не о чем' })
  }

  const sent = await sendTelegram(text)
  if (!sent.ok) {
    return NextResponse.json({ status: 'error', message: sent.error }, { status: 500 })
  }
  return NextResponse.json({ status: 'sent', preview: text })
}

/** Запуск по расписанию Vercel */
export async function GET(req: NextRequest) { return run(req) }

/** Ручная проверка из приложения */
export async function POST(req: NextRequest) { return run(req) }
