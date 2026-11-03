'use client'
import {createContext,useContext,useEffect,useState} from 'react'
import {createClient} from '@/lib/supabase'
import {CabinetSettings,DEFAULT_SETTINGS,readSettings,settingLabels,settingsError} from '@/lib/cabinet-settings'
import Modal from './Modal'
import {Settings} from 'lucide-react'
import {createPortal} from 'react-dom'
import {useUnsavedChanges} from '@/lib/unsaved-changes'
import {useEscapeKey} from '@/lib/form-keys'
const Context=createContext({settings:DEFAULT_SETTINGS,ready:true,error:'',revision:0,reload:async()=>{},save:async(_s:CabinetSettings)=>{}})
export function CabinetSettingsProvider({children}:{children:React.ReactNode}){
 const [settings,setSettings]=useState(DEFAULT_SETTINGS),[revision,setRevision]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState('')
 async function reload(){try{const r=await readSettings(createClient());setSettings(r.settings);setRevision(r.revision);setReady(true);setError('')}catch(e){setReady(false);setError(e instanceof Error?e.message:'Не удалось загрузить настройки')}}
 useEffect(()=>{reload()},[])
 async function save(next:CabinetSettings){const issue=settingsError(next);if(issue)throw Error(issue);const {data,error}=await createClient().rpc('save_cabinet_settings',{p_data:next,p_expected_revision:revision});if(error)throw Error(error.message);setSettings(next);setRevision(Number(data));setReady(true);setError('')}
 return <Context.Provider value={{settings,revision,ready,error,reload,save}}>{children}</Context.Provider>
}
export const useCabinetSettings=()=>useContext(Context)
export default function CabinetSettingsButton(){
 const state=useCabinetSettings(),[open,setOpen]=useState(false),[draft,setDraft]=useState(DEFAULT_SETTINGS),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const dirty=JSON.stringify(draft)!==JSON.stringify(state.settings)
 useUnsavedChanges(open&&dirty)
 useEffect(()=>{if(open&&state.ready)setDraft(state.settings)},[open,state.ready])
 function close(){if(busy)return;if(dirty&&!confirm('Закрыть без сохранения настроек?'))return;setOpen(false)}
 useEscapeKey(open,close)
 function field(key:keyof CabinetSettings){return <label key={key} className="label">{settingLabels[key]}<input className="input normal-case" value={String(draft[key])} onChange={e=>{setSaved(false);setDraft({...draft,[key]:e.target.value})}}/></label>}
 return <><button type="button" className="tap flex items-center gap-2 w-full px-2 py-1.5 text-xs text-navy-300 hover:text-navy-100" onClick={()=>{setDraft(state.settings);setError('');setSaved(false);setOpen(true)}}><Settings className="w-3.5 h-3.5"/>Настройки кабинета</button>
 {open&&createPortal(<Modal open={open} onClose={close} title="Настройки кабинета" wide>
 {!state.ready?<div><p role="alert" className="text-red-400">{state.error||'Загружаю настройки…'}</p><button className="btn-secondary" onClick={state.reload}>Повторить загрузку</button></div>:<fieldset disabled={busy} className="min-w-0">
 <h3 className="font-medium mb-3">Реквизиты</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{(['shortName','settlementName','fullName','regNo','certNo','inn','signerShort','city','registryRegion'] as const).map(field)}</div>
 <label className="label mt-3">{settingLabels.bankDetails}<textarea className="input normal-case min-h-24" value={draft.bankDetails} onChange={e=>setDraft({...draft,bankDetails:e.target.value})}/></label>
 <h3 className="font-medium mt-5 mb-2">Стандартные тексты документов</h3><p className="text-xs text-navy-400 mb-3">Обычный текст. Подстановки: {'{{доверитель}}, {{дело}}, {{период}}'}. Реквизиты и тексты используются для новых документов; выпущенные акты сохраняют свою версию.</p>
 {(['reportIntro','reportClosing','actNote'] as const).map(key=><label key={key} className="label mt-3">{settingLabels[key]}<textarea className="input normal-case min-h-24" value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}
 <h3 className="font-medium mt-5 mb-2">Напоминания</h3>
 {(['notificationsEnabled','notificationsDetails'] as const).map(key=><label key={key} className="flex items-center gap-3 min-h-11 text-sm text-navy-200"><input type="checkbox" className="w-5 h-5 accent-gold-500" checked={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>{settingLabels[key]}</label>)}
 <label className="label mt-3">{settingLabels.defaultRemindDays}<input className="input" type="number" min="0" max="365" step="1" value={draft.defaultRemindDays} onChange={e=>setDraft({...draft,defaultRemindDays:Number(e.target.value)})}/></label>
 <p className="text-xs text-navy-400 mt-2">Этот срок подставляется в новые события. У существующих событий сохраняются свои сроки. Плановые проверки — 08:00 и 13:00 по Новосибирску; точное время зависит от расписания сервера.</p>
 {error&&<p role="alert" className="text-red-400 mt-3">{error}</p>}{saved&&!dirty&&<p role="status" className="text-emerald-400 mt-3">Настройки сохранены</p>}
 <div className="flex flex-wrap gap-3 mt-5"><button type="button" className="btn-primary min-h-11" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await state.save(draft);setSaved(true)}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить')}finally{setBusy(false)}}}>{busy?'Сохраняю…':'Сохранить настройки'}</button><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={close}>Закрыть</button></div>
 </fieldset>}
 </Modal>,document.body)}</>
}
