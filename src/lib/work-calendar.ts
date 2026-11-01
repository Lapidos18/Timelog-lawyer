/** Проверенные федеральные переносы. Источники доступны пользователю вместе с расчётом. */
export const CALENDARS: Record<number, { source: string; version: string; holidays: string[]; working: string[] }> = {
  2026: {
    source: 'https://static.government.ru/media/files/4jeB8hNKm69ggOa9yDiYOli6YoAyM21i.pdf',
    version: 'Постановление Правительства РФ №1466 от 24.09.2025',
    holidays: ['2026-01-09','2026-03-09','2026-05-11','2026-12-31'], working: [],
  },
  2027: {
    source: 'https://www.cbr.ru/other/holidays/',
    version: 'Календарь 2027: перечень Банка России, постановление №1187 от 17.09.2026',
    holidays: ['2027-02-22','2027-05-03','2027-05-10','2027-06-14','2027-11-05','2027-12-31'], working: [],
  },
}
export function calendarVerified(from: Date, to: Date): boolean {
  for (let year=from.getFullYear();year<=to.getFullYear();year++) if(!CALENDARS[year])return false
  return true
}
