import { createBrowserClient } from '@supabase/ssr'

/**
 * Клиент Supabase для браузера — один на всё приложение.
 *
 * Раньше каждый вызов создавал новый объект. Компоненты держат его в
 * переменной уровня рендера (`const supabase = createClient()`), поэтому
 * ссылка менялась при каждой перерисовке, и линтер справедливо ругался на
 * useEffect: добавь `supabase` в зависимости — и эффект пойдёт по кругу,
 * не добавляй — правило нарушено. Общий экземпляр снимает выбор: ссылка
 * стабильна, зависимости честные, лишних перезапросов нет.
 */
let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
