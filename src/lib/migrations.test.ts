import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Страж миграций: представления базы не должны отдавать данные без входа.
 *
 * Почему это проверяется тестом. Представление в PostgreSQL по умолчанию
 * читает таблицы с правами своего владельца и обходит правила доступа (RLS).
 * 04.10.2026 обнаружилось, что так три представления (report_view,
 * finance_income_view, finance_expense_view) отдавали журнал, платежи и
 * расходы любому, у кого есть открытый ключ, — а он виден в коде сайта.
 * Исправлено миграцией 018 (`security_invoker = true`).
 *
 * Хитрость, ради которой нужен тест: `create or replace view` СБРАСЫВАЕТ
 * параметры представления. Миграция 011 уже один раз переопределяла
 * report_view; следующая такая правка без `with (security_invoker = true)`
 * молча откроет дыру снова, и заметно это не будет — приложение работает
 * как обычно, ведь вы вошли.
 *
 * Тест проходит миграции по порядку номеров и следит за итоговым состоянием
 * каждого представления: оно должно быть защищено.
 */

const dir = path.resolve(__dirname, '../../supabase/migrations')

/** SQL без комментариев и в нижнем регистре */
const clean = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').toLowerCase()

const isInvoker = (opts: string) => /security_invoker\s*=\s*(true|on|1)\b/.test(opts)

/** Итоговое состояние: имя представления → защищено ли оно после всех миграций */
function finalViewState(files: { name: string; sql: string }[]) {
  const state = new Map<string, { secured: boolean; lastTouchedBy: string }>()
  for (const f of files) {
    const sql = clean(f.sql)
    // Порядок внутри файла важен (create, потом alter), поэтому собираем события
    // по позиции в тексте
    const events: { at: number; run: () => void }[] = []

    const create = /create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?view\s+(?:public\.)?"?(\w+)"?\s*(?:\([^)]*\)\s*)?(?:with\s*\(([^)]*)\)\s*)?as\b/g
    for (const m of sql.matchAll(create)) {
      events.push({ at: m.index!, run: () => state.set(m[1], { secured: isInvoker(m[2] ?? ''), lastTouchedBy: f.name }) })
    }
    const alter = /alter\s+view\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+set\s*\(([^)]*)\)/g
    for (const m of sql.matchAll(alter)) {
      events.push({ at: m.index!, run: () => {
        const cur = state.get(m[1])
        if (cur && isInvoker(m[2])) state.set(m[1], { secured: true, lastTouchedBy: f.name })
        // reset (security_invoker) или false — снова открыто
        else if (cur && /security_invoker\s*=\s*(false|off|0)\b/.test(m[2])) state.set(m[1], { secured: false, lastTouchedBy: f.name })
      } })
    }
    const drop = /drop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/g
    for (const m of sql.matchAll(drop)) events.push({ at: m.index!, run: () => state.delete(m[1]) })

    events.sort((a, b) => a.at - b.at).forEach(e => e.run())
  }
  return state
}

const load = () =>
  readdirSync(dir).filter(n => /^\d+_.*\.sql$/.test(n)).sort()
    .map(name => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }))

describe('миграции: представления закрыты от посторонних', () => {
  it('каждое представление в итоге работает с правами читающего (security_invoker)', () => {
    const state = finalViewState(load())
    expect(state.size).toBeGreaterThan(0) // разбор не промахнулся мимо всех
    const open = [...state].filter(([, v]) => !v.secured).map(([n, v]) => `${n} (последний раз тронуто в ${v.lastTouchedBy})`)
    expect(open, `Открыты без входа: ${open.join('; ')}. Добавьте ` +
      '`alter view <имя> set (security_invoker = true);` или `with (security_invoker = true)` ' +
      'в create view — иначе журнал, платежи и расходы читаются по открытому ключу.').toEqual([])
  })

  it('знает все три прежних представления', () => {
    const names = [...finalViewState(load()).keys()].sort()
    expect(names).toEqual(['finance_expense_view', 'finance_income_view', 'report_view'])
  })

  it('ловит именно ту ошибку: переопределение без параметра открывает представление', () => {
    const state = finalViewState([
      { name: '001.sql', sql: 'create view v as select 1;\nalter view v set (security_invoker = true);' },
      { name: '002.sql', sql: 'create or replace view v as select 2;' },
    ])
    expect(state.get('v')?.secured).toBe(false)
  })

  it('create с параметром сразу защищён, alter возвращает защиту', () => {
    expect(finalViewState([{ name: 'a.sql', sql: 'create view v with (security_invoker = true) as select 1;' }]).get('v')?.secured).toBe(true)
    expect(finalViewState([
      { name: 'a.sql', sql: 'create view v as select 1;' },
      { name: 'b.sql', sql: '-- комментарий\nalter view public.v set (security_invoker = true);' },
    ]).get('v')?.secured).toBe(true)
  })

  it('закомментированный alter не считается', () => {
    const state = finalViewState([{ name: 'a.sql', sql: 'create view v as select 1;\n-- alter view v set (security_invoker = true);' }])
    expect(state.get('v')?.secured).toBe(false)
  })
})
