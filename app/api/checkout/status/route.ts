import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fulfillOrderFromPaymentIntent } from '@/lib/orders/fulfill-payment-intent'
import { getStripe } from '@/lib/stripe'
import { resolveCheckoutMode, GUEST_CHECKOUT_MODE } from '@/lib/orders/guest-checkout'

export const runtime = 'nodejs'

/**
 * Poll after Stripe redirect: payment confirmed + order row exists after webhook.
 */
export async function GET(req: NextRequest) {
  const supabaseUser = await createClient()
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()

  const sessionId = req.nextUrl.searchParams.get('session_id')?.trim()
  const paymentIntentId = req.nextUrl.searchParams.get('payment_intent')?.trim()

  if (!sessionId && !paymentIntentId) {
    return NextResponse.json({ error: 'Missing session_id or payment_intent' }, { status: 400 })
  }

  try {
    const stripe = getStripe()

    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      const checkoutMode = resolveCheckoutMode(pi.metadata ?? {})
      const isGuest = checkoutMode === GUEST_CHECKOUT_MODE

      if (!isGuest) {
        if (!user) {
          return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
        }
        if (pi.metadata?.user_id !== user.id) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      if (pi.status !== 'succeeded') {
        return NextResponse.json({
          status: 'unpaid',
          paymentStatus: pi.status,
        })
      }

      let orderQuery = supabaseAdmin
        .from('orders')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntentId)

      orderQuery = isGuest ? orderQuery.is('user_id', null) : orderQuery.eq('user_id', user!.id)

      let { data: order } = await orderQuery.maybeSingle()

      // Webhook may be missing locally or delayed — fulfill on poll as fallback
      if (!order?.id) {
        try {
          const result = await fulfillOrderFromPaymentIntent(paymentIntentId)
          if (result.orderId) {
            let createdQuery = supabaseAdmin
              .from('orders')
              .select('id')
              .eq('id', result.orderId)

            createdQuery = isGuest
              ? createdQuery.is('user_id', null)
              : createdQuery.eq('user_id', user!.id)

            const { data: created } = await createdQuery.maybeSingle()
            order = created
          }
        } catch (e) {
          console.error('[checkout/status] fulfill fallback', e)
        }
      }

      if (order?.id) {
        const { count, error: itemsError } = await supabaseAdmin
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', order.id)
        if (itemsError || !count) {
          return NextResponse.json({
            status: 'processing',
            message: 'Payment received — finalizing your order…',
          })
        }
        return NextResponse.json({
          status: 'complete',
          orderId: order.id,
        })
      }

      return NextResponse.json({
        status: 'processing',
        message: 'Payment received — finalizing your order…',
      })
    }

    if (!user) {
      return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId!)

    if (session.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({
        status: 'unpaid',
        paymentStatus: session.payment_status,
      })
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('stripe_checkout_session_id', sessionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (order?.id) {
      return NextResponse.json({
        status: 'complete',
        orderId: order.id,
      })
    }

    return NextResponse.json({
      status: 'processing',
      message: 'Payment received — finalizing your order…',
    })
  } catch (e) {
    console.error('[checkout/status]', e)
    return NextResponse.json({ error: 'Could not load payment status.' }, { status: 500 })
  }
}
