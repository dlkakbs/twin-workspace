import { useState } from 'react'
import { Plus, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { Badge } from '../components/ui/Badge'
import { NewDelegationModal } from '../components/delegations/NewDelegationModal'
import { TASK_TYPE_LABELS, formatTime, parseDate } from '../lib/utils'
import type { Delegation } from '../types'

function delegationTypeLabel(delegation: Delegation): string {
  if (delegation.channel !== 'video_call') return TASK_TYPE_LABELS[delegation.taskType]
  if (delegation.videoMeetingIntent === 'intro') return 'Intro Meeting'
  if (delegation.videoMeetingIntent === 'follow_up') return 'Follow-up Meeting'
  return 'Custom Meeting'
}

function channelBadgeLabel(delegation: Delegation): string | null {
  if (delegation.channel === 'video_call') return 'Video Call'
  if (delegation.channel === 'voice_call') return 'Voice Call'
  return null
}

function startOfMonth(date: Date) {
  const value = new Date(date)
  value.setDate(1)
  value.setHours(0, 0, 0, 0)
  return value
}

function addMonths(date: Date, amount: number) {
  const value = new Date(date)
  value.setMonth(value.getMonth() + amount)
  return startOfMonth(value)
}

function addDays(date: Date, amount: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + amount)
  return value
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString()
}

function buildMonthGrid(monthStart: Date) {
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const leadingEmptyDays = monthStart.getDay()
  const totalCells = Math.ceil((leadingEmptyDays + daysInMonth) / 7) * 7

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingEmptyDays + 1
    if (dayNumber < 1 || dayNumber > daysInMonth) return null
    return addDays(monthStart, dayNumber - 1)
  })
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function Schedule() {
  const { delegations, contacts } = useStore()
  const navigate = useNavigate()
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()))
  const [showModal, setShowModal] = useState(false)

  const today = new Date()
  const calendarDays = buildMonthGrid(monthStart)

  const unscheduled = delegations.filter((d) => !d.scheduledAt && d.status === 'draft')

  function prevMonth() {
    setMonthStart((value) => addMonths(value, -1))
  }

  function nextMonth() {
    setMonthStart((value) => addMonths(value, 1))
  }

  function goToToday() {
    setMonthStart(startOfMonth(new Date()))
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Schedule</h1>
        <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" /> New Delegation
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={prevMonth}
          className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4 text-[var(--text-secondary)]" />
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={nextMonth}
          className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
        >
          <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
        </button>
        <button
          onClick={goToToday}
          className="ml-2 text-xs text-violet-600 hover:underline dark:text-violet-400 cursor-pointer"
        >
          Today
        </button>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-2">
        {DAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1 text-center text-xs font-medium text-[var(--text-muted)]">
            {label}
          </div>
        ))}
      </div>

      <div className="mb-8 grid grid-cols-7 gap-2">
        {calendarDays.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} className="h-28" />
          }
          const isToday = sameDay(day, today)
          const dayDelegations = delegations
            .filter((d) => d.scheduledAt && sameDay(parseDate(d.scheduledAt), day))
            .sort((a, b) => a.scheduledAt! > b.scheduledAt! ? 1 : -1)

          return (
            <div
              key={day.toISOString()}
              className={`flex h-28 flex-col overflow-hidden rounded-xl border p-2 transition-colors ${
                isToday
                  ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/10'
                  : 'border-[var(--border)] bg-[var(--bg-surface)]'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className={`text-sm font-semibold ${
                  isToday
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-[var(--text-primary)]'
                }`}>
                  {day.getDate()}
                </p>
                {dayDelegations.length > 0 && (
                  <Badge variant={isToday ? 'default' : 'muted'}>{dayDelegations.length}</Badge>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {dayDelegations.map((d) => {
                  const contact = contacts.find((c) => c.id === d.contactId)
                  const displayName = contact?.name ?? d.counterpartName ?? '?'
                  const showsHermesSchedule = d.status === 'scheduled'
                    && Boolean(d.scheduledAt)
                    && (d.scheduledByHermes || Boolean(d._hermesId))
                  return (
                    <button
                      key={d.id}
                      onClick={() => navigate(`/delegations/${d.id}`)}
                      className="w-full rounded-md bg-[var(--bg-muted)] px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-muted-hover)] cursor-pointer"
                    >
                      <div className="flex items-center gap-1">
                        <StatusDot status={d.status} />
                        <span className="truncate text-[10px] font-medium text-[var(--text-primary)]">
                          {displayName}
                        </span>
                        {channelBadgeLabel(d) && (
                          <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            {channelBadgeLabel(d)}
                          </span>
                        )}
                        {showsHermesSchedule && d.channel !== 'voice_call' && (
                          <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            Hermes
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] tabular-nums">
                        {formatTime(d.scheduledAt!)}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {unscheduled.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            Queue — needs scheduling
            <Badge variant="warning" className="ml-2">{unscheduled.length}</Badge>
          </h2>
          <div className="space-y-2">
            {unscheduled.map((d) => {
              const contact = contacts.find((c) => c.id === d.contactId)
              const displayName = contact?.name ?? d.counterpartName ?? 'Unknown'
              return (
                <button
                  key={d.id}
                  onClick={() => navigate(`/delegations/${d.id}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-left hover:border-[var(--border-strong)] transition-colors cursor-pointer"
                >
                  <Calendar className="h-4 w-4 text-[var(--text-muted)]" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {displayName} — {delegationTypeLabel(d)}{channelBadgeLabel(d) ? ` · ${channelBadgeLabel(d)}` : ''}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{d.goal}</p>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">Set time →</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showModal && (
        <NewDelegationModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => navigate(`/delegations/${id}`)}
        />
      )}
    </div>
  )
}
