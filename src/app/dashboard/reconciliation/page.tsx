'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Client, Matter } from '@/types'
import { ArrowLeftRight, ClipboardList, Wallet } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import LoadError from '@/components/LoadError'
import { SkeletonRows } from '@/components/Skeleton'
import PaymentsView from './PaymentsView'
import SettlementsPanel, { ActDeepLink } from '../settlements/SettlementsPanel'

type View = 'payments' | 'acts'

/**
 * «Платежи и акты сверки» — один раздел вместо двух (CLAUDE.md, п. 19).
 *
 * Раньше «Платежи / Акт сверки» и «Акты взаимных расчётов» были отдельными
 * страницами, хотя акт строится из платежей: приходилось ходить туда-сюда.
 * Теперь вид «Платежи» — ввод поступлений, выписка и список всего, что пришло;
 * вид «Акты сверки» — акты в двусторонней форме «как в 1С». Прежний односторонний
 * акт (PDF/Excel) убран: его заменил акт взаимных расчётов.
 *
 * Адрес: ?view=acts — сразу акты; ?new=1 — сразу форма нового поступления
 * (по этой ссылке «Внести поступление» из «Доходов и налогов»).
 */
function ReconciliationInner() {
  const supabase = createClient()
  const params = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [matters, setMatters] = useState<(Matter & { clients: Client })[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [view, setView] = useState<View>('payments')
  // Акты не грузим, пока в них не заходили; зашли — держим смонтированными,
  // чтобы фильтры «Платежей» не сбрасывались при возврате
  const [actsOpened, setActsOpened] = useState(false)
  /** Растёт на единицу каждый раз, когда нужно открыть форму поступления */
  const [formSignal, setFormSignal] = useState(0)
  const [deepLink, setDeepLink] = useState<ActDeepLink | null>(null)

  async function load() {
    setLoadError(false)
    const [c, m] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('matters').select('*, clients(*)').order('title'),
    ])
    if (c.error || m.error) { setLoadError(true); return }
    setClients((c.data ?? []) as Client[])
    setMatters((m.data ?? []) as (Matter & { clients: Client })[])
    setReady(true)
  }
  useEffect(() => { load() }, [])

  // Адрес → вид. Срабатывает и при заходе по ссылке, и при переходе со своей же
  // страницы (Ctrl+K), когда сама страница не перезагружается
  useEffect(() => {
    const wantsActs = params.get('view') === 'acts'
    setView(wantsActs ? 'acts' : 'payments')
    if (wantsActs) setActsOpened(true)
    if (params.get('new') === '1') {
      setView('payments')
      setFormSignal(n => n + 1)
      // Чтобы обновление страницы не открывало форму снова
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [params])

  function switchTo(v: View) {
    setView(v)
    if (v === 'acts') setActsOpened(true)
    window.history.replaceState(null, '', v === 'acts' ? '?view=acts' : window.location.pathname)
  }

  function makeAct(clientId: string, from: string, to: string) {
    setDeepLink({ clientId, from, to })
    switchTo('acts')
  }

  const tab = (v: View, label: string, icon: React.ReactNode) => (
    <button type="button" onClick={() => switchTo(v)} aria-pressed={view === v}
      className={`tap flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        view === v ? 'bg-gold-500 text-navy-950' : 'text-navy-400 hover:text-navy-200'
      }`}>
      {icon} {label}
    </button>
  )
  const switcher = (
    <div className="flex gap-1 bg-navy-900 border border-navy-800 rounded-lg p-1">
      {tab('payments', 'Платежи', <Wallet className="w-3.5 h-3.5" />)}
      {tab('acts', 'Акты сверки', <ArrowLeftRight className="w-3.5 h-3.5" />)}
    </div>
  )

  if (loadError) {
    return (
      <div className="p-4 md:p-7">
        <PageHeader title="Платежи и акты сверки" icon={ClipboardList} />
        <LoadError onRetry={load} />
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="p-4 md:p-7">
        <PageHeader title="Платежи и акты сверки" icon={ClipboardList} />
        <div className="card"><SkeletonRows rows={4} /></div>
      </div>
    )
  }

  return (
    <>
      <div className={view === 'payments' ? '' : 'hidden'}>
        <PaymentsView clients={clients} matters={matters} switcher={switcher}
          openFormSignal={formSignal} onMakeAct={makeAct} />
      </div>
      {actsOpened && (
        <div className={view === 'acts' ? '' : 'hidden'}>
          <SettlementsPanel clients={clients} switcher={switcher}
            deepLink={deepLink} onDeepLinkDone={() => setDeepLink(null)} />
        </div>
      )}
    </>
  )
}

export default function ReconciliationPage() {
  // useSearchParams на заранее собранной странице требует Suspense
  return (
    <Suspense fallback={
      <div className="p-4 md:p-7">
        <PageHeader title="Платежи и акты сверки" icon={ClipboardList} />
        <div className="card"><SkeletonRows rows={4} /></div>
      </div>
    }>
      <ReconciliationInner />
    </Suspense>
  )
}
