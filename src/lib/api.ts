const BASE = '/api'

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const loc = Array.isArray(record.loc) ? record.loc.join('.') : ''
          const msg = typeof record.msg === 'string' ? record.msg : JSON.stringify(record)
          return loc ? `${loc}: ${msg}` : msg
        }
        return ''
      })
      .filter(Boolean)
    if (messages.length > 0) return messages.join(' | ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return fallback
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(formatApiErrorDetail(err.detail, `HTTP ${res.status}`))
  }
  return res.json()
}

async function requestForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(formatApiErrorDetail(err.detail, `HTTP ${res.status}`))
  }
  return res.json()
}

export const api = {
  health: {
    get: () => request<{ status: string; service: string }>('/health'),
  },

  auth: {
    verify: (token: string) =>
      request<{ ok: boolean; message: string }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  },

  profile: {
    get: () => request<Record<string, unknown>>('/profile'),
    update: (body: ProfileUpdate) =>
      request<Record<string, unknown>>('/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    uploadPhoto: async (file: File) => {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${BASE}/profile/assets/photo`, {
        method: 'POST',
        body,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(formatApiErrorDetail(err.detail, `HTTP ${res.status}`))
      }
      return res.json() as Promise<{ ok: boolean; photo_path: string }>
    },
    refreshHeygenAvatar: () =>
      request<{
        ok: boolean
        avatar_provider: string
        heygen_avatar_group_id: string
        heygen_avatar_id: string
      }>('/profile/assets/heygen-avatar', {
        method: 'POST',
      }),
    getHeygenAvatarPreview: () =>
      request<{
        avatar_id: string
        preview_image_url: string
        status?: string
      }>('/profile/heygen-avatar-preview'),
  },

  delegations: {
    list: () => request<HermesDelegation[]>('/delegations'),
    get: (id: string) => request<HermesDelegation>(`/delegations/${id}`),
    artifactUrl: (
      id: string,
      artifactKind: 'script' | 'audio' | 'video' | 'manifest',
      options?: { download?: boolean }
    ) => {
      const params = new URLSearchParams()
      if (options?.download) params.set('download', 'true')
      const query = params.toString()
      return `${BASE}/delegations/${id}/artifacts/${artifactKind}${query ? `?${query}` : ''}`
    },
    uploadSourceAssets: (id: string, body: { scriptText?: string; audioFile?: File | null; videoGenerationMode?: string }) => {
      const form = new FormData()
      if (body.scriptText?.trim()) form.append('script_text', body.scriptText.trim())
      if (body.videoGenerationMode) form.append('video_generation_mode', body.videoGenerationMode)
      if (body.audioFile) form.append('audio', body.audioFile)
      return requestForm<{
        ok: boolean
        source_script_path?: string
        source_audio_path?: string
      }>(`/delegations/${id}/source-assets`, form)
    },
    createWithAssets: (body: CreateDelegationBody & { scriptText?: string; audioFile?: File | null }) => {
      const form = new FormData()
      form.append('counterpart_name', body.counterpart_name)
      form.append('counterpart_phone', body.counterpart_phone ?? '')
      form.append('task_type', body.task_type)
      form.append('channel', body.channel ?? 'voice_call')
      if (body.content_subtype) form.append('content_subtype', body.content_subtype)
      if (body.video_meeting_intent) form.append('video_meeting_intent', body.video_meeting_intent)
      if (body.video_meeting_setup) form.append('video_meeting_setup', body.video_meeting_setup)
      if (body.video_generation_mode) form.append('video_generation_mode', body.video_generation_mode)
      form.append('goal', body.goal)
      if (body.scheduled_for) form.append('scheduled_for', body.scheduled_for)
      form.append('context_notes_json', JSON.stringify(body.context_notes))
      form.append('autonomous_actions_json', JSON.stringify(body.autonomous_actions))
      form.append('approval_required_json', JSON.stringify(body.approval_required))
      form.append('forbidden_actions_json', JSON.stringify(body.forbidden_actions))
      if (body.title) form.append('title', body.title)
      if (body.scriptText?.trim()) form.append('script_text', body.scriptText.trim())
      if (body.audioFile) form.append('audio', body.audioFile)
      return requestForm<{
        delegation_path: string
        delegation_id: string
        scheduled_job_id?: string
        scheduled_job_next_run_at?: string
        video_session_preview?: {
          title?: string
          status?: string
          counterpart_name?: string
          counterpart_phone?: string
          invite_delivery_status?: string
          invite_sent_at?: string
          invite_message_sid?: string
          invite_delivery_note?: string
        }
      }>('/delegations/with-assets', form)
    },
    create: (body: CreateDelegationBody) =>
      request<{
        delegation_path: string
        delegation_id: string
        scheduled_job_id?: string
        scheduled_job_next_run_at?: string
        video_session_preview?: {
          title?: string
          status?: string
          counterpart_name?: string
          counterpart_phone?: string
          invite_delivery_status?: string
          invite_sent_at?: string
          invite_message_sid?: string
          invite_delivery_note?: string
        }
      }>('/delegations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: CreateDelegationBody) =>
      request<{
        delegation_path: string
        delegation_id: string
        scheduled_job_id?: string
        scheduled_job_next_run_at?: string
        video_session_preview?: {
          title?: string
          status?: string
          counterpart_name?: string
          counterpart_phone?: string
          invite_delivery_status?: string
          invite_sent_at?: string
          invite_message_sid?: string
          invite_delivery_note?: string
        }
      }>(`/delegations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    approvePreCall: (id: string) =>
      request<{
        ok: boolean
        pre_call_approved_at: string
        scheduled_run_state: 'scheduled' | 'past_due' | 'not_scheduled'
      }>(`/delegations/${id}/approve-pre-call`, {
        method: 'POST',
      }),
    delete: (id: string) =>
      request<{ ok: boolean; deleted_path: string }>(`/delegations/${id}`, {
        method: 'DELETE',
      }),
    cancel: (id: string) =>
      request<{
        ok: boolean
        status: 'partial' | 'failed' | 'completed'
        latest_content_run?: {
          run_id?: string
          format?: string
          manifest_path?: string | null
          script_path?: string | null
          audio_path?: string | null
          video_path?: string | null
        }
      }>(`/delegations/${id}/cancel`, { method: 'POST' }),
    callRun: (id: string) =>
      request<CallRunResult>(`/delegations/${id}/call-run`, { method: 'POST' }),
    contentRun: (id: string) =>
      request<ContentRunResult>(`/delegations/${id}/content-run`, { method: 'POST' }),
  },

  settings: {
    get: () => request<CredentialSettings>('/settings'),
    update: (body: Partial<CredentialSettings>) =>
      request<{ ok: boolean }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  twilio: {
    listVerifiedNumbers: () =>
      request<TwilioVerifiedNumbersResponse>('/twilio/verified-numbers'),
    createVerifiedNumberRequest: (body: TwilioVerifiedNumberRequestBody) =>
      request<TwilioVerificationRequestResult>('/twilio/verified-numbers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteVerifiedNumber: (body: TwilioDeleteVerifiedNumberBody) =>
      request<TwilioDeleteVerifiedNumberResponse>('/twilio/verified-numbers', {
        method: 'DELETE',
        body: JSON.stringify(body),
      }),
    listOutboundLines: () =>
      request<TwilioOutboundLinesResponse>('/twilio/outbound-lines'),
    importOutboundLine: (body: TwilioImportOutboundLineBody) =>
      request<TwilioOutboundLine>('/twilio/outbound-lines/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    activateOutboundLine: (body: TwilioActivateOutboundLineBody) =>
      request<TwilioActivateOutboundLineResponse>('/twilio/outbound-lines/activate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteOutboundLine: (body: TwilioActivateOutboundLineBody) =>
      request<TwilioDeleteOutboundLineResponse>('/twilio/outbound-lines', {
        method: 'DELETE',
        body: JSON.stringify(body),
      }),
  },

  calls: {
    list: () => request<HermesCallRecord[]>('/calls'),
    get: (id: string) => request<HermesCallRecord>(`/calls/${id}`),
    forDelegation: (id: string) =>
      request<HermesCallRecord[]>(`/calls/delegation/${id}`),
    log: (body: LogCallBody) =>
      request<{ call_path: string; call: HermesCallRecord }>('/calls/log', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  videoSessions: {
    list: () => request<VideoSession[]>('/video/sessions'),
    get: (id: string) => request<VideoSession>(`/video/sessions/${id}`),
    create: (body: CreateVideoSessionBody) =>
      request<VideoSession & { invite_token: string }>('/video/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    start: (id: string) =>
      request<VideoSession>(`/video/sessions/${id}/start`, {
        method: 'POST',
      }),
    end: (id: string) =>
      request<VideoSession>(`/video/sessions/${id}/end`, {
        method: 'POST',
      }),
    delete: (id: string) =>
      request<{ ok: boolean; video_session_id: string; deleted_session_path: string; deleted_log_path: string }>(`/video/sessions/${id}`, {
        method: 'DELETE',
      }),
    resolveInvite: (inviteToken: string) =>
      request<VideoSession>(`/video/join/${inviteToken}`),
    debug: () => request<Record<string, unknown>>('/video/sessions/debug'),
  },
}

// ─── Hermes-side types (snake_case from Python) ──────────────────────────────

export interface HermesDelegation {
  delegation_id: string
  created_at?: string | null
  updated_at?: string | null
  profile_path: string
  principal_name: string
  title: string
  task_type: string
  channel: string
  latest_content_run?: {
    run_id?: string
    format?: string
    brief?: string
    script_path?: string | null
    audio_path?: string | null
    video_path?: string | null
    manifest_path?: string | null
  } | null
  goal: string
  scheduled_for: string | null
  counterpart: {
    name: string
    phone_number: string | null
    organization: string | null
    relationship: string | null
  }
  authority: {
    autonomous_actions: string[]
    approval_required: string[]
    forbidden_actions: string[]
    spending_limit: string | null
  }
  metadata?: Record<string, unknown> & {
    pre_call_approved_at?: string
  }
  context_notes: string[]
  success_criteria: string[]
  status: string
  _path: string
}

export interface HermesCallRecord {
  call_id: string
  delegation_id: string
  status: string
  summary: string
  outcome: string
  next_steps: string[]
  pending_approvals: string[]
  post_call_followups?: string[]
  pending_actions?: string[]
  transcript: string | null
  transcript_path: string | null
  notes: string[]
  created_at: string | null
  _path?: string
}

export interface CallRunResult {
  delegation_path: string
  call_run_path: string
  conversation_id: string | null
  call_sid: string | null
  status: string
  user_message?: string
  to_number?: string
  channel?: string
  video_session?: {
    video_session_id?: string
    title?: string
    status?: string
    join_url?: string
    counterpart_name?: string
    counterpart_phone?: string
    invite_delivery_status?: string
    invite_sent_at?: string
    invite_message_sid?: string
    invite_delivery_note?: string
  }
}

export interface CreateDelegationBody {
  counterpart_name: string
  counterpart_phone: string
  task_type: string
  channel?: string
  content_subtype?: string
  video_meeting_intent?: string
  video_meeting_setup?: string
  video_generation_mode?: string
  goal: string
  scheduled_for?: string
  context_notes?: string[]
  autonomous_actions?: string[]
  approval_required?: string[]
  forbidden_actions?: string[]
  title?: string
}

export interface ProfileUpdate {
  name?: string
  language?: string
  voice_model?: string
  stability?: number
  similarity_boost?: number
  speed?: number
  profession?: string
  social_tone?: string
  interaction_style?: string
  domain_familiarity?: string[]
  boundary_rules?: string[]
  do_not_say?: string[]
  persona?: string
  first_message?: string
  calling_identity_mode?: string
  avatar_provider?: string
  heygen_avatar_id?: string
  heygen_avatar_group_id?: string
  heygen_voice_id?: string
  default_video_orientation?: string
}

export interface CredentialSettings {
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  TWIN_PUBLIC_BASE_URL: string
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string
  ELEVENLABS_AGENT_ID: string
  ELEVENLABS_PHONE_NUMBER_ID: string
  LIVEAVATAR_API_KEY: string
  LIVEAVATAR_AVATAR_ID: string
  DEEPGRAM_API_KEY: string
  LIVEKIT_URL: string
  LIVEKIT_API_KEY: string
  LIVEKIT_API_SECRET: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  HEYGEN_API_KEY: string
  TWIN_SUMMARY_LANGUAGE: string
}

export interface TwilioVerifiedNumber {
  sid: string
  friendly_name: string | null
  phone_number: string
  date_created: string | null
}

export interface TwilioVerifiedNumbersResponse {
  configured_phone_number: string
  verified_numbers: TwilioVerifiedNumber[]
}

export interface TwilioDeleteVerifiedNumberBody {
  sid: string
}

export interface TwilioDeleteVerifiedNumberResponse {
  ok: boolean
  sid: string
  phone_number: string
  friendly_name: string | null
}

export interface TwilioOutboundLine {
  phone_number: string
  label: string | null
  supports_inbound: boolean
  supports_outbound: boolean
  phone_number_id: string
  provider: string
}

export interface TwilioOutboundLinesResponse {
  configured_phone_number_id: string
  configured_phone_number: string
  outbound_lines: TwilioOutboundLine[]
}

export interface TwilioImportOutboundLineBody {
  phone_number: string
  label?: string
}

export interface TwilioActivateOutboundLineBody {
  phone_number_id: string
}

export interface TwilioActivateOutboundLineResponse {
  ok: boolean
  phone_number: string
  phone_number_id: string
  supports_inbound: boolean
  supports_outbound: boolean
  label: string | null
}

export interface TwilioDeleteOutboundLineResponse {
  ok: boolean
  phone_number: string
  phone_number_id: string
  supports_inbound: boolean
  supports_outbound: boolean
  label: string | null
}

export interface TwilioVerifiedNumberRequestBody {
  phone_number: string
  friendly_name?: string
  call_delay?: number
  extension?: string
}

export interface TwilioVerificationRequestResult {
  phone_number: string
  friendly_name: string | null
  validation_code: string
  call_sid: string | null
}

export interface ContentRunResult {
  run_id: string
  profile_path: string
  format: string
  brief: string
  script_path: string
  audio_path: string | null
  video_path: string | null
  manifest_path: string | null
}

export interface LogCallBody {
  delegation_id: string
  status: string
  summary: string
  outcome: string
  next_steps?: string[]
  notes?: string[]
}

export interface CreateVideoSessionBody {
  title: string
  goal: string
  counterpart_name?: string
  workspace_notes?: string[]
}

export interface VideoSession {
  video_session_id: string
  title: string
  goal: string
  counterpart_name: string
  profile_slug: string
  profile_name: string
  status: string
  required_env: Record<string, string>
  missing_env: string[]
  join_url: string
  created_at: string
  updated_at: string
  ended_at: string | null
  workspace_notes: string[]
  provider_state: Record<string, string>
  compiled_context: {
    prompt?: string
    workspace_notes?: string[]
    recent_calls?: Array<Record<string, unknown>>
    recent_delegations?: Array<Record<string, unknown>>
  }
  runtime: Record<string, unknown>
  artifacts: Record<string, unknown>
  browser_join?: {
    status: string
    missing: string[]
    capabilities: Record<string, boolean>
    current_surface: Record<string, string>
    artifacts: {
      livekit_url?: string
      livekit_room_name?: string
      livekit_user_identity?: string
      livekit_user_token_present?: boolean
      liveavatar_session_id?: string
      liveavatar_ws_url?: string
    }
    next_steps: string[]
  }
}
