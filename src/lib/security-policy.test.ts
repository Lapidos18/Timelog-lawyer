import { describe, it, expect, vi } from 'vitest'
import { contentSecurityPolicy, sessionCookieOptions } from './security-policy'

describe('production session and CSP settings', () => {
  it('requires HTTPS cookies while keeping local development usable', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(sessionCookieOptions()).toEqual({ sameSite: 'lax', secure: true })
    vi.stubEnv('NODE_ENV', 'development')
    expect(sessionCookieOptions().secure).toBe(false)
    vi.unstubAllEnvs()
  })
  it('limits connections and uses the per-request script nonce', () => {
    const policy = contentSecurityPolicy('request-nonce', 'https://project.supabase.co')
    expect(policy).toContain("script-src 'self' 'nonce-request-nonce' 'strict-dynamic';")
    expect(policy).toContain("connect-src 'self' https://project.supabase.co wss://project.supabase.co;")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).toContain("object-src 'none'")
  })
})
