import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { EntitlementProvider } from '@/contexts/EntitlementContext'
import { AICompanionProvider } from '@/contexts/AICompanionContext'
import { AICompanionDrawer } from '@/components/ai/AICompanionDrawer'

export function AppShell() {
  return (
    <EntitlementProvider>
      <AICompanionProvider>
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
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
