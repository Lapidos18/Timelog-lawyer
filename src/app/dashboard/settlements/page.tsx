'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// «Акты взаимных расчётов» объединены с «Платежами» в раздел «Платежи и акты
// сверки» (вид «Акты сверки»). Оставляем редирект, чтобы закладки не вели в никуда.
export default function SettlementsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/reconciliation?view=acts')
  }, [router])
  return null
}
