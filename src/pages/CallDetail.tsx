import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlignLeft,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  EyeOff,
  ListChecks,
  MessageSquare,
  Phone,
  Plus,
  XCircle,
} from 'lucide-react'
import { useStore } from '../store'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { NewDelegationModal } from '../components/delegations/NewDelegationModal'
import { TASK_TYPE_LABELS, formatDate, formatTime } from '../lib/utils'
import type { CallOutcome } from '../types'

type PendingCallItem = {
  label: string
  category: 'approval_required_before_run' | 'post_call_followups' | 'pending_actions'
}

function pendingCategoryMeta(category: PendingCallItem['category']) {
  switch (category) {
    case 'approval_required_before_run':
      return { label: 'Needs Approval', variant: 'warning' as const }
    case 'post_call_followups':
      return { label: 'Follow-up', variant: 'info' as const }
    case 'pending_actions':
      return { label: 'Pending Action', variant: 'muted' as const }
  }
}

const OUTCOME_META: Record<CallOutcome, { label: string; variant: 'success' | 'warning' | 'danger'; icon: React.ReactNode }> = {
  success: {
    label: 'Success',
    variant: 'success',
    icon: <CheckCircle className="h-5 w-5 text-emerald-500" />,
  },
  partial: {
    label: 'Partial',
    variant: 'warning',
    icon: <AlertCircle className="h-5 w-5 text-amber-500" />,
  },
  failed: {
    label: 'Failed',
    variant: 'danger',
    icon: <XCircle className="h-5 w-5 text-red-500" />,
  },
}

function formatDuration(seconds?: number) {
  if (!seconds) return null
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes === 0) return `${remainingSeconds}s`
  return `${minutes}m ${remainingSeconds}s`
}

function normalizePhone(value?: string) {
  return (value ?? '').replace(/[^\d+]/g, '')
}

function maskPhone(value: string) {
  let digitIndex = 0
  const totalDigits = value.replace(/\D/g, '').length
  return value.replace(/\d/g, (digit) => {
    digitIndex += 1
    return digitIndex <= Math.max(totalDigits - 2, 0) ? '*' : digit
  })
}

function getTranscriptLines(transcript: string, twinName: string, contactName: string) {
  return transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const speakerMatch = line.match(/^([^:]{1,40}):\s*(.+)$/)
      if (!speakerMatch) {
        return {
          id: `${index}-note`,
          type: 'note' as const,
          speaker: 'Call note',
          text: line,
        }
      }

      const [, rawSpeaker, text] = speakerMatch
      const speaker = rawSpeaker.trim()
      const normalized = speaker.toLowerCase()
      const isTwin = [twinName, 'twin', 'agent', 'assistant'].some((value) =>
        normalized.includes(value.toLowerCase())
      )
      const isContact = [contactName, 'user', 'customer', 'caller'].some((value) =>
        normalized.includes(value.toLowerCase())
      )

      return {
        id: `${index}-${speaker}`,
        type: isTwin ? ('twin' as const) : isContact ? ('contact' as const) : ('note' as const),
        speaker,
        text: text.trim(),
      }
    })
}

export function CallDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, callRuns, delegations, contacts, updateCallRun } = useStore()
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [showPhoneNumber, setShowPhoneNumber] = useState(false)

  const run = callRuns.find((r) => r.id === id)
  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-sm text-[var(--text-muted)]">Call not found.</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => navigate('/calls')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Calls
        </Button>
      </div>
    )
  }

  const currentRun = run

  const delegation = delegations.find((d) => d.id === currentRun.delegationId)
  const linkedContact = delegation ? contacts.find((c) => c.id === delegation.contactId) : undefined
  const snapshotPhone = linkedContact?.phone ?? delegation?.counterpartPhone
  const matchedPhonebookContact = snapshotPhone
    ? contacts.find((item) => normalizePhone(item.phone) === normalizePhone(snapshotPhone))
    : undefined
  const resolvedContact = matchedPhonebookContact ?? linkedContact
  const displayName = resolvedContact?.name ?? delegation?.counterpartName ?? 'Unknown contact'
  const displayPhone = resolvedContact?.phone ?? delegation?.counterpartPhone ?? 'No phone number'
  const nameSourceLabel = matchedPhonebookContact ? 'Saved in Phonebook' : 'Not saved in Phonebook'
  const callTypeLabel = delegation ? TASK_TYPE_LABELS[delegation.taskType] : null
  const durationLabel = formatDuration(currentRun.durationSeconds)
  const transcriptLines = currentRun.transcript
    ? getTranscriptLines(currentRun.transcript, profile.name, displayName)
    : []
  const outcome = currentRun.outcome ? OUTCOME_META[currentRun.outcome] : null
  const followUpGoal = currentRun.pendingApprovals?.[0]
    ? `Follow up on the previous call and close this remaining owner-side question: ${currentRun.pendingApprovals[0]}`
    : currentRun.postCallFollowups?.[0]
      ? `Follow up on the previous call and handle this follow-up: ${currentRun.postCallFollowups[0]}`
      : currentRun.pendingActions?.[0]
        ? `Follow up on the previous call and complete this pending action: ${currentRun.pendingActions[0]}`
    : 'Follow up on the previous call and close the remaining open question.'
  const followUpContextNotes = [
    currentRun.summary ? `Previous call summary: ${currentRun.summary}` : '',
    ...(currentRun.pendingApprovals?.map((item) => `Owner follow-up needed: ${item}`) ?? []),
    ...(currentRun.postCallFollowups?.map((item) => `Post-call follow-up: ${item}`) ?? []),
    ...(currentRun.pendingActions?.map((item) => `Pending action: ${item}`) ?? []),
    ...(currentRun.nextSteps?.map((step) => `Existing next step: ${step}`) ?? []),
  ]
    .filter(Boolean)
    .join('\n')
  const pendingItems: PendingCallItem[] = [
    ...(currentRun.pendingApprovals?.map((label) => ({ label, category: 'approval_required_before_run' as const })) ?? []),
    ...(currentRun.postCallFollowups?.map((label) => ({ label, category: 'post_call_followups' as const })) ?? []),
    ...(currentRun.pendingActions?.map((label) => ({ label, category: 'pending_actions' as const })) ?? []),
  ]

  function setOutcome(nextOutcome: CallOutcome) {
    updateCallRun(currentRun.id, { outcome: nextOutcome })
  }

  return (
    <div className="white-arrow-surface mx-auto max-w-2xl px-6 py-8">
      <button
        onClick={() => navigate('/calls')}
        className="mb-5 flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Calls
      </button>

      <div className="mb-6 flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          currentRun.outcome === 'success'
            ? 'bg-emerald-100 dark:bg-emerald-900/30'
            : currentRun.outcome === 'failed'
            ? 'bg-red-100 dark:bg-red-900/30'
            : currentRun.outcome === 'partial'
            ? 'bg-amber-100 dark:bg-amber-900/30'
            : 'bg-[var(--bg-muted)]'
        }`}>
          {outcome ? outcome.icon : <Phone className="h-5 w-5 text-[var(--text-muted)]" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">{displayName}</h1>
            {outcome && <Badge variant={outcome.variant}>{outcome.label}</Badge>}
            {currentRun.hidden && <Badge variant="muted">Archived</Badge>}
          </div>
          {nameSourceLabel && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">{nameSourceLabel}</p>
          )}
          {callTypeLabel && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{callTypeLabel}</p>
          )}
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {formatDate(currentRun.startedAt)} · {formatTime(currentRun.startedAt)}
            {durationLabel ? ` · ${durationLabel}` : ''}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm text-[var(--text-secondary)]">
              {showPhoneNumber ? displayPhone : maskPhone(displayPhone)}
            </p>
            <button
              type="button"
              onClick={() => setShowPhoneNumber((current) => !current)}
              aria-label={showPhoneNumber ? 'Hide phone number' : 'Show phone number'}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {showPhoneNumber ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Outcome review</h2>
            </div>
            <div className="mb-4">
              {outcome ? (
                <div className="flex items-center gap-2">
                  {outcome.icon}
                  <Badge variant={outcome.variant}>{outcome.label}</Badge>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">No outcome selected yet.</p>
              )}
            </div>
            <div className="grid gap-2">
              {(['success', 'partial', 'failed'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setOutcome(value)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    currentRun.outcome === value
                      ? value === 'success'
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : value === 'partial'
                        ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                        : 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  Mark as {OUTCOME_META[value].label}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <AlignLeft className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Summary</h2>
            </div>
            {currentRun.summary ? (
              <p className="text-sm leading-7 text-[var(--text-primary)]">{currentRun.summary}</p>
            ) : (
              <p className="text-sm italic text-[var(--text-muted)]">No summary available for this call.</p>
            )}
          </Card>

          {pendingItems.length > 0 && (
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Pending items</h2>
              </div>
              <div className="space-y-2">
                {pendingItems.map((item, index) => (
                  <div
                    key={`${item.category}-${item.label}-${index}`}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={pendingCategoryMeta(item.category).variant}>
                        {pendingCategoryMeta(item.category).label}
                      </Badge>
                      <span>{item.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <button
              onClick={() => setTranscriptOpen((current) => !current)}
              className="flex w-full items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Conversation</h2>
              </div>
              {transcriptOpen ? (
                <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
              )}
            </button>

            {transcriptOpen && (
              <div className="mt-4 space-y-3">
                {transcriptLines.length > 0 ? (
                  transcriptLines.map((line) => (
                    <div
                      key={line.id}
                      className={
                        line.type === 'twin'
                          ? 'ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:bg-violet-900/20 dark:text-violet-100'
                          : line.type === 'contact'
                          ? 'mr-auto max-w-[88%] rounded-2xl rounded-bl-md bg-[var(--bg-muted)] px-4 py-3 text-sm text-[var(--text-primary)]'
                          : 'rounded-xl border border-[var(--border)] bg-[var(--bg-surface-hover)] px-4 py-3 text-sm text-[var(--text-secondary)]'
                      }
                    >
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {line.type === 'twin' ? profile.name : line.speaker}
                      </p>
                      <p className="leading-6">{line.text}</p>
                    </div>
                  ))
                ) : currentRun.transcript ? (
                  <div className="rounded-xl bg-[var(--bg-muted)] p-4">
                    <pre className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                      {currentRun.transcript}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">No transcript available.</p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Next steps</h2>
            </div>
            {currentRun.nextSteps && currentRun.nextSteps.length > 0 ? (
              <ul className="space-y-2">
                {currentRun.nextSteps.map((step, index) => (
                  <li key={`${step}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No follow-up steps were captured for this call.</p>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Phone className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Actions</h2>
            </div>
            <div className="flex flex-col gap-2">
              {delegation && (
                <Button variant="secondary" size="md" onClick={() => navigate(`/delegations/${delegation.id}`)}>
                  <MessageSquare className="h-4 w-4" />
                  View Delegation
                </Button>
              )}
              <Button variant="primary" size="md" onClick={() => setShowFollowUp(true)}>
                <Plus className="h-4 w-4" />
                Create Follow-up
              </Button>
            </div>
          </Card>
      </div>

      {showFollowUp && (
        <NewDelegationModal
          onClose={() => setShowFollowUp(false)}
          onCreated={(newId) => navigate(`/delegations/${newId}`)}
          initialChannelMode="voice_call"
          initialContactId={delegation?.contactId}
          initialTaskType="follow_up_call"
          initialGoal={followUpGoal}
          initialContextNotes={followUpContextNotes}
          initialRequiresApproval
        />
      )}
    </div>
  )
}
