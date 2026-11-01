import { describe,it,expect } from 'vitest'
import { allocationError,allocationTotal,readRub,summarizeLedger,BillingEvent,readAllRows } from './billing'
import { createBackup,verifyBackup,BACKUP_TABLES } from '../../scripts/backup-format.mjs'
describe('распределение банковского поступления',()=>{
 it('загружает все строки, даже если лимит сервера меньше запрошенной страницы',async()=>{
  const rows=Array.from({length:237},(_,id)=>({id}))
  const client={from:()=>({select:()=>({order:()=>({range:async(start:number)=>({data:rows.slice(start,start+100),error:null,count:237})})})})}
  expect((await readAllRows(client,'test')).length).toBe(237)
 })
 it('считает копейки без повторного учёта платежа',()=>{
  const rows=[{matter_id:'a',fee_amount:'600.10',expense_amount:'1.20'},{matter_id:'b',fee_amount:'300.20',expense_amount:'0.00'}]
  expect(allocationTotal(rows)).toBe(90150)
  expect(allocationError(rows,'1000.00')).toBeNull()
  expect(allocationError(rows,'900.00')).toContain('превышает')
 })
 it('не округляет и не принимает частично разобранный ввод',()=>{
  expect(readRub('1 234,56')).toBe(123456)
  for(const s of ['1.234','12abc','-1','Infinity','1e3',''])expect(readRub(s)).toBeNull()
 })
 it('отделяет открывающий остаток, начисления, уменьшение и оплату',()=>{
  const events=[['2026-09-30',200],['2026-10-10',100],['2026-10-28',-250],['2026-10-31',-50]].map(([event_date,amount],i)=>({id:String(i),event_date,amount})) as BillingEvent[]
  const r=summarizeLedger(events,'2026-10-01','2026-10-31')
  expect(r).toMatchObject({opening:20000,debit:10000,credit:30000,balance:0})
 })
})
describe('резервирование с проверкой содержимого',()=>{
 it('обнаруживает изменение суммы и потерянную строку',async()=>{
  const data=Object.fromEntries(BACKUP_TABLES.map(t=>[t,[]]))
  data.clients=[{id:'c',name:'Тест'}] as never[]
  const backup=await createBackup(data,'test')
  expect((await verifyBackup(backup)).records).toBe(1)
  const changed=JSON.parse(JSON.stringify(backup));changed.data.clients[0].name='Изменено'
  await expect(verifyBackup(changed)).rejects.toThrow('Контрольная')
  const missing=JSON.parse(JSON.stringify(backup));delete missing.data.clients
  await expect(verifyBackup(missing)).rejects.toThrow()
 })
 it('отклоняет повреждённые межтабличные ссылки',async()=>{
  const data=Object.fromEntries(BACKUP_TABLES.map(t=>[t,[]]))
  data.matters=[{id:'m',client_id:'missing'}] as never[]
  await expect(verifyBackup(await createBackup(data,'test'))).rejects.toThrow('Нарушена ссылка')
 })
})
