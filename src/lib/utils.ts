import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ContentSubtype, Delegation, TaskStatus, TaskType } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseDate(value: string) {
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed

  const match = value.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/)
  if (match) {
    const [, year, month, day, hour, minute, second] = match
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  }

  return new Date(Number.NaN)
}

export function isoToLocalDateTimeInput(isoString: string) {
  const date = parseDate(isoString)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function localDateTimeInputToIso(value: string) {
  if (!value) return undefined
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return undefined

  const [, year, month, day, hour, minute] = match
  const localDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0
  )

  if (Number.isNaN(localDate.getTime())) return undefined
  return localDate.toISOString()
}

export const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; dot: string }
> = {
  draft:            { label: 'Draft',            color: 'text-slate-400',  dot: 'bg-slate-400' },
  scheduled:        { label: 'Scheduled',         color: 'text-violet-400', dot: 'bg-violet-400' },
  approval_pending: { label: 'Approval Needed',   color: 'text-amber-500',  dot: 'bg-amber-400' },
  running:          { label: 'Running',            color: 'text-violet-600', dot: 'bg-violet-500 animate-pulse' },
  partial:          { label: 'Partial',            color: 'text-amber-600',  dot: 'bg-amber-400' },
  completed:        { label: 'Completed',          color: 'text-emerald-500',dot: 'bg-emerald-400' },
  failed:           { label: 'Failed',             color: 'text-red-500',    dot: 'bg-red-400' },
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  restaurant_inquiry: 'Restaurant Info',
  restaurant_reservation: 'Restaurant Booking',
  hotel_reservation: 'Hotel Booking',
  availability_check: 'Availability Check',
  pricing_request: 'Pricing Request',
  follow_up_call: 'Follow-up Call',
  custom_request: 'Custom Request',
  content_creation: 'Content Creation',
}

export const CONTENT_SUBTYPE_LABELS: Record<ContentSubtype, string> = {
  video: 'Video',
  audio: 'Audio',
  script: 'Script',
}

export const TASK_TYPE_DEFAULT_RULES: Record<TaskType, { label: string; allowed: boolean }[]> = {
  restaurant_inquiry: [
    { label: 'Can ask about menu & prices', allowed: true },
    { label: 'Can ask about delivery time', allowed: true },
    { label: 'Cannot confirm an order', allowed: false },
    { label: 'Cannot share home address', allowed: false },
  ],
  restaurant_reservation: [
    { label: 'Can confirm reservation time', allowed: true },
    { label: 'Can state party size', allowed: true },
    { label: 'Cannot provide payment info', allowed: false },
    { label: 'Cannot share home address', allowed: false },
  ],
  hotel_reservation: [
    { label: 'Can ask about room availability', allowed: true },
    { label: 'Can state check-in/out dates', allowed: true },
    { label: 'Cannot provide payment info', allowed: false },
    { label: 'Cannot confirm booking without approval', allowed: false },
  ],
  availability_check: [
    { label: 'Can ask about available times or inventory', allowed: true },
    { label: 'Can clarify constraints and preferences', allowed: true },
    { label: 'Cannot confirm a booking', allowed: false },
    { label: 'Cannot make commitments without approval', allowed: false },
  ],
  pricing_request: [
    { label: 'Can ask for rates, fees, and total cost', allowed: true },
    { label: 'Can compare quoted options', allowed: true },
    { label: 'Cannot provide payment details', allowed: false },
    { label: 'Cannot approve a purchase', allowed: false },
  ],
  follow_up_call: [
    { label: 'Can reference a previous conversation', allowed: true },
    { label: 'Can confirm open questions or next steps', allowed: true },
    { label: 'Cannot change prior commitments without approval', allowed: false },
    { label: 'Cannot finalize anything new without approval', allowed: false },
  ],
  custom_request: [
    { label: 'Can gather relevant information', allowed: true },
    { label: 'Can clarify the request and constraints', allowed: true },
    { label: 'Cannot make commitments without approval', allowed: false },
    { label: 'Cannot share personal details', allowed: false },
  ],
  content_creation: [
    { label: 'Can generate content from the written brief', allowed: true },
    { label: 'Can use the saved Twin voice and avatar', allowed: true },
    { label: 'Cannot publish or send without approval', allowed: false },
    { label: 'Cannot invent unsupported facts', allowed: false },
  ],
}

export function formatTime(isoString: string) {
  const date = parseDate(isoString)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(isoString: string) {
  const date = parseDate(isoString)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatRelative(isoString: string) {
  const date = parseDate(isoString)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

export function hasPreCallApprovalPending(
  delegation: Pick<Delegation, 'requiresApproval' | 'preCallApprovedAt' | 'status'>
) {
  if (delegation.status !== 'draft' && delegation.status !== 'scheduled') return false
  return delegation.requiresApproval && !delegation.preCallApprovedAt
}

export function isScheduledRunPastDue(delegation: Pick<Delegation, 'scheduledAt' | 'status'>) {
  if (delegation.status !== 'scheduled' || !delegation.scheduledAt) return false
  const scheduled = parseDate(delegation.scheduledAt)
  if (Number.isNaN(scheduled.getTime())) return false
  return scheduled.getTime() <= Date.now()
}

export function isAwaitingPreCallApprovalForScheduledRun(
  delegation: Pick<Delegation, 'requiresApproval' | 'preCallApprovedAt' | 'scheduledAt' | 'status'>
) {
  return hasPreCallApprovalPending(delegation) && delegation.status === 'scheduled' && Boolean(delegation.scheduledAt)
}
