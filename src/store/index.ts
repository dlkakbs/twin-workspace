import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Contact, Delegation, CallRun, TwinProfile } from '../types'
import { generateId } from '../lib/utils'

const MANUAL_CONTACTS_STORAGE_KEY = 'twin-phonebook-manual-contacts'
const LEGACY_SHADOW_CONTACT_IDS = new Set(['c0', 'c1', 'c2'])
const LEGACY_SHADOW_CONTACT_NAMES = new Set(['Twin Studio', 'Mado Restaurant', 'Lütfi Kırdar Hotel'])

function isLegacyShadowContact(contact: Contact): boolean {
  return LEGACY_SHADOW_CONTACT_IDS.has(contact.id) || LEGACY_SHADOW_CONTACT_NAMES.has(contact.name)
}

function stripDemoContacts(contacts: Contact[]): Contact[] {
  return contacts.filter((contact) => !isLegacyShadowContact(contact))
}

function readManualContactsShadow(): Contact[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MANUAL_CONTACTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return stripDemoContacts(parsed.filter((item): item is Contact => {
      return Boolean(
        item
        && typeof item === 'object'
        && typeof item.id === 'string'
        && typeof item.name === 'string'
        && typeof item.phone === 'string'
      )
    }))
  } catch {
    return []
  }
}

function writeManualContactsShadow(contacts: Contact[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      MANUAL_CONTACTS_STORAGE_KEY,
      JSON.stringify(stripDemoContacts(contacts))
    )
  } catch {
    // ignore storage write failures
  }
}

function mergeManualContacts(baseContacts: Contact[], manualShadow: Contact[]): Contact[] {
  const merged = new Map<string, Contact>()
  for (const contact of baseContacts) merged.set(contact.id, contact)
  for (const contact of manualShadow) merged.set(contact.id, contact)
  return Array.from(merged.values())
}

interface AppState {
  // Auth
  token: string | null
  isAuthenticated: boolean
  setToken: (token: string) => void
  logout: () => void

  // Theme
  theme: 'light' | 'dark'
  toggleTheme: () => void

  // Twin profile
  profile: TwinProfile
  updateProfile: (patch: Partial<TwinProfile>) => void

  // Contacts
  contacts: Contact[]
  addContact: (contact: Omit<Contact, 'id' | 'createdAt'>) => Contact
  updateContact: (id: string, patch: Partial<Contact>) => void
  deleteContact: (id: string) => void
  getContact: (id: string) => Contact | undefined

  // Delegations
  delegations: Delegation[]
  addDelegation: (d: Omit<Delegation, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Delegation, 'createdAt' | 'updatedAt'>>) => Delegation
  updateDelegation: (id: string, patch: Partial<Delegation>) => void
  deleteDelegation: (id: string) => void
  getDelegation: (id: string) => Delegation | undefined

  // Call runs
  callRuns: CallRun[]
  addCallRun: (run: Omit<CallRun, 'id'>) => CallRun
  updateCallRun: (id: string, patch: Partial<CallRun>) => void
  deleteCallRun: (id: string) => void
  getCallRunsFor: (delegationId: string) => CallRun[]
}

const defaultProfile: TwinProfile = {
  name: 'Dilek',
  avatarProvider: 'heygen',
  heygenAvatarId: '',
  heygenAvatarGroupId: '',
  heygenVoiceId: '',
  defaultVideoOrientation: 'portrait',
  voiceModel: 'eleven_turbo_v2_5',
  language: 'tr-TR',
  profession: 'Technical writer',
  socialTone: 'Direct, polite, professional, warm',
  interactionStyle: 'Speaks in first person, reacts naturally, stays grounded in the conversation, avoids canned support language.',
  domainFamiliarity: ['software development', 'Hermes agent workflows', 'evaluation handoffs'],
  boundaryRules: ['Use respectful language', 'Do not over-explain unless asked', 'Avoid unnecessary small talk unless it fits naturally'],
  doNotSay: ['Do not sound like customer support', 'Do not mention profession unless explicitly asked'],
  persona:
    'Direct, polite, professional. Speaks in first person. Avoids small talk unless prompted. Stays on the task.',
  firstMessage: '',
  callingIdentityMode: 'personal_twin',
  defaultAuthorityRules: [
    { id: '1', label: 'Can ask questions & gather info', allowed: true },
    { id: '2', label: 'Can introduce self by name', allowed: true },
    { id: '3', label: 'Cannot share home address', allowed: false },
    { id: '4', label: 'Cannot confirm payment', allowed: false },
    { id: '5', label: 'Cannot commit without approval', allowed: false },
  ],
  voiceTuning: { stability: 0.3, similarityBoost: 0.86, speed: 0.94 },
}

const initialContacts = mergeManualContacts([], readManualContactsShadow())

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      token: null,
      isAuthenticated: false,
      setToken: (token) => set({ token, isAuthenticated: true }),
      logout: () => set({
        token: null,
        isAuthenticated: false,
        profile: defaultProfile,
        delegations: [],
        callRuns: [],
      }),

      theme: 'light',
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),

      profile: defaultProfile,
      updateProfile: (patch) =>
        set((s) => ({ profile: { ...s.profile, ...patch } })),

      contacts: stripDemoContacts(initialContacts),
      addContact: (data) => {
        const contact: Contact = {
          source: 'manual',
          ...data,
          id: generateId(),
          createdAt: new Date().toISOString(),
        }
        set((s) => {
          const contacts = stripDemoContacts([...s.contacts, contact])
          writeManualContactsShadow(contacts.filter((item) => (item.source ?? 'manual') === 'manual'))
          return { contacts }
        })
        return contact
      },
      updateContact: (id, patch) =>
        set((s) => {
          const contacts = stripDemoContacts(s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)))
          writeManualContactsShadow(contacts.filter((item) => (item.source ?? 'manual') === 'manual'))
          return { contacts }
        }),
      deleteContact: (id) =>
        set((s) => {
          const contacts = stripDemoContacts(s.contacts.filter((c) => c.id !== id))
          writeManualContactsShadow(contacts.filter((item) => (item.source ?? 'manual') === 'manual'))
          return { contacts }
        }),
      getContact: (id) => get().contacts.find((c) => c.id === id),

      delegations: [],
      addDelegation: (data) => {
        const now = new Date().toISOString()
        const delegation: Delegation = {
          ...data,
          id: generateId(),
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? data.createdAt ?? now,
        }
        set((s) => ({ delegations: [...s.delegations, delegation] }))
        return delegation
      },
      updateDelegation: (id, patch) =>
        set((s) => ({
          delegations: s.delegations.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() } : d
          ),
        })),
      deleteDelegation: (id) =>
        set((s) => ({ delegations: s.delegations.filter((d) => d.id !== id) })),
      getDelegation: (id) => get().delegations.find((d) => d.id === id),

      callRuns: [],
      addCallRun: (data) => {
        const run: CallRun = { ...data, id: generateId() }
        set((s) => ({ callRuns: [...s.callRuns, run] }))
        return run
      },
      updateCallRun: (id, patch) =>
        set((s) => ({
          callRuns: s.callRuns.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      deleteCallRun: (id) =>
        set((s) => ({ callRuns: s.callRuns.filter((r) => r.id !== id) })),
      getCallRunsFor: (delegationId) =>
        get().callRuns.filter((r) => r.delegationId === delegationId && !r.hidden),
    }),
    {
      name: 'twin-workspace',
      version: 6,
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        theme: state.theme,
        contacts: stripDemoContacts(
          state.contacts.filter((item) => (item.source ?? 'manual') === 'manual')
        ),
      }),
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<{
          token: string | null
          isAuthenticated: boolean
          theme: 'light' | 'dark'
          contacts: Contact[]
        }>

        const manualShadow = readManualContactsShadow()

        if (version >= 6) {
          return {
            token: state.token ?? null,
            isAuthenticated: state.isAuthenticated ?? false,
            theme: state.theme ?? 'light',
            contacts: stripDemoContacts(
              mergeManualContacts(Array.isArray(state.contacts) ? state.contacts : [], manualShadow)
            ),
          }
        }

        const existingContacts = stripDemoContacts(Array.isArray(state.contacts) ? state.contacts : [])
        const syncedContacts = existingContacts.filter((contact) => contact.source === 'synced')
        const contacts = existingContacts.filter((contact) => contact.source !== 'synced')
        return {
          token: state.token ?? null,
          isAuthenticated: state.isAuthenticated ?? false,
          theme: state.theme ?? 'light',
          contacts: stripDemoContacts(
            mergeManualContacts(
              syncedContacts.length > 0 ? contacts : existingContacts,
              manualShadow
            )
          ),
        }
      },
    }
  )
)
