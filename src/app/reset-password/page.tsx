'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Scale, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Установка нового пароля по ссылке из письма.
 *
 * Ссылка приходит в одном из двух видов, и поддерживаются оба:
 *
 *  • ?token_hash=…&type=recovery — работает на ЛЮБОМ устройстве. Для этого
 *    в Supabase нужно поправить шаблон письма (см. инструкцию). Запросили
 *    сброс на компьютере, открыли письмо на телефоне — всё сработает.
 *
 *  • ?code=… — вид по умолчанию. Здесь Supabase использует защищённый поток
 *    PKCE: секрет для обмена кода остаётся в браузере, где сброс запросили.
 *    Открыть такую ссылку можно только в том же браузере — на другом
 *    устройстве обмен не пройдёт, и об этом надо сказать прямо, а не
 *    выдать непонятную ошибку.
 *
 * Параметры читаются из window.location, а не через useSearchParams:
 * тому в Next 15 нужна обёртка Suspense, без неё падает сборка.
 */

type Stage = 'checking' | 'ready' | 'failed' | 'saving'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('checking')
  const [failure, setFailure] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')

  useEffect(() => {
    async function verify() {
      const q = new URLSearchParams(window.location.search)
      const tokenHash = q.get('token_hash')
      const code = q.get('code')
      const urlError = q.get('error_description')

      if (urlError) {
        setFailure(/expired/i.test(urlError)
          ? 'Ссылка устарела — она действует один час. Запросите новую.'
          : 'Ссылка недействительна. Запросите новую.')
        setStage('failed'); return
      }

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
        if (error) {
          setFailure('Ссылка устарела или уже была использована. Запросите новую.')
          setStage('failed'); return
        }
        setStage('ready'); return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setFailure(/verifier/i.test(error.message)
            ? 'Эту ссылку нужно открыть в том же браузере, в котором вы запрашивали сброс. ' +
              'Откройте письмо там — или запросите новую ссылку прямо с этого устройства.'
            : 'Ссылка устарела или уже была использована. Запросите новую.')
          setStage('failed'); return
        }
        setStage('ready'); return
      }

      setFailure('Ссылка неполная. Откройте её из письма целиком или запросите новую.')
      setStage('failed')
    }
    verify()
  }, [supabase])

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = repeat.length > 0 && password !== repeat

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { toast.error('Пароль — не короче 8 символов'); return }
    if (password !== repeat) { toast.error('Пароли не совпадают'); return }
    setStage('saving')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(/same|different/i.test(error.message)
        ? 'Новый пароль совпадает со старым — придумайте другой'
        : 'Не удалось сохранить пароль: ' + error.message)
      setStage('ready'); return
    }
    toast.success('Пароль изменён')
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                          flex items-center justify-center mb-4">
            <Scale className="w-7 h-7 text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold text-navy-100">Новый пароль</h1>
        </div>

        <div className="card">
          {stage === 'checking' && (
            <p className="text-sm text-navy-300 text-center py-4">Проверяю ссылку...</p>
          )}

          {stage === 'failed' && (
            <div className="text-center">
              <p className="text-sm text-navy-200 mb-4">{failure}</p>
              <Link href="/forgot-password" className="btn-primary inline-flex justify-center">
                Запросить новую ссылку
              </Link>
            </div>
          )}

          {(stage === 'ready' || stage === 'saving') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label" htmlFor="new-password">Новый пароль</label>
                {/* new-password — менеджер паролей и связка ключей iCloud
                    предложат сгенерировать надёжный пароль и сами его запомнят */}
                <input id="new-password" type="password" autoComplete="new-password"
                  className="input" required minLength={8} value={password}
                  onChange={e => setPassword(e.target.value)} />
                <p className={`text-xs mt-1 ${tooShort ? 'text-amber-400' : 'text-navy-400'}`}>
                  Не короче 8 символов
                </p>
              </div>
              <div>
                <label className="label" htmlFor="repeat-password">Повторите пароль</label>
                <input id="repeat-password" type="password" autoComplete="new-password"
                  className="input" required value={repeat}
                  onChange={e => setRepeat(e.target.value)} />
                {mismatch && <p className="text-xs text-amber-400 mt-1">Пароли не совпадают</p>}
              </div>
              <button type="submit" disabled={stage === 'saving'}
                className="btn-primary w-full justify-center">
                <KeyRound className="w-4 h-4" />
                {stage === 'saving' ? 'Сохраняю...' : 'Сохранить пароль'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm mt-6">
          <Link href="/login" className="tap inline-flex items-center text-gold-400 hover:underline">← Ко входу</Link>
        </p>
      </div>
    </div>
  )
}
