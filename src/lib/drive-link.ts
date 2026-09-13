/**
 * Ссылка на папку Google Диска в карточке дела.
 *
 * Проверка нужна не для красоты. Ссылка попадает в href, и если туда
 * вставить что-то вроде `javascript:...`, нажатие выполнит этот код.
 * Пользователь один, но строка может прийти и не из формы — например,
 * из восстановленной резервной копии. Поэтому ссылкой показываем только
 * адреса Google Диска и Документов по https, всё остальное — нет.
 */

const DRIVE_URL = /^https:\/\/(drive|docs)\.google\.com\//i

export function isDriveUrl(raw: string | null | undefined): boolean {
  return !!raw && DRIVE_URL.test(raw.trim())
}

/**
 * Подсказка под полем. Пустое поле — нормально, ссылка необязательна.
 */
export function driveUrlHint(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (isDriveUrl(v)) return null
  if (/^http:\/\//i.test(v)) return 'Ссылка должна начинаться с https://'
  return 'Это не похоже на ссылку Google Диска. Откройте папку на Диске и скопируйте адрес из строки браузера'
}
