'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Калькулятор НДФЛ перенесён во вкладку "Калькулятор" раздела "Доходы и налоги".
// Оставляем редирект, чтобы старые ссылки/привычки не вели в никуда.
export default function NdflCalcRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/finance')
  }, [router])
  return null
}
