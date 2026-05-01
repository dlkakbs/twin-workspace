import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import { useTheme } from './hooks/useTheme'
import { AppLayout } from './components/layout/AppLayout'
import { Auth } from './pages/Auth'
import { Dashboard } from './pages/Dashboard'
import { Delegations } from './pages/Delegations'
import { DelegationDetail } from './pages/DelegationDetail'
import { Schedule } from './pages/Schedule'
import { People } from './pages/People'
import { CallLog } from './pages/CallLog'
import { CallDetail } from './pages/CallDetail'
import { Content } from './pages/Content'
import { Identity, IntegrationsSettings, VoiceVideoSettings } from './pages/Identity'
import { Settings } from './pages/Settings'
import { VideoSessions } from './pages/VideoSessions'
import { JoinVideoSession } from './pages/JoinVideoSession'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  return isAuthenticated ? <>{children}</> : <Navigate to="/auth" replace />
}

export default function App() {
  useTheme()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/join/:inviteToken" element={<JoinVideoSession />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/delegations" element={<Delegations />} />
          <Route path="/delegations/:id" element={<DelegationDetail />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/content" element={<Content />} />
          <Route path="/people" element={<People />} />
          <Route path="/calls" element={<CallLog />} />
          <Route path="/calls/:id" element={<CallDetail />} />
          <Route path="/video" element={<VideoSessions />} />
          <Route path="/identity" element={<Identity />} />
          <Route path="/voice-video" element={<VoiceVideoSettings />} />
          <Route path="/integrations" element={<IntegrationsSettings />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
