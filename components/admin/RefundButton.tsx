'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function RefundButton({ orderId, maxAmount }: { orderId: string; maxAmount: number }) {
  const router = useRouter()
  const [amount, setAmount] = useState(maxAmount.toFixed(2))
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function refund(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm(`Refund $${amount} for order ${orderId}? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amount), reason, restock }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Refund failed.')
        return
      }
      setDone(true)
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
        <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> Refund issued.
      </p>
    )
  }

  return (
    <form onSubmit={refund} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="form-label" htmlFor="refund-amount">
            Amount ($) — max ${maxAmount.toFixed(2)}
          </label>
          <Input
            id="refund-amount"
            type="number"
            step="0.01"
            min="0.01"
            max={maxAmount}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="form-label" htmlFor="refund-reason">
            Reason (optional)
          </label>
          <Input
            id="refund-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm text-earth-700">
        <input
          type="checkbox"
          checked={restock}
          onChange={(e) => setRestock(e.target.checked)}
          disabled={Math.round(Number(amount) * 100) !== Math.round(maxAmount * 100)}
          className="h-5 w-5 rounded border-earth-300"
        />
        Return all tracked quantities to inventory (full refund only)
      </label>

      {error && <p className="error">{error}</p>}

      <Button type="submit" variant="destructive" disabled={busy}>
        {busy ? 'Refunding…' : 'Issue refund via Stripe'}
      </Button>
    </form>
  )
}
