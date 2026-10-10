/**
 * Расчёт НДФЛ и пропорции фиксированных взносов.
 *
 * Вынесено из finance/page.tsx, чтобы формулы можно было прочитать и
 * проверить отдельно от вёрстки.
 */

/**
 * Шкала НДФЛ по п. 1 ст. 224 НК РФ (в редакции с 01.01.2025).
 *
 * До 2025 года ступеней было две — 13 % и 15 % свыше 5 млн, и в приложении
 * так и было заложено: `ndfl_rate_low` / `ndfl_rate_high` с одним порогом.
 * С 2025 года ступеней пять, и двухступенчатый расчёт занижал налог при
 * доходе выше 5 млн. Пока доход кабинета до 2,4 млн, разницы нет, но
 * формула должна быть верной заранее, а не с момента, когда это заметят.
 *
 * `upTo` — верхняя граница ступени НАРАСТАЮЩИМ ИТОГОМ за год.
 */
export const NDFL_BANDS: { upTo: number; rate: number }[] = [
  { upTo:  2_400_000, rate: 0.13 },
  { upTo:  5_000_000, rate: 0.15 },
  { upTo: 20_000_000, rate: 0.18 },
  { upTo: 50_000_000, rate: 0.20 },
  { upTo: Infinity,   rate: 0.22 },
]

/**
 * НДФЛ с налоговой базы по прогрессивной шкале.
 *
 * Ставка применяется не ко всей сумме, а к части дохода внутри ступени:
 * при базе 3 млн это 2,4 млн по 13 % плюс 600 тыс. по 15 %, а не 3 млн по 15 %.
 */
export function calcNdfl(base: number): number {
  if (base <= 0) return 0
  let tax = 0
  let prev = 0
  for (const band of NDFL_BANDS) {
    if (base <= prev) break
    tax += (Math.min(base, band.upTo) - prev) * band.rate
    prev = band.upTo
  }
  return tax
}

/**
 * Доля года для фиксированных взносов при начале деятельности не с 1 января
 * (п. 3 ст. 430 НК РФ).
 *
 * Считается по календарным дням внутри неполного месяца, а не месяцами
 * целиком: за месяц начала берётся часть, пропорциональная числу дней со дня
 * начала до конца месяца, и к ней прибавляются полные месяцы после него.
 * Раньше было `12 − номер месяца`, то есть месяц начала засчитывался как
 * полный, и сумма получалась завышенной.
 *
 * ВАЖНО: пропорция применяется только при НАЧАЛЕ деятельности. У адвоката
 * обязанность возникает из статуса, а не из формы практики, поэтому переход
 * из коллегии в кабинет пропорции не даёт — см. п. 7 в CLAUDE.md.
 *
 * @returns доля года от 0 до 1
 */
export function yearFraction(startDate: Date, year: number): number {
  if (startDate.getFullYear() < year) return 1
  if (startDate.getFullYear() > year) return 0

  const month = startDate.getMonth()          // 0–11
  const day = startDate.getDate()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const fullMonthsAfter = 11 - month
  // День начала входит в расчёт, поэтому +1
  const partOfStartMonth = (daysInMonth - day + 1) / daysInMonth

  return (fullMonthsAfter + partOfStartMonth) / 12
}

// ── Страховые взносы в профессиональном вычете ───────────────────────────

/** Взносы адвоката за себя: уплата входит в профессиональный вычет (ст. 221 НК РФ) в том периоде, когда деньги ушли */
export type ContributionType = 'fixed_contributions' | 'ops_one_percent'

export function isContributionType(t: string): t is ContributionType {
  return t === 'fixed_contributions' || t === 'ops_one_percent'
}

/** Текст расхода, который заводится из записи об уплате взноса */
export function contributionExpenseText(type: ContributionType, periodYear: number): string {
  return type === 'fixed_contributions'
    ? `Фиксированные страховые взносы за ${periodYear} год`
    : `1% ОПС с дохода свыше 300 000 руб. за ${periodYear} год`
}

/**
 * Сколько страховых взносов уже стоит в расходах, принимаемых к вычету, ₽.
 * Считается копейками: на длинном списке 0,1 + 0,2 в рублях не даёт 0,3.
 */
export function contributionsInDeduction(
  expenses: { category: string; amount: number | string; is_documented: boolean }[],
): number {
  const kop = expenses
    .filter(e => e.is_documented && isContributionType(e.category))
    .reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0)
  return kop / 100
}
