'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Search, CornerDownLeft, Briefcase, Users, LayoutDashboard } from 'lucide-react'

/**
 * Быстрый переход по Ctrl+K (⌘K на Mac).
 *
 * Открывается поверх любой страницы, ищет сразу по трём наборам: разделы,
 * доверители и дела. Доверители и дела грузятся один раз при первом открытии
 * и держатся в памяти — список кабинета небольшой, второй запрос не нужен.
 *
 * Выбор доверителя ведёт в акт сверки по нему, выбор дела — в Дела:
 * это те экраны, ради которых их обычно и ищут.
 */

type Item = {
  id: string
  label: string
  hint?: string
  group: 'Разделы' | 'Доверители' | 'Дела'
  href: string
}

const SECTIONS: Item[] = [
  { id: 's-dash',   label: 'Обзор',                 group: 'Разделы', href: '/dashboard' },
  { id: 's-jour',   label: 'Журнал',                group: 'Разделы', href: '/dashboard/journal' },
  { id: 's-matt',   label: 'Дела',                  group: 'Разделы', href: '/dashboard/matters' },
  { id: 's-cli',    label: 'Доверители',            group: 'Разделы', href: '/dashboard/clients' },
  { id: 's-rep',    label: 'Отчёты',                group: 'Разделы', href: '/dashboard/reports' },
  { id: 's-acts',   label: 'Акты',                  group: 'Разделы', href: '/dashboard/acts' },
  { id: 's-reimb',  label: 'Возмещаемые расходы',   group: 'Разделы', href: '/dashboard/reimbursements' },
  { id: 's-recon',  label: 'Платежи / Акт сверки',  group: 'Разделы', href: '/dashboard/reconciliation' },
  { id: 's-fin',    label: 'Доходы и налоги',       group: 'Разделы', href: '/dashboard/finance' },
  { id: 's-back',   label: 'Резервная копия',       group: 'Разделы', href: '/dashboard/backup' },
]

/**
 * Поиск без учёта регистра и раскладки по «ё»: адвокат ищет «отчет», а раздел
 * называется «Отчёты» — без этой замены запрос не находил бы ничего.
 */
function normalize(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

export default function CommandPalette() {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [data, setData] = useState<Item[]>([])
  const [loaded, setLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Ctrl+K / ⌘K открывает, Esc закрывает
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    // На телефоне сочетания клавиш нет, поэтому палитру открывает ещё и
    // кнопка в меню — она шлёт это событие
    function onOpen() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('timelog:open-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('timelog:open-palette', onOpen)
    }
  }, [])

  // Доверителей и дела грузим при первом открытии, а не при загрузке страницы:
  // палитрой пользуются не в каждый заход, а два лишних запроса тормозили бы старт
  useEffect(() => {
    if (!open || loaded) return
    setLoaded(true)
    Promise.all([
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('matters').select('id, title, clients(name)').order('title'),
    ]).then(([c, m]) => {
      const clientItems: Item[] = (c.data ?? []).map(x => ({
        id: 'c-' + x.id,
        label: x.name,
        hint: 'акт сверки',
        group: 'Доверители',
        href: '/dashboard/reconciliation',
      }))
      const matterItems: Item[] = (m.data ?? []).map((x: any) => ({
        id: 'm-' + x.id,
        label: x.title,
        hint: x.clients?.name,
        group: 'Дела',
        href: '/dashboard/matters',
      }))
      setData([...clientItems, ...matterItems])
    })
  }, [open, loaded])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Поле появляется вместе с окном — фокус ставим после отрисовки
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const results = useMemo(() => {
    const all = [...SECTIONS, ...data]
    const q = normalize(query)
    if (!q) return all.slice(0, 12)
    return all
      .filter(i => normalize(i.label).includes(q) || normalize(i.hint ?? '').includes(q))
      .slice(0, 12)
  }, [query, data])

  useEffect(() => { setCursor(0) }, [query])

  function go(item: Item) {
    setOpen(false)
    router.push(item.href)
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor]) }
  }

  // Выбранная строка не должна уезжать за край при движении стрелками
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const GROUP_ICON = {
    'Разделы': LayoutDashboard,
    'Доверители': Users,
    'Дела': Briefcase,
  } as const

  let lastGroup = ''

  return (
    // На телефоне окно поднято выше: с открытой клавиатурой при отступе в 12vh
    // список результатов уезжал под неё почти целиком
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] md:pt-[12vh] safe-x"
      onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-xl bg-navy-900 border border-navy-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-3 px-4 border-b border-navy-800">
          <Search className="w-4 h-4 text-navy-400 flex-shrink-0" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Раздел, доверитель или дело…"
            className="no-zoom flex-1 bg-transparent py-3.5 text-sm text-navy-100 placeholder-navy-500 focus:outline-none" />
          <kbd className="text-[10px] text-navy-400 border border-navy-700 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[45vh] md:max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="text-sm text-navy-400 text-center py-8">Ничего не найдено</p>
          ) : results.map((item, i) => {
            const showGroup = item.group !== lastGroup
            lastGroup = item.group
            const Icon = GROUP_ICON[item.group]
            return (
              <div key={item.id}>
                {showGroup && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-navy-400 uppercase tracking-wider">
                    {item.group}
                  </div>
                )}
                <button
                  data-active={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(item)}
                  className={`tap w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === cursor ? 'bg-navy-800' : 'hover:bg-navy-800/50'
                  }`}>
                  <Icon className="w-4 h-4 text-navy-400 flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-navy-100 truncate">{item.label}</span>
                    {item.hint && <span className="block text-xs text-navy-400 truncate">{item.hint}</span>}
                  </span>
                  {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 text-navy-400 flex-shrink-0" />}
                </button>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-2 border-t border-navy-800 flex items-center gap-4 text-[11px] text-navy-400">
          <span>↑↓ выбрать</span>
          <span>Enter перейти</span>
        </div>
      </div>
    </div>
  )
}
