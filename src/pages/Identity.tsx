import { useState, useEffect, useRef } from 'react'
import { Save, Orbit, Check, Ban, Eye, EyeOff, Edit3, X, RefreshCw, ChevronDown, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { generateId } from '../lib/utils'
import { api } from '../lib/api'
import type { AuthorityRule, CallingIdentityMode, TwinProfile } from '../types'
import type {
  CredentialSettings,
  TwilioOutboundLine,
  TwilioVerificationRequestResult,
  TwilioVerifiedNumber,
} from '../lib/api'

const EMPTY_CREDS: CredentialSettings = {
  KIMI_API_KEY: '',
  KIMI_BASE_URL: 'https://api.moonshot.ai/v1',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  TWIN_PUBLIC_BASE_URL: '',
  ELEVENLABS_API_KEY: '',
  ELEVENLABS_VOICE_ID: '',
  ELEVENLABS_AGENT_ID: '',
  ELEVENLABS_PHONE_NUMBER_ID: '',
  LIVEAVATAR_API_KEY: '',
  LIVEAVATAR_AVATAR_ID: '',
  DEEPGRAM_API_KEY: '',
  LIVEKIT_URL: '',
  LIVEKIT_API_KEY: '',
  LIVEKIT_API_SECRET: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_PHONE_NUMBER: '',
  HEYGEN_API_KEY: '',
  TWIN_SUMMARY_LANGUAGE: 'en',
}

const IDENTITY_SENSITIVE_INFO_KEY = 'twin-identity-hide-sensitive-info'
const VERIFIED_CALLER_IDS_VISIBILITY_KEY = 'twin-identity-show-verified-caller-ids'
const VERIFIED_CALLER_IDS_OPEN_KEY = 'twin-identity-verified-caller-ids-open'
const VOICE_MODEL_OPTIONS = [
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5', description: 'Balanced multilingual' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5', description: 'Fast multilingual' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2', description: 'Long-form multilingual' },
  { value: 'eleven_turbo_v2', label: 'Turbo v2', description: 'English-first legacy' },
  { value: 'eleven_flash_v2', label: 'Flash v2', description: 'Fast English-first legacy' },
] as const

function parseListField(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatListField(value: string[] | undefined) {
  return (value ?? []).join('\n')
}

function buildPersonaPreview(profile: TwinProfile) {
  const domainFamiliarity = profile.domainFamiliarity ?? []
  const boundaryRules = profile.boundaryRules ?? []
  const doNotSay = profile.doNotSay ?? []
  const parts = [
    profile.profession ? `Role/background: ${profile.profession}.` : '',
    profile.socialTone ? `Social tone: ${profile.socialTone}.` : '',
    profile.interactionStyle ? `Interaction style: ${profile.interactionStyle}.` : '',
    domainFamiliarity.length ? `Familiar domains: ${domainFamiliarity.join(', ')}.` : '',
    boundaryRules.length ? `Boundaries: ${boundaryRules.join('; ')}.` : '',
    doNotSay.length ? `Avoid: ${doNotSay.join('; ')}.` : '',
    profile.persona ? `Additional notes: ${profile.persona}` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

function normalizeProfileForm(profile: TwinProfile): TwinProfile {
  return {
    ...profile,
    profession: profile.profession ?? '',
    socialTone: profile.socialTone ?? '',
    interactionStyle: profile.interactionStyle ?? '',
    domainFamiliarity: profile.domainFamiliarity ?? [],
    boundaryRules: profile.boundaryRules ?? [],
    doNotSay: profile.doNotSay ?? [],
    persona: profile.persona ?? '',
    firstMessage: profile.firstMessage ?? '',
  }
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '')
}

function maskPhone(value: string) {
  let digitIndex = 0
  const totalDigits = value.replace(/\D/g, '').length
  return value.replace(/\d/g, (digit) => {
    digitIndex += 1
    return digitIndex <= Math.max(totalDigits - 2, 0) ? '*' : digit
  })
}

function normalizeOutboundLabel(value: string) {
  return value.replace(/^Twin\b/i, 'Twin')
}

function detectFirstMessageLanguageMismatch(language: string, firstMessage: string) {
  const text = firstMessage.trim()
  if (!text) return null

  const lower = text.toLowerCase()
  const looksTurkish =
    /[çğıöşü]/i.test(text) ||
    /\b(merhaba|selam|ben|arıyorum|adına|için)\b/.test(lower)
  const looksEnglish =
    /\b(hello|hi|i'm|i am|calling|on behalf of|for)\b/.test(lower)

  if (language.startsWith('tr') && looksEnglish && !looksTurkish) {
    return 'Language is set to Turkish, but the first message looks English.'
  }
  if (language.startsWith('en') && looksTurkish && !looksEnglish) {
    return 'Language is set to English, but the first message looks Turkish.'
  }
  return null
}

function detectVoiceModelLanguageMismatch(language: string, voiceModel: string) {
  const normalizedLanguage = language.trim().toLowerCase()
  const normalizedModel = voiceModel.trim().toLowerCase()
  const isEnglish = normalizedLanguage.startsWith('en')
  const isLegacyEnglishOnlyModel =
    normalizedModel === 'eleven_turbo_v2' || normalizedModel === 'eleven_flash_v2'

  if (!isEnglish && isLegacyEnglishOnlyModel) {
    return 'Language is set to a non-English language, but this voice model is English-only for ElevenLabs Agents. Use Turbo v2.5 or Flash v2.5 instead.'
  }
  return null
}

export function Identity() {
  return <IdentityWorkspaceView mode="identity" />
}

export function VoiceVideoSettings() {
  return <IdentityWorkspaceView mode="voice-video" />
}

export function IntegrationsSettings() {
  return <IdentityWorkspaceView mode="integrations" />
}

function IdentityWorkspaceView({ mode }: { mode: 'identity' | 'voice-video' | 'integrations' }) {
  const { profile, updateProfile } = useStore()
  const [form, setForm] = useState(() => normalizeProfileForm(profile))
  const [initialForm, setInitialForm] = useState(() => normalizeProfileForm(profile))
  const [domainFamiliarityText, setDomainFamiliarityText] = useState(() => formatListField(profile.domainFamiliarity))
  const [boundaryRulesText, setBoundaryRulesText] = useState(() => formatListField(profile.boundaryRules))
  const [doNotSayText, setDoNotSayText] = useState(() => formatListField(profile.doNotSay))
  const [isEditing, setIsEditing] = useState(false)
  const [isEditingVoiceCall, setIsEditingVoiceCall] = useState(false)
  const [isEditingAvatar, setIsEditingAvatar] = useState(false)
  const [isEditingIntegrations, setIsEditingIntegrations] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [creds, setCreds] = useState<CredentialSettings>(EMPTY_CREDS)
  const [initialCreds, setInitialCreds] = useState<CredentialSettings>(EMPTY_CREDS)
  const [voiceCallSaved, setVoiceCallSaved] = useState(false)
  const [avatarSaved, setAvatarSaved] = useState(false)
  const [integrationsSaved, setIntegrationsSaved] = useState(false)
  const [credsLoading, setCredsLoading] = useState(true)
  const [verifiedCallerIdsOpen, setVerifiedCallerIdsOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(VERIFIED_CALLER_IDS_OPEN_KEY)
    return stored === null ? true : stored === 'true'
  })
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {} as Record<string, boolean>
    return {
      VERIFIED_CALLER_IDS: window.localStorage.getItem(VERIFIED_CALLER_IDS_VISIBILITY_KEY) === 'true',
    }
  })
  const [verifiedNumbers, setVerifiedNumbers] = useState<TwilioVerifiedNumber[]>([])
  const [outboundLines, setOutboundLines] = useState<TwilioOutboundLine[]>([])
  const [verifiedLoading, setVerifiedLoading] = useState(false)
  const [verifiedError, setVerifiedError] = useState('')
  const [outboundLineLoading, setOutboundLineLoading] = useState(false)
  const [outboundLineError, setOutboundLineError] = useState('')
  const [voiceCallSaveError, setVoiceCallSaveError] = useState('')
  const [switchingOutboundPhone, setSwitchingOutboundPhone] = useState('')
  const [verificationForm, setVerificationForm] = useState({ phoneNumber: '', friendlyName: '' })
  const [verificationResult, setVerificationResult] = useState<TwilioVerificationRequestResult | null>(null)
  const firstMessageLanguageWarning = detectFirstMessageLanguageMismatch(form.language, form.firstMessage ?? '')
  const voiceModelLanguageWarning = detectVoiceModelLanguageMismatch(form.language, form.voiceModel)
  const personaPreview = buildPersonaPreview(form)
  const [verificationLoading, setVerificationLoading] = useState(false)
  const [verificationError, setVerificationError] = useState('')
  const [removingVerifiedSid, setRemovingVerifiedSid] = useState('')
  const [hideSensitiveInfo, setHideSensitiveInfo] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(IDENTITY_SENSITIVE_INFO_KEY) === 'true'
  })
  const activeOutboundLine = outboundLines.find(
    (entry) => entry.phone_number_id === creds.ELEVENLABS_PHONE_NUMBER_ID
  )
  const showIdentitySections = mode === 'identity'
  const showVoiceVideoSections = mode === 'voice-video'
  const showIntegrationsSections = mode === 'integrations'
  const isEditingRef = useRef(false)
  const pageTitle =
    mode === 'identity' ? 'Identity' : mode === 'voice-video' ? 'Voice & Video' : 'Integrations'
  const pageSubtitle =
    mode === 'identity'
      ? 'How Twin represents you'
      : mode === 'voice-video'
        ? 'How Twin sounds, appears, and performs across voice and video'
        : 'Provider and runtime credentials used by the Twin control-plane'

  useEffect(() => {
    isEditingRef.current = isEditing
  }, [isEditing])

  useEffect(() => {
    api.profile.get()
      .then((remote) => {
        const { profile: currentProfile, updateProfile: applyProfile } = useStore.getState()
        const patch: Partial<TwinProfile> = {
          name: typeof remote.name === 'string' ? remote.name : currentProfile.name,
          language: typeof remote.language === 'string' ? remote.language : currentProfile.language,
          voiceModel: typeof remote.voice_model === 'string' ? remote.voice_model : currentProfile.voiceModel,
          profession: typeof remote.profession === 'string' ? remote.profession : currentProfile.profession,
          socialTone: typeof remote.social_tone === 'string' ? remote.social_tone : currentProfile.socialTone,
          interactionStyle: typeof remote.interaction_style === 'string' ? remote.interaction_style : currentProfile.interactionStyle,
          domainFamiliarity: Array.isArray(remote.domain_familiarity)
            ? remote.domain_familiarity.filter((item): item is string => typeof item === 'string')
            : currentProfile.domainFamiliarity,
          boundaryRules: Array.isArray(remote.boundary_rules)
            ? remote.boundary_rules.filter((item): item is string => typeof item === 'string')
            : currentProfile.boundaryRules,
          doNotSay: Array.isArray(remote.do_not_say)
            ? remote.do_not_say.filter((item): item is string => typeof item === 'string')
            : currentProfile.doNotSay,
          persona: typeof remote.persona === 'string' ? remote.persona : currentProfile.persona,
          firstMessage: typeof remote.first_message === 'string' ? remote.first_message : currentProfile.firstMessage,
          callingIdentityMode: remote.calling_identity_mode === 'assistant_on_behalf'
            ? 'assistant_on_behalf'
            : 'personal_twin',
          elevenLabsVoiceId: typeof remote.voice_id === 'string' ? remote.voice_id : currentProfile.elevenLabsVoiceId,
          avatarProvider: 'heygen',
          heygenAvatarId: typeof remote.heygen_avatar_id === 'string' ? remote.heygen_avatar_id : currentProfile.heygenAvatarId,
          heygenAvatarGroupId: typeof remote.heygen_avatar_group_id === 'string' ? remote.heygen_avatar_group_id : currentProfile.heygenAvatarGroupId,
          heygenVoiceId: typeof remote.heygen_voice_id === 'string' ? remote.heygen_voice_id : currentProfile.heygenVoiceId,
          defaultVideoOrientation: remote.default_video_orientation === 'landscape'
            ? 'landscape'
            : 'portrait',
          voiceTuning: {
            stability: typeof remote.stability === 'number' ? remote.stability : currentProfile.voiceTuning.stability,
            similarityBoost: typeof remote.similarity_boost === 'number' ? remote.similarity_boost : currentProfile.voiceTuning.similarityBoost,
            speed: typeof remote.speed === 'number' ? remote.speed : currentProfile.voiceTuning.speed,
          },
          defaultAuthorityRules: currentProfile.defaultAuthorityRules,
        }
        applyProfile(patch)
        setInitialForm((prev) => ({ ...prev, ...patch }))
        if (!isEditingRef.current) {
          setForm((prev) => ({ ...prev, ...patch }))
          setDomainFamiliarityText(formatListField(patch.domainFamiliarity))
          setBoundaryRulesText(formatListField(patch.boundaryRules))
          setDoNotSayText(formatListField(patch.doNotSay))
        }
      })
      .catch(() => undefined)

    api.settings.get()
      .then((loadedCreds) => {
        setCreds(loadedCreds)
        setInitialCreds(loadedCreds)
        return api.twilio.listVerifiedNumbers()
          .then((data) => {
            setVerifiedNumbers(data.verified_numbers)
          })
          .catch((error) => {
            setVerifiedError(error instanceof Error ? error.message : 'Unable to load verified numbers')
          })
          .then(() =>
            api.twilio.listOutboundLines()
              .then((data) => {
                setOutboundLines(data.outbound_lines)
              })
              .catch((error) => {
                setOutboundLineError(error instanceof Error ? error.message : 'Unable to load outbound lines')
              })
          )
      })
      .finally(() => setCredsLoading(false))

  }, [])

  useEffect(() => {
    if (!verificationResult) return
    const intervalId = window.setInterval(() => {
      void loadVerifiedNumbers()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [verificationResult])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(IDENTITY_SENSITIVE_INFO_KEY, String(hideSensitiveInfo))
    }
  }, [hideSensitiveInfo])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        VERIFIED_CALLER_IDS_VISIBILITY_KEY,
        String(Boolean(showSecrets.VERIFIED_CALLER_IDS))
      )
    }
  }, [showSecrets])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VERIFIED_CALLER_IDS_OPEN_KEY, String(Boolean(verifiedCallerIdsOpen)))
    }
  }, [verifiedCallerIdsOpen])

  async function loadVerifiedNumbers() {
    setVerifiedLoading(true)
    setVerifiedError('')
    try {
      const data = await api.twilio.listVerifiedNumbers()
      setVerifiedNumbers(data.verified_numbers)
      setVerificationResult((current) => {
        if (!current) return null
        const isNowVerified = data.verified_numbers.some(
          (item) => normalizePhone(item.phone_number) === normalizePhone(current.phone_number)
        )
        return isNowVerified ? null : current
      })
    } catch (error) {
      setVerifiedError(error instanceof Error ? error.message : 'Unable to load verified numbers')
    } finally {
      setVerifiedLoading(false)
    }
  }

  async function loadOutboundLines() {
    setOutboundLineLoading(true)
    setOutboundLineError('')
    try {
      const data = await api.twilio.listOutboundLines()
      setOutboundLines(data.outbound_lines)
    } catch (error) {
      setOutboundLineError(error instanceof Error ? error.message : 'Unable to load outbound lines')
    } finally {
      setOutboundLineLoading(false)
    }
  }

  async function loadCredentialSettings() {
    const loadedCreds = await api.settings.get()
    setCreds(loadedCreds)
    setInitialCreds(loadedCreds)
  }

  async function refreshCallingNumbers() {
    await Promise.all([loadCredentialSettings(), loadVerifiedNumbers(), loadOutboundLines()])
  }

  async function handleUseOutboundLine(line: TwilioOutboundLine) {
    setSwitchingOutboundPhone(line.phone_number)
    setOutboundLineError('')
    try {
      const result = await api.twilio.activateOutboundLine({ phone_number_id: line.phone_number_id })
      setCreds((current) => ({
        ...current,
        ELEVENLABS_PHONE_NUMBER_ID: result.phone_number_id,
        TWILIO_PHONE_NUMBER: result.phone_number,
      }))
      setInitialCreds((current) => ({
        ...current,
        ELEVENLABS_PHONE_NUMBER_ID: result.phone_number_id,
        TWILIO_PHONE_NUMBER: result.phone_number,
      }))
      await loadOutboundLines()
    } catch (error) {
      setOutboundLineError(error instanceof Error ? error.message : 'Unable to switch outbound line')
    } finally {
      setSwitchingOutboundPhone('')
    }
  }

  async function handleImportAndUseVerifiedNumber(entry: TwilioVerifiedNumber) {
    setSwitchingOutboundPhone(entry.phone_number)
    setOutboundLineError('')
    try {
      const importedLine = await api.twilio.importOutboundLine({
        phone_number: entry.phone_number,
        label: entry.friendly_name ?? entry.phone_number,
      })
      const result = await api.twilio.activateOutboundLine({ phone_number_id: importedLine.phone_number_id })
      setCreds((current) => ({
        ...current,
        ELEVENLABS_PHONE_NUMBER_ID: result.phone_number_id,
        TWILIO_PHONE_NUMBER: result.phone_number,
      }))
      setInitialCreds((current) => ({
        ...current,
        ELEVENLABS_PHONE_NUMBER_ID: result.phone_number_id,
        TWILIO_PHONE_NUMBER: result.phone_number,
      }))
      await loadOutboundLines()
    } catch (error) {
      setOutboundLineError(error instanceof Error ? error.message : 'Unable to import this verified number')
    } finally {
      setSwitchingOutboundPhone('')
    }
  }

  async function handleDeleteOutboundLine(line: TwilioOutboundLine) {
    const confirmed = window.confirm(
      `Remove ${line.label || line.phone_number} from available outbound lines?`
    )
    if (!confirmed) return

    setSwitchingOutboundPhone(line.phone_number)
    setOutboundLineError('')
    try {
      await api.twilio.deleteOutboundLine({ phone_number_id: line.phone_number_id })
      await refreshCallingNumbers()
    } catch (error) {
      setOutboundLineError(error instanceof Error ? error.message : 'Unable to remove outbound line')
    } finally {
      setSwitchingOutboundPhone('')
    }
  }

  async function handleStartVerification() {
    if (!verificationForm.phoneNumber.trim()) {
      setVerificationError('Phone number required')
      return
    }
    setVerificationLoading(true)
    setVerificationError('')
    setVerificationResult(null)
    try {
      const result = await api.twilio.createVerifiedNumberRequest({
        phone_number: verificationForm.phoneNumber.trim(),
        friendly_name: verificationForm.friendlyName.trim() || undefined,
      })
      setVerificationResult(result)
      setVerificationForm({ phoneNumber: '', friendlyName: '' })
      await loadVerifiedNumbers()
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : 'Unable to start verification')
    } finally {
      setVerificationLoading(false)
    }
  }

  async function handleRemoveVerifiedNumber(entry: TwilioVerifiedNumber) {
    const confirmed = window.confirm(`Remove verified number ${entry.phone_number}?`)
    if (!confirmed) return

    setRemovingVerifiedSid(entry.sid)
    setVerifiedError('')
    try {
      await api.twilio.deleteVerifiedNumber({ sid: entry.sid })
      await refreshCallingNumbers()
    } catch (error) {
      setVerifiedError(error instanceof Error ? error.message : 'Unable to remove verified number')
    } finally {
      setRemovingVerifiedSid('')
    }
  }

  function toggleShow(key: string) {
    setShowSecrets(p => ({ ...p, [key]: !p[key] }))
  }

  function toggleRule(id: string) {
    setForm((p) => ({
      ...p,
      defaultAuthorityRules: p.defaultAuthorityRules.map((r) =>
        r.id === id ? { ...r, allowed: !r.allowed } : r
      ),
    }))
  }

  function addRule() {
    const rule: AuthorityRule = { id: generateId(), label: 'New rule', allowed: true }
    setForm((p) => ({ ...p, defaultAuthorityRules: [...p.defaultAuthorityRules, rule] }))
  }

  function updateRuleLabel(id: string, label: string) {
    setForm((p) => ({
      ...p,
      defaultAuthorityRules: p.defaultAuthorityRules.map((r) =>
        r.id === id ? { ...r, label } : r
      ),
    }))
  }

  function removeRule(id: string) {
    setForm((p) => ({ ...p, defaultAuthorityRules: p.defaultAuthorityRules.filter((r) => r.id !== id) }))
  }

  async function handleSave() {
    if (voiceModelLanguageWarning) {
      setVoiceCallSaveError(voiceModelLanguageWarning)
      return
    }
    setVoiceCallSaveError('')
    setSaveError('')
    const nextForm = {
      ...form,
      domainFamiliarity: parseListField(domainFamiliarityText),
      boundaryRules: parseListField(boundaryRulesText),
      doNotSay: parseListField(doNotSayText),
    }
    setForm(nextForm)
    updateProfile(nextForm)
    try {
      const remote = await api.profile.update({
        name: nextForm.name,
        language: nextForm.language,
        voice_model: nextForm.voiceModel,
        stability: nextForm.voiceTuning.stability,
        similarity_boost: nextForm.voiceTuning.similarityBoost,
        speed: nextForm.voiceTuning.speed,
        profession: nextForm.profession,
        social_tone: nextForm.socialTone,
        interaction_style: nextForm.interactionStyle,
        domain_familiarity: nextForm.domainFamiliarity,
        boundary_rules: nextForm.boundaryRules,
        do_not_say: nextForm.doNotSay,
        persona: nextForm.persona,
        first_message: nextForm.firstMessage ?? '',
        calling_identity_mode: nextForm.callingIdentityMode,
        avatar_provider: 'heygen',
        heygen_avatar_id: nextForm.heygenAvatarId,
        heygen_avatar_group_id: nextForm.heygenAvatarGroupId,
        heygen_voice_id: nextForm.heygenVoiceId,
        default_video_orientation: nextForm.defaultVideoOrientation,
      })
      await api.settings.update({
        ELEVENLABS_VOICE_ID: nextForm.elevenLabsVoiceId ?? '',
      })
      const normalizedForm = {
        ...nextForm,
        persona: typeof remote.persona === 'string' ? remote.persona : nextForm.persona,
      }
      setForm(normalizedForm)
      setInitialForm(normalizedForm)
      updateProfile(normalizedForm)
      setIsEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Profile could not be saved.')
    }
  }

  function handleCancelEdit() {
    setForm(initialForm)
    setDomainFamiliarityText(formatListField(initialForm.domainFamiliarity))
    setBoundaryRulesText(formatListField(initialForm.boundaryRules))
    setDoNotSayText(formatListField(initialForm.doNotSay))
    setIsEditing(false)
    setSaved(false)
    setSaveError('')
  }

  async function handleVoiceCallSave() {
    if (voiceModelLanguageWarning) {
      setVoiceCallSaveError(voiceModelLanguageWarning)
      return
    }
    setVoiceCallSaveError('')
    updateProfile(form)
    await Promise.all([
      api.profile.update({
        voice_model: form.voiceModel,
        stability: form.voiceTuning.stability,
        similarity_boost: form.voiceTuning.similarityBoost,
        speed: form.voiceTuning.speed,
        first_message: form.firstMessage ?? '',
        calling_identity_mode: form.callingIdentityMode,
      }),
      api.settings.update({
        ELEVENLABS_VOICE_ID: form.elevenLabsVoiceId ?? '',
        ELEVENLABS_AGENT_ID: creds.ELEVENLABS_AGENT_ID,
        ELEVENLABS_PHONE_NUMBER_ID: creds.ELEVENLABS_PHONE_NUMBER_ID,
        TWILIO_PHONE_NUMBER: creds.TWILIO_PHONE_NUMBER,
        TWIN_SUMMARY_LANGUAGE: creds.TWIN_SUMMARY_LANGUAGE,
      }),
    ])
    setInitialForm(form)
    setInitialCreds(creds)
    setIsEditingVoiceCall(false)
    setVoiceCallSaved(true)
    setTimeout(() => setVoiceCallSaved(false), 2000)
  }

  function handleVoiceCallCancel() {
    setVoiceCallSaveError('')
    setForm((prev) => ({
      ...prev,
      voiceModel: initialForm.voiceModel,
      firstMessage: initialForm.firstMessage,
      callingIdentityMode: initialForm.callingIdentityMode,
      elevenLabsVoiceId: initialForm.elevenLabsVoiceId,
      voiceTuning: initialForm.voiceTuning,
    }))
    setCreds((prev) => ({
      ...prev,
      ELEVENLABS_VOICE_ID: initialCreds.ELEVENLABS_VOICE_ID,
      ELEVENLABS_AGENT_ID: initialCreds.ELEVENLABS_AGENT_ID,
      ELEVENLABS_PHONE_NUMBER_ID: initialCreds.ELEVENLABS_PHONE_NUMBER_ID,
      TWILIO_PHONE_NUMBER: initialCreds.TWILIO_PHONE_NUMBER,
      TWIN_SUMMARY_LANGUAGE: initialCreds.TWIN_SUMMARY_LANGUAGE,
    }))
    setIsEditingVoiceCall(false)
    setVoiceCallSaved(false)
  }

  async function handleAvatarSave() {
    updateProfile(form)
    await Promise.all([
      api.profile.update({
        avatar_provider: 'heygen',
        heygen_avatar_id: form.heygenAvatarId,
        heygen_avatar_group_id: form.heygenAvatarGroupId,
        heygen_voice_id: form.heygenVoiceId,
        default_video_orientation: form.defaultVideoOrientation,
      }),
      api.settings.update({
        LIVEAVATAR_AVATAR_ID: creds.LIVEAVATAR_AVATAR_ID,
      }),
    ])
    setInitialForm(form)
    setInitialCreds(creds)
    setIsEditingAvatar(false)
    setAvatarSaved(true)
    setTimeout(() => setAvatarSaved(false), 2000)
  }

  function handleAvatarCancel() {
    setForm((prev) => ({
      ...prev,
      heygenAvatarId: initialForm.heygenAvatarId,
      heygenAvatarGroupId: initialForm.heygenAvatarGroupId,
      heygenVoiceId: initialForm.heygenVoiceId,
      defaultVideoOrientation: initialForm.defaultVideoOrientation,
    }))
    setCreds((prev) => ({
      ...prev,
      LIVEAVATAR_AVATAR_ID: initialCreds.LIVEAVATAR_AVATAR_ID,
    }))
    setIsEditingAvatar(false)
    setAvatarSaved(false)
  }

  async function handleIntegrationsSave() {
    await api.settings.update({
      KIMI_API_KEY: creds.KIMI_API_KEY,
      KIMI_BASE_URL: creds.KIMI_BASE_URL,
      OPENAI_API_KEY: creds.OPENAI_API_KEY,
      OPENAI_BASE_URL: creds.OPENAI_BASE_URL,
      ELEVENLABS_API_KEY: creds.ELEVENLABS_API_KEY,
      DEEPGRAM_API_KEY: creds.DEEPGRAM_API_KEY,
      LIVEKIT_URL: creds.LIVEKIT_URL,
      LIVEKIT_API_KEY: creds.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: creds.LIVEKIT_API_SECRET,
      TWILIO_ACCOUNT_SID: creds.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: creds.TWILIO_AUTH_TOKEN,
      HEYGEN_API_KEY: creds.HEYGEN_API_KEY,
      LIVEAVATAR_API_KEY: creds.LIVEAVATAR_API_KEY,
    })
    setInitialCreds(creds)
    setIsEditingIntegrations(false)
    setIntegrationsSaved(true)
    setTimeout(() => setIntegrationsSaved(false), 2000)
  }

  function handleIntegrationsCancel() {
    setCreds((prev) => ({
      ...prev,
      KIMI_API_KEY: initialCreds.KIMI_API_KEY,
      KIMI_BASE_URL: initialCreds.KIMI_BASE_URL,
      OPENAI_API_KEY: initialCreds.OPENAI_API_KEY,
      OPENAI_BASE_URL: initialCreds.OPENAI_BASE_URL,
      ELEVENLABS_API_KEY: initialCreds.ELEVENLABS_API_KEY,
      DEEPGRAM_API_KEY: initialCreds.DEEPGRAM_API_KEY,
      LIVEKIT_URL: initialCreds.LIVEKIT_URL,
      LIVEKIT_API_KEY: initialCreds.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: initialCreds.LIVEKIT_API_SECRET,
      TWILIO_ACCOUNT_SID: initialCreds.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: initialCreds.TWILIO_AUTH_TOKEN,
      HEYGEN_API_KEY: initialCreds.HEYGEN_API_KEY,
      LIVEAVATAR_API_KEY: initialCreds.LIVEAVATAR_API_KEY,
    }))
    setIsEditingIntegrations(false)
    setIntegrationsSaved(false)
  }

  return (
    <div className="white-arrow-surface mx-auto max-w-xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand)] shadow-sm">
            <Orbit className="h-6 w-6 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">{pageTitle}</h1>
            <p className="text-xs text-[var(--text-muted)]">{pageSubtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHideSensitiveInfo((current) => !current)}
          aria-label={hideSensitiveInfo ? 'Show sensitive info' : 'Hide sensitive info'}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {hideSensitiveInfo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="space-y-5">
        {showIdentitySections ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Profile</h2>
            <div className="flex items-center gap-2">
              {isEditing && (
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {isEditing ? (
                <Button variant="primary" size="sm" onClick={handleSave}>
                  {saved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => { setIsEditing(true); setSaved(false) }}>
                  {saved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Edit3 className="h-3.5 w-3.5" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          {saveError ? <p className="mb-3 text-xs text-red-600">{saveError}</p> : null}
          <div className="space-y-4">
            <Input
              label="Name"
              value={form.name}
              disabled={!isEditing}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Language</label>
                <select
                  value={form.language}
                  disabled={!isEditing}
                  onChange={(e) => {
                    setVoiceCallSaveError('')
                    setForm((p) => ({ ...p, language: e.target.value }))
                  }}
                  className={`w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-indigo-400 ${isEditing ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-muted)] opacity-80 cursor-not-allowed'}`}
                >
                  <option value="tr-TR">Turkish (tr-TR)</option>
                  <option value="en-US">English (en-US)</option>
                  <option value="en-GB">English (en-GB)</option>
                </select>
              </div>
            </div>
          </div>
        </Card>
        ) : null}

        {showIdentitySections ? (
        <Card>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Persona</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Role / background"
              value={form.profession}
              disabled={!isEditing}
              onChange={(e) => setForm((p) => ({ ...p, profession: e.target.value }))}
            />
            <Input
              label="Social tone"
              value={form.socialTone}
              disabled={!isEditing}
              onChange={(e) => setForm((p) => ({ ...p, socialTone: e.target.value }))}
            />
          </div>
          <div className="mt-3">
            <Textarea
              label="Interaction style"
              value={form.interactionStyle}
              disabled={!isEditing}
              onChange={(e) => setForm((p) => ({ ...p, interactionStyle: e.target.value }))}
              rows={3}
              hint="How Twin should react in live conversation: first person, short replies, natural follow-ups, formality level."
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Textarea
              label="Domain familiarity"
              value={domainFamiliarityText}
              disabled={!isEditing}
              onChange={(e) => setDomainFamiliarityText(e.target.value)}
              rows={4}
              hint="One topic per line."
            />
            <Textarea
              label="Boundary rules"
              value={boundaryRulesText}
              disabled={!isEditing}
              onChange={(e) => setBoundaryRulesText(e.target.value)}
              rows={4}
              hint="One rule per line."
            />
            <Textarea
              label="Avoid saying / doing"
              value={doNotSayText}
              disabled={!isEditing}
              onChange={(e) => setDoNotSayText(e.target.value)}
              rows={4}
              hint="One item per line."
            />
          </div>
          <div className="mt-3">
            <Textarea
              label="Additional persona notes"
              value={form.persona}
              disabled={!isEditing}
              onChange={(e) => setForm((p) => ({ ...p, persona: e.target.value }))}
              rows={4}
              hint="Optional freeform notes that still get injected into prompt generation."
            />
          </div>
          <div className="mt-3">
            <Textarea
              label="Compiled prompt preview"
              value={personaPreview}
              disabled
              rows={6}
              hint="This is the merged persona summary generated from the structured fields above."
            />
          </div>
        </Card>
        ) : null}

        {showVoiceVideoSections ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Voice call</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">ElevenLabs and telephony settings used for calls.</p>
            </div>
            <div className="flex items-center gap-2">
              {isEditingVoiceCall && (
                <Button variant="ghost" size="sm" onClick={handleVoiceCallCancel}>
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {isEditingVoiceCall ? (
                <Button variant="primary" size="sm" onClick={handleVoiceCallSave}>
                  {voiceCallSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => { setIsEditingVoiceCall(true); setVoiceCallSaved(false) }}>
                  {voiceCallSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Edit3 className="h-3.5 w-3.5" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Voice model</label>
                <select
                  value={form.voiceModel}
                  disabled={!isEditingVoiceCall}
                  onChange={(e) => {
                    setVoiceCallSaveError('')
                    setForm((p) => ({ ...p, voiceModel: e.target.value }))
                  }}
                  className={`w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-indigo-400 ${isEditingVoiceCall ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-muted)] opacity-80 cursor-not-allowed'}`}
                >
                  {VOICE_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.description})
                    </option>
                  ))}
                </select>
                {voiceModelLanguageWarning && (
                  <p className="mt-2 text-xs text-red-600">{voiceModelLanguageWarning}</p>
                )}
                {voiceCallSaveError && !voiceModelLanguageWarning && (
                  <p className="mt-2 text-xs text-red-600">{voiceCallSaveError}</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Call log summary language</label>
                <select
                  value={creds.TWIN_SUMMARY_LANGUAGE || 'en'}
                  disabled={!isEditingVoiceCall}
                  onChange={(e) => setCreds((p) => ({ ...p, TWIN_SUMMARY_LANGUAGE: e.target.value }))}
                  className={`w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-indigo-400 ${isEditingVoiceCall ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-muted)] opacity-80 cursor-not-allowed'}`}
                >
                  <option value="en">English (default)</option>
                  <option value="tr">Turkish</option>
                </select>
              </div>
            </div>

            <Input
              label="First message"
              value={form.firstMessage ?? ''}
              disabled={!isEditingVoiceCall}
              onChange={(e) => setForm((p) => ({ ...p, firstMessage: e.target.value }))}
              placeholder={form.callingIdentityMode === 'assistant_on_behalf'
                ? `Merhaba, ${form.name} adına arıyorum.`
                : `Merhaba, ben ${form.name}.`}
              hint={form.callingIdentityMode === 'assistant_on_behalf'
                ? 'Assistant mode uses an on-behalf-of introduction by default if this field is empty.'
                : 'Personal twin mode uses a first-person self-introduction by default if this field is empty.'}
            />
            {firstMessageLanguageWarning && (
              <p className="mt-2 text-xs text-red-600">{firstMessageLanguageWarning}</p>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Calling identity mode</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['personal_twin', 'Personal twin', 'Speak in first person as you. Best match for a personal verified line.'],
                  ['assistant_on_behalf', 'Assistant on behalf', 'Present the call as being made on your behalf instead of as you directly.'],
                ] as [CallingIdentityMode, string, string][]).map(([mode, label, description]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!isEditingVoiceCall}
                    onClick={() => setForm((p) => ({ ...p, callingIdentityMode: mode }))}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all ${
                      !isEditingVoiceCall
                        ? 'cursor-not-allowed opacity-80'
                        : 'cursor-pointer'
                    } ${
                      form.callingIdentityMode === mode
                        ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <span className="block text-[var(--text-primary)]">{label}</span>
                    <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Input
                label="ElevenLabs voice ID"
                className="pr-10"
                type={showSecrets.ELEVENLABS_VOICE_ID ? 'text' : 'password'}
                value={form.elevenLabsVoiceId ?? ''}
                disabled={!isEditingVoiceCall}
                onChange={(e) => {
                  const value = e.target.value
                  setForm((p) => ({ ...p, elevenLabsVoiceId: value }))
                  setCreds((p) => ({ ...p, ELEVENLABS_VOICE_ID: value }))
                }}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => toggleShow('ELEVENLABS_VOICE_ID')}
                className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showSecrets.ELEVENLABS_VOICE_ID ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Voice tuning</h3>
              <div className="space-y-4">
                {[
                  { key: 'stability' as const, label: 'Stability', min: 0, max: 1, step: 0.05 },
                  { key: 'similarityBoost' as const, label: 'Similarity boost', min: 0, max: 1, step: 0.05 },
                  { key: 'speed' as const, label: 'Speed', min: 0.7, max: 1.2, step: 0.01 },
                ].map(({ key, label, min, max, step }) => (
                  <div key={key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
                      <span className="text-xs tabular-nums text-[var(--text-muted)]">
                        {form.voiceTuning[key].toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={form.voiceTuning[key]}
                      disabled={!isEditingVoiceCall}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          voiceTuning: { ...p.voiceTuning, [key]: parseFloat(e.target.value) },
                        }))
                      }
                      className="w-full accent-indigo-600"
                    />
                  </div>
                ))}
              </div>
            </div>

            {credsLoading ? (
              <p className="text-xs text-[var(--text-muted)]">Loading call credentials...</p>
            ) : (
              <>
                <div>
                  <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">ElevenLabs</p>
                  <div className="space-y-3">
                    {([
                      { key: 'ELEVENLABS_AGENT_ID', label: 'Agent ID', secret: true },
                      { key: 'ELEVENLABS_PHONE_NUMBER_ID', label: 'Phone Number ID', secret: true },
                    ] as { key: keyof CredentialSettings; label: string; secret: boolean }[]).map(({ key, label, secret }) => (
                      <div key={key} className="relative">
                        <Input
                          label={label}
                          className={secret ? 'pr-10' : undefined}
                          type={(secret && !showSecrets[key]) || (hideSensitiveInfo && !isEditingVoiceCall) ? 'password' : 'text'}
                          value={creds[key]}
                          disabled={!isEditingVoiceCall}
                          onChange={e => setCreds(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={secret ? '••••••••' : ''}
                        />
                        {secret && (
                          <button
                            type="button"
                            onClick={() => toggleShow(key)}
                            className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            {showSecrets[key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Twilio</p>
                  <div className="space-y-3">
                    {([
                      { key: 'TWILIO_PHONE_NUMBER', label: 'Phone Number', secret: true },
                    ] as { key: keyof CredentialSettings; label: string; secret: boolean }[]).map(({ key, label, secret }) => (
                      <div key={key} className="relative">
                        <Input
                          label={label}
                          className={secret ? 'pr-10' : undefined}
                          type={(secret && !showSecrets[key]) || (hideSensitiveInfo && !isEditingVoiceCall) ? 'password' : 'text'}
                          value={creds[key]}
                          disabled={!isEditingVoiceCall}
                          onChange={e => setCreds(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={secret ? '••••••••' : ''}
                        />
                        {secret && (
                          <button
                            type="button"
                            onClick={() => toggleShow(key)}
                            className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            {showSecrets[key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
        ) : null}

        {showVoiceVideoSections ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Avatar & video</h2>
            <div className="flex items-center gap-2">
              {isEditingAvatar && (
                <Button variant="ghost" size="sm" onClick={handleAvatarCancel}>
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {isEditingAvatar ? (
                <Button variant="primary" size="sm" onClick={handleAvatarSave}>
                  {avatarSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => { setIsEditingAvatar(true); setAvatarSaved(false) }}>
                  {avatarSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Edit3 className="h-3.5 w-3.5" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Avatar provider</label>
                <div className="flex h-[42px] items-center rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 text-sm font-medium text-[var(--text-primary)]">
                  HeyGen
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Default orientation</label>
                <select
                  value={form.defaultVideoOrientation ?? 'portrait'}
                  disabled={!isEditingAvatar}
                  onChange={(e) => setForm((p) => ({
                    ...p,
                    defaultVideoOrientation: e.target.value === 'landscape' ? 'landscape' : 'portrait',
                  }))}
                  className={`w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-indigo-400 ${isEditingAvatar ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-muted)] opacity-80 cursor-not-allowed'}`}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
            </div>

            <div className="relative">
              <Input
                label="HeyGen avatar ID"
                className="pr-10"
                type={showSecrets.HEYGEN_AVATAR_ID ? 'text' : 'password'}
                value={form.heygenAvatarId ?? ''}
                disabled={!isEditingAvatar}
                onChange={(e) => setForm((p) => ({ ...p, heygenAvatarId: e.target.value }))}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => toggleShow('HEYGEN_AVATAR_ID')}
                className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showSecrets.HEYGEN_AVATAR_ID ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="relative">
              <Input
                label="HeyGen voice ID"
                className="pr-10"
                type={showSecrets.HEYGEN_VOICE_ID ? 'text' : 'password'}
                value={form.heygenVoiceId ?? ''}
                disabled={!isEditingAvatar}
                onChange={(e) => setForm((p) => ({ ...p, heygenVoiceId: e.target.value }))}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => toggleShow('HEYGEN_VOICE_ID')}
                className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showSecrets.HEYGEN_VOICE_ID ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="relative">
              <Input
                label="LiveAvatar avatar ID"
                className="pr-10"
                type={showSecrets.LIVEAVATAR_AVATAR_ID ? 'text' : 'password'}
                value={creds.LIVEAVATAR_AVATAR_ID}
                disabled={!isEditingAvatar}
                onChange={e => setCreds(p => ({ ...p, LIVEAVATAR_AVATAR_ID: e.target.value }))}
                placeholder="lavtr_..."
              />
              <button
                type="button"
                onClick={() => toggleShow('LIVEAVATAR_AVATAR_ID')}
                className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showSecrets.LIVEAVATAR_AVATAR_ID ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="relative">
              <Input
                label="HeyGen avatar group ID"
                className="pr-10"
                type={showSecrets.HEYGEN_AVATAR_GROUP_ID ? 'text' : 'password'}
                value={form.heygenAvatarGroupId ?? ''}
                disabled={!isEditingAvatar}
                onChange={(e) => setForm((p) => ({ ...p, heygenAvatarGroupId: e.target.value }))}
                placeholder="••••••••"
                hint="Optional metadata."
              />
              <button
                type="button"
                onClick={() => toggleShow('HEYGEN_AVATAR_GROUP_ID')}
                className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showSecrets.HEYGEN_AVATAR_GROUP_ID ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </Card>
        ) : null}

        {showIntegrationsSections ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Integrations</h2>
            <div className="flex items-center gap-2">
              {isEditingIntegrations && (
                <Button variant="ghost" size="sm" onClick={handleIntegrationsCancel}>
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {isEditingIntegrations ? (
                <Button variant="primary" size="sm" onClick={handleIntegrationsSave}>
                  {integrationsSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => { setIsEditingIntegrations(true); setIntegrationsSaved(false) }}>
                  {integrationsSaved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Edit3 className="h-3.5 w-3.5" /> Edit</>}
                </Button>
              )}
            </div>
          </div>
          {credsLoading ? (
            <p className="text-xs text-[var(--text-muted)]">Loading...</p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Kimi</p>
                <div className="space-y-3">
                  <div className="relative">
                    <Input
                      label="API Key"
                      type={showSecrets.KIMI_API_KEY ? 'text' : 'password'}
                      value={creds.KIMI_API_KEY}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, KIMI_API_KEY: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('KIMI_API_KEY')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.KIMI_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Input
                    label="Base URL"
                    value={creds.KIMI_BASE_URL}
                    disabled={!isEditingIntegrations}
                    onChange={e => setCreds(p => ({ ...p, KIMI_BASE_URL: e.target.value }))}
                    placeholder="https://api.moonshot.ai/v1"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">OpenAI</p>
                <div className="space-y-3">
                  <div className="relative">
                    <Input
                      label="API Key"
                      type={showSecrets.OPENAI_API_KEY ? 'text' : 'password'}
                      value={creds.OPENAI_API_KEY}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, OPENAI_API_KEY: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('OPENAI_API_KEY')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.OPENAI_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Input
                    label="Base URL"
                    value={creds.OPENAI_BASE_URL}
                    disabled={!isEditingIntegrations}
                    onChange={e => setCreds(p => ({ ...p, OPENAI_BASE_URL: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">ElevenLabs</p>
                <div className="space-y-3">
                  <div className="relative">
                    <Input
                      label="API Key"
                      type={showSecrets.ELEVENLABS_API_KEY ? 'text' : 'password'}
                      value={creds.ELEVENLABS_API_KEY}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, ELEVENLABS_API_KEY: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('ELEVENLABS_API_KEY')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.ELEVENLABS_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">HeyGen</p>
                <div className="relative">
                  <Input
                    label="API Key"
                    type={showSecrets['HEYGEN_API_KEY'] ? 'text' : 'password'}
                    value={creds.HEYGEN_API_KEY}
                    disabled={!isEditingIntegrations}
                    onChange={e => setCreds(p => ({ ...p, HEYGEN_API_KEY: e.target.value }))}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShow('HEYGEN_API_KEY')}
                    className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {showSecrets['HEYGEN_API_KEY'] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">LiveAvatar</p>
                <div className="space-y-3">
                  <div className="relative">
                    <Input
                      label="API Key"
                      type={showSecrets.LIVEAVATAR_API_KEY ? 'text' : 'password'}
                      value={creds.LIVEAVATAR_API_KEY}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, LIVEAVATAR_API_KEY: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('LIVEAVATAR_API_KEY')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.LIVEAVATAR_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Deepgram</p>
                <div className="relative">
                  <Input
                    label="API Key"
                    type={showSecrets.DEEPGRAM_API_KEY ? 'text' : 'password'}
                    value={creds.DEEPGRAM_API_KEY}
                    disabled={!isEditingIntegrations}
                    onChange={e => setCreds(p => ({ ...p, DEEPGRAM_API_KEY: e.target.value }))}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShow('DEEPGRAM_API_KEY')}
                    className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {showSecrets.DEEPGRAM_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">LiveKit</p>
                <div className="space-y-3">
                  <Input
                    label="URL"
                    value={creds.LIVEKIT_URL}
                    disabled={!isEditingIntegrations}
                    onChange={e => setCreds(p => ({ ...p, LIVEKIT_URL: e.target.value }))}
                    placeholder="wss://your-project.livekit.cloud"
                  />
                  <div className="relative">
                    <Input
                      label="API Key"
                      type={showSecrets.LIVEKIT_API_KEY ? 'text' : 'password'}
                      value={creds.LIVEKIT_API_KEY}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, LIVEKIT_API_KEY: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('LIVEKIT_API_KEY')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.LIVEKIT_API_KEY ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      label="API Secret"
                      type={showSecrets.LIVEKIT_API_SECRET ? 'text' : 'password'}
                      value={creds.LIVEKIT_API_SECRET}
                      disabled={!isEditingIntegrations}
                      onChange={e => setCreds(p => ({ ...p, LIVEKIT_API_SECRET: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow('LIVEKIT_API_SECRET')}
                      className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showSecrets.LIVEKIT_API_SECRET ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Twilio</p>
                <div className="space-y-3">
                  {([
                    { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', secret: true },
                    { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', secret: true },
                  ] as { key: keyof CredentialSettings; label: string; secret: boolean }[]).map(({ key, label, secret }) => (
                    <div key={key} className="relative">
                      <Input
                        label={label}
                        className={secret ? 'pr-10' : undefined}
                        type={(secret && !showSecrets[key]) || (hideSensitiveInfo && !isEditingIntegrations) ? 'password' : 'text'}
                        value={creds[key]}
                        disabled={!isEditingIntegrations}
                        onChange={e => setCreds(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={secret ? '••••••••' : ''}
                      />
                      {secret && (
                        <button
                          type="button"
                          onClick={() => toggleShow(key)}
                          className="absolute right-3 top-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {showSecrets[key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    ))}
                </div>
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-muted)] p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--text-secondary)]">Verified caller IDs</p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Verify a number you own if you want Twin calls to show that caller ID.
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleShow('VERIFIED_CALLER_IDS')}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] cursor-pointer"
                        aria-label={showSecrets.VERIFIED_CALLER_IDS ? 'Hide verified caller IDs' : 'Show verified caller IDs'}
                      >
                        {showSecrets.VERIFIED_CALLER_IDS ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => void refreshCallingNumbers()} loading={verifiedLoading || outboundLineLoading}>
                        {!verifiedLoading && <RefreshCw className="h-3.5 w-3.5" />}
                        Refresh
                      </Button>
                      <button
                        type="button"
                        onClick={() => setVerifiedCallerIdsOpen((current) => !current)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] cursor-pointer"
                        aria-label={verifiedCallerIdsOpen ? 'Collapse verified caller IDs' : 'Expand verified caller IDs'}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verifiedCallerIdsOpen ? 'rotate-0' : '-rotate-90'}`} />
                      </button>
                    </div>
                  </div>

                  {verifiedCallerIdsOpen && (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5">
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          Calls currently go out from <span className="font-medium text-[var(--text-primary)]">{activeOutboundLine?.phone_number
                            ? (showSecrets.VERIFIED_CALLER_IDS ? activeOutboundLine.phone_number : maskPhone(activeOutboundLine.phone_number))
                            : creds.TWILIO_PHONE_NUMBER
                              ? (showSecrets.VERIFIED_CALLER_IDS ? creds.TWILIO_PHONE_NUMBER : maskPhone(creds.TWILIO_PHONE_NUMBER))
                              : 'your configured outbound number'}</span>.
                        </p>
                        {activeOutboundLine && !activeOutboundLine.supports_inbound ? (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            This is your verified personal line. Twin can place outbound calls from it, but callbacks go to your real phone instead of back to Twin.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            Verified caller IDs are useful when you want Twin to present a personal number you own instead of your Twilio-purchased line.
                          </p>
                        )}

                        <div className="mt-3">
                          <p className="text-xs font-medium text-[var(--text-secondary)]">Available outbound lines</p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            Choose which imported line Twin should use for outbound calls.
                          </p>
                        </div>

                        {outboundLines.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {outboundLines.map((line) => {
                              const isActive = line.phone_number_id === creds.ELEVENLABS_PHONE_NUMBER_ID
                              const isSelected = isActive
                              const displayTitle = line.label && normalizePhone(line.label) !== normalizePhone(line.phone_number)
                                ? normalizeOutboundLabel(line.label).replace(/^(?:Dilek\s+)?/i, '')
                                : showSecrets.VERIFIED_CALLER_IDS
                                  ? line.phone_number
                                  : maskPhone(line.phone_number)
                              return (
                                <div
                                  key={line.phone_number_id}
                                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                                    isSelected
                                      ? 'border-violet-400 bg-violet-50/80 dark:border-violet-700 dark:bg-violet-950/20'
                                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-h-8 min-w-0 items-center gap-2">
                                      <p className="min-w-0 flex-1 break-words text-sm leading-tight text-[var(--text-primary)]">{displayTitle}</p>
                                      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                                        {isSelected && <Badge variant="default">Active outbound line</Badge>}
                                        {line.supports_inbound ? (
                                          <span className={`-ml-3 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                                            isSelected
                                              ? 'border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200'
                                              : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                                          }`}>
                                            Inbound + outbound
                                          </span>
                                        ) : (
                                          <Badge variant={isSelected ? 'default' : 'muted'}>Outbound only</Badge>
                                        )}
                                        {!isActive && (
                                          <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => void handleUseOutboundLine(line)}
                                            loading={switchingOutboundPhone === line.phone_number}
                                            className="h-7 px-2.5 text-[11px]"
                                          >
                                            Use for calls
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                    {line.label && normalizePhone(line.label) !== normalizePhone(line.phone_number) && (
                                      <p className="truncate text-xs text-[var(--text-muted)]">
                                        {showSecrets.VERIFIED_CALLER_IDS ? line.phone_number : maskPhone(line.phone_number)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void handleDeleteOutboundLine(line)}
                                      loading={switchingOutboundPhone === line.phone_number}
                                      className="text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                                      aria-label="Remove outbound line"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--text-muted)]">
                            No imported outbound lines yet.
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5">
                        <p className="text-xs font-medium text-[var(--text-secondary)]">Verified numbers</p>

                        {verifiedError ? (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {verifiedError}
                          </div>
                        ) : outboundLineError ? (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {outboundLineError}
                          </div>
                        ) : verifiedNumbers.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {verifiedNumbers.map((entry) => {
                              const importedLine = outboundLines.find(
                                (line) => normalizePhone(line.phone_number) === normalizePhone(entry.phone_number)
                              )
                              const isConfigured =
                                creds.TWILIO_PHONE_NUMBER &&
                                normalizePhone(entry.phone_number) === normalizePhone(creds.TWILIO_PHONE_NUMBER)
                              const rawTitle = entry.friendly_name || entry.phone_number
                              const titleIsPhoneNumber =
                                normalizePhone(rawTitle) === normalizePhone(entry.phone_number)
                              const title = titleIsPhoneNumber
                                ? showSecrets.VERIFIED_CALLER_IDS
                                  ? entry.phone_number
                                  : maskPhone(entry.phone_number)
                                : rawTitle
                              const showPhoneLine = normalizePhone(rawTitle) !== normalizePhone(entry.phone_number)
                              const isSelected = isConfigured
                              return (
                                <div
                                  key={entry.sid}
                                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                                    isSelected
                                      ? 'border-violet-400 bg-violet-50/80 dark:border-violet-700 dark:bg-violet-950/20'
                                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-h-8 min-w-0 items-center gap-2">
                                      <p className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{title}</p>
                                      {isConfigured ? null : importedLine ? (
                                        <Button
                                          variant="primary"
                                          size="sm"
                                          onClick={() => void handleUseOutboundLine(importedLine)}
                                          loading={switchingOutboundPhone === entry.phone_number}
                                          className="h-7 px-2.5 text-[11px]"
                                        >
                                          Use for calls
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="primary"
                                          size="sm"
                                          onClick={() => void handleImportAndUseVerifiedNumber(entry)}
                                          loading={switchingOutboundPhone === entry.phone_number}
                                          className="h-7 px-2.5 text-[11px]"
                                        >
                                          Import & use for calls
                                        </Button>
                                      )}
                                    </div>
                                    {showPhoneLine && (
                                      <p className="truncate text-xs text-[var(--text-muted)]">
                                        {showSecrets.VERIFIED_CALLER_IDS ? entry.phone_number : maskPhone(entry.phone_number)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void handleRemoveVerifiedNumber(entry)}
                                      loading={removingVerifiedSid === entry.sid}
                                      className="text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                                      aria-label="Remove verified number"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--text-muted)]">
                            No verified caller IDs yet.
                          </div>
                        )}

                        {verificationResult && (
                          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                            <p className="text-xs text-emerald-900">
                              Verification in progress for <span className="font-semibold">{showSecrets.VERIFIED_CALLER_IDS ? verificationResult.phone_number : maskPhone(verificationResult.phone_number)}</span>.
                              Enter code <span className="font-mono font-semibold">{verificationResult.validation_code}</span> when Twilio calls.
                            </p>
                          </div>
                        )}

                        <div className="mt-4">
                          <p className="text-xs font-medium text-[var(--text-secondary)]">Verify a new number</p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            Twilio will place a call and read back a 6-digit code.
                          </p>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <Input
                            label="Phone number"
                            placeholder="+1 415 555 1212"
                            value={verificationForm.phoneNumber}
                            onChange={(e) => setVerificationForm((current) => ({ ...current, phoneNumber: e.target.value }))}
                          />
                          <Input
                            label="Caller ID label"
                            placeholder="My mobile"
                            value={verificationForm.friendlyName}
                            onChange={(e) => setVerificationForm((current) => ({ ...current, friendlyName: e.target.value }))}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Button variant="primary" size="sm" onClick={() => void handleStartVerification()} loading={verificationLoading}>
                            Start verification call
                          </Button>
                        </div>
                        {verificationError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {verificationError}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
        </Card>
        ) : null}

        {showIdentitySections ? (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Authority rules
            </h2>
            <button
              onClick={addRule}
              className="cursor-pointer text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              + Add rule
            </button>
          </div>
          <div className="space-y-2">
            {form.defaultAuthorityRules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
                    rule.allowed
                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                  } cursor-pointer`}
                >
                  {rule.allowed ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                </button>
                <input
                  value={rule.label}
                  onChange={(e) => updateRuleLabel(rule.id, e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-indigo-400"
                />
                <button
                  onClick={() => removeRule(rule.id)}
                  className="cursor-pointer px-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>
        ) : null}
      </div>
    </div>
  )
}
