import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Серверная проверка входа для /dashboard/*.
 *
 * Раньше matcher был пустым, и защита держалась только на проверке в браузере:
 * посторонний, открывший адрес напрямую, успевал увидеть каркас приложения,
 * прежде чем его перебрасывало на вход. Данные при этом не утекали (их закрывают
 * права доступа в самой базе), но рубеж был один вместо двух.
 *
 * ВАЖНО — принцип «не заблокировать своего»: если проверку выполнить не удалось
 * (база недоступна, сбой сети), запрос ПРОПУСКАЕТСЯ. Иначе временная недоступность
 * Supabase выкидывала бы адвоката из рабочего приложения на страницу входа,
 * где он всё равно не смог бы войти. Данные в этом случае по-прежнему защищены
 * правами доступа в базе.
 */
export async function middleware(req: NextRequest) {
  try {
    // Есть ли вообще кука сессии. Если нет — это точно неавторизованный запрос,
    // и обращаться к Supabase не нужно.
    const hasSessionCookie = req.cookies
      .getAll()
      .some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))

    if (!hasSessionCookie) {
      return redirectToLogin(req)
    }

    let response = NextResponse.next({ request: req })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) => {
            cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
            response = NextResponse.next({ request: req })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options))
          },
        },
      }
    )

    const { data, error } = await supabase.auth.getUser()

    // error здесь — это в том числе «не смогли достучаться до Supabase»,
    // поэтому на ошибке пропускаем, а разбирается уже клиентская проверка
    if (!error && !data.user) {
      return redirectToLogin(req)
    }

    return response
  } catch {
    // Любая непредвиденная ошибка не должна закрывать доступ к приложению
    return NextResponse.next()
  }
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
