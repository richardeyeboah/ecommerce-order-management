import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeOrderStatus } from '@/lib/order-status'
import { parseOrderRef } from '@/lib/orders/order-number'
import { normalizeGuestEmail } from '@/lib/orders/guest-checkout'

export async function GET(req: NextRequest) {
  const idRaw = req.nextUrl.searchParams.get('id')?.trim()
  const emailRaw = req.nextUrl.searchParams.get('email')?.trim().toLowerCase()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let order: Record<string, unknown> | null = null

  if (!user) {
    const email = normalizeGuestEmail(emailRaw)
    const ref = parseOrderRef(idRaw)
    if (!ref || !email) {
      return NextResponse.json(
        { error: 'Enter your order number and the email used at checkout.' },
        { status: 400 }
      )
    }

    let query = supabaseAdmin.from('orders').select('*').ilike('customer_email', email)
    query = ref.type === 'uuid' ? query.eq('id', ref.value) : query.eq('order_number', ref.value)
    const { data, error: orderError } = await query.maybeSingle()
    if (orderError || !data) {
      return NextResponse.json({ error: 'Order not found. Check your order number and email.' }, { status: 404 })
    }
    order = data
  } else if (emailRaw && !idRaw) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .ilike('customer_email', emailRaw)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    order = data
    if (!order) {
      return NextResponse.json(
        { error: 'No orders found for that email address on your account.' },
        { status: 404 }
      )
    }
  } else {
    const ref = parseOrderRef(idRaw)
    if (!ref) {
      return NextResponse.json(
        { error: 'Enter your order number (e.g. LQ-1042) or order ID.' },
        { status: 400 }
      )
    }

    let query = supabaseAdmin.from('orders').select('*').eq('user_id', user.id)
    query = ref.type === 'uuid' ? query.eq('id', ref.value) : query.eq('order_number', ref.value)
    const { data, error: orderError } = await query.maybeSingle()
    if (orderError || !data) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }
    order = data
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  }

  const [{ data: items }, logsResult] = await Promise.all([
    supabaseAdmin
      .from('order_items')
      // `*` so fulfilled_quantity is included on installs that ran
      // partial-fulfillment.sql, without breaking those that have not.
      .select('*')
      .eq('order_id', order.id),
    supabaseAdmin
      .from('order_status_logs')
      .select('id,from_status,to_status,changed_at,note')
      .eq('order_id', order.id)
      .order('changed_at', { ascending: true }),
  ])

  const missingTable =
    !!logsResult.error &&
    (logsResult.error.code === 'PGRST205' || logsResult.error.code === '42P01')

  if (logsResult.error && !missingTable) {
    console.warn('[orders/track] logs query:', logsResult.error.message)
  }

  const logs = missingTable ? [] : (logsResult.data ?? [])

  return NextResponse.json({
    order: publicOrderFields(order),
    items: (items ?? []).map(publicItemFields),
    logs,
  })
}

/**
 * The order row is fetched with `*`, which includes Stripe identifiers and
 * internal notes. Only these fields ever reach the browser.
 */
const PUBLIC_ORDER_FIELDS = [
  'id',
  'order_number',
  'created_at',
  'customer_name',
  'customer_email',
  'customer_phone',
  'address_line',
  'city',
  'state',
  'postal_code',
  'country',
  'subtotal_amount',
  'shipping_fee',
  'tax_amount',
  'total_amount',
  'refund_amount',
  'refunded_at',
  'shipping_method',
  'payment_method',
  'tracking_number',
  'pickup_contact_name',
  'ready_for_pickup_at',
  'delivery_proof',
  'delivery_proof_at',
] as const

const PUBLIC_ITEM_FIELDS = [
  'id',
  'product_id',
  'product_name',
  'product_price',
  'quantity',
  'subtotal',
  'fulfilled_quantity',
] as const

function pick(row: Record<string, unknown>, fields: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in row) out[field] = row[field]
  }
  return out
}

function publicOrderFields(order: Record<string, unknown>) {
  return {
    ...pick(order, PUBLIC_ORDER_FIELDS),
    status: normalizeOrderStatus(order.status as string),
  }
}

function publicItemFields(item: Record<string, unknown>) {
  return pick(item, PUBLIC_ITEM_FIELDS)
}
