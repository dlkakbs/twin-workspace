import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Check, Ban } from 'lucide-react'
import { useStore } from '../../store'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import {
  CONTENT_SUBTYPE_LABELS,
  isoToLocalDateTimeInput,
  localDateTimeInputToIso,
  TASK_TYPE_DEFAULT_RULES,
  TASK_TYPE_LABELS,
  generateId,
} from '../../lib/utils'
import { api } from '../../lib/api'
import { delegationFromHermes, delegationPatchFromHermes } from '../../lib/hermesDelegations'
import type {
  AuthorityRule,
  ContentSubtype,
  Delegation,
  TaskType,
  VideoMeetingIntent,
  VideoMeetingSetup,
  VideoGenerationMode,
} from '../../types'

interface Props {
  onClose: () => void
  onCreated?: (id: string) => void
  delegationToEdit?: Delegation
  onSaved?: (id: string) => void
  initialChannelMode?: ChannelMode
  initialContactId?: string
  initialTaskType?: TaskType
  initialGoal?: string
  initialContextNotes?: string
  initialRequiresApproval?: boolean | null
}

type ChannelMode = 'voice_call' | 'video_call' | 'content_creation'

const VOICE_TASK_TYPES = (
  Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]
).filter(([type]) => type !== 'content_creation')

const VIDEO_MEETING_INTENT_OPTIONS: [VideoMeetingIntent, string][] = [
  ['intro', 'Intro Meeting'],
  ['follow_up', 'Follow-up Meeting'],
  ['custom', 'Custom Meeting'],
]

const VIDEO_MEETING_SETUP_OPTIONS: [VideoMeetingSetup, string, string][] = [
  ['external_guest', 'External guest', 'Sends an invite and requires a public workspace URL.'],
  ['local_self_test', 'Local self-test', 'No invite is sent. Best for testing camera, mic, avatar, and live response in the current workspace.'],
]

const VIDEO_MEETING_INTENT_TASK_TYPES: Record<VideoMeetingIntent, TaskType> = {
  intro: 'custom_request',
  follow_up: 'follow_up_call',
  custom: 'custom_request',
}

const CONTENT_SUBTYPES = Object.entries(CONTENT_SUBTYPE_LABELS) as [ContentSubtype, string][]

const GOAL_PLACEHOLDERS: Record<TaskType, string> = {
  restaurant_inquiry: 'Ask about light menu options, delivery time, and approximate total price.',
  restaurant_reservation: 'Ask for available tables for 2 tonight around 8 PM and confirm the booking only if approved.',
  hotel_reservation: 'Ask about room availability for May 3–5, nightly rate, and cancellation policy.',
  availability_check: 'Check whether there is availability for tomorrow afternoon and ask for the closest alternative if not.',
  pricing_request: 'Ask for the current price, any extra fees, and the estimated total cost.',
  follow_up_call: 'Follow up on the previous conversation and clarify the remaining open question.',
  custom_request: 'Explain the specific request and what outcome Twin should get from the call.',
  content_creation: 'Create a polished content asset aligned with the goal and context.',
}

const VIDEO_GOAL_PLACEHOLDERS: Record<VideoMeetingIntent, string> = {
  intro: 'Explain what Twin should cover in this first meeting, how the conversation should open, and what a good first outcome looks like.',
  follow_up: 'Explain which earlier conversation or thread this meeting follows up on and what should be closed during the meeting.',
  custom: 'Explain what this meeting should accomplish, what Twin should cover, and what outcome is needed by the end.',
}

const VIDEO_MEETING_INTENT_PREVIEW_LABELS: Record<VideoMeetingIntent, string> = {
  intro: 'Intro Meeting',
  follow_up: 'Follow-up Meeting',
  custom: 'Custom Meeting',
}

function defaultVideoMeetingIntent(taskType: TaskType): VideoMeetingIntent {
  if (taskType === 'follow_up_call') return 'follow_up'
  return 'custom'
}

const CONTENT_GOAL_PLACEHOLDERS: Record<ContentSubtype, string> = {
  video: 'Create a video about this topic using my voice and HeyGen avatar, covering the key points clearly.',
  audio: 'Create an audio-only version in my voice that explains the topic naturally and concisely.',
  script: 'Write a production-ready script with the exact talking points and structure Twin should use.',
}

const CONTENT_BRIEF_EXAMPLES: Record<
  ContentSubtype,
  { goal: string; context: string; tip: string }
> = {
  video: {
    goal: 'Create a 30-second product video for Hermes Agent. The narration should sound natural, first-person, and confident.',
    context: [
      'Audience: technical founders, developers, and AI power users.',
      'Tone: direct, calm, practical, not hypey.',
      'Do not use phrases like "Introducing...", "Today we\'re diving into...", "Imagine...", or "Embrace the future...".',
      'Use short sentences.',
      'Make it sound like I am explaining my own product.',
      'Mention these capabilities: scheduled automations, delegation to parallel subagents, sandboxed execution, browser/web control, and persistent memory.',
      'Language: English.',
      'End with a short practical closing line.',
    ].join('\n'),
    tip: 'Best for natural talking-head videos. Write the outcome in Goal, and the style rules in Context notes.',
  },
  audio: {
    goal: 'Create a short audio version in my voice that explains Hermes Agent naturally and conversationally.',
    context: [
      'Audience: technical founders, developers, and AI power users.',
      'Tone: conversational, calm, and clear.',
      'No visual references like "on screen" or "as you can see".',
      'Keep it under 45 seconds.',
      'Language: English.',
    ].join('\n'),
    tip: 'Best for voice notes, podcast-style clips, or test narration before generating video.',
  },
  script: {
    goal: 'Write a polished spoken script for a short Hermes Agent product intro.',
    context: [
      'Return script only.',
      'No stage directions.',
      'No marketing cliches or launch-video phrases.',
      'Write in first person.',
      'Keep it concise, clear, and founder-like.',
      'Audience: technical founders and developers.',
      'Language: English.',
    ].join('\n'),
    tip: 'Best when you want Twin to deliver the exact wording as a clean written output.',
  },
}

export function NewDelegationModal({
  onClose,
  onCreated,
  delegationToEdit,
  onSaved,
  initialChannelMode,
  initialContactId,
  initialTaskType,
  initialGoal,
  initialContextNotes,
  initialRequiresApproval,
}: Props) {
  const { contacts, addContact, addDelegation } = useStore()
  const isEditMode = Boolean(delegationToEdit)
  const resolvedInitialChannelMode: ChannelMode = delegationToEdit?.channel ?? initialChannelMode ?? 'voice_call'
  const resolvedInitialTaskType: TaskType = delegationToEdit?.taskType ?? initialTaskType ?? 'restaurant_inquiry'
  const initialContentSubtype: ContentSubtype = delegationToEdit?.contentSubtype ?? 'video'
  const initialVideoMeetingIntent: VideoMeetingIntent = delegationToEdit?.videoMeetingIntent
    ?? defaultVideoMeetingIntent(resolvedInitialTaskType)
  const initialVideoMeetingSetup: VideoMeetingSetup = delegationToEdit?.videoMeetingSetup ?? 'external_guest'

  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [channelMode, setChannelMode] = useState<ChannelMode>(resolvedInitialChannelMode)
  const [contactId, setContactId] = useState(delegationToEdit?.contactId ?? initialContactId ?? '')
  const [newContactName, setNewContactName] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [taskType, setTaskType] = useState<TaskType>(resolvedInitialTaskType)
  const [videoMeetingIntent, setVideoMeetingIntent] = useState<VideoMeetingIntent>(initialVideoMeetingIntent)
  const [videoMeetingSetup, setVideoMeetingSetup] = useState<VideoMeetingSetup>(initialVideoMeetingSetup)
  const [contentSubtype, setContentSubtype] = useState<ContentSubtype>(initialContentSubtype)
  const [videoGenerationMode, setVideoGenerationMode] = useState<VideoGenerationMode | null>(
    delegationToEdit?.videoGenerationMode ?? null
  )
  const [goal, setGoal] = useState(delegationToEdit?.goal ?? initialGoal ?? '')
  const [contextNotes, setContextNotes] = useState(delegationToEdit?.contextNotes ?? initialContextNotes ?? '')
  const [sourceScript, setSourceScript] = useState('')
  const [sourceAudioFile, setSourceAudioFile] = useState<File | null>(null)
  const [sourceAudioDurationSec, setSourceAudioDurationSec] = useState<number | null>(null)
  const [rules, setRules] = useState<AuthorityRule[]>(
    delegationToEdit?.authorityRules.map((rule) => ({ ...rule })) ?? []
  )
  const [scheduledAt, setScheduledAt] = useState(
    delegationToEdit?.scheduledAt ? isoToLocalDateTimeInput(delegationToEdit.scheduledAt) : ''
  )
  const [requiresApproval, setRequiresApproval] = useState<boolean | null>(
    delegationToEdit?.requiresApproval ?? initialRequiresApproval ?? (resolvedInitialChannelMode === 'content_creation' ? false : null)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')
  const [publicWorkspaceUrl, setPublicWorkspaceUrl] = useState('')

  const effectiveTaskType: TaskType = channelMode === 'content_creation' ? 'content_creation' : taskType
  const selectedContact = useMemo(
    () => channelMode === 'content_creation'
      ? undefined
      : contacts.find((c) => c.id === contactId),
    [channelMode, contacts, contactId]
  )
  const resolvedContactId = selectedContact?.id ?? ''
  const hasExistingAuthorityRules = Boolean(delegationToEdit?.authorityRules?.length)

  useEffect(() => {
    if (hasExistingAuthorityRules) {
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRules(
      TASK_TYPE_DEFAULT_RULES[effectiveTaskType].map((r) => ({
        ...r,
        id: generateId(),
      }))
    )
  }, [effectiveTaskType, hasExistingAuthorityRules])

  useEffect(() => {
    if (channelMode === 'content_creation') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAddingContact(false)
      setContactId('')
      setRequiresApproval(false)
    }
  }, [channelMode])

  useEffect(() => {
    if (channelMode !== 'video_call') return
    setTaskType(VIDEO_MEETING_INTENT_TASK_TYPES[videoMeetingIntent])
  }, [channelMode, videoMeetingIntent])

  useEffect(() => {
    if (channelMode !== 'video_call') return
    if (videoMeetingSetup === 'local_self_test') {
      setAddingContact(false)
      setRequiresApproval(false)
    }
  }, [channelMode, videoMeetingSetup])

  useEffect(() => {
    api.settings.get()
      .then((settings) => setPublicWorkspaceUrl(settings.TWIN_PUBLIC_BASE_URL ?? ''))
      .catch(() => setPublicWorkspaceUrl(''))
  }, [])

  useEffect(() => {
    if (!sourceAudioFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSourceAudioDurationSec(null)
      return
    }

    const objectUrl = URL.createObjectURL(sourceAudioFile)
    const audio = document.createElement('audio')
    const handleLoadedMetadata = () => {
      setSourceAudioDurationSec(Number.isFinite(audio.duration) ? audio.duration : null)
      URL.revokeObjectURL(objectUrl)
    }
    const handleError = () => {
      setSourceAudioDurationSec(null)
      URL.revokeObjectURL(objectUrl)
    }
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('error', handleError)
    audio.src = objectUrl

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('error', handleError)
      URL.revokeObjectURL(objectUrl)
    }
  }, [sourceAudioFile])

  useEffect(() => {
    if (channelMode !== 'content_creation' || contentSubtype !== 'video') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVideoGenerationMode(null)
      return
    }
    if (videoGenerationMode === 'exact_audio') {
      setSourceScript('')
      return
    }
    setSourceAudioFile(null)
  }, [channelMode, contentSubtype, videoGenerationMode])

  function validate() {
    const next: Record<string, string> = {}
    if (channelMode !== 'content_creation') {
      if (!isLocalVideoSelfTest) {
        if (!contactId && !newContactName) next.contact = 'Select or add a contact'
        if (addingContact && !newContactPhone) next.phone = 'Phone number required'
      }
    }
    if (!rules.length || rules.some((rule) => !rule.label.trim())) {
      next.authorityBounds = 'Add at least one authority rule'
    }
    if (!goal.trim()) next.goal = 'Describe what Twin should accomplish'
    if (channelMode === 'content_creation' && contentSubtype === 'video') {
      if (!videoGenerationMode) {
        next.videoGenerationMode = 'Choose a video mode'
      }
      if (videoGenerationMode === 'exact_audio' && !sourceAudioFile) {
        next.sourceAudio = 'Upload the narration audio for Exact Audio mode'
      }
      if (videoGenerationMode === 'explainer' && !sourceScript.trim()) {
        next.sourceScript = 'Provide the narration script for Explainer mode'
      }
    }
    if (!scheduledAt) next.scheduledAt = 'Pick a date and time'
    if (channelMode !== 'content_creation' && requiresApproval === null) {
      next.approvalMode = 'Choose an approval mode'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSaveContact() {
    if (!newContactName || !newContactPhone) return
    const c = addContact({
      name: newContactName,
      phone: newContactPhone,
      source: 'manual',
      tags: [],
      relationship: '',
    })
    setContactId(c.id)
    setAddingContact(false)
    setNewContactName('')
    setNewContactPhone('')
  }

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, allowed: !r.allowed } : r))
    )
  }

  function addRule() {
    setErrors((prev) => ({ ...prev, authorityBounds: '' }))
    setRules((prev) => [
      ...prev,
      { id: generateId(), label: 'New rule', allowed: true },
    ])
  }

  function updateRuleLabel(id: string, label: string) {
    setErrors((prev) => ({ ...prev, authorityBounds: '' }))
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, label } : r))
    )
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  function generateBrief() {
    return `${goal.trim()}${contextNotes ? ` ${contextNotes.trim()}` : ''}`.trim()
  }

  const hasScriptStageDirections = /[[\]()]/.test(sourceScript)
  const isVideoContent = channelMode === 'content_creation' && contentSubtype === 'video'
  const isScriptContent = channelMode === 'content_creation' && contentSubtype === 'script'
  const isExactAudioMode = isVideoContent && videoGenerationMode === 'exact_audio'
  const isExplainerMode = isVideoContent && videoGenerationMode === 'explainer'
  const showProvidedAssets = channelMode === 'content_creation' && !isScriptContent
  const hasPublicWorkspaceUrl = Boolean(publicWorkspaceUrl.trim())
  const isLocalVideoSelfTest = channelMode === 'video_call' && videoMeetingSetup === 'local_self_test'
  const videoCallNeedsPublicUrl = channelMode === 'video_call' && videoMeetingSetup === 'external_guest' && !hasPublicWorkspaceUrl
  const hasUploadedAudioMode = isExactAudioMode && Boolean(sourceAudioFile)
  const uploadedAudioMinutes = sourceAudioDurationSec ? Math.floor(sourceAudioDurationSec / 60) : 0
  const uploadedAudioSeconds = sourceAudioDurationSec ? Math.round(sourceAudioDurationSec % 60) : 0
  const uploadedAudioDurationLabel = sourceAudioDurationSec != null
    ? `${uploadedAudioMinutes}:${String(uploadedAudioSeconds).padStart(2, '0')}`
    : null
  const selectedOptionClass = 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300'
  const focusAccentClass = 'focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/30'
  const noteBoxClass = 'rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-800 dark:border-violet-800/40 dark:bg-violet-900/15 dark:text-violet-300'
  const infoBoxClass = 'rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 dark:border-violet-800/40 dark:bg-violet-900/15'
  const infoTextClass = 'text-xs text-violet-600 dark:text-violet-300'
  const linkAccentClass = 'text-xs text-violet-600 hover:underline dark:text-violet-400 cursor-pointer'

  function handleSubmit() {
    if (videoCallNeedsPublicUrl) {
      setCreateError('External video meetings require a public workspace URL. Configure TWIN_PUBLIC_BASE_URL before sending meeting invites.')
      return
    }
    if (!validate()) return
    setStep('preview')
  }

  async function handleCreate() {
    const targetContact = channelMode === 'content_creation'
      ? { id: '', name: 'Workspace profile', phone: '' }
      : isLocalVideoSelfTest
        ? { id: resolvedContactId || 'local-video-self-test', name: 'Local Self-Test', phone: '' }
        : selectedContact

    if (!targetContact) {
      setCreateError(channelMode === 'content_creation'
        ? 'Content target is missing. Please reopen the modal and try again.'
        : 'Please select a contact before saving the schedule.')
      return
    }
    setCreateError('')
    setCreateLoading(true)

    const autonomousActions = rules.filter((rule) => rule.allowed).map((rule) => rule.label)
    const forbiddenActions = rules.filter((rule) => !rule.allowed).map((rule) => rule.label)
    const approvalRequired = requiresApproval
      ? ['Açık onay olmadan görevi kesinleştirme.']
      : []

    try {
      const scheduledForIso = localDateTimeInputToIso(scheduledAt)
      const createPayload = {
        counterpart_name: targetContact.name,
        counterpart_phone: targetContact.phone,
        task_type: effectiveTaskType,
        channel: channelMode,
        content_subtype: channelMode === 'content_creation' ? contentSubtype : undefined,
        video_meeting_intent: channelMode === 'video_call' ? videoMeetingIntent : undefined,
        video_meeting_setup: channelMode === 'video_call' ? videoMeetingSetup : undefined,
        video_generation_mode: isVideoContent ? videoGenerationMode ?? undefined : undefined,
        goal,
        scheduled_for: scheduledForIso,
        context_notes: contextNotes
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        autonomous_actions: autonomousActions,
        approval_required: approvalRequired,
        forbidden_actions: forbiddenActions,
        title: channelMode === 'content_creation'
          ? `${CONTENT_SUBTYPE_LABELS[contentSubtype]} - ${goal.trim().slice(0, 72)}`
          : `${targetContact.name} - ${goal.trim().slice(0, 72)}`,
      }

      const hasSourceAssets = channelMode === 'content_creation' && (
        (isExactAudioMode && sourceAudioFile) ||
        (isExplainerMode && sourceScript.trim()) ||
        (!isVideoContent && (sourceScript.trim() || sourceAudioFile))
      )
      const editingHermesId = delegationToEdit?._hermesId
      const result = delegationToEdit && editingHermesId
        ? await api.delegations.update(editingHermesId, createPayload)
        : hasSourceAssets
          ? await api.delegations.createWithAssets({
              ...createPayload,
              scriptText: isExactAudioMode ? undefined : sourceScript,
              audioFile: isExactAudioMode ? sourceAudioFile : null,
            })
          : await api.delegations.create(createPayload)

      const hermesDelegationId = result.delegation_id
        ?? result.delegation_path?.split('/').filter(Boolean).at(-2)
      if (hermesDelegationId && delegationToEdit && hasSourceAssets) {
        await api.delegations.uploadSourceAssets(hermesDelegationId, {
          scriptText: isExactAudioMode ? undefined : sourceScript,
          audioFile: isExactAudioMode ? sourceAudioFile : null,
          videoGenerationMode: isVideoContent ? videoGenerationMode ?? undefined : undefined,
        })
      }
      const remoteDelegation = hermesDelegationId
        ? await api.delegations.get(hermesDelegationId).catch(() => null)
        : null

      if (delegationToEdit) {
        const { updateDelegation } = useStore.getState()
        updateDelegation(
          delegationToEdit.id,
          remoteDelegation
            ? delegationPatchFromHermes(remoteDelegation, {
                fallback: delegationToEdit,
                contactId: targetContact.id,
                authorityRules: rules,
              })
            : {
                _hermesId: hermesDelegationId,
                scheduledByHermes: Boolean(result.scheduled_job_id),
                contactId: targetContact.id,
                counterpartName: targetContact.name,
                counterpartPhone: targetContact.phone,
                taskType: effectiveTaskType,
                channel: channelMode,
                contentSubtype: channelMode === 'content_creation' ? contentSubtype : undefined,
                videoMeetingIntent: channelMode === 'video_call' ? videoMeetingIntent : undefined,
                videoMeetingSetup: channelMode === 'video_call' ? videoMeetingSetup : undefined,
                videoGenerationMode: isVideoContent ? videoGenerationMode ?? undefined : undefined,
                goal,
                contextNotes,
                authorityRules: rules,
                requiresApproval: Boolean(requiresApproval),
                scheduledAt: scheduledForIso,
                status: 'scheduled',
                briefPreview: generateBrief(),
              }
        )
        onSaved?.(delegationToEdit.id)
      } else {
        const d = remoteDelegation
          ? (() => {
              const localId = generateId()
              const normalized = delegationFromHermes(remoteDelegation, {
                localId,
                contactId: targetContact.id,
                authorityRules: rules,
              })
              const { id: _ignoredId, ...delegationInput } = normalized
              addDelegation(delegationInput)
              return normalized
            })()
          : addDelegation({
              _hermesId: hermesDelegationId,
              scheduledByHermes: Boolean(result.scheduled_job_id),
              contactId: targetContact.id,
              counterpartName: targetContact.name,
              counterpartPhone: targetContact.phone,
              taskType: effectiveTaskType,
              channel: channelMode,
              contentSubtype: channelMode === 'content_creation' ? contentSubtype : undefined,
              videoMeetingIntent: channelMode === 'video_call' ? videoMeetingIntent : undefined,
              videoMeetingSetup: channelMode === 'video_call' ? videoMeetingSetup : undefined,
              videoGenerationMode: isVideoContent ? videoGenerationMode ?? undefined : undefined,
              goal,
              contextNotes,
              authorityRules: rules,
              requiresApproval: Boolean(requiresApproval),
              scheduledAt: scheduledForIso,
              status: 'scheduled',
              briefPreview: generateBrief(),
            })
        onCreated?.(d.id)
      }
      onClose()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : `Delegation could not be ${isEditMode ? 'updated' : 'created'}`)
    } finally {
      setCreateLoading(false)
    }
  }

  const goalPlaceholder = channelMode === 'content_creation'
    ? CONTENT_GOAL_PLACEHOLDERS[contentSubtype]
    : channelMode === 'video_call'
      ? VIDEO_GOAL_PLACEHOLDERS[videoMeetingIntent]
      : GOAL_PLACEHOLDERS[taskType]
  const contentExample = channelMode === 'content_creation'
    ? CONTENT_BRIEF_EXAMPLES[contentSubtype]
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {step === 'form' ? (isEditMode ? 'Edit Delegation' : 'New Delegation') : 'Review Brief'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'form' ? (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Delegation type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['voice_call', 'Voice Call'],
                  ['video_call', 'Video Call'],
                  ['content_creation', 'Content Creation'],
                ] as [ChannelMode, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setChannelMode(type)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                      channelMode === type
                        ? selectedOptionClass
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {channelMode !== 'content_creation' ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                    {channelMode === 'video_call' ? 'Who should receive the meeting invite?' : 'Who should Twin call?'} <span className="text-red-500">*</span>
                  </label>
                  {channelMode === 'video_call' && (
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {VIDEO_MEETING_SETUP_OPTIONS.map(([setup, label, description]) => (
                        <button
                          key={setup}
                          type="button"
                          onClick={() => setVideoMeetingSetup(setup)}
                          className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                            videoMeetingSetup === setup
                              ? selectedOptionClass
                              : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                          }`}
                        >
                          <span className="block text-[var(--text-primary)]">{label}</span>
                          <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {isLocalVideoSelfTest ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                      No guest invite will be sent. Twin will create a local test room for you to join from this workspace.
                    </div>
                  ) : !addingContact ? (
                    <div className="flex gap-2">
                      <select
                        value={contactId}
                        onChange={(e) => {
                          setContactId(e.target.value)
                          setErrors((p) => ({ ...p, contact: '' }))
                        }}
                        className={`flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none ${focusAccentClass}`}
                      >
                        <option value="">Select contact...</option>
                        {contacts.filter((c) => c.phone).map((c) => (
                          <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                        ))}
                      </select>
                      <Button size="md" variant="secondary" onClick={() => setAddingContact(true)}>
                        <Plus className="h-4 w-4" />
                        New
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                      <Input
                        placeholder="Name"
                        value={newContactName}
                        onChange={(e) => setNewContactName(e.target.value)}
                      />
                      <Input
                        placeholder="Phone number"
                        value={newContactPhone}
                        onChange={(e) => setNewContactPhone(e.target.value)}
                        error={errors.phone}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={handleSaveContact}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddingContact(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {!isLocalVideoSelfTest && errors.contact && <p className="mt-1 text-xs text-red-500">{errors.contact}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                    {channelMode === 'video_call' ? 'Meeting intent' : 'Call intent'} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(channelMode === 'video_call' ? VIDEO_MEETING_INTENT_OPTIONS : VOICE_TASK_TYPES).map(([type, label]) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          if (channelMode === 'video_call') {
                            setVideoMeetingIntent(type as VideoMeetingIntent)
                            return
                          }
                          setTaskType(type as TaskType)
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                          (channelMode === 'video_call' ? videoMeetingIntent === type : taskType === type)
                            ? selectedOptionClass
                            : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2.5">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">Output target</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">
                    Twin will generate this directly with the current workspace voice and avatar profile.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                    Content subtype <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {CONTENT_SUBTYPES.map(([type, label]) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setContentSubtype(type)}
                        className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                          contentSubtype === type
                            ? selectedOptionClass
                            : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {contentExample && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/80 p-4 dark:border-violet-800/40 dark:bg-violet-900/15">
                <div className="mb-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                      Good Brief Example
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {contentExample.tip}
                    </p>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg bg-white/70 p-3 dark:bg-black/10">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Goal</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-primary)]">{contentExample.goal}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Context Notes</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--text-primary)]">
                      {contentExample.context}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Textarea
              label="Goal"
              placeholder={goalPlaceholder}
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value)
                setErrors((p) => ({ ...p, goal: '' }))
              }}
              error={errors.goal}
              rows={3}
              required
            />

            <Textarea
              label="Context notes"
              placeholder={channelMode === 'content_creation'
                ? 'Target audience, must-cover points, style notes, CTA, duration, aspect ratio...'
                : 'Any extra context Twin should know... (optional)'}
              value={contextNotes}
              onChange={(e) => setContextNotes(e.target.value)}
              rows={3}
            />

            {showProvidedAssets && (
              <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-4">
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  {isVideoContent
                    ? 'Choose how this video should be produced. Exact Audio mode keeps your uploaded narration exactly. Explainer mode requires a script and leaves room for richer scene composition.'
                    : 'You can provide source assets if you want Twin to build the scheduled content from your own material instead of generating everything from scratch.'}
                </p>

                {isVideoContent && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">
                      Video mode <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ['exact_audio', 'Exact Audio Mode'],
                        ['explainer', 'Explainer Mode'],
                      ] as [VideoGenerationMode, string][]).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setVideoGenerationMode(mode)
                            setErrors((prev) => ({ ...prev, videoGenerationMode: '', sourceAudio: '', sourceScript: '' }))
                          }}
                          className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                            videoGenerationMode === mode
                              ? selectedOptionClass
                              : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {errors.videoGenerationMode && <p className="text-xs text-red-500">{errors.videoGenerationMode}</p>}
                  </div>
                )}

                {isExactAudioMode ? (
                  <Input
                    label="Provided audio"
                    type="file"
                    accept=".mp3,.wav,.m4a,.aac,audio/*"
                    hint={sourceAudioFile
                      ? `Selected: ${sourceAudioFile.name}${uploadedAudioDurationLabel ? ` • ${uploadedAudioDurationLabel}` : ''}`
                      : undefined}
                    error={errors.sourceAudio}
                    onChange={(e) => {
                      setSourceAudioFile(e.target.files?.[0] ?? null)
                      setErrors((prev) => ({ ...prev, sourceAudio: '' }))
                    }}
                  />
                ) : (
                  <Textarea
                    label="Provided script"
                    placeholder={isExplainerMode
                      ? 'Required. Paste the exact narration script Twin should turn into an explainer video.'
                      : 'Paste the exact narration here if you already have it.'}
                    value={sourceScript}
                    onChange={(e) => {
                      setSourceScript(e.target.value)
                      setErrors((prev) => ({ ...prev, sourceScript: '' }))
                    }}
                    error={errors.sourceScript}
                    rows={4}
                  />
                )}

                {!isVideoContent && (
                  <Input
                    label="Provided audio"
                    type="file"
                    accept=".mp3,.wav,.m4a,.aac,audio/*"
                    hint={sourceAudioFile
                      ? `Selected: ${sourceAudioFile.name}${uploadedAudioDurationLabel ? ` • ${uploadedAudioDurationLabel}` : ''}`
                      : 'Optional. Reuse an existing audio take for content generation.'}
                    onChange={(e) => {
                      setSourceAudioFile(e.target.files?.[0] ?? null)
                    }}
                  />
                )}

                {hasUploadedAudioMode && (
                  <div className={noteBoxClass}>
                    Uploaded-audio mode uses your audio exactly. Twin will not shorten or rewrite it, and the final video length will match the uploaded audio.
                    {uploadedAudioDurationLabel ? ` Current audio length: ${uploadedAudioDurationLabel}.` : ''}
                    In this mode, HeyGen is doing avatar lip-sync, not full scene composition.
                  </div>
                )}

                {hasUploadedAudioMode && hasScriptStageDirections && (
                  <div className={noteBoxClass}>
                    Stage directions in the provided script are not converted into visuals in uploaded-audio mode. If those directions are spoken in the audio, the avatar will say them out loud.
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Authority bounds <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={addRule}
                  className={linkAccentClass}
                >
                  + Add rule
                </button>
              </div>
              <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] p-3">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleRule(rule.id)}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded cursor-pointer transition-colors ${
                        rule.allowed
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {rule.allowed ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    </button>
                    <input
                      value={rule.label}
                      onChange={(e) => updateRuleLabel(rule.id, e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-violet-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeRule(rule.id)}
                      className="px-1 text-[10px] text-[var(--text-muted)] hover:text-red-500 transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {errors.authorityBounds && <p className="mt-1 text-xs text-red-500">{errors.authorityBounds}</p>}
            </div>

            <Input
              label="When?"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => {
                setScheduledAt(e.target.value)
                setErrors((p) => ({ ...p, scheduledAt: '' }))
              }}
              error={errors.scheduledAt}
              required
            />
            {videoCallNeedsPublicUrl && (
              <div className={noteBoxClass}>
                External video invites need a public workspace URL. Configure <span className="font-medium">TWIN_PUBLIC_BASE_URL</span> before scheduling a video meeting.
              </div>
            )}
            {channelMode !== 'content_creation' && !isLocalVideoSelfTest && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Approval mode <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRequiresApproval(false)
                      setErrors((current) => ({ ...current, approvalMode: '' }))
                    }}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                      requiresApproval === false
                        ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-600'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <span className="block text-[var(--text-primary)]">Direct run</span>
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      {channelMode === 'video_call' ? 'Start the meeting and send the invite automatically at the scheduled time.' : 'Run automatically at the scheduled time.'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequiresApproval(true)
                      setErrors((current) => ({ ...current, approvalMode: '' }))
                    }}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all cursor-pointer ${
                      requiresApproval === true
                        ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-600'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <span className="block text-[var(--text-primary)]">Ask me first</span>
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      Wait for your approval before Twin acts.
                    </span>
                  </button>
                </div>
                {errors.approvalMode && <p className="text-xs text-red-500">{errors.approvalMode}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
            {createError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800/40 dark:bg-red-900/15">
                <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>
              </div>
            )}
            {createLoading && (
              <div className={infoBoxClass}>
                <p className={infoTextClass}>
                  {channelMode === 'content_creation'
                    ? `${isEditMode ? 'Updating' : 'Saving'} the content schedule...`
                    : channelMode === 'video_call'
                      ? `${isEditMode ? 'Updating' : 'Saving'} the video meeting schedule...`
                      : `${isEditMode ? 'Updating' : 'Saving'} the call schedule...`}
                </p>
              </div>
            )}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-4">
              <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                {channelMode === 'content_creation' ? 'Content brief preview' : channelMode === 'video_call' ? 'Meeting brief preview' : 'Call brief preview'}
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">{generateBrief()}</p>
            </div>

            <div className="space-y-2 text-sm">
              {videoCallNeedsPublicUrl && (
                <div className={noteBoxClass}>
                  This workspace does not have a public base URL configured yet. External guests cannot join until a public workspace URL is available.
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Mode</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {channelMode === 'content_creation' ? 'Content Creation' : channelMode === 'video_call' ? 'Video Call' : 'Voice Call'}
                </span>
              </div>
              {channelMode === 'video_call' && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Meeting setup</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {videoMeetingSetup === 'local_self_test' ? 'Local self-test' : 'External guest'}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">
                  {channelMode === 'content_creation' ? 'Output' : 'Contact'}
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {channelMode === 'video_call' && videoMeetingSetup === 'local_self_test'
                    ? 'Local Self-Test'
                    : channelMode === 'content_creation'
                      ? 'Workspace profile'
                      : selectedContact?.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Type</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {channelMode === 'content_creation'
                    ? CONTENT_SUBTYPE_LABELS[contentSubtype]
                    : channelMode === 'video_call'
                      ? VIDEO_MEETING_INTENT_PREVIEW_LABELS[videoMeetingIntent]
                      : TASK_TYPE_LABELS[taskType]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Scheduled</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {new Date(scheduledAt).toLocaleString('tr-TR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Approval mode</span>
                <span className={`font-medium ${requiresApproval ? 'text-violet-700 dark:text-violet-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {requiresApproval ? 'Ask me first' : 'Direct run'}
                </span>
              </div>
              {channelMode === 'content_creation' && (
                <>
                  {isVideoContent && (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-muted)]">Video mode</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {videoGenerationMode === 'exact_audio'
                          ? 'Exact Audio Mode'
                          : videoGenerationMode === 'explainer'
                            ? 'Explainer Mode'
                            : 'Choose a mode'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Source assets</span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {isExactAudioMode
                        ? (sourceAudioFile ? 'Audio' : 'None')
                        : isExplainerMode
                          ? (sourceScript.trim() ? 'Script' : 'None')
                          : [sourceScript.trim() ? 'Script' : null, sourceAudioFile ? 'Audio' : null].filter(Boolean).join(' + ') || 'None'}
                    </span>
                  </div>
                  {hasUploadedAudioMode && (
                    <div className={noteBoxClass}>
                      This run will reuse the uploaded audio exactly.
                      {uploadedAudioDurationLabel ? ` Video length will follow the audio length (${uploadedAudioDurationLabel}).` : ''}
                      Twin will not auto-shorten it to match the goal, and scene directions in the script will not be turned into visuals automatically.
                    </div>
                  )}
                  {isExplainerMode && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-800 dark:border-violet-800/40 dark:bg-violet-900/15 dark:text-violet-300">
                      This run will use the provided script as the explainer source. Uploaded audio is intentionally disabled in this mode.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-4">
          <Button variant="ghost" size="md" onClick={step === 'form' ? onClose : () => setStep('form')}>
            {step === 'form' ? 'Cancel' : '← Back'}
          </Button>
          {step === 'form' ? (
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={videoCallNeedsPublicUrl}
              title={videoCallNeedsPublicUrl ? 'Configure a public workspace URL before scheduling external video meetings.' : undefined}
            >
              Review brief →
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              loading={createLoading}
              onClick={handleCreate}
              disabled={videoCallNeedsPublicUrl}
              title={videoCallNeedsPublicUrl ? 'Configure a public workspace URL before scheduling external video meetings.' : undefined}
            >
              {!createLoading && <Check className="h-4 w-4" />}
              {createLoading
                ? (isEditMode ? 'Updating...' : 'Saving...')
                : (isEditMode
                  ? 'Save Changes'
                  : (channelMode === 'content_creation' ? 'Save Content Schedule' : channelMode === 'video_call' ? 'Save Video Schedule' : 'Save Call Schedule'))}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
