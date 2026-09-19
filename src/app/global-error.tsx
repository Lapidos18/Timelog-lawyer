'use client'

/**
 * Последний рубеж: ошибка в самом корневом макете приложения.
 *
 * Сюда попадают только если сломалось то, что обычно отрисовывает всё
 * остальное, — поэтому здесь нет ни общих стилей, ни шрифтов, ни
 * компонентов приложения: всё, от чего эта страница зависит, могло
 * сломаться вместе с макетом. Отсюда и простой встроенный стиль.
 * Next.js требует, чтобы такая страница сама выводила <html> и <body>.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{
        margin: 0, minHeight: '100dvh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 16, background: '#0d1a25', color: '#dce6f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Приложение не загрузилось</h1>
          <p style={{ fontSize: 14, color: '#8aaec9', marginBottom: 24, lineHeight: 1.5 }}>
            Данные на сервере в сохранности. Попробуйте ещё раз — если не поможет,
            закройте вкладку и откройте сайт заново.
          </p>
          <button onClick={reset} style={{
            background: '#c99510', color: '#0d1a25', border: 0, borderRadius: 8,
            padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', minHeight: 44,
          }}>
            Попробовать снова
          </button>
        </div>
      </body>
    </html>
  )
}
