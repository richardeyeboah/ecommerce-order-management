import type Stripe from 'stripe'
import { sendOrderEmails } from '@/lib/email/send-order-emails'
import { sendOrderSmsToMerchant } from '@/lib/notifications/send-order-sms'
import type { AuthoritativeOrderItem } from '@/lib/order-pricing'
import { getStripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getStoreSalesTaxRate, isCategoryTaxable } from '@/lib/tax/sales-tax'

function isProductObject(
  product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined
): product is Stripe.Product {
  return (
    typeof product === 'object' &&
    product !== null &&
    !('deleted' in product && (product as Stripe.DeletedProduct).deleted)
  )
}

/**
 * Transitional fulfillment for hosted Checkout Sessions created before the
 * Payment Element rollout. New checkouts do not use this path.
 */
export async function fulfillOrderFromStripeSession(
  sessionId: string
): Promise<{ orderId: string; created: boolean }> {
  const { data: existingSessionOrder, error: existingSessionError } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle()
  if (existingSessionError) throw new Error(existingSessionError.message)
  if (existingSessionOrder?.id) {
    return { orderId: existingSessionOrder.id, created: false }
  }

  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.payment_status !== 'paid') {
    return { orderId: '', created: false }
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id
  if (!paymentIntentId) {
    throw new Error('Paid Checkout Session is missing its PaymentIntent')
  }

  const { data: existingPaymentOrder, error: existingPaymentError } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  if (existingPaymentError) throw new Error(existingPaymentError.message)
  if (existingPaymentOrder?.id) {
    await supabaseAdmin
      .from('orders')
      .update({ stripe_checkout_session_id: sessionId })
      .eq('id', existingPaymentOrder.id)
    return { orderId: existingPaymentOrder.id, created: false }
  }

  const lineItemsResponse = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ['data.price.product'],
  })
  const orderItems: AuthoritativeOrderItem[] = []
  let shippingFee = 0
  let taxAmount = 0

  for (const line of lineItemsResponse.data) {
    const product = line.price?.product
    if (!isProductObject(product)) continue
    const metadata = product.metadata ?? {}
    if (metadata.type === 'shipping') {
      shippingFee += (line.amount_total ?? 0) / 100
      continue
    }
    if (metadata.type === 'tax') {
      taxAmount += (line.amount_total ?? 0) / 100
      continue
    }

    const productId = metadata.product_id?.trim()
    const quantity = line.quantity ?? 0
    if (!productId || quantity <= 0) continue
    const subtotal = (line.amount_total ?? 0) / 100
    orderItems.push({
      product_id: productId,
      product_name: product.name,
      product_price: subtotal / quantity,
      quantity,
      subtotal,
    })
  }
  if (orderItems.length === 0) {
    throw new Error('No product line items found on paid Checkout Session')
  }

  const productIds = orderItems.map((item) => item.product_id)
  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('id, category, tax_class')
    .in('id', productIds)
  if (productsError) throw new Error(productsError.message)
  const productById = new Map((products ?? []).map((product) => [product.id as string, product]))

  let taxableSubtotal = 0
  const rpcItems = orderItems.map((item) => {
    const product = productById.get(item.product_id)
    const category = String(product?.category ?? '')
    const taxClass = typeof product?.tax_class === 'string' ? product.tax_class : null
    if (isCategoryTaxable(category, taxClass)) taxableSubtotal += item.subtotal
    return {
      ...item,
      product_category: category || null,
      tax_class: taxClass,
    }
  })

  const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0)
  const totalFromStripe = (session.amount_total ?? 0) / 100
  const computedTotal = Math.round((subtotal + shippingFee + taxAmount) * 100) / 100
  if (Math.abs(computedTotal - totalFromStripe) > 0.02) {
    throw new Error('Order total mismatch — manual review required')
  }

  const metadata = session.metadata ?? {}
  const userId = metadata.user_id?.trim()
  const customerEmail =
    session.customer_details?.email?.trim().toLowerCase() ??
    session.customer_email?.trim().toLowerCase()
  if (!userId || !customerEmail) {
    throw new Error('Checkout Session is missing its customer identity')
  }

  const taxRate =
    taxableSubtotal > 0 ? taxAmount / taxableSubtotal : taxAmount > 0 ? getStoreSalesTaxRate() : 0
  const { data: fulfillmentRows, error: fulfillmentError } = await supabaseAdmin.rpc(
    'create_paid_order_atomic',
    {
      p_payment_intent_id: paymentIntentId,
      p_order: {
        customer_name: metadata.customer_name?.trim() ?? '',
        customer_email: customerEmail,
        customer_phone: metadata.customer_phone?.trim() ?? '',
        address_line: metadata.address_line?.trim() ?? '',
        city: metadata.city?.trim() ?? '',
        state: metadata.state?.trim() || null,
        country: metadata.country?.trim() ?? '',
        postal_code: metadata.postal_code?.trim() || null,
        subtotal_amount: subtotal,
        shipping_fee: shippingFee,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        taxable_subtotal: taxableSubtotal,
        tax_jurisdiction: taxAmount > 0 ? 'Ohio' : null,
        shipping_method: metadata.shipping_method?.trim() ?? 'standard',
        shipping_zone: metadata.shipping_zone?.trim() || null,
        total_amount: totalFromStripe,
        ordered_at: new Date().toISOString(),
        user_id: userId,
      },
      p_items: rpcItems,
      p_log_note: 'Paid via legacy Stripe Checkout session',
    }
  )
  if (fulfillmentError) throw new Error(fulfillmentError.message)

  const fulfillment = Array.isArray(fulfillmentRows) ? fulfillmentRows[0] : fulfillmentRows
  const orderId = fulfillment?.order_id as string | undefined
  const created = fulfillment?.created === true
  if (!orderId) throw new Error('Atomic fulfillment did not return an order id')

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .update({ stripe_checkout_session_id: sessionId })
    .eq('id', orderId)
    .select('*')
    .single()
  if (orderError || !order) {
    throw new Error(orderError?.message ?? 'Fulfilled order not found')
  }
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
        tax_amount: Number(order.tax_amount ?? taxAmount),
        total_amount: Number(order.total_amount),
        shipping_method: order.shipping_method,
        payment_method: order.payment_method,
        pickup_contact_name: order.pickup_contact_name ?? null,
      },
      orderItems
    )
  } catch (error) {
    console.error('[stripe] legacy session email error:', error)
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
  } catch (error) {
    console.error('[stripe] legacy session SMS error:', error)
  }

  return { orderId, created: true }
}
