import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendOrderEmails } from '@/lib/email/send-order-emails'
import { sendOrderSmsToMerchant } from '@/lib/notifications/send-order-sms'
import type { AuthoritativeOrderItem, SanitizedCartLine } from '@/lib/order-pricing'
import {
  computeCheckoutTotals,
  fetchCheckoutProductMap,
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

  const normalizedCountry = normalizeShippingCountry(payload.country)
  const normalizedState = normalizeShippingRegion(payload.state)

  const hasFrozenQuote =
    Number.isFinite(payload.quoted_total) &&
    Number.isFinite(payload.quoted_subtotal) &&
    payload.items.every(
      (item) =>
        typeof item.productName === 'string' &&
        item.productName.trim().length > 0 &&
        Number.isFinite(item.unitPrice) &&
        Number(item.unitPrice) >= 0
    )

  let authoritativeItems: AuthoritativeOrderItem[]
  let subtotal: number
  let shippingFee: number
  let shippingZone: string | null
  let taxAmount: number
  let taxRate: number
  let taxableSubtotal: number
  let taxJurisdiction: string
  let tip: number
  let expectedTotal: number

  if (hasFrozenQuote) {
    authoritativeItems = payload.items.map((item) => ({
      product_id: item.productId,
      product_name: item.productName!.trim(),
      product_price: Number(item.unitPrice),
      quantity: item.quantity,
      subtotal: Math.round(Number(item.unitPrice) * item.quantity * 100) / 100,
    }))
    subtotal = Number(payload.quoted_subtotal)
    shippingFee = Number(payload.quoted_shipping_fee ?? 0)
    shippingZone = payload.shipping_zone
    taxAmount = Number(payload.quoted_tax_amount ?? 0)
    taxRate = Number(payload.quoted_tax_rate ?? 0)
    taxableSubtotal = Number(payload.quoted_taxable_subtotal ?? 0)
    taxJurisdiction = payload.quoted_tax_jurisdiction ?? ''
    tip = normalizeShippingMethod(payload.shipping_method) === 'local_delivery'
      ? Number(payload.tip_amount ?? 0)
      : 0
    expectedTotal = Number(payload.quoted_total)
  } else {
    const candidateProductIds = Array.from(new Set(sanitizedItems.map((i) => i.productId)))
    const { productMap, error: productError } = await fetchCheckoutProductMap(
      supabaseAdmin,
      candidateProductIds
    )
    if (productError) throw new Error(productError.message)
    if (productMap.size !== candidateProductIds.length) {
      throw new Error('One or more products are no longer available')
    }
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
    authoritativeItems = totals.orderItems
    subtotal = totals.subtotal
    shippingFee = totals.shipping.fee
    shippingZone = totals.shipping.zone
    taxAmount = totals.tax.taxAmount
    taxRate = totals.tax.rate
    taxableSubtotal = totals.tax.taxableSubtotal
    taxJurisdiction = totals.tax.jurisdictionLabel
    tip = totals.tip
    expectedTotal = totals.total
  }
  const shipping_method = normalizeShippingMethod(payload.shipping_method)

  const totalCents = Math.round(expectedTotal * 100)
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
    shipping_fee: shippingFee,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    taxable_subtotal: taxableSubtotal,
    tax_jurisdiction: taxJurisdiction || null,
    shipping_method,
    shipping_zone: shippingZone,
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
  const rpcItems = authoritativeItems.map((item, index) => ({
    ...item,
    product_category: payload.items[index]?.category ?? null,
    tax_class: payload.items[index]?.taxClass ?? null,
  }))
  const { data: fulfillmentRows, error: fulfillmentError } = await supabaseAdmin.rpc(
    'create_paid_order_atomic',
    {
      p_payment_intent_id: paymentIntentId,
      p_order: { ...baseOrderInsert, pickup_contact_name: pickupContactName },
      p_items: rpcItems,
      p_log_note: 'Paid via Stripe Payment Element — payment_intent.succeeded',
    }
  )
  if (fulfillmentError) {
    throw new Error(
      `${fulfillmentError.message}. Apply supabase/migrations/20261122220000_commerce_reliability.sql.`
    )
  }

  const fulfillment = Array.isArray(fulfillmentRows) ? fulfillmentRows[0] : fulfillmentRows
  const orderId = fulfillment?.order_id as string | undefined
  const created = fulfillment?.created === true
  if (!orderId) throw new Error('Atomic fulfillment did not return an order id')

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (orderError || !order) throw new Error(orderError?.message ?? 'Fulfilled order not found')

  await supabaseAdmin.from('checkout_snapshots').delete().eq('id', snapshotId)
  if (!created) return { orderId, created: false }

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
        tax_amount: Number((order as { tax_amount?: number }).tax_amount ?? taxAmount),
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
