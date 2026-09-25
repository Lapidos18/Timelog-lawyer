import type { Metadata, Viewport } from 'next'
import { Golos_Text, Cormorant_Garamond } from 'next/font/google'
import './globals.css'
import { Toaster } from 'react-hot-toast'

// Шрифты раздаются с нашего же сайта. Раньше они подтягивались с серверов
// Google через @import в globals.css: пока чужой сервер не ответит, страница
// не показывалась вовсе (@import блокирует отрисовку), а при сбое связи с ним
// оставалась пустой на секунды. next/font скачивает файлы при сборке и кладёт
// рядом со страницей.
// Оба шрифта «переменные» — один файл на все начертания. latin-ext нужен ради
// знака ₽ (U+20BD): без него рубль рисовался бы системным шрифтом.
// Inter больше не подключается: весь текст задан Golos Text, Inter нигде не
// показывался (в tailwind.config.js он остался только запасным именем).
// preload: false — иначе браузер скачает все начертания сразу, включая
// latin-ext, которая нужна лишь на страницах с суммами; при обычной загрузке
// он берёт только те файлы, символы которых есть на странице.
const golos = Golos_Text({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  variable: '--font-golos',
  preload: false,
})
const cormorant = Cormorant_Garamond({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  variable: '--font-cormorant',
  preload: false,
})

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
    <html lang="ru" suppressHydrationWarning className={`${golos.variable} ${cormorant.variable}`}>
      <head>
        {/* Тема выставляется ДО первой отрисовки: иначе при выбранной светлой
            теме страница на мгновение вспыхивает тёмным фоном. Скрипт
            намеренно синхронный и крошечный. */}
        <script dangerouslySetInnerHTML={{ __html:
          // «office» — имя, под которым светлая тема «Кабинет» жила до
          // 21.09.2026 на пробной версии; такой выбор тоже считаем светлым
          `try{var t=localStorage.getItem('timelog-theme');` +
          `if(t==='light'||t==='office')document.documentElement.dataset.theme='light'}catch(e){}`
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
