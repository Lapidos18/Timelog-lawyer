import {it,expect} from 'vitest'
import {blobBase64,base64Word} from './document-files'
it('сохранённый файл возвращается без изменения байтов',async()=>{
 const bytes=Uint8Array.from([80,75,3,4,0,255,128,13,10])
 const saved=await blobBase64(new Blob([bytes]))
 expect(new Uint8Array(await base64Word(saved).arrayBuffer())).toEqual(bytes)
})
