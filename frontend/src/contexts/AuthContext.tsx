import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { User, TokenResponse } from '../types'
import { authApi } from '../api/client'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      authApi
        .me()
        .then((r) => setUser(r.data as User))
        .catch((err) => {
          // Only clear a token that the server actually rejected (401 — genuinely invalid or
          // expired). A network/connectivity error (backend unreachable, timed out, 5xx) is not
          // proof the token is bad — wiping it here would force a real, still-valid session to
          // log in again just because the backend happened to be down for a moment on refresh.
          // A genuine 401 elsewhere in the app is still handled the same way by the axios
          // response interceptor in api/client.ts (removes the token and redirects to /login).
          if (err?.response?.status === 401) localStorage.removeItem('token')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (username: string, password: string) => {
    const { data } = await authApi.login(username, password)
    const res = data as TokenResponse
    localStorage.setItem('token', res.access_token)
    setUser({ id: res.user_id, username: res.username, email: '', role: res.role })
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
