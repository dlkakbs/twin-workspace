import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Check,
  Ban,
  Clock,
  AlertTriangle,
  Play,
  Loader2,
  ExternalLink,
  Download,
} from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { Card } from '../components/ui/Card'
import {
  CONTENT_SUBTYPE_LABELS,
  TASK_TYPE_LABELS,
  formatDate,
  formatRelative,
  formatTime,
  hasPreCallApprovalPending,
  isScheduledRunPastDue,
} from '../lib/utils'
import { api } from '../lib/api'
import { authorityRulesFromHermes, delegationPatchFromHermes } from '../lib/hermesDelegations'
import { NewDelegationModal } from '../components/delegations/NewDelegationModal'
import type { Delegation } from '../types'

function delegationTypeLabel(delegation: Delegation) {
  if (delegation.channel !== 'video_call') return TASK_TYPE_LABELS[delegation.taskType]
  if (delegation.videoMeetingIntent === 'intro') return 'Intro Meeting'
  if (delegation.videoMeetingIntent === 'follow_up') return 'Follow-up Meeting'
  return 'Custom Meeting'
}


function formatFileLabel(path: string | undefined) {
  if (!path) return null
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function formatRunError(message: string): string {
  const text = message.trim()
  if (!text) return 'Call failed. Please try again.'
  const normalized = text.replace(/\s+/g, ' ')
  const shortMatch = normalized.match(/^(Twin[^.?!]*[.?!])/i)
  if (shortMatch?.[1]) return shortMatch[1]
  const firstSentence = normalized.match(/^(.+?[.?!])(?:\s|$)/)
  if (firstSentence?.[1] && firstSentence[1].length <= 160) return firstSentence[1]
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 137).trimEnd()}...`
}

function contentOutputLabel(delegation: Delegation) {
  if (delegation.contentSubtype === 'script') return 'Latest Script'
  if (delegation.contentSubtype === 'audio') return 'Latest Audio'
  return 'Latest Output'
}

function contentFormatLabel(delegation: Delegation) {
  if (delegation.contentSubtype === 'script') return 'Script'
  if (delegation.contentSubtype === 'audio') return 'Audio'
  if (delegation.contentSubtype === 'video') return 'Video'
  return delegation.latestContentRun?.format ?? 'Unknown'
}

function friendlyInviteDeliveryStatus(value?: string) {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'prep_sent':
      return 'Preparation message sent'
    case 'prep_failed':
      return 'Preparation message failed'
    case 'invite_failed':
      return 'Link message failed'
    case 'queued':
      return 'Link message queued'
    case 'sent':
      return 'Link message sent'
    case 'delivered':
      return 'Link message delivered'
    case 'pending':
      return 'Waiting to send'
    default:
      return value ?? 'pending'
  }
}

type ArtifactKind = 'script' | 'audio' | 'video'

export function DelegationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getDelegation, getContact, updateDelegation, deleteDelegation, getCallRunsFor, addCallRun } = useStore()
  const [runLoading, setRunLoading] = useState(false)
  const [approveLoading, setApproveLoading] = useState(false)
  const [runError, setRunError] = useState('')
  const [runFeedback, setRunFeedback] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [publicWorkspaceUrl, setPublicWorkspaceUrl] = useState('')

  const delegation = id ? getDelegation(id) : undefined
  if (!delegation) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-sm text-[var(--text-muted)]">Delegation not found.</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => navigate('/delegations')}>
          ← Back
        </Button>
      </div>
    )
  }
  const currentDelegation = delegation
  const isContentJob = currentDelegation.channel === 'content_creation' || currentDelegation.taskType === 'content_creation'
  const isVideoJob = currentDelegation.channel === 'video_call'
  const hasPublicWorkspaceUrl = Boolean(publicWorkspaceUrl.trim())
  const isLocalVideoSelfTest = currentDelegation.videoMeetingSetup === 'local_self_test'
  const hasPartialContentOutput = Boolean(
    currentDelegation.latestContentRun?.scriptPath || currentDelegation.latestContentRun?.audioPath
  )
  const hasFinalContentOutput = Boolean(currentDelegation.latestContentRun?.videoPath)

  const contact = getContact(currentDelegation.contactId)
  const displayName = contact?.name ?? currentDelegation.counterpartName ?? 'Unknown contact'
  const runs = getCallRunsFor(currentDelegation.id)

  async function refreshCurrentDelegation() {
    const hermesId = currentDelegation._hermesId
    if (!hermesId) return
    const remote = await api.delegations.get(hermesId)
    updateDelegation(currentDelegation.id, delegationPatchFromHermes(remote, {
      fallback: currentDelegation,
      contactId: currentDelegation.contactId,
      authorityRules: authorityRulesFromHermes(remote, () => crypto.randomUUID()),
    }))
  }

  useEffect(() => {
    api.settings.get()
      .then((settings) => setPublicWorkspaceUrl(settings.TWIN_PUBLIC_BASE_URL ?? ''))
      .catch(() => setPublicWorkspaceUrl(''))
  }, [])

  useEffect(() => {
    const hermesId = currentDelegation._hermesId
    if (!hermesId) return
    if (!['scheduled', 'running'].includes(currentDelegation.status)) return
    const activeHermesId = hermesId

    let cancelled = false

    async function refreshDelegation() {
      try {
        const remote = await api.delegations.get(activeHermesId)
        if (cancelled) return
        updateDelegation(currentDelegation.id, delegationPatchFromHermes(remote, {
          fallback: currentDelegation,
          contactId: currentDelegation.contactId,
          authorityRules: authorityRulesFromHermes(remote, () => crypto.randomUUID()),
        }))
      } catch {
        // Keep the existing detail view state if Hermes is temporarily unreachable.
      }
    }

    void refreshDelegation()
    const intervalId = window.setInterval(() => {
      void refreshDelegation()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentDelegation._hermesId, currentDelegation.id, currentDelegation.status, updateDelegation])

  async function handleCancel() {
    setRunError('')
    setRunFeedback('')

    if (!isContentJob) {
      updateDelegation(currentDelegation.id, { status: 'failed' })
      return
    }

    try {
      const result = await api.delegations.cancel(currentDelegation._hermesId ?? currentDelegation.id)
      await refreshCurrentDelegation().catch(() => {
        updateDelegation(currentDelegation.id, {
          status: result.status,
          latestContentRun: result.latest_content_run
            ? {
                runId: result.latest_content_run.run_id,
                format: result.latest_content_run.format,
                manifestPath: result.latest_content_run.manifest_path ?? undefined,
                scriptPath: result.latest_content_run.script_path ?? undefined,
                audioPath: result.latest_content_run.audio_path ?? undefined,
                videoPath: result.latest_content_run.video_path ?? undefined,
              }
            : currentDelegation.latestContentRun,
        })
      })

      setRunFeedback(
        result.status === 'partial'
          ? 'Generation cancelled. Partial output is available.'
          : result.status === 'completed'
            ? 'Generation was already far enough along to keep the completed output.'
            : 'Generation cancelled.'
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cancel failed'
      setRunError(formatRunError(msg))
    }
  }

  function handleDelete() {
    if (confirm('Delete this delegation?')) {
      api.delegations.delete(currentDelegation._hermesId ?? currentDelegation.id)
        .catch(() => null)
        .finally(() => {
          deleteDelegation(currentDelegation.id)
          navigate('/delegations')
        })
    }
  }

  async function handleRunNow() {
    setRunError('')
    setRunFeedback('')
    setRunLoading(true)
    try {
      if (isContentJob) {
        const result = await api.delegations.contentRun(currentDelegation._hermesId ?? currentDelegation.id)
        await refreshCurrentDelegation().catch(() => {
          updateDelegation(currentDelegation.id, {
            status: 'completed',
            latestContentRun: {
              runId: result.run_id,
              format: result.format,
              manifestPath: result.manifest_path ?? undefined,
              scriptPath: result.script_path ?? undefined,
              audioPath: result.audio_path ?? undefined,
              videoPath: result.video_path ?? undefined,
            },
          })
        })
        setRunFeedback(
          result.video_path
            ? `Content generated successfully. Video ready: ${formatFileLabel(result.video_path)}`
            : result.audio_path
              ? `Content generated successfully. Audio ready: ${formatFileLabel(result.audio_path)}`
              : `Content generated successfully.`
        )
        return
      }

      const result = await api.delegations.callRun(currentDelegation._hermesId ?? currentDelegation.id)
      if (isVideoJob) {
        await refreshCurrentDelegation().catch(() => {
          updateDelegation(currentDelegation.id, {
            status: result.status === 'partial' ? 'partial' : 'completed',
            lastError: result.status === 'partial' ? result.user_message ?? undefined : undefined,
            latestVideoSession: result.video_session
              ? {
                  videoSessionId: result.video_session.video_session_id,
                  title: result.video_session.title,
                  status: result.video_session.status,
                  joinUrl: result.video_session.join_url,
                  counterpartName: result.video_session.counterpart_name,
                  counterpartPhone: result.video_session.counterpart_phone,
                  inviteDeliveryStatus: result.video_session.invite_delivery_status,
                  inviteSentAt: result.video_session.invite_sent_at,
                  inviteMessageSid: result.video_session.invite_message_sid,
                  inviteDeliveryNote: result.video_session.invite_delivery_note,
                }
              : currentDelegation.latestVideoSession,
          })
        })
        setRunFeedback(result.user_message ?? (
          result.video_session?.join_url
            ? 'Video meeting started and invite sent successfully.'
            : 'Video meeting started successfully.'
        ))
        return
      }
      addCallRun({
        _conversationId: result.conversation_id ?? undefined,
        delegationId: currentDelegation.id,
        startedAt: new Date().toISOString(),
        callSid: result.call_sid ?? undefined,
      })
      setRunFeedback(`Call started successfully${result.to_number ? ` to ${result.to_number}` : ''}.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : isContentJob ? 'Generation failed' : 'Call failed'
      setRunError(formatRunError(msg))
      updateDelegation(currentDelegation.id, { status: 'scheduled' })
    } finally {
      setRunLoading(false)
    }
  }

  async function handleApproveOnly() {
    setRunError('')
    setRunFeedback('')
    setApproveLoading(true)
    try {
      const result = await api.delegations.approvePreCall(currentDelegation._hermesId ?? currentDelegation.id)
      await refreshCurrentDelegation().catch(() => {
        updateDelegation(currentDelegation.id, { preCallApprovedAt: result.pre_call_approved_at })
      })
      if (result.scheduled_run_state === 'past_due') {
        setRunFeedback(isVideoJob
          ? 'Approval saved. The scheduled time has already passed, so you can start the meeting now or reschedule.'
          : 'Approval saved. The scheduled time has already passed, so you can call now or reschedule.')
      } else if (result.scheduled_run_state === 'scheduled') {
        setRunFeedback(isVideoJob
          ? 'Approval saved. Twin will start the meeting and send the invite automatically at the scheduled time.'
          : 'Approval saved. Twin will place this call automatically at the scheduled time.')
      } else {
        setRunFeedback(isVideoJob
          ? 'Approval saved. You can start the meeting whenever you are ready.'
          : 'Approval saved. You can start the call whenever you are ready.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed'
      setRunError(formatRunError(msg))
    } finally {
      setApproveLoading(false)
    }
  }

  async function handleApproveAndRun() {
    setRunError('')
    setRunFeedback('')
    setApproveLoading(true)
    try {
      const result = await api.delegations.approvePreCall(currentDelegation._hermesId ?? currentDelegation.id)
      await refreshCurrentDelegation().catch(() => {
        updateDelegation(currentDelegation.id, { preCallApprovedAt: result.pre_call_approved_at })
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed'
      setRunError(formatRunError(msg))
      setApproveLoading(false)
      return
    }
    setApproveLoading(false)
    await handleRunNow()
  }

  const pendingPreCallApproval = hasPreCallApprovalPending(currentDelegation)
  const scheduledRunPastDue = isScheduledRunPastDue(currentDelegation)
  const approvedForScheduledRun = currentDelegation.requiresApproval
    && Boolean(currentDelegation.preCallApprovedAt)
    && currentDelegation.status === 'scheduled'
    && Boolean(currentDelegation.scheduledAt)
    && !scheduledRunPastDue
  const approvedAfterScheduledTime = currentDelegation.requiresApproval
    && Boolean(currentDelegation.preCallApprovedAt)
    && currentDelegation.status === 'scheduled'
    && scheduledRunPastDue
  const canApprove = pendingPreCallApproval
  const canRun = (currentDelegation.status === 'scheduled' || currentDelegation.status === 'draft')
    && (!currentDelegation.requiresApproval || Boolean(currentDelegation.preCallApprovedAt))
  const canDelete = true
  const canEdit = currentDelegation.status !== 'running'

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <button
        onClick={() => navigate('/delegations')}
        className="mb-5 flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Delegations
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {displayName}
            </h1>
            <StatusDot status={currentDelegation.status} showLabel />
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {isContentJob && currentDelegation.contentSubtype
              ? CONTENT_SUBTYPE_LABELS[currentDelegation.contentSubtype]
              : delegationTypeLabel(currentDelegation)}
            {currentDelegation.scheduledAt && (
              <>
                {' · '}
                {formatTime(currentDelegation.scheduledAt)}, {formatDate(currentDelegation.scheduledAt)}
              </>
            )}
          </p>
        </div>

        {canDelete && (
          <Button variant="danger" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        )}
      </div>

      {canApprove && (
        <div className="mb-5 flex items-start gap-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-900/15">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <p className="flex-1 text-sm text-violet-800 dark:text-violet-200">
              {scheduledRunPastDue
              ? isVideoJob
                ? 'The scheduled time passed while Twin was waiting for your approval. Approve to decide whether to start the meeting now or reschedule.'
                : 'The scheduled time passed while Twin was waiting for your approval. Approve to decide whether to call now or reschedule.'
              : isContentJob
                ? 'Approve to let Twin generate this content now.'
                : isVideoJob
                  ? 'Approve this meeting now so Twin can start the session and send the invite automatically at the scheduled time.'
                : currentDelegation.scheduledAt
                  ? 'Approve this call now so Twin can still place it automatically at the scheduled time.'
                  : 'Approve to let Twin make this call.'}
          </p>
          <div className="flex gap-2">
            {!scheduledRunPastDue && currentDelegation.scheduledAt && (
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-3.5 w-3.5" /> Review schedule
              </Button>
            )}
            <Button size="sm" variant="primary" loading={approveLoading} onClick={() => void handleApproveOnly()}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            {scheduledRunPastDue && !isContentJob && !isVideoJob && (
              <>
                <Button size="sm" variant="secondary" loading={runLoading} onClick={() => void handleApproveAndRun()}>
                  <Play className="h-3.5 w-3.5" /> Approve & Call now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                  <Edit3 className="h-3.5 w-3.5" /> Reschedule
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {approvedAfterScheduledTime && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-900/15">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-violet-800 dark:text-violet-200">
              Approved after the scheduled time
            </p>
            <p className="mt-1 text-xs leading-relaxed text-violet-800/80 dark:text-violet-200/80">
              {isVideoJob
                ? 'This meeting was not started because approval was not given in time.'
                : 'This call was not started because approval was not given in time.'}
            </p>
          </div>
        </div>
      )}

      {approvedForScheduledRun && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/15">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Approved for the scheduled run
            </p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-700/85 dark:text-emerald-300/85">
              {isVideoJob
                ? `Twin now has permission to start this meeting and send the invite automatically at ${formatTime(currentDelegation.scheduledAt!)}, ${formatDate(currentDelegation.scheduledAt!)}.`
                : `Twin now has permission to place this call automatically at ${formatTime(currentDelegation.scheduledAt!)}, ${formatDate(currentDelegation.scheduledAt!)}.`}
            </p>
          </div>
        </div>
      )}

      {currentDelegation.status === 'running' && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800/40 dark:bg-violet-900/15">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500 animate-pulse" />
          <p className="flex-1 text-sm font-medium text-violet-700 dark:text-violet-300">
            {isContentJob
              ? `Twin is generating ${currentDelegation.contentSubtype ? CONTENT_SUBTYPE_LABELS[currentDelegation.contentSubtype].toLowerCase() : 'content'}...`
              : isVideoJob
                ? `Twin is preparing the video meeting for ${displayName}...`
              : `Twin is calling ${displayName}...`}
          </p>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <Ban className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}

      {currentDelegation.status === 'scheduled' && currentDelegation.scheduledAt && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800/40 dark:bg-violet-900/15">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
              Scheduled for {formatTime(currentDelegation.scheduledAt)}, {formatDate(currentDelegation.scheduledAt)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-violet-700/80 dark:text-violet-300/80">
              {pendingPreCallApproval
                ? 'Twin is ready, but it still needs your approval before this scheduled run can start automatically.'
                : approvedForScheduledRun
                  ? 'Twin has approval and will start this automatically around the scheduled time.'
                  : `Twin will start this automatically around the scheduled time. Use ${isContentJob ? 'Generate Now' : isVideoJob ? 'Start Meeting Now' : 'Run Now'} only if you want to start early.`}
            </p>
          </div>
        </div>
      )}

      {currentDelegation.status === 'failed' && currentDelegation.lastError && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/15">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {isContentJob ? 'Content generation failed' : isVideoJob ? 'Video meeting failed' : 'Call failed'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-700/85 dark:text-red-300/85">
              {currentDelegation.lastError}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Goal</h2>
          <p className="text-sm leading-relaxed text-[var(--text-primary)]">{currentDelegation.goal}</p>
        </Card>

        {currentDelegation.contextNotes && (
          <Card>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Context Notes</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
              {currentDelegation.contextNotes}
            </p>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Authority bounds
          </h2>
          <div className="space-y-2">
            {currentDelegation.authorityRules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                    rule.allowed
                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                  }`}
                >
                  {rule.allowed ? <Check className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                </span>
                <span className="text-sm text-[var(--text-secondary)]">{rule.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-muted)]">
              Approval mode:{' '}
              <span className={currentDelegation.requiresApproval ? 'font-medium text-violet-700 dark:text-violet-300' : 'font-medium text-emerald-600 dark:text-emerald-400'}>
                {currentDelegation.requiresApproval ? 'Ask me first' : 'Direct run'}
              </span>
            </span>
            {currentDelegation.requiresApproval && currentDelegation.preCallApprovedAt && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Approved {formatRelative(currentDelegation.preCallApprovedAt)}
              </span>
            )}
          </div>
        </Card>

        {isContentJob && currentDelegation.contentSubtype !== 'script' && (currentDelegation.sourceAssets?.scriptPath || currentDelegation.sourceAssets?.audioPath) && (
          <Card>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Provided Assets</h2>
            <div className="space-y-3 text-sm">
              {currentDelegation.sourceAssets?.scriptPath && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--text-muted)]">Script</span>
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {formatFileLabel(currentDelegation.sourceAssets.scriptPath) ?? 'provided_script.txt'}
                    </span>
                  </div>
                </div>
              )}
              {currentDelegation.sourceAssets?.audioPath && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--text-muted)]">Audio</span>
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {formatFileLabel(currentDelegation.sourceAssets.audioPath)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {isVideoJob && currentDelegation.latestVideoSession && (
          <Card>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Latest Meeting</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--text-muted)]">Status</span>
                <span className="font-medium text-[var(--text-primary)]">{currentDelegation.latestVideoSession.status ?? 'unknown'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--text-muted)]">Invite delivery</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {friendlyInviteDeliveryStatus(currentDelegation.latestVideoSession.inviteDeliveryStatus)}
                </span>
              </div>
              {currentDelegation.latestVideoSession.inviteDeliveryNote && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {currentDelegation.latestVideoSession.inviteDeliveryNote}
                  </p>
                </div>
              )}
              {currentDelegation.latestVideoSession.joinUrl && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--text-muted)]">Join link</span>
                    <a
                      href={currentDelegation.latestVideoSession.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <p className="mt-2 break-all text-xs text-[var(--text-secondary)]">
                    {currentDelegation.latestVideoSession.joinUrl}
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        {isContentJob && currentDelegation.latestContentRun && (
          <Card>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {contentOutputLabel(currentDelegation)}
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--text-muted)]">Format</span>
                <span className="font-medium text-[var(--text-primary)]">{contentFormatLabel(currentDelegation)}</span>
              </div>
              {([
                ['Script', 'script', currentDelegation.latestContentRun.scriptPath],
                ['Audio', 'audio', currentDelegation.latestContentRun.audioPath],
                ['Video', 'video', currentDelegation.latestContentRun.videoPath],
              ] as [string, ArtifactKind, string | undefined][]).map(([label, kind, path]) => (
                path ? (
                  <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[var(--text-muted)]">{label}</span>
                      <span className="truncate font-medium text-[var(--text-primary)]">{formatFileLabel(path)}</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <a
                        href={api.delegations.artifactUrl(currentDelegation._hermesId ?? currentDelegation.id, kind)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-muted-hover)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open
                      </a>
                      <a
                        href={api.delegations.artifactUrl(currentDelegation._hermesId ?? currentDelegation.id, kind, { download: true })}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-muted-hover)]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Timeline</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Created</p>
                <p className="text-xs text-[var(--text-muted)]">{formatRelative(currentDelegation.createdAt)}</p>
              </div>
            </div>
            {currentDelegation.scheduledAt && (
              <div className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">Scheduled</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {formatTime(currentDelegation.scheduledAt)}, {formatDate(currentDelegation.scheduledAt)}
                  </p>
                </div>
              </div>
            )}
            {isContentJob && currentDelegation.latestContentRun && (
              <div className="flex items-start gap-3">
                <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  hasFinalContentOutput ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    {hasFinalContentOutput
                      ? 'Video generated'
                      : hasPartialContentOutput
                        ? 'Partial output generated'
                        : 'Content run started'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{formatRelative(currentDelegation.updatedAt)}</p>
                </div>
              </div>
            )}
            {!isContentJob && !isVideoJob && runs.map((run) => (
              <div key={run.id} className="flex items-start gap-3">
                <div className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                  run.outcome === 'success' ? 'bg-emerald-400' :
                  run.outcome === 'failed' ? 'bg-red-400' : 'bg-amber-400'
                }`} />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    Call {run.outcome ?? 'ran'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{formatRelative(run.startedAt)}</p>
                  {run.summary && (
                    <button
                      onClick={() => navigate(`/calls/${run.id}`)}
                      className="mt-0.5 cursor-pointer text-xs text-violet-600 hover:underline dark:text-violet-400"
                    >
                      View summary →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {(canRun || canEdit) && (
        <div className="mt-6 space-y-3">
          {isVideoJob && !isLocalVideoSelfTest && !hasPublicWorkspaceUrl && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/15">
              <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                External video guests need a public workspace URL. Configure <span className="font-medium">TWIN_PUBLIC_BASE_URL</span> before starting or scheduling this meeting, otherwise invite links will remain workspace-local and guests will not be able to join.
              </p>
            </div>
          )}
          {runFeedback && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800/40 dark:bg-emerald-900/15">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">{runFeedback}</p>
            </div>
          )}
          {runError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800/40 dark:bg-red-900/15">
              <p className="text-xs text-red-600 dark:text-red-400">
                <span className="font-medium">{isContentJob ? 'Generation failed: ' : 'Call failed: '}</span>{runError}
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" size="md" onClick={() => setEditOpen(true)}>
              <Edit3 className="h-4 w-4" /> Edit
            </Button>
            {canRun && (
              <Button
                variant="primary"
                size="md"
                loading={runLoading}
                onClick={handleRunNow}
                disabled={isVideoJob && !isLocalVideoSelfTest && !hasPublicWorkspaceUrl}
                title={isVideoJob && !isLocalVideoSelfTest && !hasPublicWorkspaceUrl ? 'Configure a public workspace URL before starting external video meetings.' : undefined}
              >
                {runLoading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {isContentJob ? 'Generating...' : 'Calling...'}</>
                  : <><Play className="h-4 w-4" /> {isContentJob ? 'Generate Now' : isVideoJob ? 'Start Meeting Now' : 'Run Now'}</>
                }
              </Button>
            )}
          </div>
        </div>
      )}

      {editOpen && (
        <NewDelegationModal
          delegationToEdit={currentDelegation}
          onClose={() => setEditOpen(false)}
          onSaved={(savedId) => {
            setEditOpen(false)
            navigate(`/delegations/${savedId}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}
