export type TaskType =
  | 'restaurant_inquiry'
  | 'restaurant_reservation'
  | 'hotel_reservation'
  | 'availability_check'
  | 'pricing_request'
  | 'follow_up_call'
  | 'custom_request'
  | 'content_creation'

export type ContentSubtype = 'video' | 'audio' | 'script'
export type VideoGenerationMode = 'exact_audio' | 'explainer'
export type VideoMeetingIntent = 'intro' | 'follow_up' | 'custom'
export type VideoMeetingSetup = 'external_guest' | 'local_self_test'
export type CallingIdentityMode = 'personal_twin' | 'assistant_on_behalf'

export type TaskStatus =
  | 'draft'
  | 'scheduled'
  | 'approval_pending'
  | 'running'
  | 'partial'
  | 'completed'
  | 'failed'

export type CallOutcome = 'success' | 'partial' | 'failed'

export interface Contact {
  id: string
  name: string
  phone: string
  source?: 'manual' | 'synced' | 'internal'
  relationship?: string
  tags: string[]
  notes?: string
  createdAt: string
}

export interface AuthorityRule {
  id: string
  label: string
  allowed: boolean
}

export interface Delegation {
  id: string
  _hermesId?: string
  scheduledByHermes?: boolean
  preCallApprovedAt?: string
  contactId: string
  counterpartName?: string
  counterpartPhone?: string
  taskType: TaskType
  contentSubtype?: ContentSubtype
  videoMeetingIntent?: VideoMeetingIntent
  videoMeetingSetup?: VideoMeetingSetup
  videoGenerationMode?: VideoGenerationMode
  channel?: 'voice_call' | 'video_call' | 'content_creation'
  goal: string
  contextNotes?: string
  authorityRules: AuthorityRule[]
  requiresApproval: boolean
  scheduledAt?: string
  status: TaskStatus
  lastError?: string
  briefPreview?: string
  sourceAssets?: {
    scriptPath?: string
    audioPath?: string
  }
  latestContentRun?: {
    runId?: string
    format?: string
    manifestPath?: string
    scriptPath?: string
    audioPath?: string
    videoPath?: string
  }
  latestVideoSession?: {
    videoSessionId?: string
    title?: string
    status?: string
    joinUrl?: string
    counterpartName?: string
    counterpartPhone?: string
    inviteDeliveryStatus?: string
    inviteSentAt?: string
    inviteMessageSid?: string
    inviteDeliveryNote?: string
  }
  createdAt: string
  updatedAt: string
}

export interface CallRun {
  id: string
  _hermesCallId?: string
  _conversationId?: string
  hidden?: boolean
  delegationId: string
  startedAt: string
  endedAt?: string
  durationSeconds?: number
  transcript?: string
  summary?: string
  outcome?: CallOutcome
  nextSteps?: string[]
  pendingApprovals?: string[]
  postCallFollowups?: string[]
  pendingActions?: string[]
  callSid?: string
}

export interface TwinProfile {
  name: string
  photo?: string
  elevenLabsVoiceId?: string
  avatarProvider?: string
  heygenAvatarId?: string
  heygenAvatarGroupId?: string
  heygenVoiceId?: string
  defaultVideoOrientation?: 'portrait' | 'landscape'
  voiceModel: string
  language: string
  profession: string
  socialTone: string
  interactionStyle: string
  domainFamiliarity: string[]
  boundaryRules: string[]
  doNotSay: string[]
  persona: string
  firstMessage: string
  callingIdentityMode: CallingIdentityMode
  defaultAuthorityRules: AuthorityRule[]
  voiceTuning: {
    stability: number
    similarityBoost: number
    speed: number
  }
}
