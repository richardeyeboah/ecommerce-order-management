import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { actorLabel } from '@/lib/auth/admin-actor'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeOrderStatus, orderStatusLabel, isPickupShippingMethod } from '@/lib/order-status'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { sendOrderStatusEmail } from '@/lib/email/send-order-emails'
import { isPlaceholderCustomerEmail } from '@/lib/orders/order-source'

/** Re-send the notification for an order's current status without changing it. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(
        'status, order_number, customer_name, customer_email, total_amount, shipping_method, tracking_number'
      )
      .eq('id', id)
      .single()

    if (error || !order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }
    if (isPlaceholderCustomerEmail(order.customer_email)) {
      return NextResponse.json(
        { error: 'No customer email on file — call or text the customer instead.' },
        { status: 400 }
      )
    }

    const status = normalizeOrderStatus(order.status)
    const sent = await sendOrderStatusEmail(
      {
        id,
        order_number: order.order_number ?? null,
        customer_name: order.customer_name ?? 'there',
        customer_email: order.customer_email,
        total_amount: Number(order.total_amount ?? 0),
        tracking_number: order.tracking_number ?? null,
        shipping_method: order.shipping_method ?? null,
      },
      status,
      null
    )

    if (!sent) {
      return NextResponse.json(
        { error: 'Email transport is not configured or the send failed.' },
        { status: 502 }
      )
    }

    const label = orderStatusLabel(status, {
      pickup: isPickupShippingMethod(order.shipping_method),
    })
    const { error: logError } = await supabaseAdmin.from('order_status_logs').insert({
      order_id: id,
      from_status: status,
      to_status: status,
      changed_by: actorLabel(auth.actor),
      note: `Resent "${label}" notice to ${order.customer_email}`,
    })

    if (
      logError &&
      !/relation .* does not exist|could not find the table|column .* does not exist|could not find the .* column/i.test(
        logError.message
      )
    ) {
      console.error('[orders notify] log insert warning:', logError)
    }

    return NextResponse.json({ ok: true, sentTo: order.customer_email })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}
