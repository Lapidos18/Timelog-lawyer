/**
 * Проверка контрольной суммы ИНН.
 *
 * ИНН попадает в акт и акт сверки — документы, которые уходят доверителю.
 * Опечатка в цифре там обнаруживается уже после отправки, а исправлять
 * подписанный документ дороже, чем не ошибиться. Контрольная сумма ловит
 * почти любую одиночную опечатку и перестановку соседних цифр.
 *
 * Алгоритм — приказ ФНС от 29.06.2012 № ММВ-7-6/435@:
 *   10 знаков (организация) — одна контрольная цифра, последняя;
 *   12 знаков (физлицо, ИП, адвокат) — две последние.
 */

const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8]
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]

function checkDigit(digits: number[], weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0)
  return (sum % 11) % 10
}

export type InnCheck = { valid: boolean; reason?: string }

/**
 * Пустая строка считается допустимой: ИНН — необязательное поле,
 * у части доверителей его просто нет под рукой.
 */
export function checkInn(raw: string): InnCheck {
  const inn = raw.trim()
  if (!inn) return { valid: true }

  if (!/^\d+$/.test(inn)) return { valid: false, reason: 'ИНН состоит только из цифр' }
  if (inn.length !== 10 && inn.length !== 12) {
    return { valid: false, reason: 'В ИНН 10 цифр у организации и 12 у физического лица' }
  }

  const d = inn.split('').map(Number)

  if (inn.length === 10) {
    return d[9] === checkDigit(d, W10)
      ? { valid: true }
      : { valid: false, reason: 'Контрольная цифра не сходится — проверьте, нет ли опечатки' }
  }

  const ok = d[10] === checkDigit(d, W11) && d[11] === checkDigit(d, W12)
  return ok
    ? { valid: true }
    : { valid: false, reason: 'Контрольные цифры не сходятся — проверьте, нет ли опечатки' }
}
