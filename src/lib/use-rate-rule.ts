'use client'
import {useEffect,useRef,useState} from 'react'
import {createClient} from '@/lib/supabase'
import {readAllRows} from './billing'
import {findRateRule,RateRule} from './rate-rules'
export function useRateRule(matter:string,date:string,activity:string,user:string,editing:boolean,fallback:number|null|undefined,onApply:(rate:number)=>void){
 const [rules,setRules]=useState<RateRule[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false)
 const last=useRef(''),wasRule=useRef(false)
 useEffect(()=>{let active=true;readAllRows<RateRule>(createClient(),'rate_rules').then(r=>{if(active){setRules(r);setReady(true)}}).catch(()=>active&&setError('Не удалось проверить правила ставок. Обновите страницу перед новой записью.'));return()=>{active=false}},[])
 const rule=findRateRule(rules,matter,date,activity,user)
 useEffect(()=>{
  if(editing){last.current='';wasRule.current=false;return}
  const key=[matter,date,activity,user,rule?.id,rule?.hourly_rate,ready].join('|')
  if(!ready||last.current===key)return
  last.current=key
  if(rule){onApply(Number(rule.hourly_rate));wasRule.current=true}
  else if(wasRule.current){onApply(Number(fallback??0));wasRule.current=false}
 // onApply меняется при рендере; применение запускает только смена условий.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[matter,date,activity,user,editing,rule?.id,rule?.hourly_rate,ready])
 return {rule,error,ready}
}
