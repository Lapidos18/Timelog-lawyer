import { readFileSync,writeFileSync,copyFileSync,mkdirSync,readdirSync,unlinkSync,existsSync,statSync } from 'node:fs'
import { resolve,dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { createBackup,verifyBackup } from './backup-format.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),parsed={}
if(existsSync(join(root,'.env.local')))for(const line of readFileSync(join(root,'.env.local'),'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(m)parsed[m[1]]=m[2].trim().replace(/^["']|["']$/g,'')
}
const env={...parsed,...process.env},backupDir=resolve(env.TIMELOG_BACKUP_DIR||join(root,'../Timelog-backups'))
if(backupDir===root||backupDir.startsWith(root+'\\')||backupDir.startsWith(root+'/'))throw Error('Копии должны храниться вне проекта')
const keep=Number(env.TIMELOG_BACKUP_KEEP||30)
if(!Number.isInteger(keep)||keep<2||keep>365)throw Error('TIMELOG_BACKUP_KEEP: от 2 до 365')
function mirrors(){
 const dirs=(env.TIMELOG_BACKUP_MIRROR||'').split(';').map(s=>s.trim()).filter(Boolean)
 for(const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ')for(const name of ['Мой диск','My Drive']){
  const p=`${letter}:\\${name}`;if(existsSync(p))dirs.push(join(p,'Timelog-backups'))
 }
 for(const p of [join(homedir(),'Google Drive'),join(homedir(),'Мой диск')])if(existsSync(p))dirs.push(join(p,'Timelog-backups'))
 return [...new Set(dirs.map(d=>resolve(d)))].filter(d=>d.toLowerCase()!==backupDir.toLowerCase())
}
function rotate(dir){for(const name of readdirSync(dir).filter(n=>/^timelog_backup_.*\.json$/.test(n)).sort((a,b)=>statSync(join(dir,a)).mtimeMs-statSync(join(dir,b)).mtimeMs).slice(0,-keep))unlinkSync(join(dir,name))}
async function main(){
 if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Не настроен доступ для резервирования')
 const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const id=crypto.randomUUID();await db.from('backup_runs').insert({id,source:'scheduled-local'})
 const finish=async values=>{const {error}=await db.from('backup_runs').update({...values,completed_at:new Date().toISOString()}).eq('id',id);if(error)console.error('Не удалось обновить состояние резервирования: '+error.message)}
 try{
  let snapshot
  for(let attempt=0;attempt<4;attempt++){
   snapshot=await db.rpc('backup_snapshot')
   if(!snapshot.error)break
   if(!/fetch|network|timeout|ECONN|socket/i.test(snapshot.error.message)||attempt===3)throw snapshot.error
   await new Promise(r=>setTimeout(r,1000*(attempt+1)))
  }
  if(snapshot.error)throw snapshot.error
  const payload=await createBackup(snapshot.data,'scheduled-local'),validation=await verifyBackup(payload)
  const name=`timelog_backup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`,file=join(backupDir,name)
  mkdirSync(backupDir,{recursive:true});writeFileSync(file,JSON.stringify(payload,null,2),'utf8')
  if((await verifyBackup(JSON.parse(readFileSync(file,'utf8')))).checksum!==validation.checksum)throw Error('Проверка сохранённой копии не прошла')
  console.log(`Основная копия: ${file}; ${validation.records} записей; SHA-256 ${validation.checksum}`)
  rotate(backupDir)
  let mirrorSuccess=false;const errors=[],destinations=mirrors()
  for(const dir of destinations){try{
   if(dir===root||dir.startsWith(root+'\\')||dir.startsWith(root+'/'))throw Error('Вторая копия должна быть вне проекта')
   mkdirSync(dir,{recursive:true});const target=join(dir,name);copyFileSync(file,target)
   if((await verifyBackup(JSON.parse(readFileSync(target,'utf8')))).checksum!==validation.checksum)throw Error('Контрольная сумма второй копии не совпала')
   mirrorSuccess=true;rotate(dir);console.log('Вторая проверенная копия: '+dir)
  }catch(e){errors.push(e.message)}}
  const message=mirrorSuccess?'Основная и вторая копии проверены':destinations.length?'Основная копия проверена; ошибки второй копии: '+errors.join('; '):'Основная копия проверена. Не задан другой носитель или облачная папка для второй копии.'
  await finish({success:true,mirror_success:mirrorSuccess,record_count:validation.records,checksum:validation.checksum,message})
  console.log(message)
  if(!mirrorSuccess && env.TIMELOG_REQUIRE_MIRROR==='1')process.exitCode=2
 }catch(e){await finish({success:false,message:e.message||String(e)});throw e}
}
main().catch(e=>{console.error('Резервирование не завершено: '+(e.message||String(e)));process.exitCode=1})
