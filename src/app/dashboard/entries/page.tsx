'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Раздел "Записи" объединён с "Журналом" (вкладка "Таблица").
// Оставляем редирект, чтобы старые ссылки/привычки не вели в никуда.
export default function EntriesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/journal')
  }, [router])
  return null
}
