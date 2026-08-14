import { useLocation, matchPath, Link } from 'react-router-dom'
import { NAV_GROUPS } from '@/config/navigation'
import { useClient } from '@/contexts/ClientContext'

export function Breadcrumbs() {
  const location = useLocation()
  const { client } = useClient()

  const allItems = NAV_GROUPS.flatMap(g => g.items)
  const current = allItems.find(item => {
    const pattern = item.clientScoped ? item.path.replace('{clientId}', ':clientId') : item.path
    return matchPath(pattern, location.pathname)
  })

  if (!current) return null

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link to="/dashboard" className="hover:text-foreground">Home</Link>
      {current.clientScoped && client && (
        <>
          <span>/</span>
          <span className="text-foreground">{client.name}</span>
        </>
      )}
      <span>/</span>
      <span className="font-medium text-foreground">{current.label}</span>
    </div>
  )
}
