import { describe, it, expect } from 'vitest'
import { layoutColumns } from './timeline-layout'

const at = (h: number, m = 0) => h * 60 + m

describe('раскладка записей на шкале дня', () => {
  it('одиночная запись — на всю ширину', () => {
    const r = layoutColumns([{ id: 'a', start: at(10), dur: 60 }])
    expect(r.get('a')).toEqual({ col: 0, cols: 1 })
  })

  it('записи подряд, не пересекаясь, остаются каждая на всю ширину', () => {
    const r = layoutColumns([
      { id: 'a', start: at(10), dur: 60 },
      { id: 'b', start: at(11), dur: 60 }, // начинается ровно в конце первой
    ])
    expect(r.get('a')).toEqual({ col: 0, cols: 1 })
    expect(r.get('b')).toEqual({ col: 0, cols: 1 })
  })

  it('две записи в одно время встают рядом', () => {
    const r = layoutColumns([
      { id: 'a', start: at(10), dur: 60 },
      { id: 'b', start: at(10, 30), dur: 60 },
    ])
    expect(r.get('a')).toEqual({ col: 0, cols: 2 })
    expect(r.get('b')).toEqual({ col: 1, cols: 2 })
  })

  it('цепочка пересечений: A–B и B–C, но A и C не пересекаются — C занимает освободившуюся колонку, ширина общая на всю кучку', () => {
    const r = layoutColumns([
      { id: 'a', start: at(9), dur: 90 },        // 9:00–10:30
      { id: 'b', start: at(10), dur: 120 },      // 10:00–12:00
      { id: 'c', start: at(11), dur: 60 },       // 11:00–12:00, с A не пересекается
    ])
    expect(r.get('a')).toEqual({ col: 0, cols: 2 })
    expect(r.get('b')).toEqual({ col: 1, cols: 2 })
    expect(r.get('c')).toEqual({ col: 0, cols: 2 })
  })

  it('три записи одновременно — три колонки', () => {
    const r = layoutColumns([
      { id: 'a', start: at(10), dur: 60 },
      { id: 'b', start: at(10), dur: 60 },
      { id: 'c', start: at(10, 15), dur: 30 },
    ])
    expect(new Set([r.get('a')!.col, r.get('b')!.col, r.get('c')!.col]).size).toBe(3)
    expect(r.get('c')!.cols).toBe(3)
  })

  it('кучки не влияют друг на друга: после пары рядом следующая запись снова на всю ширину', () => {
    const r = layoutColumns([
      { id: 'a', start: at(9), dur: 60 },
      { id: 'b', start: at(9), dur: 60 },
      { id: 'z', start: at(14), dur: 60 },
    ])
    expect(r.get('z')).toEqual({ col: 0, cols: 1 })
    expect(r.get('a')!.cols).toBe(2)
  })

  it('очень короткие записи занимают минимум видимой высоты: 10-минутная и следующая через 15 минут — рядом', () => {
    const r = layoutColumns([
      { id: 'a', start: at(10), dur: 10 },
      { id: 'b', start: at(10, 15), dur: 30 },
    ])
    expect(r.get('a')!.cols).toBe(2)
    expect(r.get('b')!.col).toBe(1)
  })

  it('порядок на входе не важен', () => {
    const items = [
      { id: 'b', start: at(10, 30), dur: 60 },
      { id: 'a', start: at(10), dur: 60 },
    ]
    const r = layoutColumns(items)
    expect(r.get('a')!.col).toBe(0)
    expect(r.get('b')!.col).toBe(1)
  })
})
