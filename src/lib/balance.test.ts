import { describe, it, expect } from 'vitest'
import { feeKop, isSubscription, subscriptionAccruals, subscriptionKop, matterFeeAccrued, manualAccrualsKop } from './balance'

// ООО УК «Альфа менеджмент»: 224 000 ₽ в месяц с апреля 2026
const alfa = { monthly_fee: 224000, fee_from: '2026-04-01', fee_to: null }

describe('абонентская плата: когда дело считается абонентским', () => {
  it('нужны и сумма, и месяц начала', () => {
    expect(isSubscription(alfa)).toBe(true)
    expect(isSubscription({ monthly_fee: 224000 })).toBe(false)                     // без начала считать не с чего
    expect(isSubscription({ fee_from: '2026-04-01' })).toBe(false)
    expect(isSubscription({ monthly_fee: 0, fee_from: '2026-04-01' })).toBe(false)
    expect(isSubscription({ monthly_fee: null, fee_from: '2026-04-01' })).toBe(false)
    expect(isSubscription({})).toBe(false)
  })

  it('сумма из базы приходит строкой; мусор — ноль', () => {
    expect(feeKop({ monthly_fee: '224000.00' })).toBe(22400000)
    expect(feeKop({ monthly_fee: 'abc' })).toBe(0)
    expect(feeKop({ monthly_fee: -5 })).toBe(0)
  })
})

describe('начисления — на последний день месяца', () => {
  it('апрель–сентябрь к 10 октября: шесть месяцев, октябрь ещё не закончился', () => {
    const a = subscriptionAccruals(alfa, '2026-10-10')
    expect(a.map(x => x.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'])
    expect(subscriptionKop(alfa, '2026-10-10')).toBe(6 * 22400000)                 // 1 344 000,00 = шесть оплат
  })

  it('в последний день месяца он уже начислен', () => {
    expect(subscriptionAccruals(alfa, '2026-10-30')).toHaveLength(6)
    expect(subscriptionAccruals(alfa, '2026-10-31')).toHaveLength(7)
  })

  it('до конца первого месяца начислений нет', () => {
    expect(subscriptionAccruals(alfa, '2026-04-29')).toEqual([])
    expect(subscriptionAccruals(alfa, '2026-03-15')).toEqual([])
  })

  it('месяц начала — целиком, даже если дата начала в середине месяца', () => {
    const mid = { monthly_fee: 1000, fee_from: '2026-04-17' }
    expect(subscriptionAccruals(mid, '2026-04-30').map(x => x.date)).toEqual(['2026-04-30'])
  })

  it('окончание: последний начисленный месяц — месяц fee_to', () => {
    const closed = { monthly_fee: 1000, fee_from: '2026-04-01', fee_to: '2026-06-10' }
    expect(subscriptionAccruals(closed, '2027-01-01').map(x => x.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30'])
  })

  it('конец февраля, в том числе високосного, и переход через год', () => {
    const t = { monthly_fee: 1, fee_from: '2023-12-01' }
    expect(subscriptionAccruals(t, '2024-03-31').map(x => x.date)).toEqual(['2023-12-31', '2024-01-31', '2024-02-29', '2024-03-31'])
    expect(subscriptionAccruals({ monthly_fee: 1, fee_from: '2026-01-01' }, '2026-02-28').map(x => x.date)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('отрезок «с даты»: начисления внутри периода акта и до него считаются порознь', () => {
    const asOf = '2026-09-30'
    const all = subscriptionKop(alfa, asOf)
    const inPeriod = subscriptionKop(alfa, asOf, '2026-07-01')                       // июль, август, сентябрь
    expect(inPeriod).toBe(3 * 22400000)
    expect(all - inPeriod).toBe(3 * 22400000)                                         // апрель–июнь — в начальное сальдо
  })
})

describe('начислено по делу: часы или абонплата', () => {
  it('почасовое дело — сумма оплачиваемых часов, как и было', () => {
    expect(matterFeeAccrued({ monthly_fee: null, fee_from: null }, 25883, '2026-10-10')).toBe(25883)
    expect(matterFeeAccrued({}, 0, '2026-10-10')).toBe(0)
  })

  it('абонентское дело — только начисления; оплачиваемые часы денег не создают', () => {
    expect(matterFeeAccrued(alfa, 99999, '2026-10-10')).toBe(1344000)
    expect(matterFeeAccrued(alfa, 0, '2026-10-10')).toBe(1344000)
  })

  it('сумма без дробных хвостов', () => {
    expect(matterFeeAccrued({ monthly_fee: 0.1, fee_from: '2026-01-01' }, 0, '2026-03-31')).toBeCloseTo(0.3, 10)
    expect(subscriptionKop({ monthly_fee: 0.1, fee_from: '2026-01-01' }, '2026-03-31')).toBe(30) // копейками — ровно 30
  })

  it('случай пользователя: шесть оплат по 224 000 закрывают шесть начислений — долга нет', () => {
    const paid = 6 * 224000
    expect(paid - matterFeeAccrued(alfa, 0, '2026-10-10')).toBe(0)
  })
})

describe('начисления по актам (работа на фиксированную сумму без часов)', () => {
  // АБ «Гребнева и партнеры»: оплата 7 000 ₽ за участие в заседании, закрыта актом от 31.08.2026
  const act = { accrual_date: '2026-08-31', amount: 7000, description: 'Акт от 31.08.2026' }

  it('начисление считается с даты акта, не раньше', () => {
    expect(manualAccrualsKop([act], '2026-08-30')).toBe(0)
    expect(manualAccrualsKop([act], '2026-08-31')).toBe(700000)
    expect(manualAccrualsKop([act], '2026-10-10')).toBe(700000)
  })

  it('сумма из базы строкой, несколько актов складываются копейками', () => {
    const list = [{ accrual_date: '2026-08-31', amount: '7000.10' }, { accrual_date: '2026-09-30', amount: '0.20' }]
    expect(manualAccrualsKop(list, '2026-10-10')).toBe(700030)
  })

  it('отрезок «с даты» — для акта сверки: начисления внутри периода и до него считаются порознь', () => {
    const list = [{ accrual_date: '2026-06-30', amount: 49500 }, act]
    expect(manualAccrualsKop(list, '2026-09-30', '2026-07-01')).toBe(700000)
    expect(manualAccrualsKop(list, '2026-09-30') - manualAccrualsKop(list, '2026-09-30', '2026-07-01')).toBe(4950000)
  })

  it('пусто и отсутствует — ноль', () => {
    expect(manualAccrualsKop([], '2026-10-10')).toBe(0)
    expect(manualAccrualsKop(null, '2026-10-10')).toBe(0)
    expect(manualAccrualsKop(undefined, '2026-10-10')).toBe(0)
  })

  it('к часам прибавляется: дело без часов получает ровно сумму актов', () => {
    expect(matterFeeAccrued({}, 0, '2026-10-10', [act])).toBe(7000)
    expect(matterFeeAccrued({}, 1000, '2026-10-10', [act])).toBe(8000)
    expect(matterFeeAccrued({}, 1000, '2026-10-10')).toBe(1000)          // без актов — как раньше
  })

  it('к абонплате тоже прибавляется (дополнительный акт сверх месячной платы)', () => {
    const alfa = { monthly_fee: 224000, fee_from: '2026-04-01' }
    expect(matterFeeAccrued(alfa, 0, '2026-10-10', [{ accrual_date: '2026-09-15', amount: 5000 }])).toBe(1349000)
  })

  it('случай пользователя: оплачено 7 000, акт на 7 000 — «аванса» нет', () => {
    expect(7000 - matterFeeAccrued({}, 0, '2026-10-10', [act])).toBe(0)
  })
})
