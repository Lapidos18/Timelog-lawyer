'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient as createPlainClient } from '@supabase/supabase-js'
import { Scale, MailCheck } from 'lucide-react'

/**
 * Отдельный клиент только для запроса письма.
 *
 * Основной клиент приложения работает по схеме PKCE: секрет для обмена
 * кода из письма остаётся в браузере, где сброс запросили. Письмо,
 * открытое в другом месте — в приложении Gmail на телефоне, на другом
 * компьютере, — не сработает.
 *
 * Обычно это решают правкой шаблона письма, но в бесплатном тарифе
 * Supabase шаблоны без собственного почтового сервера не редактируются.
 * Поэтому запрос отправляется по схеме implicit: Supabase не ждёт
 * секрета и сам возвращает ключ сессии в адресе ссылки. Такая ссылка
 * работает на любом устройстве. Защищена она так же, как и вариант из
 * документации Supabase для открытия с другого устройства: у кого письмо,
 * тот и может задать пароль — поэтому ссылка живёт один час.
 *
 * Сессию этот клиент не хранит и не подхватывает — только отправляет запрос.
 */
function recoveryClient() {
  return createPlainClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
}

/**
 * Запрос ссылки для сброса пароля.
 *
 * Пароль нигде не хранится в читаемом виде — только отпечаток (хеш) в
 * Supabase. Поэтому «напомнить» его нельзя никому, включая владельца базы;
 * можно только задать новый по ссылке из письма.
 *
 * Ответ одинаковый, есть такой адрес в базе или нет. Иначе форма
 * превратилась бы в способ проверять, какие адреса зарегистрированы.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setError('')
    const { error } = await recoveryClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSending(false)
    // Частые запросы Supabase ограничивает — об этом сказать стоит, это не
    // раскрывает ничего о существовании адреса
    if (error && /rate|limit|security purposes/i.test(error.message)) {
      setError('Письма можно запрашивать не чаще раза в минуту. Подождите немного и попробуйте снова.')
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gold-500/10 border border-gold-500/30
                          flex items-center justify-center mb-4">
            <Scale className="w-7 h-7 text-gold-400" />
          </div>
          <h1 className="text-xl font-semibold text-navy-100">Восстановление пароля</h1>
        </div>

        <div className="card">
          {sent ? (
            <div className="text-center">
              <MailCheck className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
              <p className="text-sm text-navy-200 mb-2">Проверьте почту</p>
              <p className="text-sm text-navy-400">
                Если этот адрес зарегистрирован, на него пришло письмо со ссылкой
                для нового пароля. Ссылка действует один час.
              </p>
              <p className="text-xs text-navy-400 mt-4">
                Письма нет через несколько минут — загляните в «Спам».
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-navy-300">
                Укажите адрес, с которым входите. Пришлём ссылку, по которой можно
                задать новый пароль.
              </p>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" type="email" name="username" autoComplete="username"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  className="input" required value={email}
                  onChange={e => setEmail(e.target.value)} />
              </div>
              {error && <p className="text-xs text-amber-400">{error}</p>}
              <button type="submit" disabled={sending} className="btn-primary w-full justify-center">
                {sending ? 'Отправляю...' : 'Прислать ссылку'}
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
