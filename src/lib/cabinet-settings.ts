import {CABINET} from './print'
export interface CabinetSettings {
 fullName:string;regNo:string;certNo:string;inn:string;signerShort:string;city:string;registryRegion:string;shortName:string;bankDetails:string;
 reportIntro:string;reportClosing:string;actNote:string;settlementName:string;
 notificationsEnabled:boolean;notificationsDetails:boolean;defaultRemindDays:number;
}
export const DEFAULT_SETTINGS:CabinetSettings={...CABINET,registryRegion:'Новосибирской области',shortName:'АК Бухмин А.А.',settlementName:'АК Бухмина А.А.',bankDetails:'',reportIntro:'',reportClosing:'',actNote:'',notificationsEnabled:true,notificationsDetails:true,defaultRemindDays:7}
export const settingLabels:Record<keyof CabinetSettings,string>={fullName:'Полное наименование кабинета',regNo:'Регистрационный номер адвоката',certNo:'Номер удостоверения',inn:'ИНН',signerShort:'Подпись: инициалы и фамилия',city:'Город',registryRegion:'Регион реестра адвокатов',settlementName:'Название в акте сверки (после «в пользу»)',shortName:'Краткое название кабинета',bankDetails:'Банковские и дополнительные реквизиты',reportIntro:'Вводный текст отчёта',reportClosing:'Заключительный текст отчёта',actNote:'Стандартное примечание к новому акту',notificationsEnabled:'Напоминания в Telegram',notificationsDetails:'Указывать доверителя и дело в сообщениях',defaultRemindDays:'За сколько дней напоминать о новом событии'}
export function normalizeSettings(data:unknown):CabinetSettings{
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Некорректный ответ настроек')
 const result={...DEFAULT_SETTINGS}
 for(const key of Object.keys(DEFAULT_SETTINGS) as (keyof CabinetSettings)[]){
  const v=(data as Record<string,unknown>)[key]
  if(v===undefined)continue
  if(typeof v!==typeof DEFAULT_SETTINGS[key])throw Error('Некорректная настройка: '+settingLabels[key])
  ;(result as any)[key]=v
 }
 return result
}
export function settingsError(s:CabinetSettings):string|null{
 for(const key of ['fullName','regNo','certNo','inn','signerShort','city','registryRegion','shortName','settlementName'] as const)if(!s[key].trim())return 'Заполните поле «'+settingLabels[key]+'»'
 if(!Number.isInteger(s.defaultRemindDays)||s.defaultRemindDays<0||s.defaultRemindDays>365)return 'Срок напоминания: целое число от 0 до 365'
 for(const key of Object.keys(s) as (keyof CabinetSettings)[])if(typeof s[key]==='string'&&(s[key] as string).length>4000)return 'Слишком длинное поле «'+settingLabels[key]+'»'
 const allowed=['доверитель','дело','период']
 for(const key of ['reportIntro','reportClosing','actNote'] as const)for(const m of Array.from(s[key].matchAll(/\{\{([^{}]+)\}\}/g)))if(!allowed.includes(m[1]))return 'Неизвестное поле шаблона: '+m[0]
 return null
}
export async function readSettings(client:any):Promise<{settings:CabinetSettings;revision:number}>{
 const {data,error}=await client.from('cabinet_settings').select('data,revision').eq('id',1).single()
 if(error)throw Error('Не удалось загрузить настройки кабинета')
 if(!data||Array.isArray(data))throw Error('Настройки кабинета не найдены')
 return {settings:normalizeSettings(data.data),revision:Number(data.revision)}
}
export function cabinetLine(s:CabinetSettings){return `${s.fullName}, рег. № ${s.regNo} в реестре адвокатов ${s.registryRegion}, ИНН ${s.inn}`}
export function templateText(text:string,fields:{client?:string;matter?:string;period?:string}){
 const values:Record<string,string>={доверитель:fields.client||'',дело:fields.matter||'',период:fields.period||''}
 return text.replace(/\{\{(доверитель|дело|период)\}\}/g,(_,key)=>values[key])
}
