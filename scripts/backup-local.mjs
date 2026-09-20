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

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Куда складывать копии. Намеренно ЗА пределами папки проекта, чтобы данные
// доверителей физически не могли попасть в git-репозиторий.
const BACKUP_DIR = process.env.TIMELOG_BACKUP_DIR
  || resolve(projectRoot, '..', 'Timelog-backups')

// Сколько последних копий хранить; более старые удаляются автоматически
const KEEP_LAST = Number(process.env.TIMELOG_BACKUP_KEEP || 30)

/**
 * Вторая папка для копии — облако или внешний диск.
 *
 * Копии на том же компьютере спасают от ошибки в данных, но не от пропажи
 * самого компьютера. Поэтому после сохранения файл копируется ещё раз.
 *
 * Папку не нужно настраивать: если стоит «Google Диск для компьютера», он
 * подключает диск с папкой «Мой диск» (в английской версии — «My Drive»),
 * и мы её находим сами. Путь можно задать и вручную через
 * TIMELOG_BACKUP_MIRROR (несколько папок — через точку с запятой),
 * например внешний диск F:.
 */
function findMirrorDirs(env) {
  const manual = (env.TIMELOG_BACKUP_MIRROR || '').trim()
  const dirs = manual.split(';').map(s => s.trim()).filter(Boolean)

  const candidates = []
  // Google Диск монтируется отдельным диском: G:\Мой диск, H:\My Drive и т.п.
  for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    candidates.push(`${letter}:\\Мой диск`, `${letter}:\\My Drive`)
  }
  // Режим «зеркала» кладёт папку в профиль пользователя
  candidates.push(join(homedir(), 'Google Drive'), join(homedir(), 'Мой диск'))

  for (const p of candidates) {
    if (existsSync(p)) dirs.push(join(p, 'Timelog-backups'))
  }

  // Указанная вручную папка не отменяет найденную автоматически: внешний
  // диск и Google Диск — это две разные страховки, а не замена друг другу
  return Array.from(new Set(dirs))
}

/** Оставить в папке только KEEP_LAST последних копий */
function rotate(dir) {
  const old = readdirSync(dir)
    .filter(f => /^timelog_backup_.*\.json$/.test(f))
    .sort()
    .slice(0, -KEEP_LAST)
  for (const f of old) unlinkSync(join(dir, f))
  return old
}

// Тот же список, что в разделе «Резервная копия» приложения
const TABLES = [
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

  for (const f of rotate(BACKUP_DIR)) {
    console.log(`Удалена старая копия: ${f}`)
  }

  // Вторая копия — в облако или на внешний диск.
  // Ошибка здесь НЕ должна валить задание: основная копия уже сохранена,
  // а Google Диск мог быть просто не запущен.
  const mirrors = findMirrorDirs(env)
  if (mirrors.length === 0) {
    console.log(
      '\nВторая копия не сделана: папка Google Диска не найдена.\n' +
      'Если «Google Диск для компьютера» установлен — запустите его;\n' +
      'либо укажите папку вручную в TIMELOG_BACKUP_MIRROR.'
    )
    return
  }

  for (const dir of mirrors) {
    try {
      mkdirSync(dir, { recursive: true })
      copyFileSync(file, join(dir, `timelog_backup_${stamp}.json`))
      rotate(dir)
      console.log(`Вторая копия: ${dir}`)
    } catch (e) {
      console.error(`Вторую копию в ${dir} сделать не удалось: ${e?.message ?? e}`)
    }
  }
}

main().catch(e => fail(String(e?.message ?? e)))
