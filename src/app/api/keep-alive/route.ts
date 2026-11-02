import { createClient } from '@supabase/supabase-js'
import { GET as retryNotifications } from '../notify/route'
import { NextRequest,NextResponse } from 'next/server'

export const maxDuration=60
export async function GET(req:NextRequest) {
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

    if(process.env.CRON_SECRET&&req.headers.get('authorization')==='Bearer '+process.env.CRON_SECRET){
      const retry=await retryNotifications(new NextRequest(new URL('/api/notify?retry=1',req.url),{headers:req.headers}))
      if(retry.status>=400)return NextResponse.json({status:'notification-retry-failed'},{status:500})
    }
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ status: 'error', message: String(e) }, { status: 500 })
  }
}
