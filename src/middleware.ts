import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy, sessionCookieOptions } from '@/lib/security-policy'

export async function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const policy = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NODE_ENV === 'development')
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', policy)

  const secureResponse = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', policy)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  const next = () => NextResponse.next({ request: { headers } })
  const login = () => {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return secureResponse(NextResponse.redirect(url))
  }
  const unavailable = () => secureResponse(new NextResponse(
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Проверка входа</title><body><h1>Не удалось проверить вход</h1>' +
    '<p>Соединение временно недоступно. Повторите попытку через минуту.</p>' +
    '<a href="">Повторить проверку</a></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60' } },
  ))

  if (!req.nextUrl.pathname.startsWith('/dashboard')) return secureResponse(next())
  const hasSession = req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (!hasSession) return login()

  try {
    let response = next()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: sessionCookieOptions(),
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookies: { name: string; value: string; options?: CookieOptions }[]) => {
            cookies.forEach(({ name, value }) => req.cookies.set(name, value))
            headers.set('cookie', req.headers.get('cookie') ?? '')
            response = next()
            cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          },
        },
      },
    )
    const { data, error } = await supabase.auth.getClaims()
    if (error) {
      if (['AuthInvalidJwtError', 'AuthSessionMissingError'].includes(error.name)
        || [400, 401, 403].includes(error.status ?? 0)) return login()
      return unavailable()
    }
    if (!data?.claims?.sub) return login()
    return secureResponse(response)
  } catch {
    return unavailable()
  }
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest).*)'],
}
