import { describe, it, expect } from 'vitest'
import { suggestForRow, normalizeName, reasonLabel } from './statement-match'

// Данные вымышленные: ИНН и названия не настоящих доверителей
const clients = [
  { id: 'c1', name: 'ООО "Система"',        inn: '5405006521' },
  { id: 'c2', name: 'ООО "РТИ Барнаул"',    inn: '2223968920' },
  { id: 'c3', name: 'Кадырова Наталья Викторовна', inn: null },
  { id: 'c4', name: 'АБ "Гребнева и партнёры"', inn: '5406765232' },
]

const matters = [
  { id: 'm1', client_id: 'c1', title: 'Консультации',   agreement_no: '19/06-26', case_no: null, status: 'active' },
  { id: 'm2', client_id: 'c1', title: 'Метизные решения', agreement_no: '19/06-26-2', case_no: 'А45-1122/2026', status: 'active' },
  { id: 'm3', client_id: 'c2', title: 'Консультации',   agreement_no: '21/07-26', case_no: null, status: 'active' },
  { id: 'm4', client_id: 'c3', title: 'Заявление Мэрии', agreement_no: '17-07/26', case_no: '13-1345/2026', status: 'active' },
  { id: 'm5', client_id: 'c3', title: 'Старое дело',    agreement_no: null, case_no: null, status: 'closed' },
]

const row = (over: Partial<{ counterpartyInn: string; counterpartyName: string; purpose: string }> = {}) => ({
  counterpartyInn: '', counterpartyName: '', purpose: '', ...over,
})

describe('узнавание доверителя в выписке', () => {
  it('ИНН плательщика — самый надёжный признак', () => {
    const s = suggestForRow(row({ counterpartyInn: '2223968920', counterpartyName: 'ООО РТИ' }), clients, matters)
    expect(s.clientId).toBe('c2')
    expect(s.clientReason).toBe('inn')
  })

  it('без ИНН доверитель узнаётся по названию, кавычки и форма не мешают', () => {
    const s = suggestForRow(row({ counterpartyName: 'ООО «Система»' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.clientReason).toBe('name')
  })

  it('физическое лицо узнаётся по ФИО', () => {
    const s = suggestForRow(row({ counterpartyName: 'КАДЫРОВА НАТАЛЬЯ ВИКТОРОВНА' }), clients, matters)
    expect(s.clientId).toBe('c3')
  })

  it('чужой плательщик не подставляется', () => {
    const s = suggestForRow(row({ counterpartyInn: '7707083893', counterpartyName: 'ПАО Сбербанк' }), clients, matters)
    expect(s.clientId).toBe('')
    expect(s.matterId).toBe('')
    expect(reasonLabel(s)).toBe('')
  })

  it('ИНН важнее похожего названия', () => {
    const s = suggestForRow(
      row({ counterpartyInn: '5405006521', counterpartyName: 'ООО "РТИ Барнаул"' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.clientReason).toBe('inn')
  })
})

describe('узнавание дела', () => {
  it('номер соглашения из назначения платежа', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5405006521',
      purpose: 'Оплата по соглашению 19/06-26-2 за юридические услуги',
    }), clients, matters)
    expect(s.matterId).toBe('m2')
    expect(s.matterReason).toBe('agreement')
  })

  it('номер судебного дела из назначения платежа', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5405006521',
      purpose: 'Вознаграждение по делу А45-1122/2026',
    }), clients, matters)
    expect(s.matterId).toBe('m2')
    expect(s.matterReason).toBe('case')
  })

  it('у доверителя несколько дел и в назначении ничего нет — дело не гадаем', () => {
    const s = suggestForRow(row({ counterpartyInn: '5405006521', purpose: 'Оплата услуг' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.matterId).toBe('')
  })

  it('единственное открытое дело подставляется, закрытое — нет', () => {
    const s = suggestForRow(row({ counterpartyName: 'Кадырова Наталья Викторовна' }), clients, matters)
    expect(s.matterId).toBe('m4')
    expect(s.matterReason).toBe('single')
  })

  it('дело чужого доверителя не подставляется', () => {
    const s = suggestForRow(row({
      counterpartyInn: '2223968920',
      purpose: 'Оплата по соглашению 19/06-26',   // соглашение другого доверителя
    }), clients, matters)
    expect(s.clientId).toBe('c2')
    expect(s.matterId).toBe('m3')   // единственное своё дело, а не чужое m1
  })
})

describe('подпись к подсказке', () => {
  it('объясняет, откуда взялась', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5405006521',
      purpose: 'по соглашению 19/06-26-2',
    }), clients, matters)
    expect(reasonLabel(s)).toBe('доверитель по ИНН плательщика, дело — по номеру соглашения в назначении')
  })
})

describe('приведение названий', () => {
  it('убирает кавычки, форму и регистр', () => {
    expect(normalizeName('ООО «Система»')).toBe('система')
    expect(normalizeName('ООО УК "Альфа менеджмент"')).toBe('альфа менеджмент')
    expect(normalizeName('АБ "Гребнёва и партнеры"')).toBe('гребнева и партнеры')
  })

  it('не схлопывает разные названия в одно', () => {
    expect(normalizeName('ООО "Система"')).not.toBe(normalizeName('ООО "Системаплюс"'))
  })
})
