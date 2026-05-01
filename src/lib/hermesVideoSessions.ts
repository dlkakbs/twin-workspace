import type { VideoSession } from './api'
import { humanizeEnvKey, humanizeProviderState } from './userFacingErrors'

export type VideoSessionSection = 'live' | 'ready' | 'attention' | 'history'

export function formatVideoSessionDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function videoSessionDisplayName(session: VideoSession) {
  return session.counterpart_name || 'Guest'
}

export function videoSessionUpdatedLabel(session: VideoSession) {
  return formatVideoSessionDateTime(session.updated_at)
}

export function videoSessionInviteLabel(session: VideoSession) {
  if (session.status === 'ended') return 'Closed'
  if (session.missing_env.length > 0) return 'Blocked'
  if (session.status === 'active') return 'Ready to share'
  if (session.status === 'ready_for_wiring') return 'Share manually'
  if (session.status === 'bootstrap_failed') return 'Retry before sharing'
  return 'Share manually'
}

export function videoSessionStateLabel(session: VideoSession) {
  return session.status === 'ended' && session.ended_at
    ? `Ended ${formatVideoSessionDateTime(session.ended_at)}`
    : videoSessionInviteLabel(session)
}

export function videoSessionStatusLabel(session: VideoSession) {
  if (session.status === 'active') return 'Live now'
  if (session.status === 'ended') return 'Past sessions'
  if (session.status === 'ready_for_wiring') return 'Ready to start'
  if (session.status === 'configuration_pending') return 'Action needed'
  if (session.status === 'bootstrap_failed') return 'Needs attention'
  return session.status.replaceAll('_', ' ')
}

export function videoSessionStatusVariant(session: VideoSession): 'success' | 'warning' | 'muted' | 'danger' | 'info' {
  if (session.status === 'active') return 'success'
  if (session.status === 'ready_for_wiring') return 'info'
  if (session.status === 'ended') return 'muted'
  if (session.status === 'configuration_pending' || session.status === 'bootstrap_failed') return 'warning'
  return 'muted'
}

export function videoSessionInviteVariant(session: VideoSession): 'success' | 'warning' | 'muted' | 'info' {
  if (session.status === 'active') return 'success'
  if (session.status === 'ended') return 'muted'
  if (session.missing_env.length > 0 || session.status === 'bootstrap_failed') return 'warning'
  return 'info'
}

export function videoSessionSummary(session: VideoSession) {
  if (session.missing_env.length > 0) {
    return `Setup still needed: ${session.missing_env.map(humanizeEnvKey).join(', ')}`
  }
  if (typeof session.runtime?.liveavatar_error === 'string' && session.runtime.liveavatar_error) {
    return 'The avatar runtime could not start cleanly. Retry the session after checking the provider setup.'
  }
  if (session.status === 'active') return 'Twin is live. Share the join link when you want someone to enter the room.'
  if (session.status === 'ready_for_wiring') return 'The session shell is ready. Start it when you want the live runtime to boot.'
  if (session.status === 'ended') return 'This session has already ended.'
  if (session.status === 'configuration_pending') return 'This session is waiting on missing credentials before it can start.'
  if (session.status === 'bootstrap_failed') return 'The last runtime bootstrap failed. Retry or inspect details only if you need to troubleshoot.'
  return 'Session details are available.'
}

export function videoSessionSection(session: VideoSession): VideoSessionSection {
  if (session.status === 'active') return 'live'
  if (session.status === 'ready_for_wiring') return 'ready'
  if (session.status === 'configuration_pending' || session.status === 'bootstrap_failed' || session.missing_env.length > 0) {
    return 'attention'
  }
  return 'history'
}

export function canStartVideoSession(session: VideoSession) {
  return session.status !== 'active' && session.status !== 'ended'
}

export function canEndVideoSession(session: VideoSession) {
  return session.status === 'active' || session.status === 'ready_for_wiring' || session.status === 'bootstrap_failed'
}

export function videoSessionRuntimeLine(session: VideoSession) {
  const runner = humanizeProviderState(String(session.runtime?.runner_status ?? 'unknown'))
  const liveavatar = humanizeProviderState(String(session.provider_state?.liveavatar ?? 'unknown'))
  return `Runner ${runner} · Avatar ${liveavatar}`
}
