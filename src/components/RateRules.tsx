'use client'
import {useEffect,useState} from 'react'
import {createClient} from '@/lib/supabase'
import {readAllRows,readRub,moneyText} from '@/lib/billing'
import {RateRule} from '@/lib/rate-rules'
import {ACTIVITY_LABELS,Profile} from '@/types'
import toast from 'react-hot-toast'
import {useUnsavedChanges} from '@/lib/unsaved-changes'
export default function RateRules({matterId}:{matterId:string}){
 const db=createClient(),[rules,setRules]=useState<RateRule[]>([]),[profiles,setProfiles]=useState<Profile[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const empty={id:'',activity_type:'',user_id:'',valid_from:new Date().toLocaleDateString('sv-SE'),valid_to:'',hourly_rate:'',reason:''}
 const mayDiscard=()=>JSON.stringify(form)===baseline||confirm('Закрыть изменения правила без сохранения?')
 const [form,setForm]=useState(empty),[baseline,setBaseline]=useState(JSON.stringify(empty))
 useUnsavedChanges(JSON.stringify(form)!==baseline)
 async function load(){try{const [r,p]=await Promise.all([readAllRows<RateRule>(db,'rate_rules','*',q=>q.eq('matter_id',matterId)),readAllRows<Profile>(db,'profiles')]);setRules(r);setProfiles(p);setError('')}catch{setError('Не удалось загрузить правила ставок')}}
 useEffect(()=>{load()},[matterId])
 async function save(){const rate=readRub(form.hourly_rate);if(rate===null||!form.valid_from||!form.reason.trim()){setError('Заполните дату, ставку и основание');return}setBusy(true);const {error}=await db.rpc('save_rate_rule',{p_rule:{...form,matter_id:matterId,hourly_rate:rate/100}});setBusy(false);if(error){setError(error.message);return}setForm(empty);setBaseline(JSON.stringify(empty));toast.success('Правило сохранено. Прежние записи времени не изменены');load()}
 return <section className="mt-5 border-t border-navy-700 pt-4"><h3 className="font-medium">Правила ставок</h3><p className="text-xs text-navy-400 my-2">Итоговая ставка к начислению, включая договорные надбавки. Приоритет: вид работы и исполнитель → вид работы → исполнитель → общее правило. Применяется при новой записи; существующие записи не пересчитываются.</p>
 {error&&<p role="alert" className="text-red-400 text-sm">{error}</p>}
 <div className="space-y-2">{rules.map(r=><div key={r.id} className="rounded border border-navy-700 p-3 text-sm"><p>{r.valid_from} — {r.valid_to||'без окончания'} · {moneyText(Number(r.hourly_rate))} ₽/ч</p><p className="text-xs text-navy-400">{r.activity_type?ACTIVITY_LABELS[r.activity_type as keyof typeof ACTIVITY_LABELS]:'Все виды работ'} · {profiles.find(p=>p.id===r.user_id)?.full_name||'Все исполнители'} · {r.reason}</p><div className="flex flex-wrap gap-2 mt-2"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={()=>{if(!mayDiscard())return;const next={...r,user_id:r.user_id||'',activity_type:r.activity_type||'',valid_to:r.valid_to||'',hourly_rate:String(r.hourly_rate)};setForm(next);setBaseline(JSON.stringify(next))}}>Изменить</button><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={async()=>{if(!confirm('Удалить правило для будущего ввода? Сохранённые записи останутся прежними.'))return;setBusy(true);const {error}=await db.rpc('delete_rate_rule',{p_id:r.id});setBusy(false);if(error)setError(error.message);else load()}}>Удалить</button></div></div>)}</div>
 <div className="grid md:grid-cols-2 gap-3 mt-3">
 <label className="label">Действует с<input type="date" className="input" value={form.valid_from} onChange={e=>setForm({...form,valid_from:e.target.value})}/></label>
 <label className="label">Действует по<input type="date" className="input" value={form.valid_to} onChange={e=>setForm({...form,valid_to:e.target.value})}/></label>
 <label className="label">Вид работы<select className="select" value={form.activity_type} onChange={e=>setForm({...form,activity_type:e.target.value})}><option value="">Все</option>{Object.entries(ACTIVITY_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label className="label">Исполнитель<select className="select" value={form.user_id} onChange={e=>setForm({...form,user_id:e.target.value})}><option value="">Все</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
 <label className="label">Ставка, ₽/ч<input className="input" inputMode="decimal" value={form.hourly_rate} onChange={e=>setForm({...form,hourly_rate:e.target.value})}/></label>
 <label className="label">Основание / пункт соглашения<input className="input" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
 </div><div className="flex gap-2 mt-3"><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={save}>{form.id?'Сохранить правило':'Добавить правило'}</button>{form.id&&<button type="button" className="btn-secondary" onClick={()=>{if(mayDiscard()){setForm(empty);setBaseline(JSON.stringify(empty))}}}>Отмена</button>}</div></section>
}
