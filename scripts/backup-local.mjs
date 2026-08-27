#!/usr/bin/env node
/**
 * Локальная резервная копия базы Timelog.
 *
 * Выгружает все таблицы в JSON-файл на этом компьютере. Формат совпадает
 * с тем, что скачивает раздел «Резервная копия» в самом приложении, —
 * файлы взаимозаменяемы.
 *
 * Запуск вручную:   npm run backup
 * По расписанию:    Планировщик заданий Windows (см. README-backup.md)
 *
 * Данные никуда не отправляются: только с сервера Supabase на ваш диск.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Куда складывать копии. Намеренно ЗА пределами папки проекта, чтобы данные
// доверителей физически не могли попасть в git-репозиторий.
const BACKUP_DIR = process.env.TIMELOG_BACKUP_DIR
  || resolve(projectRoot, '..', 'Timelog-backups')

// Сколько последних копий хранить; более старые удаляются автоматически
const KEEP_LAST = Number(process.env.TIMELOG_BACKUP_KEEP || 30)

// Тот же список, что в разделе «Резервная копия» приложения
const TABLES = [
  'orgs',
  'clients',
  'matters',
  'time_entries',
  'payments',
  'acts',
  'profiles',
  'expenses',
  'tax_settings',
  'tax_payments',
  'manual_income',
  'reimbursable_expenses',
]

// У tax_settings нет столбца created_at — первичный ключ там год
const ORDER_COLUMN = { tax_settings: 'year' }

/** Разбор .env.local без внешних зависимостей */
function loadEnvLocal() {
  const file = join(projectRoot, '.env.local')
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function fail(message) {
  console.error('\n[ОШИБКА] ' + message + '\n')
  process.exit(1)
}

async function main() {
  const env = { ...loadEnvLocal(), ...process.env }

  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) fail('В .env.local не найден NEXT_PUBLIC_SUPABASE_URL.')
  if (!key) {
    fail(
      'В .env.local не найден SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Это ключ, который позволяет читать базу без входа по паролю —\n' +
      'без него автоматическая выгрузка невозможна.\n\n' +
      'Где взять: панель Supabase → Project Settings → API Keys → service_role.\n' +
      'Добавьте в файл .env.local строкой:\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=<ключ>\n\n' +
      'Файл .env.local уже в .gitignore и в репозиторий не попадёт.'
    )
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const data = {}
  const results = []
  let hadError = false

  for (const table of TABLES) {
    const { data: rows, error } = await supabase
      .from(table)
      .select('*')
      .order(ORDER_COLUMN[table] ?? 'created_at')

    if (error) {
      hadError = true
      results.push({ table, count: 0, status: 'error', message: error.message })
      console.error(`  ✗ ${table}: ${error.message}`)
    } else {
      data[table] = rows ?? []
      results.push({ table, count: (rows ?? []).length, status: 'ok' })
      console.log(`  ✓ ${table}: ${(rows ?? []).length} записей`)
    }
  }

  // Пустую или частичную выгрузку не сохраняем — иначе битая копия
  // вытеснит из ротации хорошую
  if (hadError) {
    fail('Часть таблиц не выгрузилась, файл не сохранён. Прежние копии не тронуты.')
  }

  mkdirSync(BACKUP_DIR, { recursive: true })

  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `_${pad(now.getHours())}-${pad(now.getMinutes())}`

  const payload = {
    meta: {
      backup_date: now.toISOString(),
      backup_version: '1.0',
      source: 'scheduled-local',
      tables: Object.keys(data),
      total_records: Object.values(data).reduce((s, a) => s + a.length, 0),
    },
    data,
  }

  const file = join(BACKUP_DIR, `timelog_backup_${stamp}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')

  const sizeKb = Math.round(statSync(file).size / 1024)
  console.log(`\nСохранено: ${file} (${payload.meta.total_records} записей, ${sizeKb} КБ)`)

  // Ротация: оставляем только KEEP_LAST последних копий
  const old = readdirSync(BACKUP_DIR)
    .filter(f => /^timelog_backup_.*\.json$/.test(f))
    .sort()
    .slice(0, -KEEP_LAST)

  for (const f of old) {
    unlinkSync(join(BACKUP_DIR, f))
    console.log(`Удалена старая копия: ${f}`)
  }
}

main().catch(e => fail(String(e?.message ?? e)))
