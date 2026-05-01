import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  ChevronRight,
  Clapperboard,
  FileText,
  Video,
  AudioLines,
  Sparkles,
} from 'lucide-react'
import { useStore } from '../store'
import { Badge } from '../components/ui/Badge'
import { CONTENT_SUBTYPE_LABELS, formatDate, formatRelative } from '../lib/utils'
import type { ContentSubtype } from '../types'

const SUBTYPE_FILTERS: { value: ContentSubtype | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'script', label: 'Script' },
]

function subtypeIcon(subtype?: ContentSubtype) {
  switch (subtype) {
    case 'video':
      return Video
    case 'audio':
      return AudioLines
    case 'script':
      return FileText
    default:
      return Clapperboard
  }
}

function subtypeAccent(subtype?: ContentSubtype) {
  const videoAccent = 'from-violet-100 via-fuchsia-50 to-violet-50 text-violet-700'
  switch (subtype) {
    case 'video':
      return videoAccent
    case 'audio':
      return videoAccent
    case 'script':
      return videoAccent
    default:
      return 'from-indigo-100 via-violet-50 to-white text-indigo-700'
  }
}

export function Content() {
  const { delegations } = useStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ContentSubtype | 'all'>('all')

  const contentDelegations = useMemo(
    () => delegations.filter((d) => d.channel === 'content_creation' || d.taskType === 'content_creation'),
    [delegations]
  )

  const filtered = contentDelegations
    .filter((d) => filter === 'all' || d.contentSubtype === filter)
    .filter((d) => {
      if (!search) return true
      const needle = search.toLowerCase()
      return (
        d.goal.toLowerCase().includes(needle) ||
        d.contextNotes?.toLowerCase().includes(needle) ||
        CONTENT_SUBTYPE_LABELS[d.contentSubtype ?? 'video'].toLowerCase().includes(needle)
      )
    })
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))

  return (
    <div className="white-arrow-surface mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_42%,#eef2ff_100%)] p-6 shadow-sm">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Twin Studio
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Content</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            Your generated videos, audio, and scripts.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {SUBTYPE_FILTERS.map(({ value, label }) => {
            const count = value === 'all'
              ? contentDelegations.length
              : contentDelegations.filter((d) => d.contentSubtype === value).length
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  filter === value
                    ? 'border-violet-300 bg-violet-50 text-violet-700'
                    : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    filter === value ? 'bg-violet-200' : 'bg-[var(--bg-muted)]'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            placeholder="Search content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] py-20 text-center">
          <Clapperboard className="mx-auto mb-3 h-10 w-10 text-[var(--border-strong)]" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">No content found</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {search ? 'Try a different search' : 'Create content from New Delegation'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((item) => {
            const Icon = subtypeIcon(item.contentSubtype)
            const hasPartialOutput = Boolean(
              item.latestContentRun?.audioPath ||
              item.latestContentRun?.scriptPath
            )
            const hasFinalOutput = Boolean(item.latestContentRun?.videoPath)
            const accent = subtypeAccent(item.contentSubtype)

            return (
              <div
                key={item.id}
                onClick={() => navigate(`/delegations/${item.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigate(`/delegations/${item.id}`)
                  }
                }}
                role="button"
                tabIndex={0}
                className="group flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] text-left align-top shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md cursor-pointer"
              >
                <div className={`rounded-t-[24px] border-b border-[var(--border)] bg-violet-50 bg-gradient-to-br px-5 py-4 ${accent}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {CONTENT_SUBTYPE_LABELS[item.contentSubtype ?? 'video']}
                        </p>
                        <p className="mt-0.5 text-xs opacity-80">
                          Updated {formatRelative(item.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                <div className="space-y-4 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{item.status}</Badge>
                    {hasFinalOutput && <Badge variant="success">Ready</Badge>}
                    {!hasFinalOutput && hasPartialOutput && <Badge variant="warning">Partial</Badge>}
                  </div>

                  <div>
                    <p className="line-clamp-2 text-sm font-medium leading-relaxed text-[var(--text-primary)]">
                      {item.goal}
                    </p>
                    {item.contextNotes && (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">
                        {item.contextNotes}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Created</p>
                      <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{formatDate(item.createdAt)}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Output</p>
                      <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
                        {hasFinalOutput ? 'Available' : hasPartialOutput ? 'Partial' : 'Pending'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-muted)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Type</p>
                      <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
                        {CONTENT_SUBTYPE_LABELS[item.contentSubtype ?? 'video']}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
