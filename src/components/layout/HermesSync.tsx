import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Check, AlertCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { callRunChangedFromHermes, callRunFromHermes, callRunPatchFromHermes } from '../../lib/hermesCalls'
import { authorityRulesFromHermes, delegationFromHermes, delegationPatchFromHermes, normalizeHermesTaskStatus } from '../../lib/hermesDelegations'
import { useStore } from '../../store'
import { cn, generateId } from '../../lib/utils'

function normalizePhone(value?: string | null): string {
  return String(value ?? '').replace(/\D/g, '')
}

type SyncState = 'idle' | 'loading' | 'done' | 'error'

export function HermesSync() {
  const [state, setState] = useState<SyncState>('idle')
  const [summary, setSummary] = useState('')
  const runningRef = useRef(false)

  async function sync(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false
    if (runningRef.current) return
    runningRef.current = true
    if (!silent) {
      setState('loading')
      setSummary('')
    }
    try {
      const [hermesDelegations, hermesCalls] = await Promise.all([
        api.delegations.list(),
        api.calls.list(),
      ])
      const hermesDelegationIds = new Set(
        hermesDelegations.map((delegation) => delegation.delegation_id)
      )

      let newDelegations = 0
      let newCalls = 0
      let updatedDelegations = 0
      let updatedCalls = 0
      let removedDelegations = 0
      let removedCalls = 0
      let dedupedDelegations = 0

      for (const hd of hermesDelegations) {
        const store = useStore.getState()
        const normalizedHermesPhone = normalizePhone(hd.counterpart.phone_number)
        const contact = store.contacts.find((c) => {
          const normalizedContactPhone = normalizePhone(c.phone)
          if (normalizedHermesPhone && normalizedContactPhone) {
            return normalizedContactPhone === normalizedHermesPhone
          }
          return c.name.trim().toLowerCase() === String(hd.counterpart.name ?? '').trim().toLowerCase()
        })

        // Check if delegation already exists by hermes delegation_id stored in metadata
        const existing = store.delegations.find(
          (d) => d._hermesId === hd.delegation_id
        )
        const resolvedContactId = contact?.id ?? existing?.contactId ?? ''

        const authorityRules = authorityRulesFromHermes(hd, generateId)

        if (existing) {
          const nextStatus = normalizeHermesTaskStatus(hd.status) ?? existing.status
          const nextContextNotes = hd.context_notes.join('\n')
          const nextPatch = delegationPatchFromHermes(hd, {
            fallback: existing,
            contactId: resolvedContactId,
            authorityRules,
          })
          const existingVideo = existing.latestContentRun?.videoPath ?? ''
          const nextVideo = nextPatch.latestContentRun?.videoPath ?? ''
          const changed =
            existing.createdAt !== (nextPatch.createdAt ?? existing.createdAt) ||
            existing.updatedAt !== (nextPatch.updatedAt ?? existing.updatedAt) ||
            existing.status !== nextStatus ||
            (existing.contactId ?? '') !== (nextPatch.contactId ?? '') ||
            (existing.counterpartName ?? '') !== (nextPatch.counterpartName ?? '') ||
            (existing.counterpartPhone ?? '') !== (nextPatch.counterpartPhone ?? '') ||
            (existing.preCallApprovedAt ?? '') !== (nextPatch.preCallApprovedAt ?? '') ||
            existing.scheduledAt !== nextPatch.scheduledAt ||
            existing.goal !== (nextPatch.goal ?? '') ||
            (existing.contextNotes ?? '') !== nextContextNotes ||
            (existing.lastError ?? '') !== (nextPatch.lastError ?? '') ||
            Boolean(existing.scheduledByHermes) !== Boolean(nextPatch.scheduledByHermes) ||
            (existing.videoGenerationMode ?? '') !== (nextPatch.videoGenerationMode ?? '') ||
            (existing.videoMeetingIntent ?? '') !== (nextPatch.videoMeetingIntent ?? '') ||
            (existing.videoMeetingSetup ?? '') !== (nextPatch.videoMeetingSetup ?? '') ||
            (existing.sourceAssets?.scriptPath ?? '') !== (nextPatch.sourceAssets?.scriptPath ?? '') ||
            (existing.sourceAssets?.audioPath ?? '') !== (nextPatch.sourceAssets?.audioPath ?? '') ||
            (existing.latestVideoSession?.joinUrl ?? '') !== (nextPatch.latestVideoSession?.joinUrl ?? '') ||
            (existing.latestVideoSession?.status ?? '') !== (nextPatch.latestVideoSession?.status ?? '') ||
            (existing.latestVideoSession?.inviteDeliveryStatus ?? '') !== (nextPatch.latestVideoSession?.inviteDeliveryStatus ?? '') ||
            existingVideo !== nextVideo ||
            (existing.latestContentRun?.audioPath ?? '') !== (nextPatch.latestContentRun?.audioPath ?? '') ||
            (existing.latestContentRun?.scriptPath ?? '') !== (nextPatch.latestContentRun?.scriptPath ?? '')

          if (changed) {
            store.updateDelegation(existing.id, nextPatch)
            updatedDelegations++
          }
          continue
        }

        const normalized = delegationFromHermes(hd, {
            localId: generateId(),
            contactId: resolvedContactId,
            authorityRules,
          })
        const { id: _ignoredId, ...delegationInput } = normalized
        store.addDelegation(delegationInput)
        newDelegations++
      }

      for (const hc of hermesCalls) {
        const store = useStore.getState()
        const existingRun = store.callRuns.find(
          (r) => r.callSid === hc.call_id || r._hermesCallId === hc.call_id
        )
        const delegation = store.delegations.find(
          (d) => d._hermesId === hc.delegation_id
        )
        if (!delegation) continue

        if (existingRun) {
          if (callRunChangedFromHermes(existingRun, hc)) {
            store.updateCallRun(existingRun.id, callRunPatchFromHermes(hc, existingRun))
            updatedCalls++
          }
          continue
        }

        store.addCallRun(callRunFromHermes(hc, { delegationId: delegation.id }))
        newCalls++
      }

      {
        const store = useStore.getState()
        for (const delegation of store.delegations) {
          if (delegation.channel !== 'voice_call') continue
          if (delegation.status !== 'completed') continue

          const latestRun = store.callRuns
            .filter((run) => run.delegationId === delegation.id)
            .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))[0]

          if (!latestRun) continue
          const isAwaitingDecision =
            latestRun.outcome === 'partial'
            || Boolean(latestRun.pendingApprovals?.length)
            || Boolean(latestRun.postCallFollowups?.length)
            || Boolean(latestRun.pendingActions?.length)
          if (!isAwaitingDecision) continue

          store.updateDelegation(delegation.id, { status: 'partial' })
          updatedDelegations++
        }
      }

      {
        const store = useStore.getState()
        const staleDelegations = store.delegations.filter((delegation) => {
          const hermesId = delegation._hermesId
          return typeof hermesId === 'string' && !hermesDelegationIds.has(hermesId)
        })

        for (const delegation of staleDelegations) {
          const attachedRuns = store.callRuns.filter((run) => run.delegationId === delegation.id)
          for (const run of attachedRuns) {
            store.deleteCallRun(run.id)
            removedCalls++
          }
          store.deleteDelegation(delegation.id)
          removedDelegations++
        }
      }

      {
        const store = useStore.getState()

        const delegationsByHermesId = new Map<string, typeof store.delegations>()
        for (const delegation of store.delegations) {
          const hermesId = delegation._hermesId
          if (typeof hermesId !== 'string' || !hermesId) continue
          const bucket = delegationsByHermesId.get(hermesId) ?? []
          bucket.push(delegation)
          delegationsByHermesId.set(hermesId, bucket)
        }

        for (const duplicates of delegationsByHermesId.values()) {
          if (duplicates.length < 2) continue
          const canonical = duplicates
            .slice()
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0]

          for (const duplicate of duplicates) {
            if (duplicate.id === canonical.id) continue
            const attachedRuns = store.callRuns.filter((run) => run.delegationId === duplicate.id)
            for (const run of attachedRuns) {
              store.deleteCallRun(run.id)
              removedCalls++
            }
            store.deleteDelegation(duplicate.id)
            dedupedDelegations++
          }
        }
      }

      {
        const store = useStore.getState()
        const hermesBackedFingerprints = new Set(
          store.delegations
            .filter((delegation) => typeof delegation._hermesId === 'string' && delegation._hermesId)
            .map((delegation) => [
              delegation.contactId,
              delegation.taskType,
              delegation.channel ?? '',
              delegation.contentSubtype ?? '',
              delegation.goal.trim(),
              delegation.scheduledAt ?? '',
            ].join('::'))
        )

        const localDuplicates = store.delegations.filter((delegation) => {
          const hermesId = delegation._hermesId
          if (typeof hermesId === 'string' && hermesId) return false
          const fingerprint = [
            delegation.contactId,
            delegation.taskType,
            delegation.channel ?? '',
            delegation.contentSubtype ?? '',
            delegation.goal.trim(),
            delegation.scheduledAt ?? '',
          ].join('::')
          return hermesBackedFingerprints.has(fingerprint)
        })

        for (const duplicate of localDuplicates) {
          const attachedRuns = store.callRuns.filter((run) => run.delegationId === duplicate.id)
          for (const run of attachedRuns) {
            store.deleteCallRun(run.id)
            removedCalls++
          }
          store.deleteDelegation(duplicate.id)
          dedupedDelegations++
        }
      }

      const parts: string[] = []
      if (newDelegations > 0) parts.push(`${newDelegations} delegation${newDelegations > 1 ? 's' : ''}`)
      if (newCalls > 0) parts.push(`${newCalls} call${newCalls > 1 ? 's' : ''}`)
      if (updatedDelegations > 0) parts.push(`${updatedDelegations} delegation update${updatedDelegations > 1 ? 's' : ''}`)
      if (updatedCalls > 0) parts.push(`${updatedCalls} call update${updatedCalls > 1 ? 's' : ''}`)
      if (removedDelegations > 0) parts.push(`${removedDelegations} stale delegation${removedDelegations > 1 ? 's' : ''} removed`)
      if (removedCalls > 0) parts.push(`${removedCalls} stale call${removedCalls > 1 ? 's' : ''} removed`)
      if (dedupedDelegations > 0) parts.push(`${dedupedDelegations} duplicate delegation${dedupedDelegations > 1 ? 's' : ''} removed`)

      if (!silent) {
        setSummary(parts.length > 0 ? `Synced ${parts.join(', ')}` : 'Already up to date')
        setState('done')
        setTimeout(() => setState('idle'), 3000)
      }
    } catch {
      if (!silent) {
        setSummary('Backend not reachable')
        setState('error')
        setTimeout(() => setState('idle'), 4000)
      }
    } finally {
      runningRef.current = false
    }
  }

  useEffect(() => {
    const initialSyncId = window.requestAnimationFrame(() => {
      void sync({ silent: true })
    })
    const intervalId = window.setInterval(() => {
      void sync({ silent: true })
    }, 45000)
    return () => {
      window.cancelAnimationFrame(initialSyncId)
      window.clearInterval(intervalId)
    }
  }, [])

  function handleManualSync() {
    void sync()
  }

  return (
    <button
      onClick={handleManualSync}
      disabled={state === 'loading'}
      title={summary || 'Sync from Hermes'}
      className={cn(
        'flex w-full cursor-default items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all',
        state === 'done'  && 'text-emerald-600 dark:text-emerald-400',
        state === 'error' && 'text-red-500',
        state === 'idle' || state === 'loading'
          ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
          : 'hover:bg-[var(--bg-muted)]',
        state === 'loading' && 'opacity-60'
      )}
    >
      {state === 'done'  ? <Check className="h-4 w-4 shrink-0" />
      : state === 'error'? <AlertCircle className="h-4 w-4 shrink-0" />
      : <RefreshCw className={cn('h-4 w-4 shrink-0 text-[var(--text-muted)]', state === 'loading' && 'animate-spin')} />}
      {summary || 'Sync Hermes'}
    </button>
  )
}
