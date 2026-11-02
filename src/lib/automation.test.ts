import {it,expect,vi} from 'vitest'
import {findRateRule,RateRule} from './rate-rules'
import {notificationParts,notificationDay,deliverTelegram} from './notification-delivery'
import {buildActDoc} from './act-doc'
const base:RateRule={id:'1',matter_id:'m',activity_type:null,user_id:null,valid_from:'2026-01-01',valid_to:'2026-06-30',hourly_rate:1000,reason:'Тестовые условия'}
it('выбирает правило по периоду, виду работы и исполнителю',()=>{
 const rules=[base,{...base,id:'2',valid_from:'2026-07-01',valid_to:null,hourly_rate:1200},{...base,id:'3',activity_type:'travel',hourly_rate:1500},{...base,id:'4',activity_type:'travel',user_id:'u',hourly_rate:1700}]
 expect(findRateRule(rules,'m','2026-06-30','travel','u')?.hourly_rate).toBe(1700)
 expect(findRateRule(rules,'m','2026-06-30','travel','v')?.hourly_rate).toBe(1500)
 expect(findRateRule(rules,'m','2026-07-01','travel','u')?.hourly_rate).toBe(1200)
 expect(findRateRule(rules,'other','2026-06-01','travel','u')).toBeUndefined()
})
it('разбивает длинный Unicode-текст без потери символов',()=>{
 const text=('⚖️ Адвокат\n😀'.repeat(1200)),parts=notificationParts(text)
 expect(parts.length).toBeGreaterThan(1);expect(parts.every(p=>p.length<=3500)).toBe(true)
 expect(parts.map(p=>p.replace(/^\[\d+\/\d+\]\n/,'')).join('')).toBe(text)
 for(const p of parts)expect(p.endsWith('\ud83d')).toBe(false)
})
it('дата напоминания учитывает Новосибирск на границе суток',()=>{expect(notificationDay(new Date('2026-11-01T18:00:00Z'))).toBe('2026-11-02')})
it('считает успехом только подтверждение Telegram и безопасно классифицирует повторы',async()=>{
 const sent=await deliverTelegram('secret','chat','test',vi.fn().mockResolvedValue({json:async()=>({ok:true,result:{message_id:12}})}));expect(sent).toEqual({status:'sent',messageId:12})
 const throttled=await deliverTelegram('secret','chat','test',vi.fn().mockResolvedValue({status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:10}})}));expect(throttled).toMatchObject({status:'failed',retryAfter:10})
 const lost=await deliverTelegram('secret','chat','test',vi.fn().mockRejectedValue(Error('https://secret')));expect(lost).toEqual({status:'uncertain',code:'network_result_unknown'});expect(JSON.stringify(lost)).not.toContain('secret')
})
it('акт включает абонплату, фиксированное начисление и уменьшение отдельно от часов и расходов',()=>{
 const input:any={cabinet:{fullName:'Тестовый адвокат',regNo:'0',certNo:'0',city:'Тест'},client:{name:'Тест',type:'legal_entity'},matter:{title:'Задание'},periodFrom:'2026-10-01',periodTo:'2026-10-31',expensesAmount:50,
 rows:[{hours:1,hourly_rate:1000,amount:1000,performed_by:'Тест'},{hours:0,hourly_rate:0,amount:2000,performed_by:'',source_kind:'subscription',description:'Абонплата'},{hours:0,hourly_rate:0,amount:-200,performed_by:'',source_kind:'reduction',description:'Уменьшение'}]}
 const doc=buildActDoc(input);expect(doc.total).toBe(2800)
 const text=JSON.stringify(doc);expect(text).toContain('Абонплата');expect(text).toContain('Уменьшение');expect(text).toContain('расходы');expect(text).not.toContain('0,00 ч')
})
