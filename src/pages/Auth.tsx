import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Orbit, Lock } from 'lucide-react'
import { useStore } from '../store'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function Auth() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setToken: saveToken } = useStore()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) {
      setError('Please enter your Hermes token')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        let detail = 'Could not verify token.'
        try {
          const payload = await res.json()
          if (typeof payload?.detail === 'string' && payload.detail.trim()) {
            detail = payload.detail
          }
        } catch {
          // Ignore malformed error payloads and use the fallback message.
        }
        throw new Error(detail)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify token.')
      setLoading(false)
      return
    }

    saveToken(token)
    navigate('/')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[var(--bg-base)]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] shadow-lg">
            <Orbit className="h-8 w-8 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Twin</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Your delegation workspace</p>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm"
        >
          <div className="mb-5">
            <Input
              label="Hermes API Key"
              type="password"
              placeholder="Enter your API key..."
              value={token}
              onChange={(e) => { setToken(e.target.value); setError('') }}
              error={error}
              required
              autoFocus
            />
          </div>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            <Lock className="h-4 w-4" />
            Enter Workspace
          </Button>
        </form>

        {/* Footer note */}
        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          Requires a reachable Hermes backend for sign-in.
        </p>
        <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
          Find your key in{' '}
          <code className="rounded bg-[var(--bg-surface)] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[var(--text-secondary)]">
            ~/.hermes/config.yaml
          </code>
          {' '}→{' '}
          <code className="font-mono">platforms.api_server.key</code>
        </p>
      </div>
    </div>
  )
}
