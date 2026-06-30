import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    // Lightweight read query - just touches the database to reset Supabase's inactivity timer
    const { error } = await supabase.from('profiles').select('id').limit(1)

    if (error) {
      return NextResponse.json({ status: 'error', message: error.message }, { status: 500 })
    }

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ status: 'error', message: String(e) }, { status: 500 })
  }
}
