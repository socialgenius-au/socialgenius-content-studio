import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ClientProvider } from './contexts/ClientContext'
import Login from './components/Login'
import LegacyDashboard from './components/Dashboard'
import JobPlanner from './components/JobPlanner'
import JobDetail from './components/JobDetail'
import BrandList from './components/BrandList'
import BrandForm from './components/BrandForm'
import AssetLibrary from './components/AssetLibrary'
import Templates from './components/Templates'
import Layout from './components/Layout'
import StudioPage from './components/studio/StudioPage'
import { AppShell } from './components/shell/AppShell'
import { LoadingState } from './components/common/LoadingState'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const NewClientPage = lazy(() => import('./pages/NewClientPage'))
const ClientOverviewPage = lazy(() => import('./pages/ClientOverviewPage'))
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'))
const PositioningPage = lazy(() => import('./pages/PositioningPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const StrategyPage = lazy(() => import('./pages/StrategyPage'))
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'))
const CreateHubPage = lazy(() => import('./pages/CreateHubPage'))
const RepurposePage = lazy(() => import('./pages/RepurposePage'))
const BrandKitPage = lazy(() => import('./pages/BrandKitPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const PublishWorkspacePage = lazy(() => import('./pages/PublishWorkspacePage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'))
const LeadsPage = lazy(() => import('./pages/LeadsPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const ServiceConfiguratorPage = lazy(() => import('./pages/ServiceConfiguratorPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 48, color: '#666', textAlign: 'center' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PageFallback() {
  return (
    <div className="p-6">
      <LoadingState rows={4} />
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

      {/* Studio — the video editor keeps its own full-screen chrome, not the AppShell */}
      <Route
        path="/studio"
        element={
          <RequireAuth>
            <StudioPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:clientId/studio"
        element={
          <RequireAuth>
            <ClientProvider>
              <StudioPage />
            </ClientProvider>
          </RequireAuth>
        }
      />

      {/* Unified platform shell */}
      <Route
        element={
          <RequireAuth>
            <ClientProvider>
              <AppShell />
            </ClientProvider>
          </RequireAuth>
        }
      >
        <Route
          path="/dashboard"
          element={<Suspense fallback={<PageFallback />}><DashboardPage /></Suspense>}
        />
        <Route
          path="/clients"
          element={<Suspense fallback={<PageFallback />}><ClientsPage /></Suspense>}
        />
        <Route
          path="/clients/new"
          element={<Suspense fallback={<PageFallback />}><NewClientPage /></Suspense>}
        />
        <Route path="/clients/:clientId/overview" element={<Suspense fallback={<PageFallback />}><ClientOverviewPage /></Suspense>} />
        <Route path="/clients/:clientId/intelligence" element={<Suspense fallback={<PageFallback />}><IntelligencePage /></Suspense>} />
        <Route path="/clients/:clientId/positioning" element={<Suspense fallback={<PageFallback />}><PositioningPage /></Suspense>} />
        <Route path="/clients/:clientId/audit" element={<Suspense fallback={<PageFallback />}><AuditPage /></Suspense>} />
        <Route path="/clients/:clientId/strategy" element={<Suspense fallback={<PageFallback />}><StrategyPage /></Suspense>} />
        <Route path="/clients/:clientId/campaigns" element={<Suspense fallback={<PageFallback />}><CampaignsPage /></Suspense>} />
        <Route path="/clients/:clientId/campaigns/:campaignId" element={<Suspense fallback={<PageFallback />}><CampaignsPage /></Suspense>} />
        <Route path="/clients/:clientId/create" element={<Suspense fallback={<PageFallback />}><CreateHubPage /></Suspense>} />
        <Route path="/clients/:clientId/repurpose" element={<Suspense fallback={<PageFallback />}><RepurposePage /></Suspense>} />
        <Route path="/clients/:clientId/brand-kit" element={<Suspense fallback={<PageFallback />}><BrandKitPage /></Suspense>} />
        <Route path="/clients/:clientId/library" element={<Suspense fallback={<PageFallback />}><LibraryPage /></Suspense>} />
        <Route path="/clients/:clientId/publish" element={<Suspense fallback={<PageFallback />}><PublishWorkspacePage /></Suspense>} />
        <Route path="/clients/:clientId/calendar" element={<Suspense fallback={<PageFallback />}><CalendarPage /></Suspense>} />
        <Route path="/clients/:clientId/leads" element={<Suspense fallback={<PageFallback />}><LeadsPage /></Suspense>} />
        <Route path="/clients/:clientId/inbox" element={<Suspense fallback={<PageFallback />}><InboxPage /></Suspense>} />
        <Route path="/clients/:clientId/tasks" element={<Suspense fallback={<PageFallback />}><TasksPage /></Suspense>} />
        <Route path="/clients/:clientId/analytics" element={<Suspense fallback={<PageFallback />}><AnalyticsPage /></Suspense>} />
        <Route path="/clients/:clientId/service-config" element={<Suspense fallback={<PageFallback />}><ServiceConfiguratorPage /></Suspense>} />
        <Route path="/connections" element={<Suspense fallback={<PageFallback />}><ConnectionsPage /></Suspense>} />
        <Route path="/knowledge" element={<Suspense fallback={<PageFallback />}><KnowledgePage /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>} />
      </Route>

      {/* Legacy routes kept for backwards compatibility — unchanged functionality, moved off /dashboard */}
      <Route
        path="/legacy/jobs-dashboard"
        element={
          <RequireAuth>
            <Layout>
              <LegacyDashboard />
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
      <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
