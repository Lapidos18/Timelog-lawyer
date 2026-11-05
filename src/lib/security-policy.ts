/** A fresh nonce is shared by the response policy and Next.js rendering. */
export function contentSecurityPolicy(nonce: string, supabaseUrl: string, development = false) {
  const origin = new URL(supabaseUrl).origin
  const websocket = origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${origin} ${websocket}${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(!development ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function sessionCookieOptions() {
  return { sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' }
}
