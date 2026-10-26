/**
 * Раскладка записей на шкале дня: записи, идущие в одно время, ставятся РЯДОМ,
 * а не друг на друга.
 *
 * Записи объединяются в «кучки» по цепочке пересечений (A пересекает B, B пересекает C —
 * все три в одной кучке). Внутри кучки каждая запись берёт первую свободную колонку,
 * ширина колонки — 1 / число колонок кучки. Запись, не пересекающаяся ни с кем,
 * остаётся на всю ширину.
 *
 * Время — минуты от полуночи.
 */

/**
 * Видимая высота записи не меньше 28 px (≈ 27 минут при 64 px на час). Короткие записи
 * считаются занимающими это место, иначе два коротких блока визуально лезли бы друг на друга.
 */
export const MIN_VISUAL_MIN = 27

export interface TimelineItem { id: string; start: number; dur: number }
export interface ColumnSlot { col: number; cols: number }

export function layoutColumns(items: TimelineItem[]): Map<string, ColumnSlot> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.dur - a.dur)
  const out = new Map<string, ColumnSlot>()
  let cluster: { id: string; col: number }[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    for (const c of cluster) out.set(c.id, { col: c.col, cols: colEnds.length })
    cluster = []
    colEnds = []
    clusterEnd = -Infinity
  }

  for (const it of sorted) {
    if (it.start >= clusterEnd) flush()
    const end = it.start + Math.max(it.dur, MIN_VISUAL_MIN)
    let col = colEnds.findIndex(e => e <= it.start)
    if (col === -1) { col = colEnds.length; colEnds.push(end) } else colEnds[col] = end
    cluster.push({ id: it.id, col })
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return out
}
