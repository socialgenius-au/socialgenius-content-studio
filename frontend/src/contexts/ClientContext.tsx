import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useNavigate, useLocation, matchPath } from 'react-router-dom'
import type { Client } from '@/types/domain'
import { clientService } from '@/services/clientService'

interface ClientState {
  client: Client | null
  clients: Client[]
  loading: boolean
  switchClient: (clientId: string) => void
}

const ClientContext = createContext<ClientState | null>(null)
const STORAGE_KEY = 'sg.activeClientId'

/**
 * Client context is global, not just route-derived (per spec §5/§7: "client
 * always remains in context"). When the URL is a /clients/:clientId/* route,
 * that param wins and is persisted; on client-agnostic routes (Knowledge,
 * Connections, Settings) the last-active client carries over from
 * localStorage so the top bar/switcher stay meaningful everywhere.
 */
export function ClientProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const match = matchPath('/clients/:clientId/*', location.pathname)
  const routeClientId = match?.params.clientId

  const [clients, setClients] = useState<Client[]>([])
  const [activeClientId, setActiveClientId] = useState<string | null>(routeClientId ?? localStorage.getItem(STORAGE_KEY))
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    clientService.list().then(list => {
      setClients(list)
      setActiveClientId(prev => prev ?? list[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (routeClientId && routeClientId !== activeClientId) {
      setActiveClientId(routeClientId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeClientId])

  useEffect(() => {
    if (!activeClientId) {
      setClient(null)
      setLoading(false)
      return
    }
    localStorage.setItem(STORAGE_KEY, activeClientId)
    setLoading(true)
    clientService.get(activeClientId).then(c => {
      setClient(c ?? null)
      setLoading(false)
    })
  }, [activeClientId])

  const switchClient = useCallback(
    (newClientId: string) => {
      if (routeClientId) {
        const rest = location.pathname.split('/').slice(3).join('/')
        navigate(`/clients/${newClientId}/${rest || 'overview'}`)
      } else {
        setActiveClientId(newClientId)
      }
    },
    [routeClientId, location.pathname, navigate]
  )

  return (
    <ClientContext.Provider value={{ client, clients, loading, switchClient }}>
      {children}
    </ClientContext.Provider>
  )
}

export function useClient(): ClientState {
  const ctx = useContext(ClientContext)
  if (!ctx) throw new Error('useClient must be used inside ClientProvider')
  return ctx
}
