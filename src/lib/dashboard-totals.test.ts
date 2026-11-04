import { describe, it, expect } from 'vitest'
import { dashboardTotals, matterPeriodTotals } from './dashboard-totals'

describe('Обзор: начисления отдельно от поступлений', () => {
  it('разделяет по заданиям точную длительность, стоимость часов и начисления за услуги', () => {
    const hourly = { id: 'hourly' }
    const subscription = { id: 'subscription', monthly_fee: 20000, fee_from: '2026-10-01' }
    const minute = { matter_id: hourly.id, amount: 16.67, is_billable: true, hours: 0.02, duration_min: 1 }
    const rows = matterPeriodTotals([hourly, subscription], [
      ...Array(5).fill(minute),
      { ...minute, is_billable: false },
      { ...minute, matter_id: subscription.id },
    ], [{ matter_id: hourly.id, accrual_date: '2026-10-31', amount: -25 }],
    '2026-10-01', '2026-10-31')

    expect(rows[0]).toMatchObject({ hourlyKop: 8335, accruedKop: 5835 })
    expect(rows[0].hours * 60).toBeCloseTo(6)
    expect(rows[1]).toEqual({ matter: subscription, hours: 1 / 60, hourlyKop: 0, accruedKop: 2000000 })
  })
  it('учитывает абонплату вместо часов, фиксированную работу и уменьшение цены', () => {
    const result=dashboardTotals(
      [{id:'hourly'}, {id:'subscription',monthly_fee:20000,fee_from:'2026-10-01'}],
      [{matter_id:'hourly',amount:1000.10,is_billable:true,hours:1},
       {matter_id:'hourly',amount:500,is_billable:false,hours:0.5},
       {matter_id:'subscription',amount:9999,is_billable:true,hours:2}],
      [{matter_id:'hourly',accrual_date:'2026-10-31',amount:3000},
       {matter_id:'hourly',accrual_date:'2026-10-31',amount:-294.25},
       {matter_id:'hourly',accrual_date:'2026-11-01',amount:8000}],
      [{amount:50000},{amount:100.01}], '2026-10-01','2026-10-31')
    expect(result).toEqual({hours:3.5,accrued:23705.85,received:50100.01})
  })
  it('не начисляет незавершённый месяц абонплаты и прошлые фиксированные суммы повторно',()=>{
    expect(dashboardTotals([{id:'a',monthly_fee:20000,fee_from:'2026-09-01'}],[],
      [{matter_id:'a',accrual_date:'2026-09-30',amount:1000}],[],
      '2026-10-01','2026-10-15')).toEqual({hours:0,accrued:0,received:0})
  })
})
