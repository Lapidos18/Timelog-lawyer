import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const state=vi.hoisted(()=>({events:[] as any[],jobs:[] as any[],calls:[] as string[],validUser:false,settings:{} as any}))
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
 auth:{getUser:async()=>({data:{user:state.validUser?{id:'qa'}:null},error:null})},
 from:(table:string)=>{let range=[0,499];const q:any=new Proxy({},{get:(_,key)=>{
  if(key==='then')return (resolve:any)=>Promise.resolve({data:(table==='court_events'?state.events:state.jobs).slice(range[0],range[1]+1),count:(table==='court_events'?state.events:state.jobs).length,error:null}).then(resolve)
  if(key==='single')return async()=>({data:table==='cabinet_settings'?{data:state.settings,revision:0}:{role:'advocate'},error:null})
  if(key==='range')return(a:number,b:number)=>{range=[a,b];return q}
  return()=>q
 }});return q},
 rpc:async(name:string,args:any)=>{state.calls.push(name)
  if(name==='queue_notification'){if(!state.jobs.length)state.jobs=args.p_parts.map((body:string,i:number)=>({id:'job'+i,body,part_no:i+1,status:'pending',attempts:0}));return {data:state.jobs.map(j=>({...j})),error:null}}
  if(name==='claim_notification'){const job=state.jobs.find(j=>j.id===args.p_id);if(!job||!['pending','failed'].includes(job.status))return {data:null,error:null};job.status='sending';job.attempts++;job.lease_id='lease';return {data:{...job},error:null}}
  if(name==='finish_notification'){Object.assign(state.jobs.find(j=>j.id===args.p_id),{status:args.p_status});return {data:true,error:null}}
  return {data:null,error:null}
 }
})}))
import {GET,POST} from '../app/api/notify/route'
import {GET as keepAlive} from '../app/api/keep-alive/route'
beforeEach(()=>{state.events=[{id:'e',title:'Тестовый срок',event_date:'2026-01-01',kind:'deadline',event_time:null,remind_days:7,done:false}];state.jobs=[];state.calls=[];state.validUser=false;state.settings={}
 for(const [k,v] of Object.entries({CRON_SECRET:'QA_CRON',TELEGRAM_BOT_TOKEN:'QA_BOT',TELEGRAM_CHAT_ID:'QA_CHAT',SUPABASE_SERVICE_ROLE_KEY:'QA_KEY',NEXT_PUBLIC_SUPABASE_URL:'https://qa.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'QA_ANON'}))vi.stubEnv(k,v)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({json:async()=>({ok:true,result:{message_id:1}})}))
})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('не отправляет без входа или секрета расписания',async()=>{const r=await GET(new NextRequest('https://qa.invalid/api/notify'));expect(r.status).toBe(401);expect(fetch).not.toHaveBeenCalled();expect(state.calls).toEqual([])})
it('повторный запуск не отправляет подтверждённые части',async()=>{const request=()=>new NextRequest('https://qa.invalid/api/notify',{headers:{authorization:'Bearer QA_CRON'}});expect((await(await GET(request())).json()).status).toBe('sent');expect((await(await GET(request())).json()).status).toBe('sent');expect(fetch).toHaveBeenCalledTimes(1)})
it('потеря ответа остаётся неподтверждённой и не повторяется молча',async()=>{vi.mocked(fetch).mockRejectedValue(Error('network'));const req=()=>new NextRequest('https://qa.invalid/api/notify',{headers:{authorization:'Bearer QA_CRON'}});expect((await(await GET(req())).json()).status).toBe('partial');await GET(req());expect(fetch).toHaveBeenCalledTimes(1);expect(state.jobs[0].status).toBe('uncertain')})
it('при отсутствии событий фиксирует проверку без отправки',async()=>{state.events=[];state.validUser=true;const r=await POST(new NextRequest('https://qa.invalid/api/notify',{method:'POST',headers:{authorization:'Bearer QA_USER'}}));expect((await r.json()).status).toBe('nothing');expect(state.calls).toContain('record_notification_check');expect(fetch).not.toHaveBeenCalled()})
it('дневная проверка повторяет временный отказ Telegram',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce({status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:3600}})} as any)
 const req=()=>new NextRequest('https://qa.invalid/api/notify',{headers:{authorization:'Bearer QA_CRON'}})
 expect((await(await GET(req())).json()).status).toBe('partial')
 await keepAlive(new NextRequest('https://qa.invalid/api/keep-alive',{headers:{authorization:'Bearer QA_CRON'}}))
 expect(fetch).toHaveBeenCalledTimes(2);expect(state.jobs[0].status).toBe('sent')
})
it('публичная проверка работоспособности не запускает отправку',async()=>{
 await keepAlive(new NextRequest('https://qa.invalid/api/keep-alive'))
 expect(fetch).not.toHaveBeenCalled();expect(state.calls).not.toContain('queue_notification')
})
it('выключение в настройках прекращает отправку',async()=>{state.settings={notificationsEnabled:false};const r=await GET(new NextRequest('https://qa.invalid/api/notify',{headers:{authorization:'Bearer QA_CRON'}}));expect((await r.json()).status).toBe('disabled');expect(fetch).not.toHaveBeenCalled()})
it('скрывает доверителя и дело по настройке',async()=>{state.settings={notificationsDetails:false};state.events[0].matters={title:'Тестовое дело',clients:{name:'Тестовый доверитель'}};await GET(new NextRequest('https://qa.invalid/api/notify',{headers:{authorization:'Bearer QA_CRON'}}));const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body);expect(body.text).not.toContain('Тестовый доверитель');expect(body.text).not.toContain('Тестовое дело')})
