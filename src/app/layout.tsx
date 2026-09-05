import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'Тайм-трекер | АК Бухмин А.А.',
  description: 'Учёт рабочего времени адвокатского кабинета',
  // Название под иконкой на экране «Домой» — короткое, чтобы не обрезалось
  appleWebApp: {
    capable: true,
    title: 'Тайм-трекер',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d1a25',
  // Позволяет фону дотянуться до краёв экрана iPhone; отступы под Dynamic Island
  // и «полоску» home indicator берутся из env(safe-area-inset-*) в layout дашборда
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Тема выставляется ДО первой отрисовки: иначе при выбранной светлой
            теме страница на мгновение вспыхивает тёмным фоном. Скрипт
            намеренно синхронный и крошечный. */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{if(localStorage.getItem('timelog-theme')==='light')` +
          `document.documentElement.dataset.theme='light'}catch(e){}`
        }} />
      </head>
      <body>
        {children}
        {/* Цвета уведомлений — из тех же переменных, что и вся тема,
            иначе на светлой теме всплывало бы тёмное окно */}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgb(var(--navy-800))',
              color: 'rgb(var(--navy-100))',
              border: '1px solid rgb(var(--navy-700))',
            },
          }}
        />
      </body>
    </html>
  )
}
