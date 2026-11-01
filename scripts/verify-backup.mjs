import { readFileSync } from 'node:fs'
import { verifyBackup } from './backup-format.mjs'
const file=process.argv[2]
if(!file){console.error('Укажите путь к JSON-копии');process.exit(1)}
try{const result=await verifyBackup(JSON.parse(readFileSync(file,'utf8')));console.log(JSON.stringify(result,null,2))}
catch(e){console.error('Проверка не пройдена: '+e.message);process.exitCode=1}
