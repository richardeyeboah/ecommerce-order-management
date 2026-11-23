'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Package, Search } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import {
  isPickupShippingMethod,
  normalizeOrderStatus,
  orderStatusLabel,
  type OrderStatus,
} from '@/lib/order-status'
import { SHIPPING_METHOD_LABEL, type ShippingMethod } from '@/lib/shipping'
import { STORE } from '@/lib/constants/store'
import { createClient, isSupabaseBrowserConfigured } from '@/lib/supabase/client'
import { OrderStatusTimeline } from '@/components/account/OrderStatusTimeline'
import { PageHeader } from '@/components/store/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/utils'
import { formatOrderNumber } from '@/lib/orders/order-number'

type TrackOrderResponse = {
  order: {
    id: string
    order_number?: number | null
    status: string
    created_at: string
    total_amount: number | null
    subtotal_amount?: number | null
    shipping_fee?: number | null
    shipping_method?: string | null
    tracking_number?: string | null
    city?: string | null
    country?: string | null
  }
  items: Array<{
    id: string
    product_name: string
    product_price: number
    quantity: number
    subtotal: number
    fulfilled_quantity?: number | null
  }>
  logs: Array<{
    id: string
    from_status: string | null
    to_status: string
    changed_at: string
    note: string | null
  }>
}

function estimatedDelivery(createdAt: string, shippingMethod: string): string {
  const created = new Date(createdAt)
  const days = shippingMethod === 'pickup' ? 0 : 6

  if (days === 0) return 'Available for pickup'

  // Add business days
  let count = 0
  const date = new Date(created)
  while (count < days) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (day !== 0 && day !== 6) count++
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TrackOrderClient() {
  const searchParams = useSearchParams()
  const [orderId, setOrderId] = useState(searchParams.get('id') ?? '')
  const [searchMode, setSearchMode] = useState<'order' | 'email'>('order')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<TrackOrderResponse | null>(null)
  const subscribedIdRef = useRef<string>('')

  const status = useMemo<OrderStatus>(
    () => normalizeOrderStatus(data?.order?.status),
    [data?.order?.status]
  )
  const shippingMethod = (data?.order?.shipping_method as ShippingMethod | undefined) ?? 'standard'
  const isPickup = isPickupShippingMethod(data?.order?.shipping_method)

  const fetchOrder = useCallback(
    async (idOverride?: string) => {
      const id = (idOverride ?? orderId).trim()
      const emailVal = email.trim()
      if (!id && !emailVal) return
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (id) params.set('id', id)
        if (emailVal) params.set('email', emailVal)
        if (!id && !emailVal) return

        const res = await fetch(`/api/orders/track?${params.toString()}`)
        const payload = await res.json()
        if (!res.ok) {
          setError(payload.error ?? 'Could not find this order.')
          setData(null)
          return
        }
        setData(payload)
      } catch {
        setError('Network error.')
      } finally {
        setLoading(false)
      }
    },
    [orderId, email]
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await fetchOrder()
  }

  useEffect(() => {
    if (orderId.trim()) void fetchOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = data?.order?.id
    if (!id || subscribedIdRef.current === id) return
    if (!isSupabaseBrowserConfigured()) return
    subscribedIdRef.current = id

    const supabase = createClient()
    const channel = supabase
      .channel(`track-order-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        () => void fetchOrder(id)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_status_logs', filter: `order_id=eq.${id}` },
        () => void fetchOrder(id)
      )
      .subscribe()

    return () => {
      subscribedIdRef.current = ''
      void supabase.removeChannel(channel)
    }
  }, [data?.order?.id, fetchOrder])

  return (
    <div className="min-h-screen bg-cream">
      <PageHeader
        eyebrow="Orders"
        title="Track your order"
        subtitle="Enter your order number and checkout email."
      />

      <div className="store-container py-8 sm:py-10">
        <form onSubmit={handleSubmit} className="premium-card max-w-2xl p-6">
          {/* Toggle: order number vs email */}
          <div className="mb-4 flex gap-1 rounded-lg border border-earth-200 p-1 w-fit">
            <button
              type="button"
              onClick={() => setSearchMode('order')}
              className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium transition-colors ${searchMode === 'order' ? 'bg-earth-900 text-white' : 'text-earth-600 hover:text-earth-900'}`}
            >
              Order number
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('email')}
              className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium transition-colors ${searchMode === 'email' ? 'bg-earth-900 text-white' : 'text-earth-600 hover:text-earth-900'}`}
            >
              Email address
            </button>
          </div>

          {searchMode === 'order' ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="track-order-id" className="form-label">Order number</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-earth-400" />
                  <Input
                    id="track-order-id"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    required
                    placeholder="LQ-1042"
                    className="pl-9"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="track-order-email-guest" className="form-label">
                  Email used at checkout
                </label>
                <Input
                  id="track-order-email-guest"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl sm:w-auto sm:min-w-[120px]">
                {loading ? 'Checking…' : 'Track'}
              </Button>
              <p className="text-xs text-earth-500">
                On your confirmation email. Guest checkout? Use the same email you paid with.
              </p>
            </div>
          ) : (
            <>
              <label htmlFor="track-order-email" className="form-label">Email address</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-earth-400" />
                  <Input
                    id="track-order-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="pl-9"
                  />
                </div>
                <Button type="submit" disabled={loading} className="h-11 rounded-xl sm:min-w-[120px]">
                  {loading ? 'Checking…' : 'Find order'}
                </Button>
              </div>
              <p className="mt-3 text-xs text-earth-500">
                Signed in? Shows your most recent order for this email on your account.
              </p>
            </>
          )}
        </form>

        {error && <p className="error mt-6">{error}</p>}

        {data && (
          <div className="mt-10 grid gap-8 md:grid-cols-2 md:gap-10 lg:gap-12">
            <div className="premium-card p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-earth-500">Status</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-earth-900">
                {orderStatusLabel(status, { pickup: isPickup })}
              </p>
              {data.order.order_number ? (
                <p className="mt-1 font-mono text-sm font-semibold text-earth-700">
                  {formatOrderNumber(data.order.order_number)}
                </p>
              ) : (
                <p className="mt-1 break-all font-mono text-xs text-earth-400">{data.order.id}</p>
              )}

              <div className="mt-8">
                <OrderStatusTimeline
                  status={data.order.status}
                  shippingMethod={data.order.shipping_method}
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className="premium-card p-6">
                <h3 className="text-base font-semibold text-earth-900">
                  {isPickup ? 'Pickup details' : 'Delivery details'}
                </h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-earth-500">{isPickup ? 'Fulfillment' : 'Shipping'}</dt>
                    <dd className="font-medium text-earth-900">
                      {SHIPPING_METHOD_LABEL[shippingMethod]}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-earth-500">{isPickup ? 'Ready by' : 'Est. delivery'}</dt>
                    <dd className="font-medium text-earth-900">
                      {isPickup
                        ? status === 'delivered' ? 'Picked up'
                          : status === 'cancelled' ? '—'
                          : status === 'ready_for_pickup' ? 'Ready now'
                          : 'Same day'
                        : status === 'delivered' ? 'Delivered'
                          : status === 'cancelled' ? '—'
                          : estimatedDelivery(data.order.created_at, data.order.shipping_method ?? 'standard')}
                    </dd>
                  </div>
                  {!isPickup && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-earth-500">Tracking #</dt>
                      <dd className="font-medium text-earth-900">
                        {data.order.tracking_number ?? 'Not assigned yet'}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-earth-500">{isPickup ? 'Pick up at' : 'Destination'}</dt>
                    <dd className="max-w-[14rem] text-right font-medium text-earth-900">
                      {isPickup
                        ? STORE.address
                        : `${data.order.city ?? '—'}, ${data.order.country ?? '—'}`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-earth-100 pt-3">
                    <dt className="font-semibold text-earth-800">Total</dt>
                    <dd className="font-bold text-earth-950">
                      {formatMoney(Number(data.order.total_amount ?? 0))}
                    </dd>
                  </div>
                </dl>
              </div>

              {data.items.length > 0 && (
                <div className="premium-card p-6">
                  <h3 className="text-base font-semibold text-earth-900">Items</h3>
                  <ul className="mt-4 space-y-3">
                    {data.items.map((item) => {
                      const fulfilled =
                        typeof item.fulfilled_quantity === 'number'
                          ? item.fulfilled_quantity
                          : item.quantity
                      const short = item.quantity - fulfilled
                      return (
                        <li
                          key={item.id}
                          className="flex justify-between gap-3 border-b border-earth-100 pb-3 text-sm last:border-0"
                        >
                          <span className="text-earth-700">
                            {item.product_name} × {fulfilled}
                            {short > 0 && (
                              <span className="mt-0.5 block text-xs font-medium text-red-600">
                                {short} unavailable — refunded
                              </span>
                            )}
                          </span>
                          <span className="font-semibold text-earth-900">
                            {formatMoney(item.product_price * fulfilled)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <Link
                href={`/receipt?id=${encodeURIComponent(
                  formatOrderNumber(data.order.order_number) || data.order.id
                )}${email.trim() ? `&email=${encodeURIComponent(email.trim())}` : ''}`}
                className="no-underline"
              >
                <Button variant="outline" className="h-12 w-full rounded-xl">
                  Download receipt
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!data && !error && (
          <div className="premium-card mt-10 max-w-md px-6 py-12 text-center">
            <Package className="mx-auto h-10 w-10 text-earth-300" strokeWidth={1.25} />
            <p className="mt-4 text-sm text-earth-600">Enter an order ID above to view progress.</p>
          </div>
        )}

        <p className="mt-10">
          <Link
            href="/shop"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 no-underline hover:text-brand-900"
          >
            ← Continue shopping
          </Link>
        </p>
      </div>
    </div>
  )
}
