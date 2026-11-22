import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { fulfillOrderFromPaymentIntent } from '@/lib/orders/fulfill-payment-intent'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET missing')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe] webhook signature failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    if (pi.metadata?.checkout_snapshot_id) {
      try {
        await fulfillOrderFromPaymentIntent(pi.id)
      } catch (e) {
        console.error('[stripe] PI fulfillment failed', e)
        return NextResponse.json({ error: 'Fulfillment failed' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ received: true })
}
