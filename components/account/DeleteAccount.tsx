'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient, isSupabaseBrowserConfigured } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

/** Permanent account deletion. The customer types DELETE so it can't happen by a stray tap. */
export function DeleteAccount() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not delete the account.')
      if (isSupabaseBrowserConfigured()) await createClient().auth.signOut()
      router.push('/?account=deleted')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.')
      setBusy(false)
    }
  }

  return (
    <section className="premium-card mt-8 p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-earth-900">Delete account</h2>
      <p className="mt-2 text-sm text-earth-600">
        Removes your login, saved addresses and saved items. Past orders stay in the store&apos;s
        records for receipts, returns and taxes, but are no longer linked to you. This can&apos;t be undone.
      </p>
      {!open ? (
        <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-earth-700" htmlFor="confirm-delete">
            Type <strong>DELETE</strong> to confirm
          </label>
          <input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="w-full rounded-xl border border-earth-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-3">
            <Button
              type="button"
              className="rounded-xl bg-red-700 hover:bg-red-800"
              disabled={typed.trim() !== 'DELETE' || busy}
              onClick={remove}
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      )}
    </section>
  )
}
