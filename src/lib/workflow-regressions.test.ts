import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Маленький синхронный рендерер для сценариев страниц без DOM и новой зависимости.
// Проверяем обработчики настоящих компонентов и их результат, не копируя формулы.
const runtime = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: [] as (() => unknown)[],
  client: null as any,
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const i = runtime.cursor++
    if (!runtime.slots[i] || !same(runtime.slots[i].deps, deps)) runtime.slots[i] = { deps, value: factory() }
    return runtime.slots[i].value
  }
  return {
    ...actual,
    useState: (initial: any) => {
      const i = runtime.cursor++
      if (!(i in runtime.slots)) runtime.slots[i] = typeof initial === 'function' ? initial() : initial
      return [runtime.slots[i], (value: any) => {
        runtime.slots[i] = typeof value === 'function' ? value(runtime.slots[i]) : value
      }]
    },
    useRef: (initial: any) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn: any, deps: unknown[]) => memo(() => fn, deps),
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const i = runtime.cursor++
      if (!runtime.slots[i] || !same(runtime.slots[i].deps, deps)) {
        runtime.slots[i]?.cleanup?.()
        runtime.slots[i] = { deps }
        runtime.effects.push(() => { runtime.slots[i].cleanup = effect() })
      }
    },
  }
})
vi.mock('@/lib/supabase', () => ({ createClient: () => runtime.client }))
vi.mock('@/lib/locked-entries', () => ({ useLockedEntries: () => ({ locked: new Map() }), lockedMessage: () => '' }))
vi.mock('@/lib/form-keys', () => ({ useEscapeKey: () => {}, submitOnCtrlEnter: () => {} }))
vi.mock('@/lib/draft', () => ({ useDraft: () => {}, loadDraft: () => null, clearDraft: () => {} }))
vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(runtime.info, { success: runtime.success, error: runtime.error }) }))

import TableView from '@/app/dashboard/journal/TableView'
import BackupPage from '@/app/dashboard/backup/page'
import FinancePage from '@/app/dashboard/finance/page'
import ReportsPage from '@/app/dashboard/reports/page'
import ReimbursementsPage from '@/app/dashboard/reimbursements/page'
import LoadError from '@/components/LoadError'

const entry = {
  id: 'entry-1', matter_id: 'matter-1', user_id: 'user-1', work_date: '2026-10-05',
  duration_min: 15, hourly_rate: 8824, amount: 2206, activity_type: 'consultation',
  description: 'Тестовая консультация', is_billable: true, notes: null,
  matters: { id: 'matter-1', title: 'Тестовое дело', clients: { name: 'ООО «Пример»' } },
  profiles: { full_name: 'Тестовый исполнитель' },
}
const fixture: Record<string, any[]> = {
  clients: [{ id: 'client-1', name: 'ООО «Пример»' }],
  matters: [{ id: 'matter-1', client_id: 'client-1', title: 'Тестовое дело', hourly_rate: 8824 }],
  profiles: [{ id: 'user-1', full_name: 'Тестовый исполнитель', hourly_rate: 8824 }],
  time_entries: [entry], report_view: [entry], tax_settings: [],
}
type Reply = { data: any; error: null | { message: string } }
let replies: (table: string) => Reply | Promise<Reply>
const updates: any[] = []
function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      let single = false
      const query: any = new Proxy({}, {
        get: (_, name) => {
          if (name === 'then') return (resolve: any, reject: any) => Promise.resolve(replies(table))
            .then(r => ({ ...r, data: single ? r.data?.[0] ?? null : r.data })).then(resolve, reject)
          if (name === 'single' || name === 'maybeSingle') return () => { single = true; return query }
          if (name === 'update') return (payload: unknown) => { updates.push({ table, payload }); return query }
          return () => query
        },
      })
      return query
    },
  }
}
function render(component: () => any) { runtime.cursor = 0; return component() }
async function effects() {
  for (const effect of runtime.effects.splice(0)) effect()
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!React.isValidElement(tree)) return []
  const element = tree as React.ReactElement<any>
  if (element.props.open === false) return []
  return [element, ...nodes(element.props.children)]
}
function text(tree: any): string {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (React.isValidElement(tree)) return (tree as React.ReactElement<any>).props.open === false
    ? '' : text((tree as React.ReactElement<any>).props.children)
  return typeof tree === 'object' ? '' : String(tree)
}
const button = (tree: any, name: string) => nodes(tree).find(n => n.type === 'button' && text(n).trim() === name)
const taxToggle = (tree: any) => nodes(tree).find(n => n.type === 'label' && text(n).includes('+НДФЛ 15%'))
  ?.props.children.find((n: any) => n?.type === 'input')

beforeEach(() => {
  runtime.slots = []; runtime.cursor = 0; runtime.effects = []
  vi.clearAllMocks(); updates.length = 0
  replies = table => ({ data: fixture[table] ?? [], error: null })
  runtime.client = makeClient()
  vi.stubGlobal('window', { scrollTo: vi.fn() })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
})

describe('журнал: итоговая ставка не получает надбавку повторно', () => {
  it('после включения НДФЛ и отмены существующая запись сохраняет прежнюю ставку', async () => {
    let tree = render(TableView); await effects(); tree = render(TableView)
    button(tree, 'Новая запись').props.onClick(); tree = render(TableView)
    taxToggle(tree).props.onChange({ target: { checked: true } }); tree = render(TableView)
    button(tree, 'Отмена').props.onClick(); tree = render(TableView)
    nodes(tree).find(n => n.type === 'tr' && n.props.onDoubleClick).props.onDoubleClick()
    tree = render(TableView)
    expect(taxToggle(tree).props.checked).toBe(false)
    await nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
    expect(updates[0].payload.hourly_rate).toBe(8824)
  })
  it('новая форма после отмены тоже открывается без надбавки', async () => {
    let tree = render(TableView); await effects(); tree = render(TableView)
    button(tree, 'Новая запись').props.onClick(); tree = render(TableView)
    taxToggle(tree).props.onChange({ target: { checked: true } }); tree = render(TableView)
    button(tree, 'Отмена').props.onClick(); tree = render(TableView)
    button(tree, 'Новая запись').props.onClick(); tree = render(TableView)
    expect(taxToggle(tree).props.checked).toBe(false)
  })
})

describe('ручная копия: успех только после выгрузки всех таблиц', () => {
  function downloadEnvironment() {
    const click = vi.fn(), blobs: Blob[] = []
    vi.stubGlobal('document', { body: { appendChild() {}, removeChild() {} }, createElement: () => ({ click }) })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { click, blobs }
  }
  it('ошибка одной таблицы не скачивает частичный JSON и не обновляет дату', async () => {
    const { click } = downloadEnvironment()
    replies = table => table === 'expenses' ? { data: null, error: { message: 'Нет связи' } } : { data: [], error: null }
    await button(render(BackupPage), 'Скачать резервную копию').props.onClick()
    const tree = render(BackupPage)
    expect(click).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(runtime.success).not.toHaveBeenCalled()
    expect(nodes(tree).some(n => n.props.role === 'alert')).toBe(true)
    expect(text(tree)).not.toContain('✓ Бэкап скачан')
    expect(button(tree, 'Скачать резервную копию').props.disabled).toBe(false)
  })
  it('исключение сети снимает ожидание и разрешает повтор', async () => {
    downloadEnvironment()
    replies = () => Promise.reject(new Error('Сеть недоступна'))
    await button(render(BackupPage), 'Скачать резервную копию').props.onClick()
    expect(button(render(BackupPage), 'Скачать резервную копию').props.disabled).toBe(false)
    expect(runtime.success).not.toHaveBeenCalled()
  })
  it('успешная копия содержит все 15 таблиц, даже если localStorage недоступен', async () => {
    const { click, blobs } = downloadEnvironment()
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Storage blocked') })
    await button(render(BackupPage), 'Скачать резервную копию').props.onClick()
    expect(click).toHaveBeenCalledOnce()
    expect(JSON.parse(await blobs[0].text()).meta.tables).toHaveLength(15)
    expect(text(render(BackupPage))).toContain('✓ Бэкап скачан')
    expect(runtime.success).toHaveBeenCalledOnce()
  })
})

describe('финансы: неполная загрузка не превращается в нулевые суммы', () => {
  it.each(['payments', 'expenses', 'reimbursable_expenses', 'tax_settings'])('отказ %s показывает ошибку', async table => {
    replies = t => t === table ? { data: null, error: { message: 'Ошибка запроса' } } : { data: fixture[t] ?? [], error: null }
    render(FinancePage); await effects()
    const tree = render(FinancePage)
    expect(nodes(tree).some(n => n.type === LoadError)).toBe(true)
    expect(text(tree)).not.toContain('Сводка для декларации')
  })
  it('отсутствие настроек года без ошибки остаётся обычным состоянием', async () => {
    render(FinancePage); await effects()
    const tree = render(FinancePage)
    expect(nodes(tree).some(n => n.type === LoadError)).toBe(false)
    expect(text(tree)).toContain('ещё не заведены')
  })
  it('повторная загрузка после сбоя восстанавливает экран', async () => {
    replies = () => ({ data: null, error: { message: 'Нет связи' } })
    render(FinancePage); await effects()
    const error = nodes(render(FinancePage)).find(n => n.type === LoadError)
    replies = t => ({ data: fixture[t] ?? [], error: null })
    await error.props.onRetry()
    expect(nodes(render(FinancePage)).some(n => n.type === LoadError)).toBe(false)
  })
  it('возмещаемые расходы при ошибке тоже показывают повтор загрузки', async () => {
    replies = () => ({ data: null, error: { message: 'Нет связи' } })
    render(ReimbursementsPage); await effects()
    expect(nodes(render(ReimbursementsPage)).some(n => n.type === LoadError)).toBe(true)
  })
})

describe('отчёты: фильтры и строки всегда одной выборки', () => {
  it('смена периода удаляет прежние строки и кнопки выгрузки', async () => {
    let tree = render(ReportsPage); await effects(); tree = render(ReportsPage)
    await button(tree, 'Сформировать').props.onClick(); tree = render(ReportsPage)
    expect(button(tree, 'PDF')).toBeDefined()
    button(tree, 'Прошлый месяц').props.onClick(); tree = render(ReportsPage)
    expect(button(tree, 'PDF')).toBeUndefined()
    expect(button(tree, 'Word')).toBeUndefined()
    expect(text(tree)).not.toContain(entry.description)
  })
  it('запоздавший ответ старого периода не возвращает его строки', async () => {
    let finish!: (r: Reply) => void
    const pending = new Promise<Reply>(resolve => { finish = resolve })
    replies = t => t === 'report_view' ? pending : { data: fixture[t] ?? [], error: null }
    let tree = render(ReportsPage); await effects(); tree = render(ReportsPage)
    const running = button(tree, 'Сформировать').props.onClick()
    button(render(ReportsPage), 'Прошлый месяц').props.onClick()
    finish({ data: [entry], error: null }); await running
    tree = render(ReportsPage)
    expect(button(tree, 'PDF')).toBeUndefined()
    expect(text(tree)).not.toContain(entry.description)
  })
  it('неудачное повторное формирование не оставляет старую выгрузку', async () => {
    let tree = render(ReportsPage); await effects(); tree = render(ReportsPage)
    await button(tree, 'Сформировать').props.onClick()
    replies = () => ({ data: null, error: { message: 'Нет связи' } })
    await button(render(ReportsPage), 'Сформировать').props.onClick()
    expect(button(render(ReportsPage), 'PDF')).toBeUndefined()
    expect(runtime.error).toHaveBeenCalled()
  })
})

it('денежные поля во всех формах разрешают ввод копеек', () => {
  const dir = path.resolve(__dirname, '../app')
  let checked = 0
  const bad: string[] = []
  function walk(folder: string) {
    for (const file of fs.readdirSync(folder)) {
      const full = path.join(folder, file)
      if (fs.statSync(full).isDirectory()) { walk(full); continue }
      if (!full.endsWith('.tsx')) continue
      const source = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'input') {
          const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source),
            a.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : undefined]))
          if (attrs.type === 'number' && attrs.inputMode === 'decimal') {
            checked++
            if (attrs.step !== '0.01' && attrs.step !== 'any') bad.push(path.relative(dir, full))
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  walk(dir)
  expect(checked).toBeGreaterThan(10)
  expect(bad).toEqual([])
})
