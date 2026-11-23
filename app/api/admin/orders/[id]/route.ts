import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { actorLabel } from '@/lib/auth/admin-actor'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  isStatusAllowedFor,
  normalizeOrderStatus,
  ORDER_STATUS_TIMESTAMP_COLUMN,
} from '@/lib/order-status'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { sendOrderStatusEmail } from '@/lib/email/send-order-emails'
import { DELIVERY_PROOF_LABEL, type DeliveryProof } from '@/lib/orders/delivery-proof'

/** Order + line items + status history for the native admin order screen. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  const { id } = await params
  const [orderResult, itemsResult, logsResult] = await Promise.all([
    supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle(),
    supabaseAdmin.from('order_items').select('*').eq('order_id', id),
    supabaseAdmin
      .from('order_status_logs')
      .select('id,from_status,to_status,changed_at,changed_by,note')
      .eq('order_id', id)
      .order('changed_at', { ascending: true }),
  ])

  if (orderResult.error) {
    console.error('[admin/orders GET] lookup failed:', orderResult.error.message)
    return NextResponse.json({ error: 'Could not load order.' }, { status: 500 })
  }
  if (!orderResult.data) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

  return NextResponse.json({
    order: { ...orderResult.data, status: normalizeOrderStatus(orderResult.data.status) },
    items: itemsResult.data ?? [],
    logs: logsResult.error ? [] : (logsResult.data ?? []),
  })
}

export async function PATCH(
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
    const { status, trackingNumber } = body
    // Cap note length to prevent oversized payloads from reaching the DB.
    const noteRaw = typeof body.note === 'string' ? body.note.slice(0, 500) : ''
    const note = noteRaw
    const normalized = normalizeOrderStatus(status)
    const nowIso = new Date().toISOString()
    const deliveryProof =
      body.deliveryProof === 'handed' || body.deliveryProof === 'left_at_door'
        ? (body.deliveryProof as DeliveryProof)
        : null

    const { data: existingOrder, error: existingError } = await supabaseAdmin
      .from('orders')
      .select('status, order_number, customer_name, customer_email, total_amount, shipping_method')
      .eq('id', id)
      .single()

    if (existingError || !existingOrder) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (!isStatusAllowedFor(normalized, existingOrder.shipping_method)) {
      return NextResponse.json(
        { error: 'Pickup orders cannot be marked shipped or out for delivery.' },
        { status: 400 }
      )
    }

    const fromStatus = normalizeOrderStatus(existingOrder.status)
    const updatePayload: Record<string, unknown> = {
      status: normalized,
      tracking_number:
        typeof trackingNumber === 'string' && trackingNumber.trim()
          ? trackingNumber.trim()
          : null,
    }
    updatePayload[ORDER_STATUS_TIMESTAMP_COLUMN[normalized]] = nowIso

    if (deliveryProof) {
      updatePayload.delivery_proof = deliveryProof
      updatePayload.delivery_proof_at = nowIso
      updatePayload.delivery_proof_note = note.trim() || null
    }

    let updateResult = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (
      updateResult.error &&
      (/column .* does not exist/i.test(updateResult.error.message) ||
        /could not find the .* column/i.test(updateResult.error.message))
    ) {
      updateResult = await supabaseAdmin
        .from('orders')
        .update({ status: normalized })
        .eq('id', id)
        .select()
        .single()
    }

    if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 })

    const trackingNote = updatePayload.tracking_number ? `Tracking: ${String(updatePayload.tracking_number)}` : null
    const proofNote = deliveryProof ? DELIVERY_PROOF_LABEL[deliveryProof] : null
    const combinedNote =
      [typeof note === 'string' ? note.trim() : '', proofNote, trackingNote]
        .filter(Boolean)
        .join(' · ') || null

    if (fromStatus !== normalized || combinedNote) {
      const { error: logError } = await supabaseAdmin
        .from('order_status_logs')
        .insert({
          order_id: id,
          from_status: fromStatus,
          to_status: normalized,
          changed_by: actorLabel(auth.actor),
          note: combinedNote,
        })

      if (
        logError &&
        !/relation .* does not exist|could not find the table|column .* does not exist|could not find the .* column/i.test(
          logError.message
        )
      ) {
        console.error('Status log insert warning:', logError)
      }
    }

    // Notify the customer when the status actually changed. We intentionally do
    // NOT notify when admin only updates a tracking number or note on the same
    // status — that would spam customers with duplicate updates.
    if (fromStatus !== normalized && existingOrder.customer_email) {
      try {
        await sendOrderStatusEmail(
          {
            id,
            order_number: existingOrder.order_number ?? null,
            customer_name: existingOrder.customer_name ?? 'there',
            customer_email: existingOrder.customer_email,
            total_amount: Number(existingOrder.total_amount ?? 0),
            tracking_number: updatePayload.tracking_number
              ? String(updatePayload.tracking_number)
              : null,
            shipping_method: existingOrder.shipping_method ?? null,
          },
          normalized,
          typeof note === 'string' && note.trim() ? note.trim() : null,
        )
      } catch (emailErr) {
        console.error('[admin/orders PATCH] status email failed:', emailErr)
      }
    }

    return NextResponse.json(updateResult.data)
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    const { data: existing, error: lookupErr } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (lookupErr) {
      console.error('[orders DELETE] lookup failed:', lookupErr.message)
      return NextResponse.json({ error: 'Could not load order.' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    // order_items + order_status_logs cascade via FK on delete.
    const { error } = await supabaseAdmin.from('orders').delete().eq('id', id)
    if (error) {
      console.error('[orders DELETE] failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}
