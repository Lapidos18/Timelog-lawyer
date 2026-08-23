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
    <html lang="ru">
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1e3a50',
              color: '#dce6f0',
              border: '1px solid #264462',
            },
          }}
        />
      </body>
    </html>
  )
}
