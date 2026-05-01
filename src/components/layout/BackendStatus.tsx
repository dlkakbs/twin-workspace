import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api } from '../../lib/api'

export function BackendStatus() {
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        await api.health.get()
        if (!cancelled) setHealthy(true)
      } catch {
        if (!cancelled) setHealthy(false)
      }
    }

    check()
    const interval = window.setInterval(check, 15000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  if (healthy == null) return null

  if (healthy) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800/40 dark:bg-emerald-900/15"
      >
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Backend online</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-700/80 dark:text-emerald-300/80">
              Scheduled jobs and Hermes sync are available.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/15"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Backend offline</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-300/80">
            Scheduled jobs will not run. Start Twin with `./start.sh`.
          </p>
        </div>
      </div>
    </div>
  )
}
