// Настройка проверки кода (ESLint 9, «плоский» формат).
//
// До 21.09.2026 здесь был .eslintrc.json под ESLint 8. Восьмую версию
// перестали поддерживать, и она одна тянула в сборку шесть устаревших
// пакетов (rimraf, glob, inflight и др.) — отсюда жёлтые строки в журнале
// Vercel. Правила перенесены без изменений: набор next/core-web-vitals
// через FlatCompat и одно отключённое правило.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

export default [
  { ignores: ['.next/**', 'node_modules/**', 'scripts/**'] },
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]
