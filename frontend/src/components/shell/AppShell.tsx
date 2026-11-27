import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { EntitlementProvider } from '@/contexts/EntitlementContext'
import { AICompanionProvider } from '@/contexts/AICompanionContext'
import { AICompanionDrawer } from '@/components/ai/AICompanionDrawer'
import { useNarrowViewport } from '@/hooks/useNarrowViewport'

export function AppShell() {
  const narrow = useNarrowViewport()
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setNavOpen(false) }, [pathname, narrow])      // a drawer never outlives the page it opened from

  return (
    <EntitlementProvider>
      <AICompanionProvider>
        <div className="flex h-screen w-full overflow-hidden bg-[#0d0d0d] text-[#f5e8ce] sg-gold-shell [--background:0_0%_5%] [--foreground:40_55%_90%] [--card:36_18%_10%] [--card-foreground:40_55%_90%] [--muted:36_12%_15%] [--muted-foreground:40_20%_72%] [--border:38_38%_28%] [--input:38_38%_28%] [--primary:40_70%_65%] [--primary-foreground:36_30%_8%] [--ring:40_70%_65%]">
          <Sidebar narrow={narrow} open={navOpen} onClose={() => setNavOpen(false)} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar showMenuButton={narrow} onOpenMenu={() => setNavOpen(true)} />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-5 sm:p-8">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
        <AICompanionDrawer />
      </AICompanionProvider>
    </EntitlementProvider>
  )
}
