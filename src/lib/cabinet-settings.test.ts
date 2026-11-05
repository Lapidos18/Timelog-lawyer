import {it,expect,vi,afterEach} from 'vitest'
import {DEFAULT_SETTINGS,normalizeSettings,settingsError,templateText} from './cabinet-settings'
import {exportToPDF,exportToWord} from './reports'
import {printDocument} from './print'
import JSZip from 'jszip'
vi.mock('dompurify',()=>({default:{sanitize:(html:string)=>html}}))
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks()})
it('сохраняет выключение уведомлений и проверяет поля',()=>{
 expect(normalizeSettings({notificationsEnabled:false}).notificationsEnabled).toBe(false)
 expect(settingsError({...DEFAULT_SETTINGS,defaultRemindDays:1.5})).not.toBeNull()
 expect(settingsError({...DEFAULT_SETTINGS,actNote:'{{несуществующее}}'})).not.toBeNull()
 expect(templateText('Для {{доверитель}} / {{дело}} / {{период}}',{client:'<Тест>',matter:'Дело',period:'Период'})).toBe('Для <Тест> / Дело / Период')
})
it('экранирует номер отчёта, шаблон и реквизиты; не обещает одну страницу',()=>{
 vi.useFakeTimers();let html='';vi.stubGlobal('window',{open:()=>({document:{open(){},write(s:string){html=s},close(){}},focus(){},print(){}})})
 exportToPDF([], 'Отчёт №<img src=x>',undefined,{settings:{...DEFAULT_SETTINGS,fullName:'Кабинет <Тест>',reportIntro:'<script>{{доверитель}}</script>'},clientName:'A&B'})
 expect(html).toContain('Отчёт №&lt;img src=x&gt;');expect(html).toContain('&lt;script&gt;A&amp;B&lt;/script&gt;');expect(html).toContain('Кабинет &lt;Тест&gt;')
 expect(html).not.toContain('<img src=x>');expect(html).not.toContain('Стр. 1 из 1');expect(html).toContain('counter(pages)')
})
it('общая печать экранирует заголовок и изолирует документ без разрешения скриптов',()=>{
 const frame={srcdoc:'',style:{cssText:''},setAttribute:vi.fn(),addEventListener:vi.fn()}
 const popup={opener:{},document:{title:'',createElement:()=>frame,body:{style:{margin:''},appendChild:vi.fn()}}}
 vi.stubGlobal('window',{open:()=>popup})
 printDocument('A & <B>','<p>Текст</p>','</style><script>unsafe()</script>')
 expect(frame.srcdoc).toContain('<title>A &amp; &lt;B&gt;</title>')
 expect(frame.srcdoc).toContain("script-src 'none'")
 expect(frame.srcdoc).not.toContain('</style><script>')
 expect(frame.setAttribute).toHaveBeenCalledWith('sandbox','allow-same-origin allow-modals')
 expect(popup.opener).toBeNull()
})
it('Word использует настоящие поля страниц, повторяемые шапки и текущие реквизиты',async()=>{
 let blob:Blob|undefined;vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b as Blob;return 'blob:qa'});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
 vi.stubGlobal('document',{createElement:()=>({href:'',download:'',click(){},remove(){}}),body:{appendChild(){},removeChild(){}}})
 await exportToWord([], 'Отчёт №Тест',{settings:{...DEFAULT_SETTINGS,fullName:'Кабинет для теста',reportIntro:'Вводная строка\nВторая строка'}})
 expect(blob).toBeDefined();const zip=await JSZip.loadAsync(await blob!.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('string');const footer=await zip.file('word/footer1.xml')!.async('string')
 expect(xml).toContain('Кабинет для теста');expect(xml).toContain('Вторая строка');expect(xml).toContain('w:tblHeader');expect(footer).toContain('PAGE');expect(footer).toContain('NUMPAGES')
})
