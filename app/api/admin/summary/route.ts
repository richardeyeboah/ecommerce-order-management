import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NEEDS_ACTION_STATUSES } from '@/lib/admin/ops-health'
import { resolveRange, type RangeKey } from '@/lib/admin/date-range'
import {
  computePeriodStats,
  countableOrderIdsFrom,
  topProducts,
  type PeriodOrderItem,
  type PeriodOrderRow,
} from '@/lib/admin/period-stats'
import { normalizeOrderStatus } from '@/lib/order-status'

export const runtime = 'nodejs'

const RANGES: RangeKey[] = ['today', 'yesterday', '7d', '30d', 'mtd']
const LOW_STOCK_MAX = 5
const ORDER_COLUMNS =
  'id, total_amount, subtotal_amount, shipping_fee, status, refunded_at, refund_amount, created_at, payment_status'

async function periodRows(startIso: string | null, endIso: string) {
  const build = (columns: string) => {
    let q = supabaseAdmin.from('orders').select(columns).lt('created_at', endIso)
    if (startIso) q = q.gte('created_at', startIso)
    return q
  }
  let { data, error } = await build(ORDER_COLUMNS)
  // payment_status only exists after the phone-orders migration; fall back without it.
  if (error && /payment_status/i.test(error.message)) {
    ;({ data, error } = await build(ORDER_COLUMNS.replace(', payment_status', '')))
  }
  if (error) throw new Error(error.message)
  const orders = (data ?? []) as unknown as PeriodOrderRow[]
  if (orders.length === 0) return { orders, items: [] as PeriodOrderItem[] }
  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('order_id, product_id, product_name, quantity, subtotal, product_price')
    .in(
      'order_id',
      orders.map((o) => o.id),
    )
  return { orders, items: (items ?? []) as PeriodOrderItem[] }
}

/**
 * Store-manager dashboard for the native app: the same revenue rules as `/admin`
 * (lib/admin/period-stats), plus the work queue and stock alerts.
 * `range` = today (default) | yesterday | 7d | 30d | mtd.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  const requested = req.nextUrl.searchParams.get('range') as RangeKey | null
  const key: RangeKey = requested && RANGES.includes(requested) ? requested : 'today'
  const range = resolveRange(key, undefined, undefined)
  const startIso = range.start?.toUTC().toISO() ?? null
  const endIso = range.end.toUTC().toISO()!
  const prevStartIso = range.prevStart?.toUTC().toISO() ?? null
  const prevEndIso = range.prevEnd?.toUTC().toISO() ?? null

  try {
    const [curr, prev, needsAction, readyPickup, toShip, pendingReviews, outOfStock, lowStock, recent] =
      await Promise.all([
        periodRows(startIso, endIso),
        prevStartIso && prevEndIso
          ? periodRows(prevStartIso, prevEndIso)
          : Promise.resolve({ orders: [] as PeriodOrderRow[], items: [] as PeriodOrderItem[] }),
        supabaseAdmin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .in('status', [...NEEDS_ACTION_STATUSES]),
        supabaseAdmin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'ready_for_pickup'),
        // Same rule as `/api/admin/orders?queue=to_ship`.
        supabaseAdmin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['ordered', 'processing'])
          .neq('shipping_method', 'pickup')
          .or('tracking_number.is.null,tracking_number.eq.'),
        supabaseAdmin
          .from('product_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('approved', false),
        supabaseAdmin
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('in_stock', false),
        supabaseAdmin
          .from('products')
          .select('id, name, stock_quantity, image_url')
          .eq('in_stock', true)
          .not('stock_quantity', 'is', null)
          .lte('stock_quantity', LOW_STOCK_MAX)
          .order('stock_quantity', { ascending: true })
          .limit(20),
        supabaseAdmin
          .from('orders')
          .select('id, order_number, customer_name, total_amount, status, shipping_method, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ])

    const stats = computePeriodStats(curr.orders, curr.items)
    const prevStats = computePeriodStats(prev.orders, prev.items)
    const best = topProducts(curr.items, countableOrderIdsFrom(curr.orders), 5)

    return NextResponse.json({
      range: key,
      label: range.label,
      gross: stats.gross,
      net_revenue: stats.netRevenue,
      orders: stats.ordersCount,
      units: stats.unitsSold,
      average_order: stats.averageOrderValue,
      unpaid_count: stats.unpaidCount,
      previous_gross: prevStartIso ? prevStats.gross : null,
      previous_orders: prevStartIso ? prevStats.ordersCount : null,
      needs_action: needsAction.count ?? 0,
      ready_for_pickup: readyPickup.count ?? 0,
      to_ship: toShip.count ?? 0,
      pending_reviews: pendingReviews.count ?? 0,
      out_of_stock: outOfStock.count ?? 0,
      low_stock: (lowStock.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        stock_quantity: p.stock_quantity,
        image_url: p.image_url ?? null,
      })),
      best_sellers: best.map((b) => ({
        product_id: b.productId,
        name: b.productName,
        units: b.units,
        revenue: b.revenue,
      })),
      recent_orders: (recent.data ?? []).map((o) => ({
        id: o.id,
        order_number: o.order_number ?? null,
        customer_name: o.customer_name ?? null,
        total_amount: o.total_amount ?? null,
        status: normalizeOrderStatus(o.status),
        shipping_method: o.shipping_method ?? null,
        created_at: o.created_at,
      })),
    })
  } catch (err) {
    console.error('[admin/summary GET] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load the dashboard.' }, { status: 500 })
  }
}
