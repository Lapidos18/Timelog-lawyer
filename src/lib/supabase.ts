import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export function createClient() {
  return createClientComponentClient()
}

export function createServerClient() {
  return createServerComponentClient({ cookies })
}
