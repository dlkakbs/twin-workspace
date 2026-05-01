import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-base)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-violet-700"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
