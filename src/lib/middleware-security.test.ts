import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

const state = vi.hoisted(() => ({ claims: vi.fn() }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: state.claims } }),
}))

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
const request = (path = '/dashboard', cookie = true) => new NextRequest('https://qa.invalid' + path, {
  headers: cookie ? { cookie: 'sb-qa-auth-token=synthetic', 'x-nonce': 'untrusted' } : {},
})

describe('server authentication boundary', () => {
  it('blocks absent sessions and invalid credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
    expect((await middleware(request('/dashboard', false))).status).toBe(307)
    state.claims.mockResolvedValue({ data: null, error: { name: 'AuthSessionMissingError' } })
    expect((await middleware(request())).status).toBe(307)
    state.claims.mockResolvedValue({ data: null, error: { name: 'AuthApiError', status: 401 } })
    expect((await middleware(request())).status).toBe(307)
  })
  it('returns a retryable failure when authentication cannot be verified', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
    state.claims.mockResolvedValue({ data: null, error: { name: 'AuthRetryableFetchError', status: 503 } })
    const response = await middleware(request())
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    state.claims.mockRejectedValue(new Error('network'))
    expect((await middleware(request())).status).toBe(503)
  })
  it('admits verified claims and replaces caller-provided nonces', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
    state.claims.mockResolvedValue({ data: { claims: { sub: 'verified-user' } }, error: null })
    const first = await middleware(request())
    const second = await middleware(request())
    expect(first.status).toBe(200)
    expect(first.headers.get('content-security-policy')).not.toContain('nonce-untrusted')
    expect(first.headers.get('content-security-policy')).not.toBe(second.headers.get('content-security-policy'))
    const nonce = first.headers.get('x-middleware-request-x-nonce')
    expect(nonce).toBeTruthy()
    expect(first.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`)
  })
})
