import type { StatementRow } from './bank-statement'
export type Receipt = {date:string;amount:number|string;doc_no?:string|null;description?:string|null}
const norm=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase()
export function receiptMatch(row:StatementRow,existing:Receipt[]): 'possible'|'new' {
 return existing.some(p=>p.date===row.date && Math.round(Number(p.amount)*100)===Math.round(row.amount*100)) ? 'possible' : 'new'
}
export function sourceReceipt(account:string,row:StatementRow){
 return {account:account.replace(/\s/g,''),date:row.date,amount:row.amount,doc:row.docNo.trim(),inn:row.counterpartyInn.trim(),name:norm(row.counterpartyName),purpose:row.purpose.trim()}
}
export function receiptKey(account:string,row:StatementRow){
 const source=sourceReceipt(account,row)
 return JSON.stringify({...source,amount:Math.round(row.amount*100),purpose:norm(source.purpose)})
}
