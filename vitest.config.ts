import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Автопроверки расчётов в src/lib.
 *
 * Запускаются перед каждой сборкой (скрипт prebuild в package.json) —
 * и у вас, и на Vercel. Если проверка не прошла, сборка останавливается,
 * и сломанный расчёт не попадает на сайт.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
