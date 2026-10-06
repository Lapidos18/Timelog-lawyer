/**
 * Узкий экран или сенсорный ввод — там запись открывается ОДНИМ касанием,
 * а не двойным кликом.
 *
 * На iPhone двойное касание срабатывает ненадёжно, поэтому во всех списках
 * правка открывается касанием (CLAUDE.md, п. 1). `pointer: coarse` верен и для
 * повёрнутого телефона (852 px — это уже «десктопная» ширина), и для планшета.
 */
export function isTouchLayout(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
}
