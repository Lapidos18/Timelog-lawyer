import {describe,it,expect} from 'vitest'
import {buildActDoc,ActDocInput} from './act-doc'
import {actBodyHtml,actCss,buildActWord} from './act-print'
import JSZip from 'jszip'

const base=():ActDocInput=>({cabinet:{fullName:'Адвокатский кабинет Тестова Теста Тестовича',regNo:'00/000',certNo:'0',inn:'000000000000',signerShort:'Т.Т. Тестов',city:'г. Тест'},
client:{name:'ООО «Пример»',type:'legal_entity',signer_short:'И.И. Иванов'},
matter:{title:'Консультирование',agreement_no:'1/26',agreement_date:'2026-01-01',task_no:'1',task_date:'2026-01-01'},
periodFrom:'2026-10-01',periodTo:'2026-10-31',rows:[{hours:2,hourly_rate:1000,amount:2000,performed_by:'Тестов'}]})

describe('формы актов по образцам',()=>{
 it('нумерует пункты, выделяет названия и сумму; не дублирует условия другого задания',()=>{
  const doc=buildActDoc(base()),paras=doc.blocks.filter(b=>b.kind==='para')
  expect(paras.filter(b=>b.number).map(b=>b.number)).toEqual([1,2,3,4,5])
  expect(paras.find(b=>b.text.startsWith('За оказанные'))?.text).toContain('Заданием № 1 от 01.01.2026')
  expect(actBodyHtml(doc)).toContain('<strong>Адвокатский кабинет Тестова Теста Тестовича</strong>')
  expect(actBodyHtml(doc)).toContain('a-signature')
 })
 it('абонентский акт использует договор и его пункты без фиктивной таблицы часов',()=>{
  const input=base();input.rows=[{source_kind:'subscription',hours:0,hourly_rate:0,amount:20000,performed_by:''}]
  input.matter.act_document_options={agreement_kind:'contract',service_clause:'п. 1.2.',fee_clause:'п. 3.1.'}
  const doc=buildActDoc(input),text=doc.blocks.filter(b=>b.kind==='para'||b.kind==='title').map(b=>b.text).join('\n')
  expect(doc.layout).toBe('subscription');expect(doc.blocks.some(b=>b.kind==='table')).toBe(false)
  expect(text).toContain('к договору');expect(text).toContain('п. 1.2. Договора');expect(text).toContain('п. 3.1. Договора')
  expect(text).not.toContain('трудозатрат');expect(text).toContain('НДС не облагается')
  expect(actCss(doc)).toContain('Calibri');expect(doc.total).toBe(20000)
 })
 it('фиксированная сумма не превращается в нулевые часы',()=>{
  const input=base();input.rows=[{source_kind:'accrual',hours:0,hourly_rate:0,amount:7000,performed_by:''}]
  const doc=buildActDoc(input);expect(doc.layout).toBe('fixed');expect(doc.blocks.some(b=>b.kind==='table')).toBe(false)
  expect(doc.total).toBe(7000)
 })
 it('при корректировке сохраняет итог и отдельное возмещение',()=>{
  const input=base();input.rows.push({source_kind:'reduction',hours:0,hourly_rate:0,amount:-294.25,performed_by:'',description:'Уменьшение стоимости'})
  input.expensesAmount=387.34
  const doc=buildActDoc(input);expect(doc.total).toBe(1705.75)
  expect(doc.blocks.filter(b=>b.kind==='table')).toHaveLength(2)
  expect(doc.blocks.some(b=>b.kind==='para'&&b.text.includes('возмещает'))).toBe(true)
 })
 it('выводит сохранённый текст стороны и реквизиты физлица, экранируя HTML',()=>{
  const input=base();input.client={name:'Тестова Анна Ивановна',type:'individual',act_party_text:'Гражданка РФ <Тестова>, именуемая далее «Доверитель», с другой стороны,',act_requisites:'Тестова Анна Ивановна\nСведения документа: тестовый образец'}
  const html=actBodyHtml(buildActDoc(input));expect(html).toContain('&lt;Тестова&gt;');expect(html).not.toContain('именуемый(ая)')
  expect(html).toContain('Сведения документа: тестовый образец')
 })
 it('Word сохраняет нумерацию, серую шапку, два ряда подписей и выбранный шрифт',async()=>{
  const hourly=buildActDoc(base()),zip=await JSZip.loadAsync(await (await buildActWord(hourly)).arrayBuffer())
  const xml=await zip.file('word/document.xml')!.async('string')
  expect(xml).toContain('EAEAEA');expect(xml).toContain('Times New Roman');expect(xml).toContain('1.')
  const input=base();input.rows=[{source_kind:'subscription',hours:0,hourly_rate:0,amount:20000,performed_by:''}]
  const sub=await JSZip.loadAsync(await (await buildActWord(buildActDoc(input))).arrayBuffer())
  expect(await sub.file('word/document.xml')!.async('string')).toContain('Calibri')
 })
})
