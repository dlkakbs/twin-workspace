import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, ChevronRight, ListTodo, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { Badge } from '../components/ui/Badge'
import { NewDelegationModal } from '../components/delegations/NewDelegationModal'
import { TASK_TYPE_LABELS, formatTime, formatDate, hasPreCallApprovalPending, isScheduledRunPastDue } from '../lib/utils'
import type { Delegation, TaskStatus } from '../types'

const STATUS_FILTERS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'approval_pending', label: 'Needs Approval' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

function delegationTypeLabel(delegation: Delegation): string {
  if (delegation.channel !== 'video_call') return TASK_TYPE_LABELS[delegation.taskType]
  if (delegation.videoMeetingIntent === 'intro') return 'Intro Meeting'
  if (delegation.videoMeetingIntent === 'follow_up') return 'Follow-up Meeting'
  return 'Custom Meeting'
}

function channelBadgeLabel(delegation: Delegation): string | null {
  if (delegation.channel === 'video_call') return 'Video Call'
  if (delegation.channel === 'voice_call') return 'Voice Call'
  return null
}

function delegationSortTimestamp(delegation: Delegation): number {
  const primaryDate = delegation.scheduledAt ?? delegation.createdAt
  const timestamp = new Date(primaryDate).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function Delegations() {
  const { delegations, contacts } = useStore()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')

  const filtered = delegations
    .filter((d) => {
      if (filter === 'all') return true
      if (filter === 'approval_pending') return hasPreCallApprovalPending(d)
      return d.status === filter
    })
    .filter((d) => {
      if (!search) return true
      const contact = contacts.find((c) => c.id === d.contactId)
      const name = (contact?.name ?? d.counterpartName ?? '').toLowerCase()
      const s = search.toLowerCase()
      return name.includes(s) || d.goal.toLowerCase().includes(s) || delegationTypeLabel(d).toLowerCase().includes(s)
    })
    .sort((a, b) => delegationSortTimestamp(b) - delegationSortTimestamp(a))

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_42%,#eef2ff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Delegations
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Tasks</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Track what Twin is running, waiting on approval, or completing for you.
            </p>
          </div>

          <Button variant="primary" size="lg" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" />
            New delegation
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map(({ value, label }) => {
          const count = value === 'all'
            ? delegations.length
            : value === 'approval_pending'
              ? delegations.filter((d) => hasPreCallApprovalPending(d)).length
              : delegations.filter((d) => d.status === value).length
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                filter === value
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-600'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  filter === value ? 'bg-violet-200 dark:bg-violet-800' : 'bg-[var(--bg-muted)]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-5 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
        <input
          placeholder="Search delegations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/30"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <ListTodo className="mx-auto mb-3 h-10 w-10 text-[var(--border-strong)]" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">No delegations found</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {search ? 'Try a different search' : 'Create your first delegation'}
          </p>
          {!search && (
            <Button variant="primary" size="md" className="mt-4" onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" /> New Delegation
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const contact = contacts.find((c) => c.id === d.contactId)
            const displayName = contact?.name ?? d.counterpartName ?? 'Unknown contact'
            const showsHermesSchedule = d.status === 'scheduled'
              && Boolean(d.scheduledAt)
              && (d.scheduledByHermes || Boolean(d._hermesId))
            return (
              <button
                key={d.id}
                onClick={() => navigate(`/delegations/${d.id}`)}
                className="flex w-full items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3.5 text-left transition-all hover:border-[var(--border-strong)] hover:shadow-sm cursor-pointer"
              >
                <StatusDot status={d.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-medium text-[var(--text-primary)]">
                      {displayName}
                    </p>
                    <Badge variant="muted">{delegationTypeLabel(d)}</Badge>
                    {channelBadgeLabel(d) && (
                      <Badge variant="muted">{channelBadgeLabel(d)}</Badge>
                    )}
                    {hasPreCallApprovalPending(d) && (
                      <Badge variant={isScheduledRunPastDue(d) ? 'warning' : 'info'}>
                        {isScheduledRunPastDue(d) ? 'Waiting on approval' : 'Approval before run'}
                      </Badge>
                    )}
                    {!hasPreCallApprovalPending(d) && d.requiresApproval && d.preCallApprovedAt && d.status === 'scheduled' && (
                      <Badge variant="success">Approved</Badge>
                    )}
                    {showsHermesSchedule && d.channel !== 'voice_call' && (
                      <Badge variant="info">Hermes</Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-[var(--text-secondary)]">{d.goal}</p>
                  {hasPreCallApprovalPending(d) && d.scheduledAt && (
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                      {isScheduledRunPastDue(d)
                        ? 'Scheduled time passed while Twin was waiting for approval.'
                        : `Approve before ${formatTime(d.scheduledAt)}, ${formatDate(d.scheduledAt)}.`}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {d.scheduledAt && (
                    <>
                      <p className="text-xs font-medium text-[var(--text-secondary)]">
                        {formatTime(d.scheduledAt)}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {formatDate(d.scheduledAt)}
                      </p>
                    </>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              </button>
            )
          })}
        </div>
      )}

      {showModal && (
        <NewDelegationModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => navigate(`/delegations/${id}`)}
        />
      )}
    </div>
  )
}
