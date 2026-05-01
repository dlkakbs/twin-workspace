function shortSentence(text: string, fallback: string) {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return fallback
  const firstSentence = normalized.match(/^(.+?[.?!])(?:\s|$)/)
  if (firstSentence?.[1] && firstSentence[1].length <= 160) return firstSentence[1]
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 157).trimEnd()}...`
}

function containsAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle))
}

export function formatUserFacingError(message: string | undefined, fallback: string): string {
  const text = String(message ?? '').trim()
  if (!text) return fallback
  const lower = text.toLowerCase()

  if (containsAny(lower, ['backend not reachable', 'failed to fetch', 'networkerror', 'network error'])) {
    return 'Hermes workspace backend is not reachable right now. Please try again in a moment.'
  }
  if (containsAny(lower, ['invite token missing', 'invite could not be resolved', 'guest token is missing'])) {
    return 'This meeting link is incomplete or no longer valid.'
  }
  if (containsAny(lower, ['live session bootstrap is not ready yet', 'join payload is not ready yet'])) {
    return 'The meeting is still preparing. Wait a moment and try joining again.'
  }
  if (containsAny(lower, ['backend bootstrap is still incomplete'])) {
    return 'The meeting setup is still incomplete. Finish the required setup and try again.'
  }
  if (containsAny(lower, ['camera toggle failed', 'browser media device error', 'microphone toggle failed'])) {
    return 'Your browser could not access the camera or microphone. Check device permissions and try again.'
  }
  if (containsAny(lower, ['could not join the livekit room', 'could not join the meeting'])) {
    return 'The meeting could not be joined right now. Please try again in a moment.'
  }
  if (containsAny(lower, ['not allowed to send sms', 'geographic permissions'])) {
    return 'SMS delivery is not enabled for this destination yet. Update Twilio messaging permissions and try again.'
  }
  if (containsAny(lower, ['insufficient', 'quota', 'credits']) && containsAny(lower, ['elevenlabs', 'heygen', 'twilio'])) {
    return 'A provider account does not have enough credits or quota for this action.'
  }
  if (containsAny(lower, ['twin couldn\'t', 'twin could not'])) {
    return shortSentence(text, fallback)
  }

  return shortSentence(text, fallback)
}

export function humanizeEnvKey(key: string): string {
  switch (key) {
    case 'LIVEKIT_URL':
      return 'LiveKit URL'
    case 'LIVEKIT_API_KEY':
      return 'LiveKit API key'
    case 'LIVEKIT_API_SECRET':
      return 'LiveKit API secret'
    case 'OPENAI_API_KEY':
      return 'OpenAI API key'
    case 'DEEPGRAM_API_KEY':
      return 'Deepgram API key'
    case 'HEYGEN_API_KEY':
      return 'HeyGen API key'
    case 'TWIN_PUBLIC_BASE_URL':
      return 'Public workspace URL'
    default:
      return key.replaceAll('_', ' ')
  }
}

export function humanizeProviderState(value: string | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'ready':
      return 'Ready'
    case 'active':
      return 'Live'
    case 'starting':
      return 'Starting'
    case 'stopped':
      return 'Stopped'
    case 'ended':
      return 'Ended'
    case 'failed':
      return 'Needs attention'
    case 'unknown':
    case '':
      return 'Unknown'
    default:
      return value ?? 'Unknown'
  }
}
