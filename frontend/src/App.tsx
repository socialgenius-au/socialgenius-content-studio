import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import JobPlanner from './components/JobPlanner'
import JobDetail from './components/JobDetail'
import BrandList from './components/BrandList'
import BrandForm from './components/BrandForm'
import AssetLibrary from './components/AssetLibrary'
import Templates from './components/Templates'
import Layout from './components/Layout'
import StudioPage from './components/studio/StudioPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 48, color: '#666', textAlign: 'center' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/studio" replace /> : <Login />} />

      {/* Studio — the main production page */}
      <Route
        path="/studio"
        element={
          <RequireAuth>
            <StudioPage />
          </RequireAuth>
        }
      />

      {/* Legacy routes kept for backwards compatibility */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Layout>
              <Dashboard />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/planner"
        element={
          <RequireAuth>
            <Layout>
              <JobPlanner />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:jobId"
        element={
          <RequireAuth>
            <Layout>
              <JobDetail />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/brands"
        element={
          <RequireAuth>
            <Layout>
              <BrandList />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/brands/new"
        element={
          <RequireAuth>
            <Layout>
              <BrandForm />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/brands/:brandId"
        element={
          <RequireAuth>
            <Layout>
              <BrandForm />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/assets"
        element={
          <RequireAuth>
            <Layout>
              <AssetLibrary />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <Layout>
              <Templates />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to={user ? '/studio' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
