import {it,expect} from 'vitest'
import {receiptMatch,receiptKey} from './statement-import'
const row={index:1,date:'2026-10-01',docNo:'123',amount:1000,purpose:'Оплата задания',counterpartyInn:'0000000000',counterpartyName:'Тест'}
it('дата и сумма дают лишь сомнительное совпадение',()=>{expect(receiptMatch(row,[{date:row.date,amount:1000,doc_no:'другой'}])).toBe('possible');expect(receiptMatch(row,[])).toBe('new')})
it('отпечаток не зависит от позиции, имени файла, пробелов и регистра; различает номер и счёт',()=>{expect(receiptKey(' 123 ',row)).toBe(receiptKey('123',{...row,index:77,purpose:' оплата   ЗАДАНИЯ '}));expect(receiptKey('123',row)).not.toBe(receiptKey('123',{...row,docNo:'124'}));expect(receiptKey('123',row)).not.toBe(receiptKey('124',row))})
