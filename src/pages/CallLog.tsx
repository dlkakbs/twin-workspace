import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, CheckCircle, XCircle, AlertCircle, ChevronRight, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { Badge } from '../components/ui/Badge'
import { formatRelative, formatDate } from '../lib/utils'
import type { CallOutcome } from '../types'

const ARCHIVED_VISIBILITY_KEY = 'twin-call-log-show-archived'

const OUTCOME_CONFIG: Record<CallOutcome, { icon: React.ReactNode; label: string; variant: 'success' | 'danger' | 'warning' }> = {
  success: { icon: <CheckCircle className="h-4 w-4" />, label: 'Success', variant: 'success' },
  partial: { icon: <AlertCircle className="h-4 w-4" />, label: 'Partial', variant: 'warning' },
  failed: { icon: <XCircle className="h-4 w-4" />, label: 'Failed', variant: 'danger' },
}

function normalizePhone(value?: string) {
  return (value ?? '').replace(/[^\d+]/g, '')
}

export function CallLog() {
  const { callRuns, delegations, contacts, updateCallRun, deleteCallRun } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<CallOutcome | 'all'>('all')
  const [showHidden, setShowHidden] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = window.localStorage.getItem(ARCHIVED_VISIBILITY_KEY)
    return saved === null ? true : saved === 'true'
  })

  const filteredRuns = [...callRuns]
    .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))
    .filter((run) => filter === 'all' || run.outcome === filter)

  const visibleRuns = filteredRuns.filter((run) => !run.hidden)
  const archivedRuns = filteredRuns.filter((run) => run.hidden)
  const hiddenCount = callRuns.filter((run) => run.hidden).length

  function groupRunsByDate(runs: typeof filteredRuns) {
    const groups: Record<string, typeof runs> = {}
    for (const run of runs) {
      const key = formatDate(run.startedAt)
      if (!groups[key]) groups[key] = []
      groups[key].push(run)
    }
    return groups
  }

  const visibleGroups = groupRunsByDate(visibleRuns)
  const archivedGroups = groupRunsByDate(archivedRuns)

  function removeCallRun(id: string) {
    if (!confirm('Delete this call record?')) return
    deleteCallRun(id)
  }

  function renderRunCard(run: typeof filteredRuns[number], options?: { archived?: boolean }) {
    const delegation = delegations.find((item) => item.id === run.delegationId)
    const linkedContact = delegation ? contacts.find((item) => item.id === delegation.contactId) : undefined
    const snapshotPhone = linkedContact?.phone ?? delegation?.counterpartPhone
    const matchedPhonebookContact = snapshotPhone
      ? contacts.find((item) => normalizePhone(item.phone) === normalizePhone(snapshotPhone))
      : undefined
    const resolvedContact = matchedPhonebookContact ?? linkedContact
    const displayName = resolvedContact?.name ?? delegation?.counterpartName ?? 'Unknown'
    const cfg = run.outcome ? OUTCOME_CONFIG[run.outcome] : null
    const isArchived = options?.archived ?? false
    const sourceLabel = matchedPhonebookContact ? 'Saved in Phonebook' : 'Not saved in Phonebook'

    return (
      <div
        key={run.id}
        className={`rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--border-strong)] hover:shadow-sm ${
          isArchived ? 'opacity-80' : ''
        }`}
      >
        <button
          onClick={() => navigate(`/calls/${run.id}`)}
          className="flex w-full items-start gap-4 text-left cursor-pointer"
        >
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              run.outcome === 'success'
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                : run.outcome === 'failed'
                ? 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                : run.outcome === 'partial'
                ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
            }`}
          >
            {cfg ? cfg.icon : <Phone className="h-4 w-4" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-medium text-[var(--text-primary)]">{displayName}</p>
              {cfg && <Badge variant={cfg.variant}>{cfg.label}</Badge>}
              {isArchived && <Badge variant="muted">Archived</Badge>}
            </div>
            {run.summary ? (
              <p className="mt-1 line-clamp-1 text-sm text-[var(--text-secondary)]">
                {run.summary}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--text-muted)]">No summary</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>{sourceLabel}</span>
              <span>{formatRelative(run.startedAt)}</span>
            </div>
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        </button>

        <div className="mt-3 flex items-center gap-2 pl-12">
          {isArchived ? (
            <button
              onClick={() => updateCallRun(run.id, { hidden: false })}
              className="rounded-full border border-violet-200 px-2.5 py-1 text-xs text-violet-700 hover:bg-violet-50 cursor-pointer dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => updateCallRun(run.id, { hidden: true })}
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Archive
            </button>
          )}
          <button
            onClick={() => removeCallRun(run.id)}
            className="rounded-full border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 cursor-pointer dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="white-arrow-surface mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_42%,#eef2ff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Calls
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Call Activity</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Review call results, follow-ups, and archived records.
            </p>
          </div>

          <span className="text-sm text-[var(--text-muted)]">{callRuns.length} total</span>
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['all', 'success', 'partial', 'failed'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all cursor-pointer capitalize ${
                filter === value
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-600'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              }`}
            >
              {value === 'all' ? 'All' : OUTCOME_CONFIG[value].label}
            </button>
          ))}
        </div>

        {hiddenCount > 0 && (
          <button
            onClick={() =>
              setShowHidden((current) => {
                const next = !current
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem(ARCHIVED_VISIBILITY_KEY, String(next))
                }
                return next
              })
            }
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            {showHidden ? `Hide archived (${hiddenCount})` : `Show archived (${hiddenCount})`}
          </button>
        )}
      </div>

      {visibleRuns.length === 0 && (!showHidden || archivedRuns.length === 0) ? (
        <div className="py-16 text-center">
          <Phone className="mx-auto mb-3 h-10 w-10 text-[var(--border-strong)]" />
          <p className="text-sm text-[var(--text-secondary)]">No calls yet</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Create a delegation and run it to see results here
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(visibleGroups).map(([date, runs]) => (
            <div key={date}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {date}
              </p>
              <div className="space-y-2">
                {runs.map((run) => renderRunCard(run))}
              </div>
            </div>
          ))}

          {showHidden && archivedRuns.length > 0 && (
            <div className="border-t border-[var(--border)] pt-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Archived calls
                </p>
                <span className="text-xs text-[var(--text-muted)]">{archivedRuns.length}</span>
              </div>
              <div className="space-y-4">
                {Object.entries(archivedGroups).map(([date, runs]) => (
                  <div key={date}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      {date}
                    </p>
                    <div className="space-y-2">
                      {runs.map((run) => renderRunCard(run, { archived: true }))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
