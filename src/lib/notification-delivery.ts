/** Запас к лимиту Telegram; разрезаем по строкам и целым символам Unicode. */
export function notificationParts(text:string,limit=3000):string[]{
 const parts:string[]=[];let current=''
 for(const char of text){if(current.length+char.length>limit){parts.push(current);current=''}current+=char}
 if(current)parts.push(current)
 return parts.length>1?parts.map((p,i)=>`[${i+1}/${parts.length}]\n${p}`):parts
}
export function notificationDay(now=new Date()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Novosibirsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
}
export type TelegramResult={status:'sent'|'failed'|'uncertain';messageId?:number;code?:string;retryAfter?:number}
export async function deliverTelegram(token:string,chat:string,text:string,request:typeof fetch=fetch):Promise<TelegramResult>{
 try{
  const r=await request(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(8000)})
  let body:any;try{body=await r.json()}catch{return {status:'uncertain',code:'invalid_response'}}
  if(body.ok===true&&Number.isSafeInteger(body.result?.message_id))return {status:'sent',messageId:body.result.message_id}
  if(body.ok!==false)return {status:'uncertain',code:'invalid_response'}
  const code=Number(body.error_code||r.status)
  return {status:'failed',code:'telegram_'+code,retryAfter:code===429?Math.min(604800,Math.max(1,Number(body.parameters?.retry_after)||1)):code>=500?1:undefined}
 }catch{return {status:'uncertain',code:'network_result_unknown'}}
}
