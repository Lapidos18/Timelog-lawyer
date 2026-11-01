/** Храним выпущенный Word как точные байты, без повторной генерации шаблоном. */
export async function blobBase64(blob: Blob): Promise<string> {
 const bytes=new Uint8Array(await blob.arrayBuffer())
 let text=''
 for(let start=0;start<bytes.length;start+=8192)text+=String.fromCharCode(...Array.from(bytes.subarray(start,start+8192)))
 return btoa(text)
}
export function base64Word(value: string): Blob {
 const text=atob(value),bytes=Uint8Array.from(text,c=>c.charCodeAt(0))
 return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
}
export function downloadWord(value: string,name: string) {
 const url=URL.createObjectURL(base64Word(value)),a=document.createElement('a')
 a.href=url;a.download=name+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
