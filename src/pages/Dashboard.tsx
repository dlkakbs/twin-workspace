import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, CheckCircle, Phone, Clock, ChevronRight, Clapperboard, Video, AudioLines, FileText, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusDot } from '../components/ui/StatusDot'
import { Badge } from '../components/ui/Badge'
import { CONTENT_SUBTYPE_LABELS, STATUS_CONFIG, TASK_TYPE_LABELS, formatTime, formatRelative, hasPreCallApprovalPending, isScheduledRunPastDue } from '../lib/utils'
import { NewDelegationModal } from '../components/delegations/NewDelegationModal'
import type { CallRun, Delegation } from '../types'

type PendingItem = {
  id: string
  delegationId: string
  label: string
  category: 'approval_required_before_run' | 'post_call_followups' | 'pending_actions'
}

type DashboardSection = 'today' | 'recentContent' | 'recentCalls'

type DashboardHiddenState = Record<DashboardSection, string[]>

const DASHBOARD_HIDDEN_KEY = 'twin-dashboard-hidden-items'

const EMPTY_HIDDEN_STATE: DashboardHiddenState = {
  today: [],
  recentContent: [],
  recentCalls: [],
}

function loadDashboardHiddenState(): DashboardHiddenState {
  if (typeof window === 'undefined') return EMPTY_HIDDEN_STATE
  try {
    const raw = window.localStorage.getItem(DASHBOARD_HIDDEN_KEY)
    if (!raw) return EMPTY_HIDDEN_STATE
    const parsed = JSON.parse(raw) as Partial<DashboardHiddenState>
    return {
      today: Array.isArray(parsed.today) ? parsed.today : [],
      recentContent: Array.isArray(parsed.recentContent) ? parsed.recentContent : [],
      recentCalls: Array.isArray(parsed.recentCalls) ? parsed.recentCalls : [],
    }
  } catch {
    return EMPTY_HIDDEN_STATE
  }
}

function saveDashboardHiddenState(state: DashboardHiddenState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DASHBOARD_HIDDEN_KEY, JSON.stringify(state))
}

function pendingCategoryMeta(category: PendingItem['category']) {
  switch (category) {
    case 'approval_required_before_run':
      return { label: 'Needs Approval', variant: 'info' as const }
    case 'post_call_followups':
      return { label: 'Follow-up', variant: 'info' as const }
    case 'pending_actions':
      return { label: 'Pending Action', variant: 'muted' as const }
  }
}

function buildPendingItems(delegation: Delegation, latestRun?: CallRun): PendingItem[] {
  const items: PendingItem[] = []
  if (hasPreCallApprovalPending(delegation)) {
    items.push({
      id: `${delegation.id}-pre-call`,
      delegationId: delegation.id,
      label: isScheduledRunPastDue(delegation)
        ? 'Scheduled time passed while Twin was waiting for approval.'
        : 'Twin is waiting for approval before the run can start.',
      category: 'approval_required_before_run',
    })
  }

  for (const item of latestRun?.postCallFollowups ?? []) {
    items.push({
      id: `${delegation.id}-followup-${item}`,
      delegationId: delegation.id,
      label: item,
      category: 'post_call_followups',
    })
  }

  for (const item of latestRun?.pendingActions ?? []) {
    items.push({
      id: `${delegation.id}-action-${item}`,
      delegationId: delegation.id,
      label: item,
      category: 'pending_actions',
    })
  }

  return items
}

function greet(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 18) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

function contentIcon(type?: Delegation['contentSubtype']) {
  switch (type) {
    case 'video':
      return Video
    case 'audio':
      return AudioLines
    case 'script':
      return FileText
    default:
      return Clapperboard
  }
}

function conciseContentTitle(value: string, subtype?: Delegation['contentSubtype']) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const topicMatch = normalized.match(/\b(?:about|for|on)\s+(.+?)(?:\s+\b(using|with|from|via|in)\b|[,.]|$)/i)
  const topic = topicMatch?.[1]?.trim()

  if (subtype === 'video' && topic) {
    const durationMatch = normalized.match(/\b(\d+[-\s]?(?:second|seconds|minute|minutes))\b/i)
    const duration = durationMatch?.[1]?.replace(/\s+/g, '-').toLowerCase() ?? 'short'
    return `A ${duration} video about ${topic}`
  }

  if (subtype === 'audio' && topic) {
    return `An audio about ${topic}`
  }

  if (subtype === 'script' && topic) {
    return `A script about ${topic}`
  }

  if (subtype) {
    const shortLabel = CONTENT_SUBTYPE_LABELS[subtype].toLowerCase()
    const article = /^[aeiou]/i.test(shortLabel) ? 'An' : 'A'
    if (!topic) return `${article} ${shortLabel}`
  }

  const cleaned = normalized
    .replace(/^(create|make|generate|write|produce|build)\s+/i, '')
    .replace(/^(short|quick)\s+/i, '')
    .replace(/^(a|an)\s+/i, '')
    .split(/\s+\b(using|with|based on|from)\b/i)[0]
    .trim()

  if (cleaned.length <= 40) return cleaned

  const shortened = cleaned.split(' ').slice(0, 7).join(' ').trim()
  return shortened.endsWith('.') ? shortened.slice(0, -1) : shortened
}

function dashboardTodayLabel(delegation: Delegation) {
  if (delegation.channel === 'video_call') return 'Video Call'
  if (delegation.channel === 'voice_call') return 'Voice Call'
  return TASK_TYPE_LABELS[delegation.taskType]
}

type RecentInteraction =
  | {
      id: string
      kind: 'voice'
      startedAt: string
      displayName: string
      navigationPath: string
      subtitle: string
    }
  | {
      id: string
      kind: 'video'
      startedAt: string
      displayName: string
      navigationPath: string
      subtitle: string
    }

export function Dashboard() {
  const { profile, delegations, callRuns, contacts } = useStore()
  const navigate = useNavigate()
  const [showNewModal, setShowNewModal] = useState(false)
  const [hiddenBySection, setHiddenBySection] = useState<DashboardHiddenState>(() => loadDashboardHiddenState())
  const [selectionMode, setSelectionMode] = useState<DashboardSection | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const today = new Date().toDateString()
  const todayDelegations = delegations
    .filter((d) => d.scheduledAt && new Date(d.scheduledAt).toDateString() === today)
    .filter((d) => !hiddenBySection.today.includes(d.id))
    .sort((a, b) => (a.scheduledAt! > b.scheduledAt! ? 1 : -1))

  const pendingItems = useMemo(() => {
    return delegations
      .flatMap((delegation) => {
        const latestRun = callRuns
          .filter((run) => run.delegationId === delegation.id && !run.hidden)
          .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))[0]
        return buildPendingItems(delegation, latestRun)
      })
  }, [callRuns, delegations])

  const recentInteractions = useMemo<RecentInteraction[]>(() => {
    const voiceRuns: RecentInteraction[] = [...callRuns]
      .filter((run) => !run.hidden)
      .filter((run) => !hiddenBySection.recentCalls.includes(run.id))
      .map((run) => {
        const delegation = delegations.find((d) => d.id === run.delegationId)
        const contact = delegation ? contacts.find((c) => c.id === delegation.contactId) : undefined
        const displayName = contact?.name ?? delegation?.counterpartName ?? 'Unknown'
        return {
          id: run.id,
          kind: 'voice',
          startedAt: run.startedAt,
          displayName,
          navigationPath: `/calls/${run.id}`,
          subtitle: run.outcome
            ? run.outcome.charAt(0).toUpperCase() + run.outcome.slice(1)
            : 'Call',
        }
      })

    const videoRuns: RecentInteraction[] = delegations
      .filter((delegation) => delegation.channel === 'video_call' && delegation.latestVideoSession)
      .filter((delegation) => !hiddenBySection.recentCalls.includes(`video-${delegation.id}`))
      .map((delegation) => {
        const contact = contacts.find((c) => c.id === delegation.contactId)
        const displayName =
          delegation.latestVideoSession?.counterpartName
          ?? contact?.name
          ?? delegation.counterpartName
          ?? 'Unknown'
        const startedAt =
          delegation.latestVideoSession?.inviteSentAt
          ?? delegation.updatedAt
          ?? delegation.createdAt
        const status = delegation.latestVideoSession?.status
          ? delegation.latestVideoSession.status.replaceAll('_', ' ')
          : 'Session ready'
        return {
          id: `video-${delegation.id}`,
          kind: 'video',
          startedAt,
          displayName,
          navigationPath: `/delegations/${delegation.id}`,
          subtitle: `Video Call · ${status.charAt(0).toUpperCase()}${status.slice(1)}`,
        }
      })

    return [...voiceRuns, ...videoRuns]
      .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))
      .slice(0, 4)
  }, [callRuns, contacts, delegations, hiddenBySection.recentCalls])

  const recentContent = delegations
    .filter((d) => d.channel === 'content_creation' || d.taskType === 'content_creation')
    .filter((d) => !hiddenBySection.recentContent.includes(d.id))
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
    .slice(0, 4)

  function reschedule(d: Delegation) {
    navigate(`/delegations/${d.id}`)
  }

  function delegationDisplayName(d: Delegation) {
    const contact = contacts.find((c) => c.id === d.contactId)
    return contact?.name ?? d.counterpartName ?? 'Unknown'
  }

  function listRowClassName() {
    return 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--bg-muted)] cursor-pointer'
  }

  function updateHiddenSection(section: DashboardSection, nextIds: string[]) {
    const nextState = { ...hiddenBySection, [section]: nextIds }
    setHiddenBySection(nextState)
    saveDashboardHiddenState(nextState)
  }

  function startSelection(section: DashboardSection) {
    setSelectionMode(section)
    setSelectedIds([])
  }

  function finishSelection() {
    setSelectionMode(null)
    setSelectedIds([])
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  function hideSelected(section: DashboardSection) {
    if (selectedIds.length === 0) return
    updateHiddenSection(section, Array.from(new Set([...hiddenBySection[section], ...selectedIds])))
    finishSelection()
  }

  function hideAll(section: DashboardSection, ids: string[]) {
    updateHiddenSection(section, Array.from(new Set([...hiddenBySection[section], ...ids])))
    finishSelection()
  }

  function isSelecting(section: DashboardSection) {
    return selectionMode === section
  }

  function isItemSelected(id: string) {
    return selectedIds.includes(id)
  }

  function sectionHeaderActions(section: DashboardSection, ids: string[]) {
    if (ids.length === 0) return null
    if (!isSelecting(section)) {
      return (
        <button
          type="button"
          onClick={() => startSelection(section)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-red-500 cursor-pointer"
          aria-label={`Manage ${section}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => hideSelected(section)}
          disabled={selectedIds.length === 0}
          className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40 cursor-pointer"
        >
          Delete selected
        </button>
        <button
          type="button"
          onClick={() => hideAll(section, ids)}
          className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
        >
          Delete all
        </button>
        <button
          type="button"
          onClick={finishSelection}
          className="text-xs text-violet-600 transition-colors hover:text-violet-700 cursor-pointer"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="white-arrow-surface mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            {greet(profile.name)}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setShowNewModal(true)}>
          <Plus className="h-4 w-4" />
          New Delegation
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Today's schedule */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Today</h2>
            <div className="flex items-center gap-3">
              {sectionHeaderActions('today', todayDelegations.map((item) => item.id))}
              <button
                onClick={() => navigate('/schedule')}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-violet-600 transition-colors cursor-pointer"
              >
                View schedule <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {todayDelegations.length === 0 ? (
            <div className="py-8 text-center">
              <Clock className="mx-auto mb-2 h-8 w-8 text-[var(--border-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">Nothing scheduled today</p>
              <button
                onClick={() => setShowNewModal(true)}
                className="mt-2 text-xs text-violet-600 hover:underline dark:text-violet-400 cursor-pointer"
              >
                Create a delegation
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {todayDelegations.map((d) => {
                return (
                  <div
                    key={d.id}
                    onClick={() => {
                      if (isSelecting('today')) {
                        toggleSelected(d.id)
                        return
                      }
                      navigate(`/delegations/${d.id}`)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (isSelecting('today')) {
                          toggleSelected(d.id)
                          return
                        }
                        navigate(`/delegations/${d.id}`)
                      }
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-muted)] cursor-pointer"
                  >
                    {isSelecting('today') && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(d.id)}
                        onChange={() => toggleSelected(d.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4"
                      />
                    )}
                    <StatusDot status={d.status} />
                    <span className="w-12 shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                      {d.scheduledAt ? formatTime(d.scheduledAt) : '--:--'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {delegationDisplayName(d)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs text-[var(--text-muted)]">
                          {dashboardTodayLabel(d)}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Pending approvals (secondary) */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Pending Approvals</h2>
            {pendingItems.length > 0 && (
              <span className="text-sm font-semibold text-[var(--text-muted)]">{pendingItems.length}</span>
            )}
          </div>

          {pendingItems.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle className="mx-auto mb-2 h-8 w-8 text-[var(--border-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">No pending items</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingItems.slice(0, 3).map((item) => {
                const delegation = delegations.find((d) => d.id === item.delegationId)
                if (!delegation) return null
                const badgeMeta = pendingCategoryMeta(item.category)
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-white px-3 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                        <CheckCircle className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {delegationDisplayName(delegation)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-[var(--text-primary)]">
                            {TASK_TYPE_LABELS[delegation.taskType]}
                          </p>
                          <Badge variant={badgeMeta.variant}>{badgeMeta.label}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-[var(--text-primary)]">
                          {item.label}
                        </p>
                        {delegation.scheduledAt && item.category === 'approval_required_before_run' && (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {`Scheduled for ${formatTime(delegation.scheduledAt)}.`}
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="primary" onClick={() => reschedule(delegation)}>
                            Open task
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Content</h2>
            <div className="flex items-center gap-3">
              {sectionHeaderActions('recentContent', recentContent.map((item) => item.id))}
              <button
                onClick={() => navigate('/content')}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-violet-600 transition-colors cursor-pointer"
              >
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {recentContent.length === 0 ? (
            <div className="py-8 text-center">
              <Clapperboard className="mx-auto mb-2 h-8 w-8 text-[var(--border-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">No content yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentContent.map((item) => {
                const Icon = contentIcon(item.contentSubtype)
                const subtypeLabel = item.contentSubtype ? CONTENT_SUBTYPE_LABELS[item.contentSubtype] : 'Content'
                const statusLabel = STATUS_CONFIG[item.status].label
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (isSelecting('recentContent')) {
                        toggleSelected(item.id)
                        return
                      }
                      navigate(`/delegations/${item.id}`)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (isSelecting('recentContent')) {
                          toggleSelected(item.id)
                          return
                        }
                        navigate(`/delegations/${item.id}`)
                      }
                    }}
                    className={listRowClassName()}
                  >
                    {isSelecting('recentContent') && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4"
                      />
                    )}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-5 text-[var(--text-primary)]">
                        {conciseContentTitle(item.goal, item.contentSubtype)}
                      </p>
                      <p className="truncate text-xs leading-4 text-[var(--text-muted)]">
                        {subtypeLabel} · {statusLabel}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {formatRelative(item.updatedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Recent calls */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Calls</h2>
            <div className="flex items-center gap-3">
              {sectionHeaderActions('recentCalls', recentInteractions.map((item) => item.id))}
              <button
                onClick={() => navigate('/calls')}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-violet-600 transition-colors cursor-pointer"
              >
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {recentInteractions.length === 0 ? (
            <div className="py-8 text-center">
              <Phone className="mx-auto mb-2 h-8 w-8 text-[var(--border-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">No calls yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentInteractions.map((item) => {
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (isSelecting('recentCalls')) {
                        toggleSelected(item.id)
                        return
                      }
                      navigate(item.navigationPath)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (isSelecting('recentCalls')) {
                          toggleSelected(item.id)
                          return
                        }
                        navigate(item.navigationPath)
                      }
                    }}
                    className={listRowClassName()}
                  >
                    {isSelecting('recentCalls') && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4"
                      />
                    )}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                      {item.kind === 'video' ? (
                        <Video className="h-3.5 w-3.5" />
                      ) : (
                        <Phone className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-5 text-[var(--text-primary)]">
                        {item.displayName}
                      </p>
                      <p className="truncate text-xs leading-4 text-[var(--text-muted)]">
                        {item.subtitle}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {formatRelative(item.startedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {showNewModal && <NewDelegationModal onClose={() => setShowNewModal(false)} />}
    </div>
  )
}
