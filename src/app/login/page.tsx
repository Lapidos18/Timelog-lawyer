'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Scale } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error('Неверный email или пароль')
    } else {
      router.push('/dashboard')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                          flex items-center justify-center mb-4">
            <Scale className="w-7 h-7 text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold text-navy-100">Тайм-трекер</h1>
          <p className="text-sm text-navy-400 mt-1">Учёт рабочего времени адвоката</p>
        </div>

        <div className="card">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Email</label>
              {/* autoComplete username + current-password — по этой паре связка
                  ключей iCloud и менеджеры паролей предлагают сохранённый вход */}
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
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
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
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-navy-500 mt-5">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-gold-400 hover:text-gold-300">
            Зарегистрировать кабинет
          </Link>
        </p>

        <p className="text-center text-xs text-navy-600 mt-6">
          Адвокатская тайна охраняется ст. 8 ФЗ-63
        </p>
      </div>
    </div>
  )
}
