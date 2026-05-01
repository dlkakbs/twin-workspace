import type { HermesCallRecord } from './api'
import type { CallOutcome, CallRun } from '../types'

function normalizeHermesCallOutcome(value?: string | null): CallOutcome {
  if (value === 'success') return 'success'
  if (value === 'failed') return 'failed'
  return 'partial'
}

function normalizeTranscript(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function equalStringLists(left?: string[], right?: string[]) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? [])
}

export function callRunPatchFromHermes(
  remote: HermesCallRecord,
  fallback?: CallRun,
): Partial<CallRun> {
  return {
    startedAt: remote.created_at ?? fallback?.startedAt ?? new Date().toISOString(),
    summary: remote.summary,
    transcript: normalizeTranscript(remote.transcript),
    outcome: normalizeHermesCallOutcome(remote.outcome),
    nextSteps: remote.next_steps,
    pendingApprovals: remote.pending_approvals,
    postCallFollowups: remote.post_call_followups,
    pendingActions: remote.pending_actions,
    _hermesCallId: remote.call_id,
  }
}

export function callRunFromHermes(
  remote: HermesCallRecord,
  {
    delegationId,
  }: {
    delegationId: string
  },
): Omit<CallRun, 'id'> {
  return {
    delegationId,
    startedAt: remote.created_at ?? new Date().toISOString(),
    summary: remote.summary,
    transcript: normalizeTranscript(remote.transcript),
    outcome: normalizeHermesCallOutcome(remote.outcome),
    nextSteps: remote.next_steps,
    pendingApprovals: remote.pending_approvals,
    postCallFollowups: remote.post_call_followups,
    pendingActions: remote.pending_actions,
    _hermesCallId: remote.call_id,
  }
}

export function callRunChangedFromHermes(
  current: CallRun,
  remote: HermesCallRecord,
): boolean {
  const next = callRunPatchFromHermes(remote, current)
  return (
    (current.startedAt ?? '') !== (next.startedAt ?? '') ||
    (current.summary ?? '') !== (next.summary ?? '') ||
    (current.transcript ?? '') !== (next.transcript ?? '') ||
    (current.outcome ?? '') !== (next.outcome ?? '') ||
    !equalStringLists(current.nextSteps, next.nextSteps) ||
    !equalStringLists(current.pendingApprovals, next.pendingApprovals) ||
    !equalStringLists(current.postCallFollowups, next.postCallFollowups) ||
    !equalStringLists(current.pendingActions, next.pendingActions)
  )
}
