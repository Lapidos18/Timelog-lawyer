import { describe, it, expect } from 'vitest'
import { dashboardTotals } from './dashboard-totals'

describe('Обзор: начисления отдельно от поступлений', () => {
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
