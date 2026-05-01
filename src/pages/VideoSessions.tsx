import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Play,
  Sparkles,
  Square,
  Trash2,
  Video,
} from 'lucide-react'

import { api, type VideoSession } from '../lib/api'
import {
  canEndVideoSession,
  canStartVideoSession,
  formatVideoSessionDateTime,
  videoSessionDisplayName,
  videoSessionInviteLabel,
  videoSessionInviteVariant,
  videoSessionRuntimeLine,
  videoSessionSection,
  videoSessionStateLabel,
  videoSessionStatusLabel,
  videoSessionStatusVariant,
  videoSessionSummary,
  videoSessionUpdatedLabel,
} from '../lib/hermesVideoSessions'
import { formatUserFacingError, humanizeEnvKey, humanizeProviderState } from '../lib/userFacingErrors'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

function SessionRow({
  session,
  onCopy,
  onStart,
  onEnd,
  onDelete,
}: {
  session: VideoSession
  onCopy: (url: string) => Promise<void>
  onStart: (id: string) => Promise<void>
  onEnd: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md">
      <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(245,243,255,0.95)_0%,rgba(255,255,255,0.96)_48%,rgba(237,233,254,0.82)_100%)] px-5 py-4 dark:bg-[linear-gradient(135deg,rgba(91,33,182,0.24)_0%,rgba(30,41,59,0.94)_55%,rgba(76,29,149,0.18)_100%)]">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-violet-600 shadow-sm dark:bg-white/10 dark:text-violet-300">
            <Video className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-violet-700 dark:text-violet-300">
                  {videoSessionDisplayName(session)}
                </p>
                <p className="mt-0.5 text-xs text-violet-600/80 dark:text-violet-300/80">
                  Updated {videoSessionUpdatedLabel(session)}
                </p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-violet-400/80 dark:text-violet-300/60" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={videoSessionStatusVariant(session)}>{videoSessionStatusLabel(session)}</Badge>
          <Badge variant={videoSessionInviteVariant(session)}>Invite: {videoSessionInviteLabel(session)}</Badge>
        </div>

        <div>
          <p className="text-xs text-[var(--text-muted)]/90">{videoSessionSummary(session)}</p>
        </div>

        <div className="grid gap-2 text-center sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Created</p>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{formatVideoSessionDateTime(session.created_at)}</p>
          </div>
          <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Runtime</p>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{videoSessionRuntimeLine(session)}</p>
          </div>
          <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">State</p>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{videoSessionStateLabel(session)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {session.status === 'ended' ? (
            <span className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-4 text-sm font-medium text-[var(--text-muted)]">
              Join session
            </span>
          ) : (
            <a
              href={session.join_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-[var(--brand-hover)]"
            >
              Join session
            </a>
          )}
          <Button size="sm" variant="secondary" onClick={() => void onCopy(session.join_url)}>
            <Copy className="h-3.5 w-3.5" />
            Copy invite
          </Button>
          {canStartVideoSession(session) ? (
            <Button size="sm" variant="ghost" onClick={() => void onStart(session.video_session_id)}>
              <Play className="h-3.5 w-3.5" />
              Start
            </Button>
          ) : null}
          {canEndVideoSession(session) ? (
            <Button size="sm" variant="ghost" onClick={() => void onEnd(session.video_session_id)}>
              <Square className="h-3.5 w-3.5" />
              End
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void onDelete(session.video_session_id)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>

        <details className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2">
          <summary className="flex cursor-default list-none items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <ChevronDown className="h-3.5 w-3.5" />
            Technical details
          </summary>
          <div className="mt-3 space-y-3 text-sm text-[var(--text-primary)]">
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)]">Invite URL</p>
              <p className="mt-1 break-all">{session.join_url}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)]">Missing setup</p>
              <p className="mt-1">
                {session.missing_env.length > 0
                  ? session.missing_env.map(humanizeEnvKey).join(', ')
                  : 'No missing environment variables.'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-secondary)]">Runtime</p>
              <p className="mt-1">Runner: {humanizeProviderState(String(session.runtime?.runner_status ?? 'unknown'))}</p>
              <p>LiveAvatar: {humanizeProviderState(String(session.provider_state?.liveavatar ?? 'unknown'))}</p>
              {typeof session.runtime?.liveavatar_error === 'string' && session.runtime.liveavatar_error ? (
                <p className="text-red-600 dark:text-red-400">
                  The avatar runtime reported an internal startup issue. Check provider setup if this keeps happening.
                </p>
              ) : null}
              {typeof session.artifacts?.session_log_path === 'string' && session.artifacts.session_log_path ? (
                <p className="mt-1 break-all text-xs text-[var(--text-muted)]">Log: {session.artifacts.session_log_path}</p>
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3">
        {title ? <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2> : null}
        {description ? <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function VideoSessions() {
  const [sessions, setSessions] = useState<VideoSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  async function loadSessions() {
    setLoading(true)
    try {
      const data = await api.videoSessions.list()
      setSessions(data)
      setError('')
    } catch (err) {
      setError(formatUserFacingError(err instanceof Error ? err.message : '', 'Could not load video sessions.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  async function copyInvite(url: string) {
    await navigator.clipboard.writeText(url)
  }

  async function startSession(id: string) {
    try {
      const updated = await api.videoSessions.start(id)
      setSessions((current) => current.map((item) => item.video_session_id === id ? updated : item))
      setError('')
    } catch (err) {
      setError(formatUserFacingError(err instanceof Error ? err.message : '', 'Could not start video session.'))
    }
  }

  async function endSession(id: string) {
    try {
      const updated = await api.videoSessions.end(id)
      setSessions((current) => current.map((item) => item.video_session_id === id ? updated : item))
      setError('')
    } catch (err) {
      setError(formatUserFacingError(err instanceof Error ? err.message : '', 'Could not end video session.'))
    }
  }

  async function deleteSession(id: string) {
    try {
      await api.videoSessions.delete(id)
      setSessions((current) => current.filter((item) => item.video_session_id !== id))
      setError('')
    } catch (err) {
      setError(formatUserFacingError(err instanceof Error ? err.message : '', 'Could not delete video session.'))
    }
  }

  const liveSessions = sessions.filter((session) => videoSessionSection(session) === 'live')
  const readySessions = sessions.filter((session) => videoSessionSection(session) === 'ready')
  const attentionSessions = sessions.filter((session) => videoSessionSection(session) === 'attention')
  const historySessions = sessions.filter((session) => videoSessionSection(session) === 'history')

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 [&_a]:cursor-default [&_button]:cursor-default [&_summary]:cursor-default">
      <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_42%,#eef2ff_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Video Calls
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Session activity</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Use Delegations to schedule meetings. Here you can view existing sessions, access join links, and track their live status.
            </p>
          </div>

          <div className="flex items-center">
            <span className="text-sm text-[var(--text-muted)]">{sessions.length} total</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--text-secondary)]">Loading sessions…</p>
        </Card>
      ) : sessions.length === 0 ? (
        <div className="py-16 text-center">
          <Video className="mx-auto mb-3 h-10 w-10 text-[var(--border-strong)]" />
          <p className="text-sm text-[var(--text-secondary)]">No video sessions yet</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Schedule a video meeting from Delegations to see it appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {liveSessions.length > 0 ? (
            <Section title="Live now">
              {liveSessions.map((session) => (
                <SessionRow
                  key={session.video_session_id}
                  session={session}
                  onCopy={copyInvite}
                  onStart={startSession}
                  onEnd={endSession}
                  onDelete={deleteSession}
                />
              ))}
            </Section>
          ) : null}

          {readySessions.length > 0 ? (
            <Section title="Ready to launch">
              {readySessions.map((session) => (
                <SessionRow
                  key={session.video_session_id}
                  session={session}
                  onCopy={copyInvite}
                  onStart={startSession}
                  onEnd={endSession}
                  onDelete={deleteSession}
                />
              ))}
            </Section>
          ) : null}

          {attentionSessions.length > 0 ? (
            <Section title="Needs attention">
              {attentionSessions.map((session) => (
                <SessionRow
                  key={session.video_session_id}
                  session={session}
                  onCopy={copyInvite}
                  onStart={startSession}
                  onEnd={endSession}
                  onDelete={deleteSession}
                />
              ))}
            </Section>
          ) : null}

          {historySessions.length > 0 ? (
            <Section title="Past sessions">
              {historySessions.map((session) => (
                <SessionRow
                  key={session.video_session_id}
                  session={session}
                  onCopy={copyInvite}
                  onStart={startSession}
                  onEnd={endSession}
                  onDelete={deleteSession}
                />
              ))}
            </Section>
          ) : null}
        </div>
      )}
    </div>
  )
}
