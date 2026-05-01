import type { HermesDelegation } from './api'
import type { AuthorityRule, ContentSubtype, Delegation, TaskStatus, TaskType, VideoGenerationMode, VideoMeetingIntent, VideoMeetingSetup } from '../types'

const TASK_TYPE_MAP: Record<string, TaskType> = {
  restaurant_inquiry: 'restaurant_inquiry',
  restaurant_reservation: 'restaurant_reservation',
  hotel_reservation: 'hotel_reservation',
  availability_check: 'availability_check',
  pricing_request: 'pricing_request',
  follow_up_call: 'follow_up_call',
  custom_request: 'custom_request',
  content_creation: 'content_creation',
}

const STATUS_MAP: Record<string, TaskStatus> = {
  planned: 'scheduled',
  running: 'running',
  partial: 'partial',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  needs_follow_up: 'completed',
  blocked: 'failed',
}

export function normalizeHermesTaskType(value?: string): TaskType {
  return TASK_TYPE_MAP[value ?? ''] ?? 'custom_request'
}

export function normalizeHermesTaskStatus(value?: string): TaskStatus {
  return STATUS_MAP[value ?? ''] ?? 'scheduled'
}

export function normalizeHermesContentSubtype(value?: string): ContentSubtype | undefined {
  if (value === 'video' || value === 'audio' || value === 'script') return value
  return undefined
}

export function normalizeHermesVideoMeetingIntent(value?: unknown): VideoMeetingIntent | undefined {
  if (value === 'intro' || value === 'follow_up' || value === 'custom') return value
  return undefined
}

export function normalizeHermesVideoMeetingSetup(value?: unknown): VideoMeetingSetup | undefined {
  if (value === 'local_self_test' || value === 'external_guest') return value
  return undefined
}

export function normalizeHermesVideoGenerationMode(value?: unknown): VideoGenerationMode | undefined {
  if (value === 'exact_audio' || value === 'explainer') return value
  return undefined
}

export function authorityRulesFromHermes(remote: HermesDelegation, makeId: () => string): AuthorityRule[] {
  return [
    ...remote.authority.autonomous_actions.map((label) => ({
      id: makeId(),
      label,
      allowed: true,
    })),
    ...remote.authority.approval_required.map((label) => ({
      id: makeId(),
      label,
      allowed: false,
    })),
    ...remote.authority.forbidden_actions.map((label) => ({
      id: makeId(),
      label,
      allowed: false,
    })),
  ]
}

export function latestVideoSessionFromHermes(remote: HermesDelegation): Delegation['latestVideoSession'] {
  const payload = remote.metadata?.latest_video_session
  if (!payload || typeof payload !== 'object') return undefined
  const data = payload as Record<string, unknown>
  return {
    videoSessionId: typeof data.video_session_id === 'string' ? data.video_session_id : undefined,
    title: typeof data.title === 'string' ? data.title : undefined,
    status: typeof data.status === 'string' ? data.status : undefined,
    joinUrl: typeof data.join_url === 'string' ? data.join_url : undefined,
    counterpartName: typeof data.counterpart_name === 'string' ? data.counterpart_name : undefined,
    counterpartPhone: typeof data.counterpart_phone === 'string' ? data.counterpart_phone : undefined,
    inviteDeliveryStatus: typeof data.invite_delivery_status === 'string' ? data.invite_delivery_status : undefined,
    inviteSentAt: typeof data.invite_sent_at === 'string' ? data.invite_sent_at : undefined,
    inviteMessageSid: typeof data.invite_message_sid === 'string' ? data.invite_message_sid : undefined,
    inviteDeliveryNote: typeof data.invite_delivery_note === 'string' ? data.invite_delivery_note : undefined,
  }
}

export function delegationPatchFromHermes(
  remote: HermesDelegation,
  {
    fallback,
    contactId,
    authorityRules,
  }: {
    fallback?: Delegation
    contactId: string
    authorityRules: AuthorityRule[]
  },
): Partial<Delegation> {
  const metadata = remote.metadata ?? {}
  return {
    _hermesId: remote.delegation_id,
    scheduledByHermes: Boolean(metadata.scheduled_job_id),
    contactId,
    counterpartName: remote.counterpart.name ?? fallback?.counterpartName ?? '',
    counterpartPhone: remote.counterpart.phone_number ?? fallback?.counterpartPhone ?? '',
    taskType: normalizeHermesTaskType(remote.task_type),
    contentSubtype: normalizeHermesContentSubtype(typeof metadata.content_subtype === 'string' ? metadata.content_subtype : undefined),
    videoMeetingIntent: normalizeHermesVideoMeetingIntent(metadata.video_meeting_intent) ?? fallback?.videoMeetingIntent,
    videoMeetingSetup: normalizeHermesVideoMeetingSetup(metadata.video_meeting_setup) ?? fallback?.videoMeetingSetup,
    videoGenerationMode: normalizeHermesVideoGenerationMode(metadata.video_generation_mode),
    channel: remote.channel === 'content_creation'
      ? 'content_creation'
      : remote.channel === 'video_call'
        ? 'video_call'
        : 'voice_call',
    goal: remote.goal,
    contextNotes: remote.context_notes.join('\n'),
    authorityRules,
    requiresApproval: remote.authority.approval_required.length > 0,
    preCallApprovedAt: typeof metadata.pre_call_approved_at === 'string' ? metadata.pre_call_approved_at : undefined,
    scheduledAt: remote.scheduled_for ?? undefined,
    status: normalizeHermesTaskStatus(remote.status),
    lastError: typeof metadata.last_error === 'string' ? metadata.last_error : undefined,
    sourceAssets: {
      scriptPath: typeof metadata.source_script_path === 'string' ? metadata.source_script_path : undefined,
      audioPath: typeof metadata.source_audio_path === 'string' ? metadata.source_audio_path : undefined,
    },
    latestContentRun: remote.latest_content_run
      ? {
          runId: remote.latest_content_run.run_id ?? undefined,
          format: remote.latest_content_run.format ?? undefined,
          manifestPath: remote.latest_content_run.manifest_path ?? undefined,
          scriptPath: remote.latest_content_run.script_path ?? undefined,
          audioPath: remote.latest_content_run.audio_path ?? undefined,
          videoPath: remote.latest_content_run.video_path ?? undefined,
        }
      : undefined,
    latestVideoSession: latestVideoSessionFromHermes(remote),
    createdAt: remote.created_at ?? fallback?.createdAt,
    updatedAt: remote.updated_at ?? fallback?.updatedAt ?? remote.created_at ?? undefined,
  }
}

export function delegationFromHermes(
  remote: HermesDelegation,
  {
    localId,
    contactId,
    authorityRules,
  }: {
    localId: string
    contactId: string
    authorityRules: AuthorityRule[]
  },
): Delegation {
  return {
    id: localId,
    createdAt: remote.created_at ?? new Date().toISOString(),
    updatedAt: remote.updated_at ?? remote.created_at ?? new Date().toISOString(),
    ...delegationPatchFromHermes(remote, {
      contactId,
      authorityRules,
    }),
  } as Delegation
}
