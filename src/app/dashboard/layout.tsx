'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Profile } from '@/types'
import {
  LayoutDashboard, Clock, Users, Briefcase,
  FileBarChart2, LogOut, Scale, ChevronRight,
  BookOpen, ClipboardList, Menu, X, FileCheck, HardDrive, Calculator, Wallet
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',                icon: LayoutDashboard, label: 'Обзор' },
  { href: '/dashboard/journal',        icon: BookOpen,        label: 'Журнал' },
  { href: '/dashboard/entries',        icon: Clock,           label: 'Записи' },
  { href: '/dashboard/matters',        icon: Briefcase,       label: 'Дела' },
  { href: '/dashboard/clients',        icon: Users,           label: 'Клиенты' },
  { href: '/dashboard/reports',        icon: FileBarChart2,   label: 'Отчёты' },
  { href: '/dashboard/acts',           icon: FileCheck,       label: 'Акты' },
  { href: '/dashboard/reconciliation', icon: ClipboardList,   label: 'Акт сверки' },
  { href: '/dashboard/finance',         icon: Wallet,          label: 'Доходы и налоги' },
  { href: '/dashboard/ndfl-calc',       icon: Calculator,      label: 'Калькулятор НДФЛ' },
  { href: '/dashboard/backup',          icon: HardDrive,       label: 'Бэкап' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      supabase.from('profiles').select('*').eq('id', data.user.id).single()
        .then(({ data: p }) => p && setProfile(p))
    })
  }, [])

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const NavContent = () => (
    <>
      <div className="flex items-center gap-3 px-3 mb-7">
        <div className="w-8 h-8 rounded-lg bg-gold-500/15 border border-gold-500/30
                        flex items-center justify-center flex-shrink-0">
          <Scale className="w-4 h-4 text-gold-400" />
        </div>
        <span className="text-sm font-semibold text-navy-200 leading-tight">АК Бухмин А.А.</span>
      </div>

      <nav className="flex-1 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                          transition-colors ${
                active
                  ? 'bg-gold-500/10 text-gold-400 font-medium'
                  : 'text-navy-400 hover:text-navy-200 hover:bg-navy-800/60'
              }`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-navy-800 pt-4 mt-4 px-1">
        {profile && (
          <div className="px-2 mb-3">
            <p className="text-xs font-medium text-navy-300 truncate">{profile.full_name}</p>
            <p className="text-xs text-navy-600">
              {profile.role === 'advocate' ? 'Адвокат' : 'Помощник'}
            </p>
          </div>
        )}
        <button onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs
                     text-navy-500 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Выйти
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen bg-navy-950">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-navy-950 border-r border-navy-800
                        flex-col py-5 px-3 fixed h-full z-10">
        <NavContent />
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-navy-950 border-b border-navy-800
                      flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gold-500/15 border border-gold-500/30
                          flex items-center justify-center">
            <Scale className="w-3.5 h-3.5 text-gold-400" />
          </div>
          <span className="text-sm font-semibold text-navy-200">АК Бухмин А.А.</span>
        </div>
        <button onClick={() => setMobileOpen(o => !o)}
          className="p-2 text-navy-400 hover:text-navy-200 hover:bg-navy-800 rounded-lg transition-colors">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ── Mobile slide-in menu ── */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div className="md:hidden fixed inset-0 z-30 bg-black/60"
            onClick={() => setMobileOpen(false)} />
          {/* Drawer */}
          <div className="md:hidden fixed top-0 left-0 bottom-0 z-40 w-64
                          bg-navy-950 border-r border-navy-800 flex flex-col py-5 px-3">
            <NavContent />
          </div>
        </>
      )}

      {/* ── Bottom nav for mobile (quick access) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-20
                      bg-navy-950 border-t border-navy-800 flex">
        {NAV.slice(0, 5).map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5
                          text-xs transition-colors ${
                active ? 'text-gold-400' : 'text-navy-600 hover:text-navy-400'
              }`}>
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{label}</span>
            </Link>
          )
        })}
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 md:ml-56 min-h-screen
                       pt-14 md:pt-0 pb-16 md:pb-0">
        {children}
      </main>
    </div>
  )
}
