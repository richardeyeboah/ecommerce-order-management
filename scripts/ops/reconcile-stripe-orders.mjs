/**
 * Reports succeeded checkout PaymentIntents that do not have a complete order.
 * Read-only by design. Run with production credentials only during a controlled audit:
 * node --env-file=.env.local scripts/ops/reconcile-stripe-orders.mjs
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!stripeKey || !supabaseUrl || !serviceKey) {
  throw new Error('STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const stripe = new Stripe(stripeKey)
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const checkoutIntents = []
let startingAfter
do {
  const page = await stripe.paymentIntents.list({
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  })
  checkoutIntents.push(
    ...page.data.filter(
      (intent) => intent.status === 'succeeded' && intent.metadata?.checkout_snapshot_id
    )
  )
  if (!page.has_more || page.data.length === 0) break
  startingAfter = page.data.at(-1).id
} while (startingAfter)

let incomplete = 0
for (const intent of checkoutIntents) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number')
    .eq('stripe_payment_intent_id', intent.id)
    .maybeSingle()

  let itemCount = 0
  if (order?.id) {
    const { count } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)
    itemCount = count ?? 0
  }

  if (!order?.id || itemCount === 0) {
    incomplete++
    console.log(JSON.stringify({
      paymentIntentId: intent.id,
      amountReceived: intent.amount_received,
      created: new Date(intent.created * 1000).toISOString(),
      snapshotId: intent.metadata.checkout_snapshot_id,
      orderId: order?.id ?? null,
      itemCount,
    }))
  }
}

console.log(`Checked ${checkoutIntents.length} succeeded checkout payments; ${incomplete} incomplete.`)
if (incomplete > 0) process.exitCode = 2
