import { useEffect, useRef } from 'react'

type SocketMessage = {
  type: 'init' | 'status' | 'step_update' | 'ping'
  status?: string
  plan_json?: unknown
  step?: unknown
  [key: string]: unknown
}

/**
 * Connects to the job WebSocket. Falls back to polling via onPollFallback if the
 * socket fails to open (e.g. during local dev without the proxy configured).
 */
export function useJobSocket(
  jobId: number | null,
  onMessage: (msg: SocketMessage) => void,
  onPollFallback: () => void,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    const token = localStorage.getItem('token')
    if (!token) return

    const apiUrl = import.meta.env.VITE_API_URL as string ?? ''
    const wsBase = apiUrl
      ? apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
      : 'ws://localhost:8000'

    const url = `${wsBase}/ws/jobs/${jobId}?token=${token}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
      wsRef.current = ws
    } catch {
      startFallback()
      return
    }

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as SocketMessage
        if (msg.type !== 'ping') onMessage(msg)
      } catch { /* ignore parse errors */ }
    }

    ws.onerror = () => {
      startFallback()
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
      if (fallbackRef.current) clearInterval(fallbackRef.current)
    }
  }, [jobId])

  function startFallback() {
    if (fallbackRef.current) return
    fallbackRef.current = setInterval(onPollFallback, 3000)
  }

  return {
    close: () => {
      wsRef.current?.close()
      if (fallbackRef.current) { clearInterval(fallbackRef.current); fallbackRef.current = null }
    },
  }
}
