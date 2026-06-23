'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Profile } from '@/types'
import {
  LayoutDashboard, Clock, Users, Briefcase,
  FileBarChart2, LogOut, Scale, ChevronRight, BookOpen
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',          icon: LayoutDashboard, label: 'Обзор' },
  { href: '/dashboard/journal',  icon: BookOpen,        label: 'Журнал (день)' },
  { href: '/dashboard/entries',  icon: Clock,           label: 'Все записи' },
  { href: '/dashboard/matters',  icon: Briefcase,       label: 'Дела' },
  { href: '/dashboard/clients',  icon: Users,           label: 'Клиенты' },
  { href: '/dashboard/reports',  icon: FileBarChart2,   label: 'Отчёты' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      supabase.from('profiles').select('*').eq('id', data.user.id).single()
        .then(({ data: p }) => p && setProfile(p))
    })
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-navy-950 border-r border-navy-800
                        flex flex-col py-5 px-3 fixed h-full z-10">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 mb-7">
          <div className="w-8 h-8 rounded-lg bg-gold-500/15 border border-gold-500/30
                          flex items-center justify-center flex-shrink-0">
            <Scale className="w-4 h-4 text-gold-400" />
          </div>
          <span className="text-sm font-semibold text-navy-200 leading-tight">
            АК Бухмин А.А.
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                            transition-colors group ${
                  active
                    ? 'bg-gold-500/10 text-gold-400 font-medium'
                    : 'text-navy-400 hover:text-navy-200 hover:bg-navy-800/60'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
                {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="border-t border-navy-800 pt-4 mt-4 px-1">
          {profile && (
            <div className="px-2 mb-3">
              <p className="text-xs font-medium text-navy-300 truncate">{profile.full_name}</p>
              <p className="text-xs text-navy-600 capitalize">
                {profile.role === 'advocate' ? 'Адвокат' : 'Помощник'}
              </p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs
                       text-navy-500 hover:text-red-400 hover:bg-red-900/10
                       rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Выйти
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-56 min-h-screen">
        {children}
      </main>
    </div>
  )
}
