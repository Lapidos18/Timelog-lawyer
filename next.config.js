/**
 * Защитные заголовки для всех страниц и ответов.
 *
 * До 04.10.2026 сайт отдавал только Strict-Transport-Security (его ставит
 * сам Vercel). Остальное добавлено по итогам ревизии:
 *  - X-Frame-Options: SAMEORIGIN — чужая страница не может встроить кабинет
 *    в невидимую рамку и подсунуть вам нажатие на кнопку («кликджекинг»).
 *    Свой сайт встраивать в себя можно: так устроены проверки вёрстки.
 *  - X-Content-Type-Options: nosniff — браузер не «угадывает» тип файла и не
 *    исполняет текст как скрипт.
 *  - Referrer-Policy — при переходе по внешней ссылке (папка на Google Диске)
 *    уходит только адрес сайта, без пути к вашему разделу.
 *  - Permissions-Policy — камера, микрофон и геопозиция сайту не нужны, и
 *    встроенный на страницу чужой код их тоже не получит.
 *
 * Content-Security-Policy задаёт middleware с новой меткой nonce для каждого
 * HTML-ответа. Скрипт выбора темы использует эту же метку в layout.tsx.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
