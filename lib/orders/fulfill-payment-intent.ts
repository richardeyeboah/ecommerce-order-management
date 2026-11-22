import { supabaseAdmin } from '@/lib/supabase-admin'
import { decrementStockForOrder } from '@/lib/orders/decrement-stock'
import { sendOrderEmails } from '@/lib/email/send-order-emails'
import { sendOrderSmsToMerchant } from '@/lib/notifications/send-order-sms'
import type { SanitizedCartLine } from '@/lib/order-pricing'
import {
  computeCheckoutTotals,
  fetchCheckoutProductMap,
  type ProductWithCategory,
} from '@/lib/checkout-totals'
import { normalizeShippingCountry, normalizeShippingRegion, normalizeShippingMethod } from '@/lib/shipping'
import { getStripe } from '@/lib/stripe'
import type { CheckoutSnapshotPayload } from '@/lib/orders/checkout-snapshot'
import {
  isGuestCheckoutMode,
  isGuestCheckoutUserId,
} from '@/lib/orders/guest-checkout'

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Creates order after PaymentIntent succeeds (webhook).
 * Idempotent: same PaymentIntent only creates one order.
 */
export async function fulfillOrderFromPaymentIntent(
  paymentIntentId: string
): Promise<{ orderId: string; created: boolean }> {
  const stripe = getStripe()

  const { data: existing } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (existing?.id) {
    return { orderId: existing.id, created: false }
  }

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)

  if (pi.status !== 'succeeded') {
    console.warn('[stripe] PI not succeeded, skipping', paymentIntentId, pi.status)
    return { orderId: '', created: false }
  }

  const rawUserId = pi.metadata?.user_id?.trim()
  const snapshotId = pi.metadata?.checkout_snapshot_id?.trim()
  if (!rawUserId || !snapshotId) {
    throw new Error('Missing user_id or checkout_snapshot_id on PaymentIntent')
  }

  const guestCheckout =
    isGuestCheckoutMode(pi.metadata?.checkout_mode) || isGuestCheckoutUserId(rawUserId)
  const userId = guestCheckout ? null : rawUserId

  const { data: snap, error: snapErr } = await supabaseAdmin
    .from('checkout_snapshots')
    .select('id,user_id,payload,created_at')
    .eq('id', snapshotId)
    .maybeSingle()

  if (snapErr || !snap) {
    throw new Error(snapErr?.message ?? 'Checkout snapshot not found')
  }

  if (snap.user_id !== rawUserId) {
    throw new Error('Snapshot user mismatch')
  }

  if (Date.now() - new Date(snap.created_at).getTime() > SNAPSHOT_MAX_AGE_MS) {
    throw new Error('Checkout snapshot expired')
  }

  const payload = snap.payload as CheckoutSnapshotPayload
  const sanitizedItems: SanitizedCartLine[] = payload.items
    .map((item) => ({
      productId: typeof item.productId === 'string' ? item.productId.trim() : '',
      quantity: Number(item.quantity ?? 0),
    }))
    .filter(
      (item): item is SanitizedCartLine =>
        item.productId.length > 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 99
    )

  if (sanitizedItems.length === 0) {
    throw new Error('Empty cart in snapshot')
  }

  const candidateProductIds = Array.from(new Set(sanitizedItems.map((i) => i.productId)))
  const { productMap, error: productError } = await fetchCheckoutProductMap(
    supabaseAdmin,
    candidateProductIds
  )

  if (productError) {
    throw new Error(productError.message)
  }

  if (productMap.size !== candidateProductIds.length) {
    throw new Error('One or more products are no longer available')
  }

  const normalizedCountry = normalizeShippingCountry(payload.country)
  const normalizedState = normalizeShippingRegion(payload.state)

  const totals = computeCheckoutTotals({
    items: sanitizedItems,
    productMap,
    country: normalizedCountry,
    state: normalizedState,
    shippingMethod: payload.shipping_method,
    tipAmount:
      normalizeShippingMethod(payload.shipping_method) === 'local_delivery'
        ? Number(payload.tip_amount ?? 0)
        : 0,
  })
  const { orderItems: authoritativeItems, subtotal, shipping, tax, tip } = totals
  const shipping_method = shipping.method

  const totalCents = Math.round(totals.total * 100)
  const received = pi.amount_received ?? pi.amount ?? 0
  if (Math.abs(received - totalCents) > 2) {
    console.error('[stripe] PI amount mismatch', { received, totalCents, paymentIntentId })
    throw new Error('Payment amount mismatch — manual review required')
  }

  const totalFromStripe = received / 100
  const customerEmail = payload.account_email.trim().toLowerCase()

  const baseOrderInsert: Record<string, unknown> = {
    customer_name: payload.customer_name.trim(),
    customer_email: customerEmail,
    customer_phone: payload.customer_phone.trim(),
    address_line: payload.address_line.trim(),
    city: payload.city.trim(),
    state: payload.state?.trim() || null,
    country: normalizedCountry,
    postal_code: payload.postal_code?.trim() || null,
    subtotal_amount: subtotal,
    shipping_fee: shipping.fee,
    tax_amount: tax.taxAmount,
    shipping_method,
    shipping_zone: shipping.zone,
    total_amount: totalFromStripe,
    status: 'ordered',
    ordered_at: new Date().toISOString(),
    payment_method: 'stripe',
    user_id: userId,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: paymentIntentId,
    tip_amount: tip,
    substitution_pref: payload.substitution_pref ?? 'refund',
    pickup_slot: payload.pickup_slot ?? null,
  }

  const pickupContactName = payload.pickup_contact_name?.trim() || null

  let { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .insert({ ...baseOrderInsert, pickup_contact_name: pickupContactName })
    .select()
    .single()

  // Retry without newer columns if the DB migration hasn't been applied yet.
  if (
    orderError &&
    /column .* does not exist|could not find the .* column/i.test(orderError.message)
  ) {
    const legacy = { ...baseOrderInsert }
    delete legacy.tip_amount
    delete legacy.substitution_pref
    delete legacy.pickup_slot
    ;({ data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({ ...legacy, pickup_contact_name: pickupContactName })
      .select()
      .single())
    if (
      orderError &&
      /column .* does not exist|could not find the .* column/i.test(orderError.message)
    ) {
      ;({ data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert(legacy)
        .select()
        .single())
    }
  }

  if (orderError || !order) {
    if (
      orderError?.code === '23505' ||
      /duplicate key|unique constraint/i.test(orderError?.message ?? '')
    ) {
      const { data: dup } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle()
      if (dup?.id) return { orderId: dup.id, created: false }
    }
    throw new Error(orderError?.message ?? 'Order insert failed')
  }

  const { error: itemsError } = await supabaseAdmin.from('order_items').insert(
    authoritativeItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      product_price: item.product_price,
      quantity: item.quantity,
      subtotal: item.subtotal,
    }))
  )

  if (itemsError) {
    console.error('[stripe] order_items insert failed', itemsError)
    throw new Error(itemsError.message)
  }

  await decrementStockForOrder(authoritativeItems)

  await supabaseAdmin.from('checkout_snapshots').delete().eq('id', snapshotId)

  const { error: logError } = await supabaseAdmin.from('order_status_logs').insert({
    order_id: order.id,
    from_status: null,
    to_status: 'ordered',
    changed_by: 'stripe_webhook',
    note: 'Paid via Stripe Payment Element — payment_intent.succeeded',
  })

  if (
    logError &&
    !/relation .* does not exist|could not find the table|column .* does not exist|could not find the .* column/i.test(
      logError.message
    )
  ) {
    console.error('[stripe] order_status_logs insert warning:', logError)
  }

  try {
    await sendOrderEmails(
      {
        id: order.id,
        order_number: order.order_number ?? null,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        address_line: order.address_line,
        city: order.city,
        state: order.state,
        country: order.country,
        postal_code: order.postal_code,
        subtotal_amount: Number(order.subtotal_amount),
        shipping_fee: Number(order.shipping_fee),
        tax_amount: Number((order as { tax_amount?: number }).tax_amount ?? tax.taxAmount),
        total_amount: Number(order.total_amount),
        shipping_method: order.shipping_method,
        payment_method: order.payment_method,
        pickup_contact_name:
          (order as { pickup_contact_name?: string | null }).pickup_contact_name ??
          pickupContactName,
      },
      authoritativeItems
    )
  } catch (e) {
    console.error('[stripe] post-order email error:', e)
  }

  try {
    await sendOrderSmsToMerchant({
      orderId: order.id,
      orderNumber: order.order_number ?? null,
      customerName: order.customer_name,
      totalAmount: Number(order.total_amount),
      city: order.city,
      shippingMethod: order.shipping_method,
    })
  } catch (e) {
    console.error('[stripe] post-order SMS error:', e)
  }

  return { orderId: order.id, created: true }
}
