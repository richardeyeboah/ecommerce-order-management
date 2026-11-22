'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type FulfillmentItem = {
  id: string
  product_name: string
  product_price: number
  quantity: number
  fulfilled_quantity: number | null
}

type Quote = {
  goodsRefund: number
  taxRefund: number
  totalRefund: number
  clamped: boolean
  shortLines: Array<{ productName: string; missingQuantity: number; orderedQuantity: number }>
}

function money(n: number): string {
  return `$${Number(n).toFixed(2)}`
}

export function OrderItemsFulfillment({
  orderId,
  items,
  paysByCard,
  fullyRefunded,
  unpaid = false,
}: {
  orderId: string
  items: FulfillmentItem[]
  paysByCard: boolean
  fullyRefunded: boolean
  /** No money collected yet — shortfalls reduce the amount to collect, not refund. */
  unpaid?: boolean
}) {
  const router = useRouter()

  const saved = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of items) {
      map[item.id] = item.fulfilled_quantity ?? item.quantity
    }
    return map
  }, [items])

  const [draft, setDraft] = useState<Record<string, number>>(saved)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const dirty = items.some((item) => draft[item.id] !== saved[item.id])

  const requestQuote = useCallback(async () => {
    setQuoting(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/adjust-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview: true,
          lines: items.map((item) => ({
            itemId: item.id,
            fulfilledQuantity: draft[item.id] ?? item.quantity,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not price this adjustment.')
        setQuote(null)
        return
      }
      setQuote(data.quote as Quote)
    } catch {
      setError('Network error while pricing the refund.')
    } finally {
      setQuoting(false)
    }
  }, [draft, items, orderId])

  // Debounced so holding the stepper does not fire a request per click.
  useEffect(() => {
    if (!dirty) {
      setQuote(null)
      return
    }
    const t = window.setTimeout(() => void requestQuote(), 350)
    return () => window.clearTimeout(t)
  }, [dirty, requestQuote])

  function setQty(itemId: string, value: number, max: number) {
    const next = Math.max(0, Math.min(max, Math.trunc(Number.isFinite(value) ? value : 0)))
    setDraft((prev) => ({ ...prev, [itemId]: next }))
    setDone('')
  }

  async function commit() {
    if (!quote) return
    const label =
      quote.totalRefund > 0
        ? unpaid
          ? `Save shortage and collect ${money(quote.totalRefund)} less at handoff?`
          : `Refund ${money(quote.totalRefund)} for the unavailable items?`
        : 'Save these fulfilled quantities?'
    if (!confirm(label)) return

    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/adjust-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          lines: items.map((item) => ({
            itemId: item.id,
            fulfilledQuantity: draft[item.id] ?? item.quantity,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not save the adjustment.')
        return
      }
      setDone(
        data.refunded
          ? `Refunded ${money(data.quote?.totalRefund ?? 0)} and notified the customer.`
          : data.unpaid && Number(data.quote?.totalRefund ?? 0) > 0
            ? `Saved — collect ${money(data.quote?.totalRefund ?? 0)} less at handoff.`
            : 'Saved.'
      )
      setReason('')
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const anyShort = items.some((item) => (draft[item.id] ?? item.quantity) < item.quantity)

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {items.map((item) => {
          const value = draft[item.id] ?? item.quantity
          const short = value < item.quantity
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-earth-200 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-earth-900">{item.product_name}</p>
                <p className="text-xs text-earth-500">
                  {money(Number(item.product_price ?? 0))} · ordered {item.quantity}
                  {short && (
                    <span className="ml-1.5 font-semibold text-red-600">
                      short {item.quantity - value}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`One less ${item.product_name}`}
                  disabled={value <= 0 || busy}
                  onClick={() => setQty(item.id, value - 1, item.quantity)}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  className="stepper-input h-11 w-14 font-semibold"
                  value={value}
                  min={0}
                  max={item.quantity}
                  aria-label={`${item.product_name} handed over`}
                  onChange={(e) => setQty(item.id, Number(e.target.value), item.quantity)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`One more ${item.product_name}`}
                  disabled={value >= item.quantity || busy}
                  onClick={() => setQty(item.id, value + 1, item.quantity)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {dirty && (
        <div className="space-y-3 rounded-xl border border-earth-200 bg-earth-50 px-4 py-3">
          {quoting && !quote ? (
            <div className="h-5 w-40 animate-pulse rounded bg-earth-200" />
          ) : quote ? (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-semibold text-earth-900">
                  {unpaid ? 'Less to collect' : 'Refund due'}
                </span>
                <span className="text-lg font-bold tabular-nums text-earth-950">
                  {money(quote.totalRefund)}
                </span>
              </div>
              <dl className="space-y-1 text-xs text-earth-600">
                <div className="flex justify-between gap-4">
                  <dt>Items</dt>
                  <dd className="tabular-nums">{money(quote.goodsRefund)}</dd>
                </div>
                {quote.taxRefund !== 0 && (
                  <div className="flex justify-between gap-4">
                    <dt>Sales tax</dt>
                    <dd className="tabular-nums">{money(quote.taxRefund)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt>Method</dt>
                  <dd>
                    {unpaid
                      ? 'Not paid yet — deduct from amount due'
                      : paysByCard
                        ? 'Stripe — back to card'
                        : 'Cash — hand back at counter'}
                  </dd>
                </div>
              </dl>
              {quote.clamped && (
                <p className="text-xs font-medium text-amber-700">
                  Capped at the amount still refundable on this order.
                </p>
              )}
            </>
          ) : null}

          <div className="space-y-1.5">
            <label className="form-label" htmlFor="shortfall-reason">
              Reason (optional)
            </label>
            <Input
              id="shortfall-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Out of stock — last case damaged"
              maxLength={200}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={quote && quote.totalRefund > 0 ? 'destructive' : 'default'}
              className="min-h-11"
              disabled={busy || quoting || !quote}
              onClick={commit}
            >
              {busy
                ? 'Working…'
                : quote && quote.totalRefund > 0
                  ? unpaid
                    ? `Save — collect ${money(quote.totalRefund)} less`
                    : `Refund ${money(quote.totalRefund)}`
                  : 'Save quantities'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setDraft(saved)
                setError('')
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </Button>
          </div>
        </div>
      )}

      {!dirty && anyShort && (
        <p className="text-sm text-earth-600">
          Shortages recorded. The receipt and the customer email show the adjusted quantities.
        </p>
      )}

      {fullyRefunded && (
        <p className="text-sm text-earth-600">This order is fully refunded.</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && (
        <p className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
          <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          {done}
        </p>
      )}
    </div>
  )
}
