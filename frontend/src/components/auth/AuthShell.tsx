import type { ReactNode } from 'react'
import { s } from './authStyles'

/** The page + card + logo block shared by every sign-in-family screen: identical to the structure of components/Login.tsx. */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoWrap}>
          <h1 style={s.logoName}>SocialGenius</h1>
          <p style={s.logoSub}>Content Studio</p>
        </div>
        {children}
      </div>
    </div>
  )
}
