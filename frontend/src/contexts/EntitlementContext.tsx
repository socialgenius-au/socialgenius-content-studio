import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { EntitlementKey, ServiceEntitlement } from '@/types/domain'
import { servicePlanService } from '@/services/servicePlanService'
import { useClient } from './ClientContext'

interface EntitlementState {
  entitlements: ServiceEntitlement[]
  planName: string
  loading: boolean
  can: (key: EntitlementKey) => boolean
  limit: (key: EntitlementKey) => number | null
  updateEntitlement: (key: string, patch: Partial<ServiceEntitlement>) => void
}

const EntitlementContext = createContext<EntitlementState | null>(null)

/**
 * Single source of truth for a client's service plan (spec §55: capability
 * checks, not scattered plan-name conditionals). Service Configurator writes
 * here via updateEntitlement(); every other module reads via can()/limit(),
 * so a change made in the configurator is visible everywhere immediately —
 * no separate "save" step, matching how Positioning approvals etc. already
 * apply instantly against this mock backend.
 */
export function EntitlementProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const [entitlements, setEntitlements] = useState<ServiceEntitlement[]>([])
  const [planName, setPlanName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client) {
      setEntitlements([])
      setPlanName('')
      setLoading(false)
      return
    }
    setLoading(true)
    servicePlanService.get(client.servicePlanId).then(plan => {
      setEntitlements(plan?.entitlements ?? [])
      setPlanName(plan?.name ?? '')
      setLoading(false)
    })
  }, [client])

  const can = useCallback((key: EntitlementKey) => entitlements.find(e => e.key === key)?.enabled ?? true, [entitlements])
  const limit = useCallback((key: EntitlementKey) => entitlements.find(e => e.key === key)?.usageLimit ?? null, [entitlements])
  const updateEntitlement = useCallback((key: string, patch: Partial<ServiceEntitlement>) => {
    setEntitlements(prev => prev.map(e => (e.key === key ? { ...e, ...patch } : e)))
  }, [])

  return (
    <EntitlementContext.Provider value={{ entitlements, planName, loading, can, limit, updateEntitlement }}>
      {children}
    </EntitlementContext.Provider>
  )
}

export function useEntitlements(): EntitlementState {
  const ctx = useContext(EntitlementContext)
  if (!ctx) throw new Error('useEntitlements must be used inside EntitlementProvider')
  return ctx
}
