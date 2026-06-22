import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'Тайм-трекер | АК Бухмин А.А.',
  description: 'Учёт рабочего времени адвокатского кабинета',
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
