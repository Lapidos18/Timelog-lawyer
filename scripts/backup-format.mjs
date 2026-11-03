export const BACKUP_TABLES = ['clients','profiles','matters','time_entries','payments','acts','expenses','tax_settings',
 'tax_payments','manual_income','reimbursable_expenses','court_events','audit_log','settlement_acts','matter_accruals',
 'payment_allocations','act_entry_claims','billing_periods','backup_runs','financial_operations','rate_rules','document_source_claims','notification_deliveries','cabinet_settings'];
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
 ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
export async function checksum(value) {
 const data=new TextEncoder().encode(JSON.stringify(canonical(value)));
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function createBackup(data,source='manual') {
 for(const table of BACKUP_TABLES)if(!Array.isArray(data[table]))throw Error('Отсутствует таблица '+table);
 const table_counts=Object.fromEntries(BACKUP_TABLES.map(t=>[t,data[t].length]));
 const checksums=Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async t=>[t,await checksum(data[t])])));
 return {meta:{backup_date:new Date().toISOString(),backup_version:'2.0',schema_revision:37,source,tables:BACKUP_TABLES,
  table_counts,checksums,total_records:Object.values(table_counts).reduce((s,n)=>s+n,0)},data};
}
/** Проверка содержимого и ссылок до любого восстановления. Ничего не записывает в базу. */
export async function verifyBackup(backup) {
 if(!backup?.meta||!backup?.data||!Array.isArray(backup.meta.tables))throw Error('Некорректный формат резервной копии');
 const names=backup.meta.tables;
 if(!['1.0','2.0'].includes(backup.meta.backup_version))throw Error('Неизвестная версия резервной копии');
 if(Object.keys(backup.data).some(t=>!names.includes(t)))throw Error('Таблица отсутствует в перечне копии');
 if(new Set(names).size!==names.length||names.some(t=>!BACKUP_TABLES.includes(t)))throw Error('Неизвестная или повторяющаяся таблица');
 const required=Number(backup.meta.schema_revision)>=36?BACKUP_TABLES:Number(backup.meta.schema_revision)>=35?BACKUP_TABLES.filter(t=>t!=='cabinet_settings'):BACKUP_TABLES.filter(t=>!['rate_rules','document_source_claims','notification_deliveries','cabinet_settings'].includes(t));
 if(backup.meta.backup_version==='2.0'&&required.some(t=>!names.includes(t)))throw Error('Неполная копия');
 let count=0;
 for(const table of names){
  const rows=backup.data[table];if(!Array.isArray(rows))throw Error('Некорректная таблица '+table);count+=rows.length;
  const key=table==='tax_settings'?'year':table==='act_entry_claims'?'entry_id':'id';
  if(rows.some(r=>!r||r[key]===undefined)||new Set(rows.map(r=>r[key])).size!==rows.length)throw Error('Повтор идентификатора в '+table);
  if(backup.meta.backup_version==='2.0'){
   if(backup.meta.table_counts?.[table]!==rows.length||backup.meta.checksums?.[table]!==await checksum(rows))throw Error('Контрольная сумма/число строк не совпали: '+table);
  }
 }
 if(count!==backup.meta.total_records)throw Error('Итоговое число записей не совпало');
 const ids=t=>new Set((backup.data[t]||[]).map(r=>r.id));
 const references=[['matters','client_id','clients'],['time_entries','matter_id','matters'],['time_entries','user_id','profiles'],
  ['payments','client_id','clients'],['payments','matter_id','matters'],['reimbursable_expenses','matter_id','matters'],
  ['reimbursable_expenses','payment_id','payments'],['matter_accruals','matter_id','matters'],['acts','matter_id','matters'],
  ['settlement_acts','client_id','clients'],['payment_allocations','payment_id','payments'],['payment_allocations','matter_id','matters'],
  ['payment_allocations','act_id','acts'],['act_entry_claims','entry_id','time_entries'],['act_entry_claims','act_id','acts'],['rate_rules','matter_id','matters'],['rate_rules','user_id','profiles'],['document_source_claims','act_id','acts']];
 for(const [table,field,target] of references){const targetIds=ids(target);if((backup.data[table]||[]).some(r=>r[field]&&!targetIds.has(r[field])))throw Error(`Нарушена ссылка ${table}.${field}`)}
 return {tables:names.length,records:count,checksum:await checksum(backup.data),verifiedChecksums:backup.meta.backup_version==='2.0'};
}
