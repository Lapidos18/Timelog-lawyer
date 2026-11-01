/** Настоящее восстановление в одноразовый PostgreSQL в памяти. Адрес рабочей базы не используется. */
import { readFileSync,readdirSync } from 'node:fs'
import { resolve,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { verifyBackup } from './backup-format.mjs'
const require=createRequire(import.meta.url)
const { PGlite }=require('@electric-sql/pglite')
const file=process.argv[2]
if(!file){console.error('Укажите путь к JSON-копии');process.exit(1)}
let db
try{
 const backup=JSON.parse(readFileSync(file,'utf8'));const verified=await verifyBackup(backup)
 db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
  create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`)
 const migrations=resolve(dirname(fileURLToPath(import.meta.url)),'../supabase/migrations')
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort()){
  await db.exec(readFileSync(resolve(migrations,name),'utf8').replace(/create extension if not exists "uuid-ossp";/i,''))
 }
 // Триггеры отключаются только у одноразовой базы в памяти. Связи и ограничения остаются включены.
 await db.exec('begin')
 const tables=backup.meta.tables
 for(const t of tables)await db.exec(`alter table public."${t}" disable trigger user`)
 for(const [i,p] of (backup.data.profiles||[]).entries())await db.query('insert into auth.users(id,email) values($1,$2)',[p.id,`restored-${i}@example.invalid`])
 const order=['clients','profiles','matters','time_entries','payments','expenses','tax_settings','tax_payments','manual_income','reimbursable_expenses','court_events','acts','settlement_acts','matter_accruals','payment_allocations','act_entry_claims','billing_periods','backup_runs','financial_operations','audit_log']
 for(const t of order.filter(t=>tables.includes(t))){
  const columns=(await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 and is_generated=$3',['public',t,'NEVER'])).rows.map(r=>r.column_name)
  const rows=[...backup.data[t]];if(t==='acts')rows.sort((a,b)=>(a.document_revision||1)-(b.document_revision||1))
  for(const row of rows){const keys=Object.keys(row).filter(k=>columns.includes(k));const pk=t==='tax_settings'?'year':t==='act_entry_claims'?'entry_id':'id'
   const update=keys.filter(k=>k!==pk).map(k=>`"${k}"=excluded."${k}"`).join(',')
   const values=keys.map(k=>row[k]&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k])
   await db.query(`insert into public."${t}"(${keys.map(k=>`"${k}"`).join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict("${pk}") ${update?'do update set '+update:'do nothing'}`,values)
  }
 }
 const counts={}
 for(const t of tables){
  const pk=t==='tax_settings'?'year':t==='act_entry_claims'?'entry_id':'id'
  const seq=(await db.query('select pg_get_serial_sequence($1,$2) seq',['public.'+t,pk])).rows[0].seq
  if(seq){const max=(await db.query(`select coalesce(max("${pk}"),1)::text n from public."${t}"`)).rows[0].n
   await db.query('select setval($1::regclass,$2::bigint,$3)',[seq,max,backup.data[t].length>0])}
 }
 for(const t of tables){const count=Number((await db.query(`select count(*) n from public."${t}"`)).rows[0].n);if(count!==backup.data[t].length)throw Error('Не совпало число строк '+t);counts[t]=count;await db.exec(`alter table public."${t}" enable trigger user`)}
 const totals={}
 for(const t of ['payments','time_entries','matter_accruals','reimbursable_expenses']){
  const original=(backup.data[t]||[]).reduce((sum,r)=>sum+BigInt(Math.round(Number(r.amount)*100)),0n).toString()
  const restored=(await db.query(`select round(coalesce(sum(amount),0)*100)::text n from public."${t}"`)).rows[0].n
  if(original!==restored)throw Error('Не совпала денежная сумма '+t);totals[t]=restored
 }
 await db.exec('commit')
 await db.exec(`begin;insert into audit_log(table_name,row_id,action,new_data)values('restore_probe',gen_random_uuid(),'insert','{}');rollback;`)
 console.log(JSON.stringify({restored:true,isolated:true,auditSequenceReady:true,tables:verified.tables,records:verified.records,counts,totalsKopecks:totals,checksum:verified.checksum},null,2))
}catch(e){console.error('Восстановление не подтверждено: '+e.message);process.exitCode=1}
finally{if(db)await db.close()}
