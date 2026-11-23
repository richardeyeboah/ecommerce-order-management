import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { actorLabel } from '@/lib/auth/admin-actor'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { normalizeOrderStatus } from '@/lib/order-status'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200).trim() : ''

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount, payment_method, refunded_at, status')
      .eq('id', id)
      .single()

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (order.refunded_at) {
      return NextResponse.json({ error: 'Order already refunded.' }, { status: 400 })
    }

    const fromStatus = normalizeOrderStatus(order.status)
    const nowIso = new Date().toISOString()

    const { error } = await supabaseAdmin
      .from('orders')
      .update({
        refunded_at: nowIso,
        refund_amount: order.total_amount,
        status: 'cancelled',
        cancelled_at: nowIso,
      })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { error: logErr } = await supabaseAdmin.from('order_status_logs').insert({
      order_id: id,
      from_status: fromStatus,
      to_status: 'cancelled',
      changed_by: actorLabel(auth.actor),
      note: `Manual refund marked${reason ? `: ${reason}` : ''} ($${Number(order.total_amount ?? 0).toFixed(2)})`,
    })

    if (logErr) {
      console.error('[manual-refund] audit log failed:', logErr.message)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}
