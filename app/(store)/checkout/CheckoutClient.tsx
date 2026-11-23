'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Clock, Lock, MapPin, Phone, Truck } from 'lucide-react'
import { useCart } from '@/context/CartContext'
import { PageHeader } from '@/components/store/PageHeader'
import { AddressAutocomplete } from '@/components/store/AddressAutocomplete'
import { UsStateSelect } from '@/components/store/UsStateSelect'
import { isUnitedStatesCountry, isValidUsZip } from '@/lib/address/verify-us-address'
import type { ParsedAddress } from '@/lib/address/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckoutStripePayment } from './CheckoutStripePayment'
import {
  calculateShipping,
  LOCAL_DELIVERY_MIN_SUBTOTAL,
  SHIPPING_METHOD_LABEL,
  type ShippingMethod,
} from '@/lib/shipping'
import { calculateSalesTax } from '@/lib/tax/sales-tax'
import { getAuthSiteOrigin } from '@/lib/site-url-client'
import { STORE } from '@/lib/constants/store'
import { StorePhoneLinks } from '@/components/store/StorePhoneLinks'
import { OrderByPhone } from '@/components/store/OrderByPhone'
import { cn } from '@/lib/utils'
import { PickupPromoBanner } from '@/components/store/PickupPromoBanner'
import { friendlyShippingError } from '@/lib/checkout/shipping-errors'
import {
  PICKUP_SLOT_OPTIONS,
  SUBSTITUTION_OPTIONS,
  TIP_PRESETS,
  clampTip,
  type PickupSlotId,
  type SubstitutionPref,
} from '@/lib/orders/grocery-ops'

type CheckoutAccount = {
  email: string
  fullName: string
  phone: string
}

export type SavedAddress = {
  id: string
  label: string | null
  full_name: string
  phone: string | null
  line1: string
  line2: string | null
  city: string
  state: string | null
  country: string
  postal_code: string | null
  is_default: boolean
}

type CheckoutForm = {
  name: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  state: string
  country: string
  postalCode: string
  pickupName: string
}

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Mexico']

const CHECKOUT_DRAFT_KEY = 'lq_checkout_draft_v1'

type AddressVerifyStatus = 'idle' | 'checking' | 'ok' | 'correction' | 'error'

function loadDraft(): Partial<CheckoutForm> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CHECKOUT_DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<CheckoutForm>
  } catch {
    return null
  }
}

function saveDraft(form: CheckoutForm, persistEmail: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (persistEmail) {
      localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(form))
      return
    }
    const { email: _email, ...rest } = form
    void _email
    localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(rest))
  } catch {
    /* quota or disabled storage */
  }
}

function CheckoutStep({
  step,
  title,
  children,
}: {
  step: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="premium-card p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 text-sm font-bold text-white">
          {step}
        </span>
        <h2 className="text-base font-semibold text-earth-900">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function addressToForm(
  account: CheckoutAccount,
  addr: SavedAddress
): CheckoutForm {
  return {
    name: addr.full_name || account.fullName,
    email: account.email,
    phone: (addr.phone || account.phone || '').trim(),
    address1: addr.line1,
    address2: addr.line2 ?? '',
    city: addr.city,
    state: addr.state ?? '',
    country: addr.country || 'United States',
    postalCode: addr.postal_code ?? '',
    pickupName: '',
  }
}

export function CheckoutClient({
  initialAccount,
  savedAddresses = [],
  isGuest = false,
}: {
  initialAccount: CheckoutAccount
  savedAddresses?: SavedAddress[]
  isGuest?: boolean
}) {
  const { items, totalPrice, totalItems } = useCart()
  const detailsFormRef = useRef<HTMLFormElement>(null)

  const defaultAddress = useMemo(
    () => savedAddresses.find((a) => a.is_default) ?? savedAddresses[0] ?? null,
    [savedAddresses]
  )

  const [selectedAddressId, setSelectedAddressId] = useState<string | 'new'>(
    defaultAddress?.id ?? 'new'
  )

  const [form, setForm] = useState<CheckoutForm>(() => {
    if (defaultAddress) return addressToForm(initialAccount, defaultAddress)
    // Load draft synchronously on first render to avoid a blank→filled flash
    const draft = loadDraft()
    return {
      name: draft?.name || initialAccount.fullName,
      email: draft?.email || initialAccount.email,
      phone: draft?.phone || initialAccount.phone,
      address1: draft?.address1 ?? '',
      address2: draft?.address2 ?? '',
      city: draft?.city ?? '',
      state: draft?.state ?? 'OH',
      country: draft?.country ?? 'United States',
      postalCode: draft?.postalCode ?? '',
      pickupName: draft?.pickupName ?? '',
    }
  })

  // Persist form to localStorage on every change so phone/address survive a page reload or login flow.
  useEffect(() => {
    saveDraft(form, isGuest)
  }, [form, isGuest])

  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>('pickup')
  const isPickup = shippingMethod === 'pickup'
  const isLocalDelivery = shippingMethod === 'local_delivery'
  const [substitutionPref, setSubstitutionPref] = useState<SubstitutionPref>('refund')
  const [pickupSlot, setPickupSlot] = useState<PickupSlotId>('today_asap')
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [serverQuote, setServerQuote] = useState<{
    subtotal: number
    shippingFee: number
    taxAmount: number
    taxApplies: boolean
    total: number
  } | null>(null)
  const [returnUrl, setReturnUrl] = useState('')
  const [categoryByProductId, setCategoryByProductId] = useState<Record<string, string>>({})
  const [addressVerified, setAddressVerified] = useState(false)
  const [addressVerifyStatus, setAddressVerifyStatus] = useState<AddressVerifyStatus>('idle')
  const [suggestedAddress, setSuggestedAddress] = useState<ParsedAddress | null>(null)
  const [addressVerifyError, setAddressVerifyError] = useState('')
  const [localEligibility, setLocalEligibility] = useState<{
    status: 'idle' | 'checking' | 'eligible' | 'ineligible' | 'error'
    minutes?: number
    error?: string
  }>({ status: 'idle' })

  const cartFingerprint = useMemo(
    () => items.map((i) => `${i.product.id}:${i.quantity}`).join('|'),
    [items]
  )

  useEffect(() => {
    setReturnUrl(`${getAuthSiteOrigin()}/checkout/success`)
  }, [])

  useEffect(() => {
    if (shippingMethod === 'pickup' || !isUnitedStatesCountry(form.country)) return

    const zip = form.postalCode.trim()
    if (!isValidUsZip(zip)) return
    const zip5 = zip.slice(0, 5)

    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/address/city-state?ZIPCode=${encodeURIComponent(zip5)}`, {
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((data: { ok?: boolean; city?: string; state?: string; error?: string }) => {
          if (!data.ok || !data.city || !data.state) return

          const uspsCity = data.city
          const uspsState = data.state
          const cityEmpty = !form.city.trim()
          const stateEmpty = !form.state.trim()

          if (cityEmpty || stateEmpty) {
            setForm((prev) => ({
              ...prev,
              city: cityEmpty ? uspsCity : prev.city,
              state: stateEmpty ? uspsState : prev.state,
            }))
            return
          }

          const normCity = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
          const cityMismatch = normCity(form.city) !== normCity(uspsCity)
          const stateMismatch = form.state.trim().toUpperCase() !== uspsState.toUpperCase()
          if (cityMismatch || stateMismatch) {
            setAddressVerifyStatus('correction')
            setSuggestedAddress({
              line1: form.address1.trim(),
              city: uspsCity,
              state: uspsState,
              country: 'United States',
              postalCode: zip,
            })
            setAddressVerifyError(`ZIP ${zip} is ${uspsCity}, ${uspsState}.`)
            setAddressVerified(false)
          }
        })
        .catch((err: { name?: string }) => {
          if (err?.name === 'AbortError') return
        })
    }, 400)

    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [form.postalCode, form.city, form.state, form.address1, form.country, shippingMethod])

  useEffect(() => {
    if (shippingMethod === 'pickup' || !isUnitedStatesCountry(form.country)) {
      setAddressVerifyStatus('idle')
      setSuggestedAddress(null)
      setAddressVerifyError('')
      setAddressVerified(true)
      return
    }

    const line1 = form.address1.trim()
    const city = form.city.trim()
    const state = form.state.trim()
    const zip = form.postalCode.trim()
    if (line1.length < 5 || city.length < 2 || state.length < 2 || !isValidUsZip(zip)) {
      setAddressVerifyStatus('idle')
      setSuggestedAddress(null)
      setAddressVerifyError('')
      setAddressVerified(false)
      return
    }

    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setAddressVerifyStatus('checking')
      fetch('/api/address/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line1,
          line2: form.address2.trim(),
          city,
          state,
          postalCode: zip,
          country: form.country,
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then(
          (data: {
            ok?: boolean
            error?: string
            suggested?: ParsedAddress | null
          }) => {
            if (data.ok) {
              setAddressVerifyStatus('ok')
              setSuggestedAddress(null)
              setAddressVerifyError('')
              setAddressVerified(true)
              return
            }
            if (data.suggested) {
              setAddressVerifyStatus('correction')
              setSuggestedAddress(data.suggested)
              setAddressVerifyError(
                friendlyShippingError(
                  data.error ?? 'USPS standardized this address. Use the suggested format.'
                )
              )
              setAddressVerified(false)
              return
            }
            setAddressVerifyStatus('error')
            setSuggestedAddress(null)
            setAddressVerifyError(friendlyShippingError(data.error ?? 'Could not verify this address.'))
            setAddressVerified(false)
          }
        )
        .catch((err: { name?: string }) => {
          if (err?.name === 'AbortError') return
          setAddressVerifyStatus('error')
          setAddressVerifyError('Address verification unavailable. Try again.')
          setAddressVerified(false)
        })
    }, 600)

    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [
    form.address1,
    form.address2,
    form.city,
    form.state,
    form.postalCode,
    form.country,
    shippingMethod,
  ])

  useEffect(() => {
    if (!isLocalDelivery || !addressVerified) {
      setLocalEligibility({ status: 'idle' })
      return
    }

    const ctrl = new AbortController()
    setLocalEligibility({ status: 'checking' })
    fetch('/api/delivery/local-eligibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line1: form.address1.trim(),
        line2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; eligible?: boolean; minutes?: number; error?: string }) => {
        if (!data.ok) {
          setLocalEligibility({ status: 'error', error: data.error || 'Could not check this address.' })
          return
        }
        setLocalEligibility({
          status: data.eligible ? 'eligible' : 'ineligible',
          minutes: data.minutes,
        })
      })
      .catch((err: { name?: string }) => {
        if (err?.name === 'AbortError') return
        setLocalEligibility({ status: 'error', error: 'Could not check this address.' })
      })

    return () => ctrl.abort()
  }, [
    isLocalDelivery,
    addressVerified,
    form.address1,
    form.address2,
    form.city,
    form.state,
    form.postalCode,
    form.country,
  ])

  useEffect(() => {
    const productIds = items.map((i) => i.product.id)
    if (productIds.length === 0) {
      setCategoryByProductId({})
      return
    }
    const ctrl = new AbortController()
    fetch('/api/checkout/cart-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { categories?: Record<string, string> }) => {
        setCategoryByProductId(data.categories ?? {})
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [cartFingerprint, items])

  function pickSavedAddress(id: string) {
    setSelectedAddressId(id)
    if (id === 'new') {
      setAddressVerified(false)
      setForm((prev) => ({
        ...prev,
        address1: '',
        address2: '',
        city: '',
        state: 'OH',
        postalCode: '',
      }))
      return
    }
    const addr = savedAddresses.find((a) => a.id === id)
    if (addr) {
      setForm(addressToForm(initialAccount, addr))
      setAddressVerified(false)
      setAddressVerifyStatus('idle')
      setSuggestedAddress(null)
      setAddressVerifyError('')
    }
  }

  function applySuggestedAddress() {
    if (!suggestedAddress) return
    setForm((prev) => ({
      ...prev,
      address1: suggestedAddress.line1,
      city: suggestedAddress.city,
      state: suggestedAddress.state,
      postalCode: suggestedAddress.postalCode,
      country: suggestedAddress.country || prev.country,
    }))
    setSuggestedAddress(null)
    // USPS already suggested this address — mark as verified immediately
    setAddressVerifyStatus('ok')
    setAddressVerifyError('')
    setAddressVerified(true)
  }

  const checkoutFingerprint = useMemo(
    () =>
      [
        cartFingerprint,
        form.country,
        form.state,
        shippingMethod,
        tipAmount,
        pickupSlot,
        substitutionPref,
      ].join('|'),
    [cartFingerprint, form.country, form.state, shippingMethod, tipAmount, pickupSlot, substitutionPref]
  )

  useEffect(() => {
    setClientSecret(null)
    setServerQuote(null)
  }, [checkoutFingerprint, totalPrice])

  const shipping = useMemo(
    () =>
      calculateShipping({
        subtotal: totalPrice,
        country: form.country,
        state: form.state,
        method: shippingMethod,
      }),
    [form.country, form.state, shippingMethod, totalPrice]
  )
  const taxQuote = useMemo(
    () =>
      calculateSalesTax(
        items.map(({ product, quantity }) => ({
          category: categoryByProductId[product.id] ?? product.category ?? '',
          lineSubtotal: product.price * quantity,
        })),
        {
          country: form.country,
          state: form.state,
          shippingMethod,
        }
      ),
    [items, categoryByProductId, form.country, form.state, shippingMethod]
  )

  const tipForTotal = isLocalDelivery ? tipAmount : 0
  const deliveryMinShort =
    isLocalDelivery && totalPrice < LOCAL_DELIVERY_MIN_SUBTOTAL
      ? Math.round((LOCAL_DELIVERY_MIN_SUBTOTAL - totalPrice) * 100) / 100
      : 0
  const grandTotal = totalPrice + shipping.fee + taxQuote.taxAmount + tipForTotal
  const displaySubtotal = serverQuote?.subtotal ?? totalPrice
  const displayShippingFee = serverQuote?.shippingFee ?? shipping.fee
  const displayTaxAmount = serverQuote?.taxAmount ?? taxQuote.taxAmount
  const displayTaxApplies = serverQuote?.taxApplies ?? taxQuote.applies
  const displayTotal = serverQuote?.total ?? grandTotal

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const name = e.target.name
    setForm((prev) => ({ ...prev, [name]: e.target.value }))
    if (
      name === 'city' ||
      name === 'state' ||
      name === 'postalCode' ||
      name === 'country'
      // address2 (apt/suite) intentionally excluded — doesn't affect delivery verification
    ) {
      setAddressVerified(false)
      setAddressVerifyStatus('idle')
      setSuggestedAddress(null)
      setAddressVerifyError('')
      setSelectedAddressId('new')
    }
  }

  async function preparePayment() {
    const el = detailsFormRef.current
    if (el && !el.checkValidity()) {
      el.reportValidity()
      return
    }

    if (
      shippingMethod !== 'pickup' &&
      isUnitedStatesCountry(form.country) &&
      !addressVerified
    ) {
      setError(
        addressVerifyStatus === 'correction'
          ? friendlyShippingError('USPS standardized this address. Use the suggested format.')
          : friendlyShippingError(
              addressVerifyError ||
                'Enter a deliverable US address — verification runs when street, city, state, and ZIP are filled in.'
            )
      )
      return
    }

    if (isLocalDelivery && localEligibility.status !== 'eligible') {
      setError(
        localEligibility.status === 'ineligible'
          ? `That address is about ${localEligibility.minutes} min away by car — outside our 30-min local delivery area. Choose standard shipping or store pickup instead.`
          : 'Checking local delivery eligibility — wait a moment and try again.'
      )
      return
    }

    if (isLocalDelivery && deliveryMinShort > 0) {
      setError(
        `Local delivery needs a $${LOCAL_DELIVERY_MIN_SUBTOTAL.toFixed(2)} minimum. Add $${deliveryMinShort.toFixed(2)} more, or choose pickup / shipping.`
      )
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/checkout/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name,
          phone: form.phone,
          address1: form.address1.trim(),
          address2: form.address2.trim(),
          city: form.city,
          state: form.state,
          country: form.country,
          postalCode: form.postalCode,
          addressVerified: shippingMethod === 'pickup' || addressVerified,
          items,
          shippingMethod,
          pickupName: form.pickupName.trim(),
          substitutionPref,
          pickupSlot: isPickup ? pickupSlot : null,
          tipAmount: tipForTotal,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.suggested) {
          setSuggestedAddress(data.suggested as ParsedAddress)
          setAddressVerifyStatus('correction')
          setAddressVerifyError(
            friendlyShippingError(
              typeof data.error === 'string'
                ? data.error
                : 'USPS standardized this address. Use the suggested format.'
            )
          )
          setAddressVerified(false)
        }
        setError(
          friendlyShippingError(
            typeof data.error === 'string' ? data.error : 'Could not start checkout.'
          )
        )
        return
      }

      if (typeof data.clientSecret === 'string' && data.clientSecret) {
        const quoteValues = [
          data.subtotal,
          data.shippingFee,
          data.taxAmount,
          data.total,
        ].map(Number)
        if (quoteValues.some((value) => !Number.isFinite(value) || value < 0)) {
          setError('The server returned an invalid checkout total. Please try again.')
          return
        }
        setServerQuote({
          subtotal: quoteValues[0],
          shippingFee: quoteValues[1],
          taxAmount: quoteValues[2],
          taxApplies: data.taxApplies === true,
          total: quoteValues[3],
        })
        setClientSecret(data.clientSecret)
        return
      }

      setError('Could not initialize payment.')
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-cream">
        <PageHeader eyebrow="Checkout" title="Your cart is empty" subtitle="Add products before checking out." />
        <div className="store-container py-12 text-center">
          <Link href="/shop" className="inline-flex min-h-11 items-center no-underline">
            <Button size="lg" className="rounded-xl">
              Browse shop
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream md:pb-12">
      <PageHeader
        eyebrow="Secure checkout"
        title="Complete your order"
        subtitle={
          isGuest
            ? `Guest checkout · ${totalItems} item${totalItems === 1 ? '' : 's'}`
            : `Signed in as ${initialAccount.email} · ${totalItems} item${totalItems === 1 ? '' : 's'}`
        }
      />

      <div className="store-container py-8 sm:py-10">
        <Link
          href="/cart"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-earth-600 no-underline hover:text-brand-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to cart
        </Link>

        <PickupPromoBanner className="mb-6" />

        <div className="grid gap-8 md:grid-cols-5 md:gap-10 lg:gap-12">
          <form
            ref={detailsFormRef}
            onSubmit={(e) => e.preventDefault()}
            autoComplete="shipping"
            className="space-y-6 lg:col-span-3"
          >
            <CheckoutStep step={1} title="Contact details">
              <div className="space-y-4">
                <div>
                  <label htmlFor="checkout-email" className="form-label">
                    Email
                  </label>
                  <Input
                    id="checkout-email"
                    type="email"
                    name="email"
                    className={isGuest ? undefined : 'bg-sand'}
                    value={form.email}
                    onChange={isGuest ? handleChange : undefined}
                    readOnly={!isGuest}
                    required
                    autoComplete="email"
                  />
                </div>
                {isGuest ? (
                  <p className="text-xs text-earth-500">
                    Already have an account?{' '}
                    <Link
                      href="/login?next=/checkout"
                      className="font-semibold text-brand-700 no-underline hover:text-brand-800"
                    >
                      Sign in
                    </Link>{' '}
                    to use saved addresses.
                  </p>
                ) : null}
                <div>
                  <label htmlFor="checkout-name" className="form-label">
                    Full name
                  </label>
                  <Input
                    id="checkout-name"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="checkout-phone" className="form-label">
                    Phone
                  </label>
                  <Input
                    id="checkout-phone"
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    required
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="(614) 555-0199"
                    aria-describedby="checkout-phone-hint"
                  />
                  <p id="checkout-phone-hint" className="mt-1 text-xs text-earth-500">
                    We call this number at pickup or at your door.
                  </p>
                </div>
              </div>
            </CheckoutStep>

            <CheckoutStep step={2} title="Shipping method">
              <div className="space-y-3">
                {(['pickup', 'local_delivery', 'standard'] as ShippingMethod[]).map((method) => {
                  const quote = calculateShipping({
                    subtotal: totalPrice,
                    country: form.country,
                    state: form.state,
                    method,
                  })
                  const selected = shippingMethod === method
                  const deliveryEta: Record<string, string> = {
                    local: '3–5 business days',
                    regional: '4–6 business days',
                    national: '6–9 business days',
                    international: '10–14 business days',
                  }
                  return (
                    <label
                      key={method}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition',
                        selected
                          ? 'border-brand-400 bg-brand-50/50'
                          : 'border-earth-200 bg-white hover:border-earth-300'
                      )}
                    >
                      <input
                        type="radio"
                        name="shippingMethod"
                        className="mt-1"
                        checked={selected}
                        onChange={() => setShippingMethod(method)}
                      />
                      <span className="text-sm">
                        <span className="font-semibold text-earth-950">
                          {SHIPPING_METHOD_LABEL[method]}
                        </span>
                        <span className="block text-earth-600">
                          {quote.fee === 0 ? 'Free' : `$${quote.fee.toFixed(2)}`}
                          {method === 'pickup'
                            ? ' · Ready same day · come in or send Uber with your order #'
                            : method === 'local_delivery'
                              ? ` · Same-day · $${LOCAL_DELIVERY_MIN_SUBTOTAL}+ order · within 30 min drive`
                              : ` · ${deliveryEta[quote.zone] ?? '5–8 business days'}`}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>

              {isLocalDelivery && deliveryMinShort > 0 && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  Add ${deliveryMinShort.toFixed(2)} more for local delivery (minimum $
                  {LOCAL_DELIVERY_MIN_SUBTOTAL.toFixed(2)}).
                </p>
              )}

              {isLocalDelivery && (
                <div className="mt-4 rounded-xl border border-earth-200 bg-earth-50 px-4 py-3 text-sm">
                  {localEligibility.status === 'idle' && (
                    <p className="text-earth-600">Enter your address below to check eligibility.</p>
                  )}
                  {localEligibility.status === 'checking' && (
                    <p className="text-earth-600">Checking drive time…</p>
                  )}
                  {localEligibility.status === 'eligible' && (
                    <p className="font-medium text-emerald-700">
                      In range — about {localEligibility.minutes} min from the store.
                    </p>
                  )}
                  {localEligibility.status === 'ineligible' && (
                    <p className="font-medium text-red-600">
                      About {localEligibility.minutes} min away — outside our 30-min local delivery
                      area. Choose standard shipping or store pickup instead.
                    </p>
                  )}
                  {localEligibility.status === 'error' && (
                    <p className="text-red-600">{localEligibility.error}</p>
                  )}
                </div>
              )}

              {isLocalDelivery && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-earth-500">
                    Driver tip
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TIP_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setTipAmount(preset)
                          setCustomTip('')
                        }}
                        className={cn(
                          'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition duration-150',
                          tipAmount === preset && !customTip
                            ? 'border-earth-900 bg-earth-900 text-white'
                            : 'border-earth-200 bg-white text-earth-800 hover:border-earth-400'
                        )}
                      >
                        {preset === 0 ? 'No tip' : `$${preset}`}
                      </button>
                    ))}
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.50"
                      placeholder="Custom"
                      className="h-11 w-24"
                      value={customTip}
                      onChange={(e) => {
                        setCustomTip(e.target.value)
                        setTipAmount(clampTip(e.target.value))
                      }}
                      aria-label="Custom tip amount"
                    />
                  </div>
                </div>
              )}

              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-earth-500">
                  If an item is unavailable
                </p>
                <div className="space-y-2">
                  {SUBSTITUTION_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                        substitutionPref === opt.value
                          ? 'border-brand-400 bg-brand-50/50'
                          : 'border-earth-200 bg-white hover:border-earth-300'
                      )}
                    >
                      <input
                        type="radio"
                        name="substitutionPref"
                        className="mt-1"
                        checked={substitutionPref === opt.value}
                        onChange={() => setSubstitutionPref(opt.value)}
                      />
                      <span className="text-sm">
                        <span className="font-semibold text-earth-950">{opt.label}</span>
                        <span className="block text-earth-600">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <OrderByPhone compact className="mt-4" />
            </CheckoutStep>

            <CheckoutStep step={3} title={isPickup ? 'Pickup details' : 'Delivery address'}>
              {isPickup ? (
                <div className="space-y-5">
                  <div className="rounded-xl border border-earth-200 bg-earth-50 p-4">
                    <p className="text-sm font-semibold text-earth-900">Pick up at our store</p>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start gap-2.5">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                        <dd className="text-earth-700">{STORE.address}</dd>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                        <dd className="text-earth-700">{STORE.hours}</dd>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                        <dd>
                          <StorePhoneLinks
                            linkClassName="font-medium text-brand-700 no-underline hover:text-brand-800"
                          />
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <p className="form-label">Pickup window</p>
                    <div className="mt-2 space-y-2">
                      {PICKUP_SLOT_OPTIONS.map((slot) => (
                        <label
                          key={slot.value}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                            pickupSlot === slot.value
                              ? 'border-brand-400 bg-brand-50/50'
                              : 'border-earth-200 bg-white hover:border-earth-300'
                          )}
                        >
                          <input
                            type="radio"
                            name="pickupSlot"
                            className="mt-1"
                            checked={pickupSlot === slot.value}
                            onChange={() => setPickupSlot(slot.value)}
                          />
                          <span className="text-sm">
                            <span className="font-semibold text-earth-950">{slot.label}</span>
                            <span className="block text-earth-600">{slot.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="checkout-pickup-name" className="form-label">
                      Who&apos;s picking up?{' '}
                      <span className="font-normal text-earth-400">(optional)</span>
                    </label>
                    <Input
                      id="checkout-pickup-name"
                      type="text"
                      name="pickupName"
                      value={form.pickupName}
                      onChange={handleChange}
                      placeholder="Name of person picking up"
                      autoComplete="off"
                      maxLength={120}
                    />
                    <p className="mt-2 text-xs leading-relaxed text-earth-500">
                      Optional — if someone else is collecting the order.
                    </p>
                  </div>
                </div>
              ) : (
              <>
              {savedAddresses.length > 0 && (
                <div className="mb-5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-earth-500">
                    Saved addresses
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {savedAddresses.map((a) => {
                      const active = selectedAddressId === a.id
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => pickSavedAddress(a.id)}
                          className={cn(
                            'group flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors',
                            active
                              ? 'border-brand-500 bg-brand-50/40'
                              : 'border-earth-200 bg-white hover:border-earth-300'
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="font-semibold text-earth-900">
                              {a.label || 'Address'}
                              {a.is_default ? (
                                <span className="ml-2 text-xs font-medium text-earth-500">Default</span>
                              ) : null}
                            </span>
                            {active ? (
                              <Check className="h-4 w-4 shrink-0 text-brand-700" strokeWidth={2.5} aria-hidden />
                            ) : null}
                          </div>
                          <span className="line-clamp-2 text-xs leading-snug text-earth-600">
                            {a.line1}
                            {a.line2 ? `, ${a.line2}` : ''} · {a.city}, {a.state ?? ''}{' '}
                            {a.postal_code ?? ''}
                          </span>
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => pickSavedAddress('new')}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-lg border border-dashed p-3 text-left text-sm transition-colors',
                        selectedAddressId === 'new'
                          ? 'border-brand-500 bg-brand-50/40 text-brand-800'
                          : 'border-earth-300 bg-white text-earth-700 hover:border-earth-400'
                      )}
                    >
                      <span className="font-semibold">+ Use a new address</span>
                      <span className="text-xs text-earth-500">
                        We&apos;ll save it for next time.
                      </span>
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label htmlFor="checkout-address1" className="form-label">
                    Street address
                  </label>
                  <AddressAutocomplete
                    id="checkout-address1"
                    name="shipping-address-line1"
                    value={form.address1}
                    onChange={(v) => {
                      setSelectedAddressId('new')
                      setAddressVerified(false)
                      setAddressVerifyStatus('idle')
                      setSuggestedAddress(null)
                      setAddressVerifyError('')
                      setForm((prev) => ({ ...prev, address1: v }))
                    }}
                    onVerifiedChange={() => {
                      /* USPS verify runs when city/state/ZIP are complete */
                    }}
                    onSelect={(parsed) => {
                      setSelectedAddressId('new')
                      setAddressVerified(false)
                      setAddressVerifyStatus('idle')
                      setForm((prev) => ({
                        ...prev,
                        address1: parsed.line1 || prev.address1,
                        city: parsed.city || prev.city,
                        state: parsed.state || prev.state,
                        country: parsed.country || prev.country,
                        postalCode: parsed.postalCode || prev.postalCode,
                      }))
                    }}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="checkout-address2" className="form-label">
                    Apt / suite <span className="font-normal text-earth-400">(optional)</span>
                  </label>
                  <Input
                    id="checkout-address2"
                    type="text"
                    name="address2"
                    value={form.address2}
                    onChange={handleChange}
                    autoComplete="shipping address-line2"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="checkout-city" className="form-label">
                      City
                    </label>
                    <Input
                      id="checkout-city"
                      type="text"
                      name="city"
                      value={form.city}
                      onChange={handleChange}
                      required
                      autoComplete="shipping address-level2"
                    />
                  </div>
                  <div>
                    <label htmlFor="checkout-state" className="form-label">
                      State
                    </label>
                    {isUnitedStatesCountry(form.country) ? (
                      <UsStateSelect
                        id="checkout-state"
                        name="state"
                        value={form.state}
                        onChange={(code) => {
                          setAddressVerified(false)
                          setAddressVerifyStatus('idle')
                          setSuggestedAddress(null)
                          setAddressVerifyError('')
                          setSelectedAddressId('new')
                          setForm((prev) => ({ ...prev, state: code }))
                        }}
                        required
                      />
                    ) : (
                      <Input
                        id="checkout-state"
                        type="text"
                        name="state"
                        value={form.state}
                        onChange={handleChange}
                        required
                        autoComplete="shipping address-level1"
                      />
                    )}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="checkout-country" className="form-label">
                      Country
                    </label>
                    <select
                      id="checkout-country"
                      name="country"
                      className="form-select"
                      value={form.country}
                      onChange={handleChange}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="checkout-zip" className="form-label">
                      ZIP code
                    </label>
                    <Input
                      id="checkout-zip"
                      type="text"
                      name="postalCode"
                      value={form.postalCode}
                      onChange={handleChange}
                      required
                      autoComplete="shipping postal-code"
                    />
                  </div>
                </div>
                {isUnitedStatesCountry(form.country) ? (
                  <div className="space-y-2">
                    {addressVerifyStatus === 'checking' ? (
                      <p className="text-xs text-earth-500">Verifying address with USPS…</p>
                    ) : null}
                    {addressVerifyStatus === 'ok' ? (
                      <p className="text-xs font-medium text-brand-700">Address verified for delivery</p>
                    ) : null}
                    {addressVerifyStatus === 'correction' && suggestedAddress ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
                        <p className="font-medium text-earth-900">{addressVerifyError}</p>
                        <p className="mt-1 text-earth-700">
                          {suggestedAddress.line1 ? `${suggestedAddress.line1}, ` : ''}
                          {suggestedAddress.city}, {suggestedAddress.state}{' '}
                          {suggestedAddress.postalCode}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={applySuggestedAddress}
                        >
                          Use suggested address
                        </Button>
                      </div>
                    ) : null}
                    {addressVerifyStatus === 'error' && addressVerifyError ? (
                      <p className="text-xs font-medium text-red-700" role="alert">
                        {addressVerifyError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              </>
              )}
            </CheckoutStep>
          </form>

          <div className="lg:col-span-2">
            <div className="premium-card sticky top-24 p-6">
              <h2 className="text-base font-semibold text-earth-900">Order summary</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {items.map(({ product, quantity }) => (
                  <li
                    key={product.id}
                    className="flex justify-between gap-3 border-b border-earth-100 pb-3 last:border-0"
                  >
                    <span className="line-clamp-2 text-earth-700">
                      {product.name} × {quantity}
                    </span>
                    <span className="shrink-0 font-semibold text-earth-900">
                      ${(product.price * quantity).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-2 border-t border-earth-100 pt-4 text-sm">
                <div className="flex justify-between text-earth-600">
                  <span>Subtotal</span>
                  <span className="font-medium text-earth-900">${displaySubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-earth-600">
                  <span>Shipping</span>
                  <span className="font-medium text-earth-900">
                    {displayShippingFee === 0 ? 'Free' : `$${displayShippingFee.toFixed(2)}`}
                  </span>
                </div>
                {displayTaxApplies ? (
                  <div className="flex justify-between text-earth-600">
                    <span>Sales tax</span>
                    <span className="font-medium text-earth-900">
                      ${displayTaxAmount.toFixed(2)}
                    </span>
                  </div>
                ) : null}
                {tipForTotal > 0 && (
                  <div className="flex justify-between text-earth-600">
                    <span>Driver tip</span>
                    <span className="font-medium text-earth-900">${tipForTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-earth-100 pt-3 text-lg font-bold text-earth-950">
                  <span>Total</span>
                  <span>${displayTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-6 border-t border-earth-100 pt-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-earth-800">
                  <Lock className="h-4 w-4 text-brand-600" aria-hidden />
                  Payment
                </div>
                <p className="mt-1 text-xs text-earth-500">
                  Secure payment powered by Stripe
                </p>

                {!clientSecret && (
                  <div className="mt-4 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-1 max-md:border-t max-md:border-earth-200 max-md:bg-white max-md:px-1 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pt-3">
                    <Button
                      type="button"
                      size="lg"
                      className="h-14 w-full rounded-xl text-base font-bold tracking-tight shadow-[var(--shadow-card-hover)]"
                      onClick={() => void preparePayment()}
                      disabled={
                        loading ||
                        deliveryMinShort > 0 ||
                        (isLocalDelivery &&
                          localEligibility.status !== 'eligible' &&
                          localEligibility.status !== 'idle')
                      }
                    >
                      {loading ? 'Preparing…' : `Continue to pay · $${grandTotal.toFixed(2)}`}
                    </Button>
                    <p className="mt-2 text-center text-xs text-earth-500">
                      You&apos;ll enter card or wallet details on the next step
                    </p>
                  </div>
                )}

                {clientSecret && returnUrl && (
                  <div className="mt-4">
                    <CheckoutStripePayment
                      clientSecret={clientSecret}
                      returnUrl={returnUrl}
                      totalLabel={`$${displayTotal.toFixed(2)}`}
                    />
                  </div>
                )}

                {error && <p className="error mt-3">{error}</p>}
              </div>

              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-earth-500">
                <Truck className="h-3.5 w-3.5" aria-hidden />
                Pickup available at our Columbus store
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
