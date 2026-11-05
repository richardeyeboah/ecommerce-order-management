import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { createPhoneOrder } from '@/lib/orders/create-phone-order'
import { normalizeOrderSource, normalizePaymentStatus } from '@/lib/orders/order-source'
import { normalizeManualSettleMethod } from '@/lib/payment-methods'
import { normalizeShippingMethod } from '@/lib/shipping'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ORDER_STATUSES, normalizeOrderStatus } from '@/lib/order-status'
import { NEEDS_ACTION_STATUSES } from '@/lib/admin/ops-health'
import { parseOrderRef } from '@/lib/orders/order-number'

export const runtime = 'nodejs'

const LIST_LIMIT = 50
const MAX_OFFSET = 5000

/** Orders per status, for the filter badges. Head-only queries, so no rows are transferred. */
async function statusCounts(): Promise<Record<string, number>> {
  const results = await Promise.all(
    ORDER_STATUSES.map(async (status) => {
      const { count } = await supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      return [status, count ?? 0] as const
    }),
  )
  return Object.fromEntries(results)
}

/**
 * Admin order queue for the native app. Mirrors the `/admin/orders` page filters:
 * `queue=needs_action` (default), `queue=all`, `queue=to_ship` (shipping orders that are open and
 * have no tracking yet, oldest first), `status=<status>`, and `q=<name|email|LQ-number>`.
 * Paged by `offset` (50 per page); `has_more` says whether another page exists.
 * The first page also carries `counts` per status.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  const params = req.nextUrl.searchParams
  const rawStatus = params.get('status')?.trim()
  const status = rawStatus ? normalizeOrderStatus(rawStatus) : null
  // PostgREST `or()` treats , ( ) as syntax, so strip them from free-text search.
  const term = (params.get('q') ?? '').replace(/[,()%*"\\]/g, ' ').trim().slice(0, 80)
  const requested = params.get('queue')
  const queue =
    status || term ? 'all' : requested === 'all' || requested === 'to_ship' ? requested : 'needs_action'
  const offset = Math.min(MAX_OFFSET, Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0))

  // One extra row tells us whether there is another page.
  let query = supabaseAdmin
    .from('orders')
    .select('*')
    // The ship queue is worked oldest first, like a packing line.
    .order('created_at', { ascending: queue === 'to_ship' })
    .range(offset, offset + LIST_LIMIT)

  if (status) query = query.eq('status', status)
  else if (queue === 'needs_action') query = query.in('status', [...NEEDS_ACTION_STATUSES])
  else if (queue === 'to_ship') {
    query = query
      .in('status', ['ordered', 'processing'])
      .neq('shipping_method', 'pickup')
      .or('tracking_number.is.null,tracking_number.eq.')
  }

  if (term) {
    const ref = parseOrderRef(term)
    const filters = [`customer_name.ilike.%${term}%`, `customer_email.ilike.%${term}%`]
    if (ref?.type === 'number') filters.push(`order_number.eq.${ref.value}`)
    if (ref?.type === 'uuid') filters.push(`id.eq.${ref.value}`)
    query = query.or(filters.join(','))
  }

  const [{ data, error }, counts] = await Promise.all([
    query,
    offset === 0 ? statusCounts() : Promise.resolve(null),
  ])
  if (error) {
    console.error('[admin/orders GET] failed:', error.message)
    return NextResponse.json({ error: 'Could not load orders.' }, { status: 500 })
  }

  const rows = data ?? []
  return NextResponse.json({
    queue,
    has_more: rows.length > LIST_LIMIT,
    ...(counts ? { counts } : {}),
    orders: rows.slice(0, LIST_LIMIT).map((row) => ({
      id: row.id,
      order_number: row.order_number ?? null,
      created_at: row.created_at,
      status: normalizeOrderStatus(row.status),
      customer_name: row.customer_name ?? null,
      customer_email: row.customer_email ?? null,
      customer_phone: row.customer_phone ?? null,
      total_amount: row.total_amount ?? null,
      shipping_method: row.shipping_method ?? null,
      tracking_number: row.tracking_number ?? null,
      payment_status: row.payment_status ?? null,
      city: row.city ?? null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  const linesRaw = Array.isArray(body.lines) ? body.lines : []
  const lines = linesRaw
    .map((line: unknown) => {
      if (!line || typeof line !== 'object') return null
      const row = line as Record<string, unknown>
      return {
        productId: typeof row.productId === 'string' ? row.productId : '',
        quantity: Number(row.quantity),
      }
    })
    .filter((l: { productId: string; quantity: number } | null): l is { productId: string; quantity: number } =>
      Boolean(l)
    )

  const result = await createPhoneOrder({
    customerName: typeof body.customerName === 'string' ? body.customerName : '',
    customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone : '',
    customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail : null,
    source: normalizeOrderSource(body.source),
    shippingMethod: normalizeShippingMethod(
      typeof body.shippingMethod === 'string' ? body.shippingMethod : 'pickup'
    ),
    paymentStatus: normalizePaymentStatus(body.paymentStatus),
    paymentMethod: normalizeManualSettleMethod(body.paymentMethod),
    addressLine: typeof body.addressLine === 'string' ? body.addressLine : null,
    city: typeof body.city === 'string' ? body.city : null,
    state: typeof body.state === 'string' ? body.state : null,
    postalCode: typeof body.postalCode === 'string' ? body.postalCode : null,
    country: typeof body.country === 'string' ? body.country : null,
    pickupContactName:
      typeof body.pickupContactName === 'string' ? body.pickupContactName : null,
    note: typeof body.note === 'string' ? body.note : null,
    lines,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    totalAmount: result.totalAmount,
  })
}
