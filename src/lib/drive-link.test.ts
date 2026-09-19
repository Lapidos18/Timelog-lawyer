import { describe, it, expect } from 'vitest'
import { isDriveUrl, driveUrlHint } from './drive-link'

describe('ссылка на папку Google Диска', () => {
  it('принимает ссылки на папки и документы', () => {
    expect(isDriveUrl('https://drive.google.com/drive/folders/1tbzzFx6uMNUlQXqLNdlA5i8w6B7H8Dbk')).toBe(true)
    expect(isDriveUrl('https://drive.google.com/drive/u/0/folders/1abc')).toBe(true)
    expect(isDriveUrl('https://docs.google.com/document/d/1abc/edit')).toBe(true)
    expect(isDriveUrl('  https://drive.google.com/drive/folders/1abc  ')).toBe(true)
  })

  // Ссылка попадает в href — всё, что не Google Диск по https, ссылкой быть не должно
  it('не пропускает попытку выполнить код', () => {
    expect(isDriveUrl('javascript:alert(1)')).toBe(false)
  })

  it('не пропускает поддельный домен и Google только в пути', () => {
    expect(isDriveUrl('https://drive.google.com.evil.ru/folders/1')).toBe(false)
    expect(isDriveUrl('https://example.com/drive.google.com/')).toBe(false)
  })

  it('требует https', () => {
    expect(isDriveUrl('http://drive.google.com/drive/folders/1')).toBe(false)
    expect(driveUrlHint('http://drive.google.com/drive/folders/1')).toMatch(/https/)
  })

  it('пустое поле — ни ссылки, ни подсказки', () => {
    expect(isDriveUrl('')).toBe(false)
    expect(isDriveUrl(null)).toBe(false)
    expect(driveUrlHint('')).toBeNull()
  })
})
