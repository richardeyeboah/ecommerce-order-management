import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { normalizeOrderStatus } from '@/lib/order-status'
import { getStoreSalesTaxRate } from '@/lib/tax/sales-tax'
import {
  computeShortfallRefund,
  describeShortLines,
  type ShortfallLineInput,
} from '@/lib/orders/partial-refund'
import { sendShortfallEmail } from '@/lib/email/send-order-emails'

type IncomingLine = { itemId?: unknown; fulfilledQuantity?: unknown }

function isMissingColumn(message: string): boolean {
  return /column .* does not exist|could not find the .* column/i.test(message)
}

/**
 * Record what was actually handed over and refund the difference.
 *
 * `preview: true` runs the same math and returns the quote without touching
 * Stripe or the database, so the admin UI and the server always agree on the
 * amount before anyone clicks refund.
 */
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
    const body = await req.json()
    const preview = body?.preview === true
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200).trim() : ''
    const incoming: IncomingLine[] = Array.isArray(body?.lines) ? body.lines.slice(0, 200) : []

    if (!incoming.length) {
      return NextResponse.json({ error: 'No item quantities were provided.' }, { status: 400 })
    }

    const requestedByItem = new Map<string, number>()
    for (const line of incoming) {
      if (typeof line?.itemId !== 'string') continue
      const qty = Number(line.fulfilledQuantity)
      if (!Number.isFinite(qty) || qty < 0) continue
      requestedByItem.set(line.itemId, Math.trunc(qty))
    }
    if (!requestedByItem.size) {
      return NextResponse.json({ error: 'No valid item quantities were provided.' }, { status: 400 })
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .select('*')
      .eq('order_id', id)

    if (itemsErr || !items?.length) {
      return NextResponse.json({ error: 'This order has no items.' }, { status: 400 })
    }

    // Categories drive whether a refunded line carries sales tax back.
    const productIds = Array.from(
      new Set(
        items
          .map((i) => i.product_id)
          .filter((v): v is string => typeof v === 'string')
      )
    )
    const { data: productRows } = productIds.length
      ? await supabaseAdmin.from('products').select('id, category').in('id', productIds)
      : { data: [] }
    const categoryByProduct = new Map(
      (productRows ?? []).map((p) => [p.id as string, (p.category as string | null) ?? ''])
    )

    const orderRecord = order as Record<string, unknown>
    const lines: ShortfallLineInput[] = items
      .filter((item) => requestedByItem.has(item.id))
      .map((item) => {
        const ordered = Number(item.quantity ?? 0)
        const recorded = (item as Record<string, unknown>).fulfilled_quantity
        const previousFulfilled =
          typeof recorded === 'number' && Number.isFinite(recorded) ? recorded : ordered
        return {
          itemId: item.id,
          productName: String(item.product_name ?? 'Item'),
          unitPrice: Number(item.product_price ?? 0),
          orderedQuantity: ordered,
          previousFulfilledQuantity: previousFulfilled,
          nextFulfilledQuantity: requestedByItem.get(item.id) ?? previousFulfilled,
          category: String(
            (item as Record<string, unknown>).product_category ??
              (typeof item.product_id === 'string'
                ? (categoryByProduct.get(item.product_id) ?? '')
                : '')
          ),
          taxClass:
            typeof (item as Record<string, unknown>).tax_class === 'string'
              ? String((item as Record<string, unknown>).tax_class)
              : null,
        }
      })

    if (!lines.length) {
      return NextResponse.json({ error: 'None of those items belong to this order.' }, { status: 400 })
    }

    const orderTotal = Number(order.total_amount ?? 0)
    const alreadyRefunded = Number(order.refund_amount ?? 0)
    const maxRefundable = Math.max(0, Math.round((orderTotal - alreadyRefunded) * 100) / 100)

    const quote = computeShortfallRefund({
      lines,
      taxRate: Number.isFinite(Number(orderRecord.tax_rate))
        ? Number(orderRecord.tax_rate)
        : getStoreSalesTaxRate(),
      orderTaxAmount: Number(orderRecord.tax_amount ?? 0),
      maxRefundable,
    })

    if (preview) {
      return NextResponse.json({ ok: true, preview: true, quote, maxRefundable })
    }

    const isStripe =
      order.payment_method === 'stripe' && typeof order.stripe_payment_intent_id === 'string'
    // No money was collected on an unpaid phone order — nothing to refund;
    // the shortfall just reduces what staff should collect at handoff.
    const isUnpaid = orderRecord.payment_status === 'unpaid'

    // 1. Persist what was handed over. Do this before charging anything back so
    //    a failed refund never leaves the money moved but the record stale.
    for (const line of quote.lines) {
      const { error: updateErr } = await supabaseAdmin
        .from('order_items')
        .update({ fulfilled_quantity: line.fulfilledQuantity })
        .eq('id', line.itemId)
        .eq('order_id', id)

      if (updateErr && isMissingColumn(updateErr.message)) {
        return NextResponse.json(
          {
            error:
              'Run supabase/partial-fulfillment.sql — the fulfilled_quantity column is missing.',
          },
          { status: 400 }
        )
      }
      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }
    }

    // 2. Move the money.
    let refundId: string | null = null
    let refundError: string | null = null

    if (quote.totalRefund > 0 && isStripe) {
      const secret = process.env.STRIPE_SECRET_KEY
      if (!secret) {
        refundError = 'Stripe is not configured — record the refund manually.'
      } else {
        try {
          const stripe = new Stripe(secret)
          const refund = await stripe.refunds.create({
            payment_intent: order.stripe_payment_intent_id as string,
            amount: Math.round(quote.totalRefund * 100),
            reason: 'requested_by_customer',
          })
          refundId = refund.id
        } catch (e) {
          refundError = e instanceof Error ? e.message : 'Stripe refund failed.'
        }
      }
    }

    const refundApplied =
      quote.totalRefund > 0 && !isUnpaid && (refundId !== null || !isStripe)
    const newRefundTotal = refundApplied
      ? Math.round((alreadyRefunded + quote.totalRefund) * 100) / 100
      : alreadyRefunded

    if (refundApplied) {
      const previousShortfall = Number(orderRecord.shortfall_refund_amount ?? 0)
      const orderUpdate: Record<string, unknown> = {
        refund_amount: newRefundTotal,
        shortfall_refund_amount:
          Math.round((previousShortfall + quote.totalRefund) * 100) / 100,
      }
      if (refundId) orderUpdate.refund_stripe_id = refundId
      if (newRefundTotal >= orderTotal) orderUpdate.refunded_at = new Date().toISOString()

      let update = await supabaseAdmin.from('orders').update(orderUpdate).eq('id', id)
      if (update.error && isMissingColumn(update.error.message)) {
        delete orderUpdate.shortfall_refund_amount
        update = await supabaseAdmin.from('orders').update(orderUpdate).eq('id', id)
      }
      if (update.error) {
        return NextResponse.json({ error: update.error.message }, { status: 500 })
      }
    }

    // 3. Audit trail.
    const status = normalizeOrderStatus(order.status)
    const summary = quote.shortLines.length
      ? describeShortLines(quote.shortLines)
      : 'All items fulfilled'
    const noteParts = [summary]
    if (refundApplied) {
      noteParts.push(
        `Refunded $${quote.totalRefund.toFixed(2)}${isStripe ? ' via Stripe' : ' (manual)'}`
      )
    } else if (isUnpaid && quote.totalRefund > 0) {
      noteParts.push(
        `Unpaid order — collect $${Math.max(0, orderTotal - quote.totalRefund).toFixed(2)} instead of $${orderTotal.toFixed(2)}`
      )
    } else if (refundError) {
      noteParts.push(`Refund failed: ${refundError}`)
    }
    if (reason) noteParts.push(reason)

    const { error: logError } = await supabaseAdmin.from('order_status_logs').insert({
      order_id: id,
      from_status: status,
      to_status: status,
      changed_by: 'admin',
      note: noteParts.join(' · ').slice(0, 500),
    })
    if (logError && !/relation .* does not exist|could not find the table/i.test(logError.message)) {
      console.error('[adjust-items] log insert warning:', logError)
    }

    // 4. Tell the customer what they are not getting and what came back.
    if (quote.shortLines.length && order.customer_email) {
      try {
        await sendShortfallEmail({
          order: {
            id,
            order_number: order.order_number ?? null,
            customer_name: order.customer_name ?? 'there',
            customer_email: order.customer_email,
            total_amount: orderTotal,
            shipping_method: order.shipping_method ?? null,
          },
          shortLines: quote.shortLines,
          refundAmount: refundApplied ? quote.totalRefund : 0,
        })
      } catch (e) {
        console.error('[adjust-items] shortfall email failed:', e)
      }
    }

    if (refundError) {
      return NextResponse.json(
        { error: `Items saved, but the refund failed: ${refundError}`, quote },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      quote,
      refundId,
      refunded: refundApplied,
      unpaid: isUnpaid,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
