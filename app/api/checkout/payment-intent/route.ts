import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sanitizeCartItems } from '@/lib/order-pricing'
import {
  computeCheckoutTotals,
  fetchCheckoutProductMap,
  type ProductWithCategory,
} from '@/lib/checkout-totals'
import {
  formatAddressLine,
  isUnitedStatesCountry,
  resolveShippingAddress,
  verifyUsDeliveryAddress,
} from '@/lib/address/verify-us-address'
import { normalizeShippingCountry, normalizeShippingMethod, normalizeShippingRegion, LOCAL_DELIVERY_MIN_SUBTOTAL } from '@/lib/shipping'
import {
  checkLocalDeliveryEligibility,
  LOCAL_DELIVERY_MAX_MINUTES,
} from '@/lib/delivery/local-delivery-eligibility'
import { toDialable } from '@/lib/phone-link'
import { STORE } from '@/lib/constants/store'
import type { CartItem } from '@/types'
import { CHECKOUT_STRIPE_PAYMENT_METHOD_TYPES, getStripe } from '@/lib/stripe'
import type { CheckoutSnapshotPayload } from '@/lib/orders/checkout-snapshot'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { maxCartQuantity } from '@/lib/product-pricing'
import {
  ACCOUNT_CHECKOUT_MODE,
  GUEST_CHECKOUT_MODE,
  GUEST_CHECKOUT_USER_ID,
  normalizeGuestEmail,
} from '@/lib/orders/guest-checkout'
import {
  clampTip,
  normalizePickupSlot,
  normalizeSubstitutionPref,
} from '@/lib/orders/grocery-ops'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  try {
    const supabaseUser = await createClient()
    const {
      data: { user },
    } = await supabaseUser.auth.getUser()

    const body = await req.json()
    const {
      email: rawEmail,
      name,
      phone,
      address,
      address1,
      address2,
      city,
      state,
      country,
      postalCode,
      items,
      shippingMethod: rawShippingMethod,
      pickupName,
      substitutionPref: rawSubstitutionPref,
      pickupSlot: rawPickupSlot,
      tipAmount: rawTipAmount,
    } = body

    const guestCheckout = !user
    const accountEmail = guestCheckout
      ? normalizeGuestEmail(rawEmail)
      : (user.email?.trim().toLowerCase() ?? null)

    if (!accountEmail) {
      return NextResponse.json(
        {
          error: guestCheckout
            ? 'Enter a valid email for your receipt and order updates.'
            : 'Your account is missing an email address.',
        },
        { status: 400 }
      )
    }

    const checkoutMode = guestCheckout ? GUEST_CHECKOUT_MODE : ACCOUNT_CHECKOUT_MODE
    const snapshotUserId = guestCheckout ? GUEST_CHECKOUT_USER_ID : user!.id

    const isPickup = normalizeShippingMethod(rawShippingMethod) === 'pickup'

    const addressLine1 =
      typeof address1 === 'string'
        ? address1.trim()
        : typeof address === 'string'
          ? address.trim()
          : ''
    const addressLine2 = typeof address2 === 'string' ? address2.trim() : ''

    // Pickup orders are collected at the store, so a delivery address is not
    // required — only a name (for the order) and items.
    if (!name || !items?.length) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }
    if (!isPickup && (!addressLine1 || !city || !country)) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const pickupContactName =
      isPickup && typeof pickupName === 'string' && pickupName.trim()
        ? pickupName.trim().slice(0, 120)
        : null

    const substitutionPref = normalizeSubstitutionPref(rawSubstitutionPref)
    const pickupSlot = isPickup ? normalizePickupSlot(rawPickupSlot) : null
    if (isPickup && !pickupSlot) {
      return NextResponse.json(
        { error: 'Choose a pickup window so we know when to stage your order.' },
        { status: 400 }
      )
    }

    const tipAmount = clampTip(rawTipAmount)
    const cartItems = (Array.isArray(items) ? items : []) as CartItem[]
    const phoneTrim = typeof phone === 'string' ? phone.trim() : ''
    if (!phoneTrim) {
      return NextResponse.json(
        { error: 'Phone number is required so we can confirm your order.' },
        { status: 400 }
      )
    }
    // Staff call the customer from the pickup counter and at the door, so the
    // number has to actually be dialable — not just non-empty.
    if (!toDialable(phoneTrim)) {
      return NextResponse.json(
        { error: 'Enter a reachable phone number, e.g. (614) 555-0199.' },
        { status: 400 }
      )
    }

    const sanitizedItems = sanitizeCartItems(cartItems)
    if (sanitizedItems.length === 0) {
      return NextResponse.json({ error: 'Your cart is empty or invalid.' }, { status: 400 })
    }

    const candidateProductIds = Array.from(new Set(sanitizedItems.map((item) => item.productId)))
    const { productMap, error: productError } = await fetchCheckoutProductMap(
      supabaseAdmin,
      candidateProductIds
    )

    if (productError) {
      console.error('Product lookup error:', productError)
      return NextResponse.json({ error: 'Could not verify cart items.' }, { status: 500 })
    }

    if (productMap.size !== candidateProductIds.length) {
      return NextResponse.json(
        { error: 'One or more items are no longer available. Please review your cart.' },
        { status: 400 }
      )
    }

    const unavailable = sanitizedItems
      .map((item) => productMap.get(item.productId))
      .filter((product): product is ProductWithCategory => !!product && !product.in_stock)

    if (unavailable.length > 0) {
      return NextResponse.json(
        {
          error: `These items are currently unavailable: ${unavailable.map((p) => p.name).join(', ')}.`,
        },
        { status: 400 }
      )
    }

    const overStock = sanitizedItems
      .map((item) => {
        const product = productMap.get(item.productId)
        if (!product) return null
        const max = maxCartQuantity(product)
        if (item.quantity <= max) return null
        return { name: product.name, max }
      })
      .filter((row): row is { name: string; max: number } => row != null)

    if (overStock.length > 0) {
      return NextResponse.json(
        {
          error: `Reduce quantity for: ${overStock
            .map((r) => `${r.name} (max ${r.max})`)
            .join(', ')}.`,
        },
        { status: 400 }
      )
    }

    const normalizedCountry = isPickup ? 'united states' : normalizeShippingCountry(country)
    const normalizedState = isPickup ? STORE.shipFrom.state : normalizeShippingRegion(state)
    const shippingMethodPreview = normalizeShippingMethod(rawShippingMethod)
    // Tip only applies to local delivery (driver).
    const tipForTotals =
      shippingMethodPreview === 'local_delivery' ? tipAmount : 0
    const totals = computeCheckoutTotals({
      items: sanitizedItems,
      productMap,
      country: normalizedCountry,
      state: normalizedState,
      shippingMethod: rawShippingMethod,
      tipAmount: tipForTotals,
    })
    const { subtotal, shipping, tax } = totals
    const shipping_method = shipping.method

    if (shipping_method === 'local_delivery' && subtotal < LOCAL_DELIVERY_MIN_SUBTOTAL) {
      return NextResponse.json(
        {
          error: `Local delivery needs a $${LOCAL_DELIVERY_MIN_SUBTOTAL.toFixed(2)} minimum (before delivery fee). Add $${(LOCAL_DELIVERY_MIN_SUBTOTAL - subtotal).toFixed(2)} more, or choose pickup / shipping.`,
        },
        { status: 400 }
      )
    }

    let shippingAddress = isPickup
      ? {
          line1: `Store pickup — ${STORE.shipFrom.street1}`,
          line2: '',
          city: STORE.shipFrom.city,
          state: STORE.shipFrom.state,
          postalCode: STORE.shipFrom.zip,
        }
      : {
          line1: addressLine1,
          line2: addressLine2,
          city: String(city ?? '').trim(),
          state: normalizedState || String(state ?? '').trim(),
          postalCode: typeof postalCode === 'string' ? postalCode.trim() : '',
        }

    if (shipping_method !== 'pickup' && isUnitedStatesCountry(String(country))) {
      const zip = shippingAddress.postalCode
      if (!zip) {
        return NextResponse.json({ error: 'ZIP code is required.' }, { status: 400 })
      }
      const verified = await verifyUsDeliveryAddress({
        line1: shippingAddress.line1,
        line2: shippingAddress.line2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: zip,
        country: String(country).trim(),
      })
      if (!verified.ok) {
        return NextResponse.json(
          {
            error: verified.error,
            suggested: verified.suggested ?? null,
            corrections: verified.corrections ?? [],
          },
          { status: 400 }
        )
      }
      shippingAddress = resolveShippingAddress(
        {
          line1: shippingAddress.line1,
          line2: shippingAddress.line2,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postalCode: zip,
          country: String(country).trim(),
        },
        verified
      )
    }

    // Local delivery is a real driver making a real trip — the 30-minute
    // radius is enforced here authoritatively, never trusting the client-side
    // pre-check alone.
    if (shipping_method === 'local_delivery') {
      const eligibility = await checkLocalDeliveryEligibility({
        line1: shippingAddress.line1,
        line2: shippingAddress.line2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        country: String(country).trim(),
      })
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.error }, { status: 400 })
      }
      if (!eligibility.eligible) {
        return NextResponse.json(
          {
            error: `That address is about ${eligibility.minutes} min away by car — outside our ${LOCAL_DELIVERY_MAX_MINUTES}-min local delivery area. Choose standard shipping or store pickup instead.`,
          },
          { status: 400 }
        )
      }
    }

    const addressLine = formatAddressLine(shippingAddress)

    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
    if (!stripeKey) {
      console.error('[checkout] STRIPE_SECRET_KEY is not set in the deployment environment.')
      return NextResponse.json(
        { error: 'Online payments are temporarily unavailable. Please contact the store to complete your order.' },
        { status: 503 },
      )
    }

    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
    if (!publishableKey) {
      return NextResponse.json(
        { error: 'Online payments are temporarily unavailable. Please contact the store to complete your order.' },
        { status: 503 },
      )
    }

    // Both keys must come from the same Stripe account. Modern Stripe keys
    // (issued since ~2020) embed a 17-char account ID immediately after the
    // mode prefix, e.g. `sk_test_51TJNzEJHvbwKGXut<rest>` — the `51TJNzEJHvbwKGXut`
    // part is identical between the secret and publishable keys of the same account.
    // Older keys without a visible account ID won't match this pattern; in that
    // case we silently skip the check (Stripe will surface the real error).
    const accountIdFrom = (key: string): string | null => {
      const m = key.match(/^(?:sk|pk|rk)_(?:test|live)_([A-Za-z0-9]{17})/)
      return m ? m[1] : null
    }
    const secretAcct = accountIdFrom(stripeKey)
    const publishableAcct = accountIdFrom(publishableKey)
    if (secretAcct && publishableAcct && secretAcct !== publishableAcct) {
      return NextResponse.json(
        {
          error: 'Online payments are temporarily unavailable. Please try again shortly or contact the store.',
        },
        { status: 503 },
      )
    }

    const payload: CheckoutSnapshotPayload = {
      items: sanitizedItems.map((item) => {
        const product = productMap.get(item.productId)!
        return {
          productId: item.productId,
          quantity: item.quantity,
          productName: product.name,
          unitPrice: product.price,
          category: product.category,
          taxClass: product.tax_class ?? null,
        }
      }),
      customer_name: String(name).trim(),
      customer_phone: phoneTrim,
      address_line: addressLine,
      city: shippingAddress.city,
      state: shippingAddress.state || null,
      country: normalizedCountry,
      postal_code: shippingAddress.postalCode || null,
      shipping_method,
      shipping_zone: shipping.zone,
      account_email: accountEmail,
      pickup_contact_name: pickupContactName,
      substitution_pref: substitutionPref,
      pickup_slot: pickupSlot,
      tip_amount: tipForTotals,
      quoted_subtotal: subtotal,
      quoted_shipping_fee: shipping.fee,
      quoted_tax_amount: tax.taxAmount,
      quoted_tax_rate: tax.rate,
      quoted_taxable_subtotal: tax.taxableSubtotal,
      quoted_tax_jurisdiction: tax.jurisdictionLabel,
      quoted_total: totals.total,
    }

    const { data: snap, error: snapErr } = await supabaseAdmin
      .from('checkout_snapshots')
      .insert({
        user_id: snapshotUserId,
        payload,
      })
      .select('id')
      .single()

    if (snapErr || !snap) {
      console.error('[checkout] snapshot insert', snapErr)
      const missingTable =
        snapErr?.code === 'PGRST205' ||
        /checkout_snapshots/i.test(snapErr?.message ?? '')
      return NextResponse.json(
        {
          error: missingTable
            ? 'Checkout is temporarily unavailable. Please try again shortly or contact the store.'
            : 'Could not prepare checkout.',
        },
        { status: 500 }
      )
    }

    const amountCents = Math.round(totals.total * 100)
    if (amountCents < 50) {
      await supabaseAdmin.from('checkout_snapshots').delete().eq('id', snap.id)
      return NextResponse.json({ error: 'Order total is too small.' }, { status: 400 })
    }

    const stripe = getStripe()
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        payment_method_types: [...CHECKOUT_STRIPE_PAYMENT_METHOD_TYPES],
        metadata: {
          user_id: snapshotUserId,
          checkout_mode: checkoutMode,
          checkout_snapshot_id: snap.id,
        },
        receipt_email: accountEmail,
      },
      { idempotencyKey: `checkout:${snap.id}` }
    )

    if (!paymentIntent.client_secret) {
      await supabaseAdmin.from('checkout_snapshots').delete().eq('id', snap.id)
      return NextResponse.json({ error: 'Could not start payment.' }, { status: 500 })
    }

    await supabaseAdmin
      .from('checkout_snapshots')
      .update({ payment_intent_id: paymentIntent.id })
      .eq('id', snap.id)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      subtotal,
      shippingFee: shipping.fee,
      taxAmount: tax.taxAmount,
      taxApplies: tax.applies,
      taxRate: tax.rate,
      taxableSubtotal: tax.taxableSubtotal,
      taxJurisdiction: tax.jurisdictionLabel,
      total: totals.total,
    })
  } catch (err) {
    console.error('payment-intent error:', err)
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 })
  }
}
