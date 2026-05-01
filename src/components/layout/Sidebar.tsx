import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Calendar,
  ListTodo,
  Users,
  PhoneCall,
  Clapperboard,
  Video,
  Settings,
  User,
  Mic,
  PlugZap,
  Sun,
  Moon,
  Orbit,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useStore } from '../../store'
import { HermesSync } from './HermesSync'
import { BackendStatus } from './BackendStatus'

const navItems = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/schedule',   icon: Calendar,        label: 'Schedule'  },
  { to: '/delegations',icon: ListTodo,        label: 'Delegations'},
  { to: '/content',    icon: Clapperboard,    label: 'Content'   },
  { to: '/people',     icon: Users,           label: 'Phonebook' },
  { to: '/calls',      icon: PhoneCall,       label: 'Voice Calls' },
  { to: '/video',      icon: Video,           label: 'Video Calls' },
]

const bottomItems = [
  { to: '/identity', icon: User,     label: 'Identity' },
  { to: '/voice-video', icon: Mic,   label: 'Voice & Video' },
  { to: '/integrations', icon: PlugZap, label: 'Integrations' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function Sidebar() {
  const { theme, toggleTheme, profile } = useStore()

  return (
    <aside
      className="white-arrow-nav flex h-screen w-56 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
      style={{ position: 'sticky', top: 0 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[var(--sidebar-border)]">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand)] shadow-sm">
          <Orbit className="h-5 w-5 text-white" strokeWidth={1.5} />
        </div>
        <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Twin</span>
        <span className="ml-auto text-xs text-[var(--text-muted)]">{profile.name}</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-100',
                'cursor-default',
                isActive
                  ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-violet-600 dark:text-violet-300' : 'text-[var(--text-muted)]')}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-[var(--sidebar-border)] space-y-0.5">
        <BackendStatus />

        {bottomItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-100',
                'cursor-default',
                isActive
                  ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-violet-600 dark:text-violet-300' : 'text-[var(--text-muted)]')}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}

        {/* Hermes sync */}
        <HermesSync />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] transition-all duration-100"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <Moon className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={2} />
          ) : (
            <Sun className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={2} />
          )}
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
      </div>
    </aside>
  )
}
