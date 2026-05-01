import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Sun, Moon, LogOut, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function Settings() {
  const { theme, toggleTheme, logout } = useStore()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-[var(--text-primary)]">Settings</h1>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Appearance</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Theme</p>
              <p className="text-xs text-[var(--text-muted)]">
                Currently {theme === 'light' ? 'light' : 'dark'} mode
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
            </button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Backend</h2>
          <div className="space-y-2 text-sm text-[var(--text-secondary)]">
            <div className="flex items-center justify-between">
              <span>API mode</span>
              <code className="rounded bg-[var(--bg-muted)] px-2 py-0.5 text-xs text-[var(--text-primary)]">
                Configurable
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span>Hermes surface</span>
              <code className="rounded bg-[var(--bg-muted)] px-2 py-0.5 text-xs text-[var(--text-primary)]">
                skills.twin
              </code>
            </div>
            <p className="pt-2 text-xs leading-relaxed text-[var(--text-muted)]">
              Twin Workspace requires a reachable Hermes-backed API surface. In local development you can start the included frontend and backend dev servers with <code className="rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]">./start.sh</code>.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Account</h2>
          <div className="flex flex-col gap-3">
            <Button variant="ghost" size="md" className="justify-start" onClick={handleLogout}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
            <Button
              variant="danger"
              size="md"
              className="justify-start"
              onClick={() => {
                if (confirm('Clear all local data? This cannot be undone.')) {
                  localStorage.removeItem('twin-workspace')
                  window.location.reload()
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear all data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
