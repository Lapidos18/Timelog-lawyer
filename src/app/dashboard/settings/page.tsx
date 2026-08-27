'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Org, Profile } from '@/types'
import { initialsSignature } from '@/lib/org'
import { Building2, User, Save, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import LoadError from '@/components/LoadError'

/**
 * Реквизиты кабинета и личный профиль.
 *
 * Раньше наименование адвоката, регистрационный номер и ИНН были зашиты прямо
 * в шаблоны акта и акта сверки. Теперь они берутся отсюда — иначе у второго
 * адвоката документы печатались бы с чужими реквизитами.
 */
export default function SettingsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingOrg, setSavingOrg] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [org, setOrg] = useState<Org | null>(null)
  const [orgForm, setOrgForm] = useState({
    name: '', full_name: '', advocate_name: '', signature_name: '',
    reg_no: '', inn: '', address: '', phone: '', email: '',
  })

  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileForm, setProfileForm] = useState({ full_name: '', hourly_rate: '' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setLoadError(false)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [orgRes, profileRes] = await Promise.all([
      supabase.from('orgs').select('*').limit(1).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', user.id).single(),
    ])

    if (orgRes.error || profileRes.error) {
      setLoadError(true)
      setLoading(false)
      return
    }

    const o = orgRes.data as Org | null
    if (o) {
      setOrg(o)
      setOrgForm({
        name: o.name ?? '',
        full_name: o.full_name ?? '',
        advocate_name: o.advocate_name ?? '',
        signature_name: o.signature_name ?? '',
        reg_no: o.reg_no ?? '',
        inn: o.inn ?? '',
        address: o.address ?? '',
        phone: o.phone ?? '',
        email: o.email ?? '',
      })
    }

    const p = profileRes.data as Profile
    setProfile(p)
    setProfileForm({
      full_name: p.full_name ?? '',
      hourly_rate: p.hourly_rate != null ? String(p.hourly_rate) : '',
    })

    setLoading(false)
  }

  async function saveOrg() {
    if (!org) return
    if (!orgForm.name.trim()) { toast.error('Укажите краткое наименование кабинета'); return }
    setSavingOrg(true)
    const { error } = await supabase.from('orgs').update({
      name: orgForm.name.trim(),
      full_name: orgForm.full_name.trim() || null,
      advocate_name: orgForm.advocate_name.trim() || null,
      signature_name: orgForm.signature_name.trim() || null,
      reg_no: orgForm.reg_no.trim() || null,
      inn: orgForm.inn.trim() || null,
      address: orgForm.address.trim() || null,
      phone: orgForm.phone.trim() || null,
      email: orgForm.email.trim() || null,
    }).eq('id', org.id)
    setSavingOrg(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Реквизиты сохранены')
    loadAll()
  }

  async function saveProfile() {
    if (!profile) return
    if (!profileForm.full_name.trim()) { toast.error('Укажите ФИО'); return }
    const rate = profileForm.hourly_rate.trim() === ''
      ? null
      : parseFloat(profileForm.hourly_rate)
    if (rate !== null && (isNaN(rate) || rate < 0)) { toast.error('Ставка указана неверно'); return }

    setSavingProfile(true)
    const { error } = await supabase.from('profiles').update({
      full_name: profileForm.full_name.trim(),
      hourly_rate: rate,
    }).eq('id', profile.id)
    setSavingProfile(false)
    if (error) { toast.error('Ошибка: ' + error.message); return }
    toast.success('Профиль сохранён')
    loadAll()
  }

  function suggestSignature() {
    const base = orgForm.advocate_name.trim() || profileForm.full_name.trim()
    if (!base) { toast.error('Сначала укажите ФИО адвоката'); return }
    setOrgForm(f => ({ ...f, signature_name: initialsSignature(base) }))
  }

  if (loading) {
    return <div className="p-4 md:p-7 text-navy-500 text-sm">Загрузка…</div>
  }
  if (loadError) {
    return <div className="p-4 md:p-7"><LoadError onRetry={loadAll} /></div>
  }

  return (
    <div className="p-4 md:p-7 max-w-3xl">
      <h1 className="text-xl font-semibold text-navy-100 mb-1">Настройки</h1>
      <p className="text-sm text-navy-500 mb-6">
        Реквизиты подставляются в акт об оказании юридической помощи и акт сверки
      </p>

      {/* ── Кабинет ── */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-4 h-4 text-gold-400" />
          <h2 className="text-sm font-semibold text-navy-200">Адвокатский кабинет</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="label">Краткое наименование (в меню)</label>
            <input className="input" placeholder="АК Иванов И.И."
              value={orgForm.name}
              onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="md:col-span-2">
            <label className="label">Полное наименование (в шапке документов)</label>
            <input className="input" placeholder="Адвокатский кабинет Иванова Ивана Ивановича"
              value={orgForm.full_name}
              onChange={e => setOrgForm(f => ({ ...f, full_name: e.target.value }))} />
            <p className="text-xs text-navy-600 mt-1.5">
              Пишется в родительном падеже — так, как в свидетельстве
            </p>
          </div>

          <div>
            <label className="label">ФИО адвоката</label>
            <input className="input" placeholder="Иванов Иван Иванович"
              value={orgForm.advocate_name}
              onChange={e => setOrgForm(f => ({ ...f, advocate_name: e.target.value }))} />
          </div>

          <div>
            <label className="label">Подпись в документе</label>
            <div className="flex gap-2">
              <input className="input" placeholder="И.И. Иванов"
                value={orgForm.signature_name}
                onChange={e => setOrgForm(f => ({ ...f, signature_name: e.target.value }))} />
              <button type="button" onClick={suggestSignature}
                title="Собрать из ФИО"
                className="btn-secondary flex-shrink-0 px-3">
                <Wand2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="label">Рег. № в реестре адвокатов</label>
            <input className="input" placeholder="77/1234"
              value={orgForm.reg_no}
              onChange={e => setOrgForm(f => ({ ...f, reg_no: e.target.value }))} />
          </div>

          <div>
            <label className="label">ИНН</label>
            <input className="input" inputMode="numeric" placeholder="770123456789"
              value={orgForm.inn}
              onChange={e => setOrgForm(f => ({ ...f, inn: e.target.value }))} />
          </div>

          <div className="md:col-span-2">
            <label className="label">Адрес кабинета</label>
            <input className="input"
              value={orgForm.address}
              onChange={e => setOrgForm(f => ({ ...f, address: e.target.value }))} />
          </div>

          <div>
            <label className="label">Телефон</label>
            <input className="input" type="tel" inputMode="tel"
              value={orgForm.phone}
              onChange={e => setOrgForm(f => ({ ...f, phone: e.target.value }))} />
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoCapitalize="none" spellCheck={false}
              value={orgForm.email}
              onChange={e => setOrgForm(f => ({ ...f, email: e.target.value }))} />
          </div>
        </div>

        <button onClick={saveOrg} disabled={savingOrg} className="btn-primary mt-5">
          <Save className="w-4 h-4" />
          {savingOrg ? 'Сохраняем…' : 'Сохранить реквизиты'}
        </button>
      </div>

      {/* ── Профиль ── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-5">
          <User className="w-4 h-4 text-gold-400" />
          <h2 className="text-sm font-semibold text-navy-200">Мой профиль</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">ФИО</label>
            <input className="input"
              value={profileForm.full_name}
              onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Ставка по умолчанию, ₽/час</label>
            <input className="input" inputMode="decimal" placeholder="5000"
              value={profileForm.hourly_rate}
              onChange={e => setProfileForm(f => ({ ...f, hourly_rate: e.target.value }))} />
          </div>
        </div>

        <p className="text-xs text-navy-600 mt-3">
          Роль: {profile?.role === 'advocate' ? 'адвокат' : 'помощник'}.
          В отчётах и актах для доверителя вместо ФИО всегда печатается «Адвокат».
        </p>

        <button onClick={saveProfile} disabled={savingProfile} className="btn-primary mt-5">
          <Save className="w-4 h-4" />
          {savingProfile ? 'Сохраняем…' : 'Сохранить профиль'}
        </button>
      </div>
    </div>
  )
}
