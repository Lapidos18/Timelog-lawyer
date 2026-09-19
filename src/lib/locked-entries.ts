'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

/**
 * Записи времени, вошедшие в подписанный или оплаченный акт.
 *
 * Сам запрет стоит в базе (триггер из миграции 015) и срабатывает всегда.
 * Этот хук нужен для удобства: без него форма правки открывалась бы,
 * вы бы всё исправили — и только при сохранении узнали, что нельзя,
 * потеряв набранное. С ним запись сразу помечена замком, а попытка
 * открыть её говорит, в каком она акте.
 *
 * Пока миграция 015 не выполнена, колонки rows нет — возвращаем пустой
 * набор, и всё работает как раньше.
 */
export function useLockedEntries() {
  const [locked, setLocked] = useState<Map<string, string>>(new Map())

  const reload = useCallback(async () => {
    const { data, error } = await createClient()
      .from('acts')
      .select('act_no, rows')
      .in('status', ['signed', 'paid'])
    if (error || !data) { setLocked(new Map()); return }
    const map = new Map<string, string>()
    for (const act of data as { act_no: string; rows: { id: string }[] | null }[]) {
      for (const r of act.rows ?? []) map.set(String(r.id), act.act_no)
    }
    setLocked(map)
  }, [])

  useEffect(() => { reload() }, [reload])

  return { locked, reload }
}

/** Текст для пользователя — один на все три экрана, где правятся записи */
export function lockedMessage(actNo: string) {
  return `Запись входит в акт ${actNo}, он подписан или оплачен. Чтобы её изменить, переведите акт в «Черновик».`
}
