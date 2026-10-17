import { describe, it, expect } from 'vitest'
import { suggestForRow, normalizeName, reasonLabel } from './statement-match'

// Данные вымышленные: ИНН и названия не настоящих доверителей
const clients = [
  { id: 'c1', name: 'ООО "Ромашка"',        inn: '5400000011' },
  { id: 'c2', name: 'ООО "Линия Омск"',    inn: '2200000033' },
  { id: 'c3', name: 'Петрова Мария Сергеевна', inn: null },
  { id: 'c4', name: 'АБ "Смирнова и партнёры"', inn: '5400000044' },
]

const matters = [
  { id: 'm1', client_id: 'c1', title: 'Консультации',   agreement_no: '05/03-26', case_no: null, status: 'active' },
  { id: 'm2', client_id: 'c1', title: 'Вектор поставок', agreement_no: '05/03-26-2', case_no: 'А00-100/2026', status: 'active' },
  { id: 'm3', client_id: 'c2', title: 'Консультации',   agreement_no: '08/04-26', case_no: null, status: 'active' },
  { id: 'm4', client_id: 'c3', title: 'Заявление о взыскании', agreement_no: '07-01/26', case_no: '2-100/2026', status: 'active' },
  { id: 'm5', client_id: 'c3', title: 'Старое дело',    agreement_no: null, case_no: null, status: 'closed' },
]

const row = (over: Partial<{ counterpartyInn: string; counterpartyName: string; purpose: string }> = {}) => ({
  counterpartyInn: '', counterpartyName: '', purpose: '', ...over,
})

describe('узнавание доверителя в выписке', () => {
  it('ИНН плательщика — самый надёжный признак', () => {
    const s = suggestForRow(row({ counterpartyInn: '2200000033', counterpartyName: 'ООО Линия' }), clients, matters)
    expect(s.clientId).toBe('c2')
    expect(s.clientReason).toBe('inn')
  })

  it('без ИНН доверитель узнаётся по названию, кавычки и форма не мешают', () => {
    const s = suggestForRow(row({ counterpartyName: 'ООО «Ромашка»' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.clientReason).toBe('name')
  })

  it('физическое лицо узнаётся по ФИО', () => {
    const s = suggestForRow(row({ counterpartyName: 'ПЕТРОВА МАРИЯ СЕРГЕЕВНА' }), clients, matters)
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
      row({ counterpartyInn: '5400000011', counterpartyName: 'ООО "Линия Омск"' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.clientReason).toBe('inn')
  })
})

describe('узнавание дела', () => {
  it('номер соглашения из назначения платежа', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5400000011',
      purpose: 'Оплата по соглашению 05/03-26-2 за юридические услуги',
    }), clients, matters)
    expect(s.matterId).toBe('m2')
    expect(s.matterReason).toBe('agreement')
  })

  it('номер судебного дела из назначения платежа', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5400000011',
      purpose: 'Вознаграждение по делу А00-100/2026',
    }), clients, matters)
    expect(s.matterId).toBe('m2')
    expect(s.matterReason).toBe('case')
  })

  it('у доверителя несколько дел и в назначении ничего нет — дело не гадаем', () => {
    const s = suggestForRow(row({ counterpartyInn: '5400000011', purpose: 'Оплата услуг' }), clients, matters)
    expect(s.clientId).toBe('c1')
    expect(s.matterId).toBe('')
  })

  it('единственное открытое дело подставляется, закрытое — нет', () => {
    const s = suggestForRow(row({ counterpartyName: 'Петрова Мария Сергеевна' }), clients, matters)
    expect(s.matterId).toBe('m4')
    expect(s.matterReason).toBe('single')
  })

  it('дело чужого доверителя не подставляется', () => {
    const s = suggestForRow(row({
      counterpartyInn: '2200000033',
      purpose: 'Оплата по соглашению 05/03-26',   // соглашение другого доверителя
    }), clients, matters)
    expect(s.clientId).toBe('c2')
    expect(s.matterId).toBe('m3')   // единственное своё дело, а не чужое m1
  })
})

describe('подпись к подсказке', () => {
  it('объясняет, откуда взялась', () => {
    const s = suggestForRow(row({
      counterpartyInn: '5400000011',
      purpose: 'по соглашению 05/03-26-2',
    }), clients, matters)
    expect(reasonLabel(s)).toBe('доверитель по ИНН плательщика, дело — по номеру соглашения в назначении')
  })
})

describe('приведение названий', () => {
  it('убирает кавычки, форму и регистр', () => {
    expect(normalizeName('ООО «Ромашка»')).toBe('ромашка')
    expect(normalizeName('ООО УК "Орион сервис"')).toBe('орион сервис')
    expect(normalizeName('АБ "Смирнова и партнеры"')).toBe('смирнова и партнеры')
  })

  it('не схлопывает разные названия в одно', () => {
    expect(normalizeName('ООО "Ромашка"')).not.toBe(normalizeName('ООО "Ромашкаплюс"'))
  })
})
