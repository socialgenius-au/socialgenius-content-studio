import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { EntitlementKey } from '@/types/domain'
import { entitlementService } from '@/services/entitlementService'
import { useClient } from './ClientContext'

interface EntitlementState {
  loading: boolean
  can: (key: EntitlementKey) => boolean
  limit: (key: EntitlementKey) => number | null
}

const EntitlementContext = createContext<EntitlementState | null>(null)

/**
 * Mock entitlement provider (section 55). Components should gate visibility
 * with can()/limit() rather than checking plan names directly, so a later
 * real entitlements backend is a drop-in replacement for entitlementService.
 */
export function EntitlementProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const [map, setMap] = useState<Record<EntitlementKey, { enabled: boolean; limit: number | null }>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client) {
      setMap({})
      setLoading(false)
      return
    }
    setLoading(true)
    entitlementService.forClient(client.servicePlanId).then(m => {
      setMap(m)
      setLoading(false)
    })
  }, [client])

  const can = useCallback((key: EntitlementKey) => map[key]?.enabled ?? true, [map])
  const limit = useCallback((key: EntitlementKey) => map[key]?.limit ?? null, [map])

  return <EntitlementContext.Provider value={{ loading, can, limit }}>{children}</EntitlementContext.Provider>
}

export function useEntitlements(): EntitlementState {
  const ctx = useContext(EntitlementContext)
  if (!ctx) throw new Error('useEntitlements must be used inside EntitlementProvider')
  return ctx
}
