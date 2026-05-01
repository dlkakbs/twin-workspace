import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { formatRelative } from '../lib/utils'
import type { Contact } from '../types'

type PanelMode = 'view' | 'add' | 'edit' | null

const PHONEBOOK_MASK_PREFERENCE_KEY = 'twin-phonebook-hide-phone-numbers'

function maskPhone(value: string) {
  let digitIndex = 0
  const totalDigits = value.replace(/\D/g, '').length
  return value.replace(/\d/g, (digit) => {
    digitIndex += 1
    return digitIndex <= Math.max(totalDigits - 2, 0) ? '*' : digit
  })
}

export function People() {
  const { contacts, addContact, updateContact, deleteContact, delegations, callRuns } = useStore()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>(null)
  const [form, setForm] = useState({ name: '', phone: '', relationship: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [hidePhoneNumbers, setHidePhoneNumbers] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(PHONEBOOK_MASK_PREFERENCE_KEY) === 'true'
  })

  const visibleContacts = useMemo(
    () => contacts.filter((c) => !c.tags.includes('internal') && (c.source ?? 'manual') === 'manual'),
    [contacts]
  )

  const filtered = visibleContacts.filter((contact) => {
    if (!search) return true
    const term = search.toLowerCase()
    return (
      contact.name.toLowerCase().includes(term) ||
      contact.phone.includes(term) ||
      (contact.relationship ?? '').toLowerCase().includes(term)
    )
  })

  const selected = visibleContacts.find((contact) => contact.id === selectedId) ?? null
  const activeContact = panelMode === 'add' ? null : selected

  const contactDelegations = activeContact
    ? delegations.filter((delegation) => delegation.contactId === activeContact.id)
    : []
  const contactRuns = activeContact
    ? callRuns.filter((run) => contactDelegations.some((delegation) => delegation.id === run.delegationId))
    : []

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PHONEBOOK_MASK_PREFERENCE_KEY, String(hidePhoneNumbers))
    }
  }, [hidePhoneNumbers])

  function openAddPanel() {
    setPanelMode('add')
    setSelectedId(null)
    setForm({ name: '', phone: '', relationship: '', notes: '' })
    setErrors({})
  }

  function openViewPanel(contact: Contact) {
    setSelectedId(contact.id)
    setPanelMode('view')
    setErrors({})
  }

  function openEditPanel(contact: Contact) {
    setSelectedId(contact.id)
    setPanelMode('edit')
    setForm({
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship ?? '',
      notes: contact.notes ?? '',
    })
    setErrors({})
  }

  function closePanel() {
    setPanelMode(null)
    setErrors({})
  }

  function validateForm() {
    const nextErrors: Record<string, string> = {}
    if (!form.name.trim()) nextErrors.name = 'Name required'
    if (!form.phone.trim()) nextErrors.phone = 'Phone required'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function handleAdd() {
    if (!validateForm()) return
    const contact = addContact({ ...form, tags: [] })
    setSelectedId(contact.id)
    setPanelMode('view')
    setForm({ name: '', phone: '', relationship: '', notes: '' })
  }

  function handleUpdate() {
    if (!selected || !validateForm()) return
    updateContact(selected.id, {
      name: form.name,
      phone: form.phone,
      relationship: form.relationship,
      notes: form.notes,
    })
    setPanelMode('view')
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this contact?')) return
    deleteContact(id)
    setSelectedId(null)
    setPanelMode(null)
  }

  function renderDrawerBody() {
    if (panelMode === 'add') {
      return (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-500">New contact</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">Add to your phonebook</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Save only the numbers you want to keep visible in Phonebook.
            </p>
          </div>

          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            error={errors.name}
            required
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
            error={errors.phone}
            required
          />
          <Input
            label="Relationship"
            placeholder="Restaurant, hotel, client..."
            value={form.relationship}
            onChange={(e) => setForm((current) => ({ ...current, relationship: e.target.value }))}
          />
          <div className="flex gap-3 pt-2">
            <Button variant="primary" size="md" onClick={handleAdd}>Save contact</Button>
            <Button variant="ghost" size="md" onClick={closePanel}>Cancel</Button>
          </div>
        </div>
      )
    }

    if (!activeContact) return null

    if (panelMode === 'edit') {
      return (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-500">Edit contact</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{activeContact.name}</h2>
          </div>

          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            error={errors.name}
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
            error={errors.phone}
          />
          <Input
            label="Relationship"
            value={form.relationship}
            onChange={(e) => setForm((current) => ({ ...current, relationship: e.target.value }))}
          />
          <div className="flex gap-3 pt-2">
            <Button variant="primary" size="md" onClick={handleUpdate}>Save</Button>
            <Button variant="ghost" size="md" onClick={() => setPanelMode('view')}>Cancel</Button>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        <div className="rounded-[28px] border border-violet-200/70 bg-[linear-gradient(140deg,rgba(248,245,255,0.98),rgba(255,255,255,0.98))] p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-violet-100 text-2xl font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              {activeContact.name[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-500">Contact</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{activeContact.name}</h2>
                <div className="mt-2 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Phone className="h-3.5 w-3.5" />
                {hidePhoneNumbers ? maskPhone(activeContact.phone) : activeContact.phone}
              </div>
              {activeContact.relationship && (
                <Badge variant="muted" className="mt-3">{activeContact.relationship}</Badge>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => openEditPanel(activeContact)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(activeContact.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-4">
            <p className="text-3xl font-semibold text-[var(--text-primary)]">{contactDelegations.length}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Delegations</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-4">
            <p className="text-3xl font-semibold text-[var(--text-primary)]">{contactRuns.length}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Calls made</p>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">Call history</h3>
          </div>
          {contactRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] py-10 text-center">
              <MessageSquare className="mx-auto mb-2 h-6 w-6 text-[var(--border-strong)]" />
              <p className="text-sm text-[var(--text-muted)]">No calls yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactRuns.map((run) => {
                const delegation = contactDelegations.find((item) => item.id === run.delegationId)
                return (
                  <div
                    key={run.id}
                    className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
                  >
                    <div
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        run.outcome === 'success'
                          ? 'bg-emerald-400'
                          : run.outcome === 'failed'
                            ? 'bg-red-400'
                            : 'bg-amber-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {delegation
                          ? delegation.goal.slice(0, 56) + (delegation.goal.length > 56 ? '…' : '')
                          : 'Call'}
                      </p>
                      {run.summary && (
                        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                          {run.summary.slice(0, 96)}…
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {formatRelative(run.startedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden bg-[linear-gradient(180deg,rgba(250,248,255,0.94),rgba(255,255,255,1))]">
      <div className="h-full overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_42%,#eef2ff_100%)] p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
                    <Sparkles className="h-3.5 w-3.5" />
                    Phonebook
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Contacts</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                    Saved phone numbers Twin can call.
                  </p>
                </div>

                <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
                  <div className="relative min-w-[280px] flex-1 sm:flex-none">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      placeholder="Search name, phone, relationship"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-11 w-full rounded-2xl border border-[var(--border)] bg-white/90 py-2 pl-10 pr-4 text-sm text-[var(--text-primary)] shadow-sm backdrop-blur-sm placeholder:text-[var(--text-muted)] focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setHidePhoneNumbers((current) => !current)}
                    aria-label={hidePhoneNumbers ? 'Show phone numbers' : 'Hide phone numbers'}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-white/90 text-[var(--text-muted)] shadow-sm backdrop-blur-sm transition-colors hover:text-[var(--text-primary)] hover:bg-white cursor-pointer"
                  >
                    {hidePhoneNumbers ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <Button variant="primary" size="lg" onClick={openAddPanel}>
                    <Plus className="h-4 w-4" />
                    Add contact
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[var(--border)] bg-white/85 px-8 py-16 text-center shadow-sm">
              <Users className="mx-auto mb-3 h-10 w-10 text-[var(--border-strong)]" />
              <p className="text-lg font-medium text-[var(--text-primary)]">
                {search ? 'No contacts match this search' : 'No manual contacts yet'}
              </p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {search ? 'Try a different name or number.' : 'Start by adding the people you actually want in your phonebook.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((contact) => {
                const runsForContact = callRuns.filter((run) =>
                  delegations.some((delegation) => delegation.contactId === contact.id && delegation.id === run.delegationId)
                )
                const lastRun = runsForContact
                  .slice()
                  .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]

                return (
                  <button
                    key={contact.id}
                    onClick={() => openViewPanel(contact)}
                    className={`group flex w-full items-center gap-4 rounded-[24px] border px-5 py-4 text-left shadow-sm transition-all ${
                      selectedId === contact.id && panelMode !== 'add'
                        ? 'border-violet-300 bg-violet-50/90 shadow-md'
                        : 'border-[var(--border)] bg-white/90 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-white'
                    }`}
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      {contact.name[0].toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-medium text-[var(--text-primary)]">{contact.name}</p>
                        {contact.relationship && <Badge variant="muted">{contact.relationship}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
                        <span>{hidePhoneNumbers ? maskPhone(contact.phone) : contact.phone}</span>
                        {lastRun && <span>Last call {formatRelative(lastRun.startedAt)}</span>}
                      </div>
                    </div>

                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--text-muted)] sm:block" />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {panelMode && (
        <div className="absolute inset-0 z-20 flex justify-end bg-slate-950/18 backdrop-blur-[1px]">
          <button
            aria-label="Close panel"
            className="flex-1 cursor-default"
            onClick={closePanel}
          />
          <div className="h-full w-full max-w-[440px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-surface)] px-6 py-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                {panelMode === 'add' ? 'Add contact' : panelMode === 'edit' ? 'Edit contact' : 'Contact details'}
              </div>
              <button
                onClick={closePanel}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderDrawerBody()}
          </div>
        </div>
      )}
    </div>
  )
}
