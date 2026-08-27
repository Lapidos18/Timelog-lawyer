'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Scale } from 'lucide-react'

/**
 * Регистрация нового адвоката.
 *
 * Кабинет создаётся не здесь, а триггером в базе (handle_new_user): так
 * пользователь физически не может оказаться без кабинета или попасть в чужой.
 * ФИО передаётся в метаданных — из него собирается наименование кабинета,
 * которое потом правится в «Настройках».
 */
export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [needConfirm, setNeedConfirm] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (fullName.trim().length < 3) {
      toast.error('Укажите ФИО полностью')
      return
    }
    if (password.length < 8) {
      toast.error('Пароль должен быть не короче 8 символов')
      return
    }
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    })

    setLoading(false)

    if (error) {
      // Сообщения Supabase приходят по-английски — переводим частые случаи
      const msg = /already registered/i.test(error.message)
        ? 'Такой адрес уже зарегистрирован'
        : /password/i.test(error.message)
          ? 'Пароль слишком простой'
          : 'Не удалось зарегистрироваться: ' + error.message
      toast.error(msg)
      return
    }

    // Если в проекте включено подтверждение адреса, сессии в ответе не будет —
    // сначала письмо, вход потом.
    if (!data.session) {
      setNeedConfirm(true)
      return
    }

    toast.success('Кабинет создан')
    router.push('/dashboard')
    router.refresh()
  }

  if (needConfirm) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                          flex items-center justify-center mb-4 mx-auto">
            <Scale className="w-7 h-7 text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold text-navy-100 mb-2">Проверьте почту</h1>
          <p className="text-sm text-navy-400 mb-6">
            На {email} отправлено письмо со ссылкой для подтверждения адреса.
            После подтверждения войдите обычным способом.
          </p>
          <Link href="/login" className="btn-primary w-full justify-center">Перейти ко входу</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                          flex items-center justify-center mb-4">
            <Scale className="w-7 h-7 text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold text-navy-100">Регистрация кабинета</h1>
          <p className="text-sm text-navy-400 mt-1 text-center">
            Отдельное рабочее пространство: ваши доверители, дела и записи
            видны только вам
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="label">ФИО адвоката</label>
              <input
                type="text"
                name="name"
                autoComplete="name"
                className="input"
                placeholder="Иванов Иван Иванович"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Пароль</label>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                className="input"
                placeholder="не короче 8 символов"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center mt-2"
            >
              {loading ? 'Создаём кабинет...' : 'Зарегистрироваться'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-navy-500 mt-5">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-gold-400 hover:text-gold-300">Войти</Link>
        </p>
        <p className="text-center text-xs text-navy-600 mt-6">
          Адвокатская тайна охраняется ст. 8 ФЗ-63
        </p>
      </div>
    </div>
  )
}
