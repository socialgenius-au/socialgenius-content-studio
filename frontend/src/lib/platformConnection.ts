import type { PlatformConnection } from '@/types/domain'

// PlatformVersion.platform is often a variant of the connection's platform
// name (e.g. "Instagram Reel" vs. "Instagram"), so match by prefix.
export function findConnection(platform: string, connections: PlatformConnection[]): PlatformConnection | undefined {
  return connections.find(c => platform.startsWith(c.platform))
}

export function isPlatformLive(connection: PlatformConnection | undefined): boolean {
  return connection?.status === 'connected' || connection?.status === 'warning'
}
