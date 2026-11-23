import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { actorLabel } from '@/lib/auth/admin-actor'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { normalizeOrderStatus } from '@/lib/order-status'

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
    const { amount, reason, restock, restockOnly } = await req.json()

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select(
        'id, stripe_payment_intent_id, total_amount, refund_amount, refunded_at, payment_method, status, inventory_restocked_at'
      )
      .eq('id', id)
      .single()

    if (fetchErr) {
      console.error('[refund] order lookup failed:', fetchErr.message)
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

    if (restockOnly === true) {
      if (!order.refunded_at) {
        return NextResponse.json(
          { error: 'Inventory can only be restocked separately after a completed refund.' },
          { status: 400 }
        )
      }
      if (order.inventory_restocked_at) {
        return NextResponse.json({ ok: true, restocked: true, alreadyRestocked: true })
      }

      const { error } = await supabaseAdmin.rpc('restock_order_inventory', {
        p_order_id: id,
      })
      if (error) {
        console.error('[refund] inventory-only restock failed:', error.message)
        return NextResponse.json(
          { error: `Refund is complete, but inventory restocking failed: ${error.message}` },
          { status: 502 }
        )
      }
      return NextResponse.json({ ok: true, restocked: true })
    }

    if (order.refunded_at) return NextResponse.json({ error: 'Order already refunded.' }, { status: 400 })
    if (order.payment_method !== 'stripe' || !order.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'Order has no Stripe payment to refund.' }, { status: 400 })
    }

    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Refunds are temporarily unavailable.' }, { status: 500 })
    }
    const stripe = new Stripe(secret)

    const orderTotalCents = Math.round(Number(order.total_amount) * 100)
    if (!Number.isFinite(orderTotalCents) || orderTotalCents <= 0) {
      return NextResponse.json({ error: 'Order total is invalid.' }, { status: 400 })
    }

    const alreadyRefundedCents = Math.round(Number(order.refund_amount ?? 0) * 100)
    const remainingCents = orderTotalCents - alreadyRefundedCents
    if (remainingCents <= 0) {
      return NextResponse.json({ error: 'Nothing left to refund on this order.' }, { status: 400 })
    }

    const amountCents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: 'Invalid refund amount.' }, { status: 400 })
    }
    if (amountCents > remainingCents) {
      return NextResponse.json(
        {
          error: `Refund amount exceeds remaining balance ($${(remainingCents / 100).toFixed(2)}).`,
        },
        { status: 400 }
      )
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: amountCents,
        reason: 'requested_by_customer',
      },
      {
        idempotencyKey: `order-refund:${id}:${alreadyRefundedCents}:${amountCents}`,
      }
    )

    const isFullRefund = amountCents >= remainingCents
    const newRefundTotal = (alreadyRefundedCents + amountCents) / 100

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        refunded_at: isFullRefund ? new Date().toISOString() : order.refunded_at,
        refund_amount: newRefundTotal,
        refund_stripe_id: refund.id,
      })
      .eq('id', id)
    if (updateError) {
      console.error('[refund] Stripe succeeded but order update failed:', {
        orderId: id,
        refundId: refund.id,
        error: updateError.message,
      })
      return NextResponse.json(
        {
          error:
            'Stripe issued the refund, but the order record needs reconciliation. Do not refund again.',
          refundId: refund.id,
        },
        { status: 502 }
      )
    }

    let restocked = false
    let restockError: string | null = null
    if (isFullRefund && restock === true) {
      const { data, error } = await supabaseAdmin.rpc('restock_order_inventory', {
        p_order_id: id,
      })
      if (error) {
        console.error('[refund] restock failed:', error.message)
        restockError = error.message
      } else {
        restocked = data === true || Boolean(order.inventory_restocked_at)
      }
    }

    const fromStatus = normalizeOrderStatus(order.status)
    const toStatus = isFullRefund ? 'cancelled' : fromStatus

    await supabaseAdmin.from('order_status_logs').insert({
      order_id: id,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: actorLabel(auth.actor),
      note: `Refunded $${(amountCents / 100).toFixed(2)}${reason ? ` — ${reason}` : ''}${restockError ? ` — inventory restock failed: ${restockError}` : ''}`.slice(0, 500),
    })

    if (restockError) {
      return NextResponse.json(
        {
          error: 'Refund issued, but inventory restocking failed. Retry inventory restocking only.',
          refundId: refund.id,
          refundIssued: true,
          restockFailed: true,
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, refundId: refund.id, restocked })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Refund failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
