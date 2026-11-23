import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { actorLabel } from '@/lib/auth/admin-actor'
import { assertSameOrigin } from '@/lib/security/same-origin'
import {
  isStatusAllowedFor,
  normalizeOrderStatus,
  ORDER_STATUS_TIMESTAMP_COLUMN,
} from '@/lib/order-status'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 100) : []
    const action = typeof body.action === 'string' ? body.action : 'status'

    if (!ids.length) {
      return NextResponse.json({ error: 'ids are required.' }, { status: 400 })
    }

    if (action === 'delete') {
      const { error } = await supabaseAdmin.from('orders').delete().in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, deleted: ids.length })
    }

    const status = typeof body.status === 'string' ? normalizeOrderStatus(body.status) : null
    if (!status) {
      return NextResponse.json({ error: 'ids and status are required.' }, { status: 400 })
    }

    // Fetch current statuses before updating so audit log has from_status
    const { data: currentOrders } = await supabaseAdmin
      .from('orders')
      .select('id, status, shipping_method')
      .in('id', ids)

    const fromStatusMap = new Map(
      (currentOrders ?? []).map((o) => [o.id, normalizeOrderStatus(o.status)])
    )

    // A pickup order has no carrier leg, so a mixed selection must not drag it
    // into "shipped" / "out for delivery". Those rows are skipped, not failed.
    const shippingMethodMap = new Map(
      (currentOrders ?? []).map((o) => [o.id, o.shipping_method as string | null])
    )
    const targetIds = ids.filter((id) =>
      isStatusAllowedFor(status, shippingMethodMap.get(id) ?? null)
    )
    const skipped = ids.length - targetIds.length

    if (!targetIds.length) {
      return NextResponse.json(
        { error: 'Pickup orders cannot be marked shipped or out for delivery.' },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()
    const updatePayload: Record<string, unknown> = { status }
    updatePayload[ORDER_STATUS_TIMESTAMP_COLUMN[status]] = nowIso

    const { error } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .in('id', targetIds)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Log each status change with correct from_status
    await supabaseAdmin.from('order_status_logs').insert(
      targetIds.map((id) => ({
        order_id: id,
        from_status: fromStatusMap.get(id) ?? null,
        to_status: status,
        changed_by: `${actorLabel(auth.actor)} (bulk)`,
        note: `Bulk update to ${status}`,
      }))
    )

    return NextResponse.json({ ok: true, updated: targetIds.length, skipped })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}
