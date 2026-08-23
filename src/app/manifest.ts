import type { MetadataRoute } from 'next'

// Манифест нужен, чтобы приложение можно было добавить на экран «Домой»
// на телефоне и открывать без адресной строки браузера.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Тайм-трекер | АК Бухмин А.А.',
    short_name: 'Тайм-трекер',
    description: 'Учёт рабочего времени адвокатского кабинета',
    lang: 'ru',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d1a25',
    theme_color: '#0d1a25',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
