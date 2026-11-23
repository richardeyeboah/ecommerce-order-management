import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, CheckCircle2, Circle, Package } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PAYMENT_LABEL, normalizeManualSettleMethod, type PaymentMethod } from '@/lib/payment-methods'
import {
  ORDER_SOURCE_LABEL,
  PAYMENT_STATUS_LABEL,
  normalizeOrderSource,
  normalizePaymentStatus,
} from '@/lib/orders/order-source'
import { OrderStatusUpdater } from '@/components/admin/OrderStatusUpdater'
import { RefundButton } from '@/components/admin/RefundButton'
import { ManualRefundButton } from '@/components/admin/ManualRefundButton'
import { MarkPaidPanel } from '@/components/admin/MarkPaidPanel'
import { DeleteOrderButton } from '@/components/admin/DeleteOrderButton'
import { AdminNotePanel } from '@/components/admin/AdminNotePanel'
import { FulfillOrderShipping } from '@/components/admin/FulfillOrderShipping'
import { PrintAddressSlipLink } from '@/components/admin/PrintAddressSlipLink'
import { PickupFulfillmentPanel } from '@/components/admin/PickupFulfillmentPanel'
import { OrderItemsFulfillment } from '@/components/admin/OrderItemsFulfillment'
import { DeliveryRunPanel } from '@/components/admin/DeliveryRunPanel'
import { normalizeDeliveryProof } from '@/lib/orders/delivery-proof'
import {
  getStatusFlow,
  getStatusStepIndex,
  isPickupShippingMethod,
  isLocalDeliveryShippingMethod,
  isShippingOnlyStatus,
  normalizeOrderStatus,
  orderStatusLabel,
  type OrderStatus,
} from '@/lib/order-status'
import { PICKUP_HOLD_HOURS } from '@/lib/orders/pickup-hold'
import {
  SUBSTITUTION_OPTIONS,
  pickupSlotLabel,
} from '@/lib/orders/grocery-ops'
import { formatPhoneDisplay, smsHref, telHref } from '@/lib/phone-link'
import { STORE } from '@/lib/constants/store'
import { SHIPPING_METHOD_LABEL, type ShippingMethod } from '@/lib/shipping'
import { requireAdminPage } from '@/lib/auth/require-admin-page'
import { formatOrderNumber } from '@/lib/orders/order-number'
import { getDefaultParcel } from '@/lib/shipping/label-config'
import { isShippoConfigured, isUspsLabelsLive } from '@/lib/shipping/admin-ship-methods'
import { getUspsConfigPublic, isUspsConfigured } from '@/lib/shipping/usps-config'

const STATUS_PILL_COLORS: Record<OrderStatus, string> = {
  ordered: 'bg-blue-50 text-blue-700',
  processing: 'bg-amber-50 text-amber-700',
  ready_for_pickup: 'bg-teal-50 text-teal-700',
  shipped: 'bg-violet-50 text-violet-700',
  out_for_delivery: 'bg-indigo-50 text-indigo-700',
  delivered: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminPage()
  const { id } = await params

  const [{ data: order }, { data: items }, logsResult] = await Promise.all([
    supabaseAdmin.from('orders').select('*').eq('id', id).single(),
    supabaseAdmin.from('order_items').select('*').eq('order_id', id),
    supabaseAdmin
      .from('order_status_logs')
      .select('id,from_status,to_status,changed_at,changed_by,note')
      .eq('order_id', id)
      .order('changed_at', { ascending: true }),
  ])

  if (!order) notFound()

  const pm = (order.payment_method as PaymentMethod | null | undefined) ?? 'cod'
  const paymentLabel = PAYMENT_LABEL[pm] ?? pm
  const orderRecord = order as Record<string, unknown>
  const paymentStatus = normalizePaymentStatus(orderRecord.payment_status)
  const orderSource = normalizeOrderSource(orderRecord.order_source)
  const paidAt =
    typeof orderRecord.paid_at === 'string' ? orderRecord.paid_at : null
  const normalizedStatus = normalizeOrderStatus(order.status)
  const shippingMethod =
    (order.shipping_method as ShippingMethod | null | undefined) ?? 'standard'
  const isPickup = isPickupShippingMethod(order.shipping_method)
  const isLocalDelivery = isLocalDeliveryShippingMethod(order.shipping_method)
  const statusFlow = getStatusFlow(order.shipping_method)
  const statusIndex = getStatusStepIndex(order.status, statusFlow)
  const shippingLabel = SHIPPING_METHOD_LABEL[shippingMethod] ?? shippingMethod
  const pickupContactName =
    (order as { pickup_contact_name?: string | null }).pickup_contact_name ?? null
  const statusLogs =
    logsResult.error &&
    /relation .* does not exist|could not find the table/i.test(logsResult.error.message)
      ? []
      : (logsResult.data ?? [])

  const uspsConfig = getUspsConfigPublic()
  const defaultParcel = getDefaultParcel()
  const readyForPickupAt =
    typeof orderRecord.ready_for_pickup_at === 'string' ? orderRecord.ready_for_pickup_at : null

  // Thumbnails let staff eyeball the bag against the order before handing it over.
  const productIds = Array.from(
    new Set(
      (items ?? [])
        .map((item) => item.product_id)
        .filter((value): value is string => typeof value === 'string')
    )
  )
  const { data: productRows } = productIds.length
    ? await supabaseAdmin.from('products').select('id, image_url').in('id', productIds)
    : { data: [] }
  const imageByProductId = new Map(
    (productRows ?? []).map((p) => [p.id as string, (p.image_url as string | null) ?? null])
  )

  const fulfillmentItems = (items ?? []).map((item) => {
    const recorded = (item as Record<string, unknown>).fulfilled_quantity
    return {
      id: item.id as string,
      product_name: String(item.product_name ?? 'Item'),
      product_price: Number(item.product_price ?? 0),
      quantity: Number(item.quantity ?? 0),
      fulfilled_quantity:
        typeof recorded === 'number' && Number.isFinite(recorded) ? recorded : null,
    }
  })
  const hasShortage = fulfillmentItems.some(
    (item) => item.fulfilled_quantity !== null && item.fulfilled_quantity < item.quantity
  )

  const deliveryProof = normalizeDeliveryProof(orderRecord.delivery_proof)
  const deliveryProofAt =
    typeof orderRecord.delivery_proof_at === 'string' ? orderRecord.delivery_proof_at : null
  const deliveryProofNote =
    typeof orderRecord.delivery_proof_note === 'string' ? orderRecord.delivery_proof_note : null

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/orders?queue=needs_action"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-earth-600 no-underline transition-colors hover:text-earth-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to orders
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="admin-page-title">
            Order {formatOrderNumber(order.order_number) || 'detail'}
          </h1>
          <p className="mt-1 break-all font-mono text-xs text-earth-400">{order.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          {orderSource !== 'online' && (
            <span className="admin-status-pill bg-earth-100 text-earth-700">
              {ORDER_SOURCE_LABEL[orderSource]}
            </span>
          )}
          {pm !== 'stripe' && (
            <span
              className={`admin-status-pill ${
                paymentStatus === 'unpaid'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {PAYMENT_STATUS_LABEL[paymentStatus]}
            </span>
          )}
          {hasShortage && (
            <span className="admin-status-pill bg-red-50 text-red-700">Partially fulfilled</span>
          )}
          <span className={`admin-status-pill ${STATUS_PILL_COLORS[normalizedStatus]}`}>
            {orderStatusLabel(normalizedStatus, { pickup: isPickup })}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar — floats to top on mobile so actions are immediately visible */}
        <div className="order-first space-y-6 lg:order-last">
          {/* Timeline */}
          <section className="admin-card">
            <h2 className="admin-section-title">{isPickup ? 'Pickup timeline' : 'Delivery timeline'}</h2>
            <ol className="mt-4 space-y-3">
              {statusFlow.map((step, index) => {
                const done = statusIndex >= index
                const tsColumn =
                  step === 'ordered' ? order.ordered_at
                  : step === 'processing' ? order.processing_at
                  : step === 'ready_for_pickup' ? order.ready_for_pickup_at
                  : step === 'shipped' ? order.shipped_at
                  : step === 'out_for_delivery' ? order.out_for_delivery_at
                  : order.delivered_at
                return (
                  <li key={step} className="flex items-start gap-2.5 text-sm">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-earth-300" strokeWidth={1.5} aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={done ? 'font-medium text-earth-900' : 'text-earth-500'}>
                        {orderStatusLabel(step, { pickup: isPickup })}
                      </p>
                      {done && tsColumn && (
                        <p className="mt-0.5 text-xs text-earth-500">
                          {new Date(tsColumn).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
          {/* Fulfilment — pickup counter or carrier label */}
          {isPickup ? (
            <section className="admin-card">
              <h2 className="admin-section-title">Pickup counter</h2>
              <p className="mt-1 text-sm text-earth-500">
                Held {PICKUP_HOLD_HOURS} hours from the moment it is staged.
              </p>
              <div className="mt-4">
                <PickupFulfillmentPanel
                  orderId={order.id}
                  status={normalizedStatus}
                  readyAt={readyForPickupAt}
                  customerPhone={order.customer_phone ?? null}
                  customerEmail={order.customer_email ?? null}
                />
              </div>
            </section>
          ) : (
          <>
          <section className="admin-card">
            <h2 className="admin-section-title">Delivery run</h2>
            <p className="mt-1 text-sm text-earth-500">
              For orders you drive yourself. Go en route, then close out at the door.
            </p>
            <div className="mt-4">
              <DeliveryRunPanel
                orderId={order.id}
                status={normalizedStatus}
                customerPhone={order.customer_phone ?? null}
                deliveryProof={deliveryProof}
                deliveryProofAt={deliveryProofAt}
                deliveryProofNote={deliveryProofNote}
              />
            </div>
          </section>

          <section className="admin-card space-y-4">
            <PrintAddressSlipLink
              orderId={order.id}
              isPickup={shippingMethod === 'pickup'}
              isLocalDelivery={isLocalDelivery}
            />
            <div>
              <h2 className="admin-section-title">Ship this order</h2>
              <p className="mt-1 text-sm text-earth-500">Create a label or add tracking.</p>
              <div className="mt-4">
                <FulfillOrderShipping
                  orderId={order.id}
                  isPickup={shippingMethod === 'pickup'}
                  isLocalDelivery={isLocalDelivery}
                  currentStatus={normalizedStatus}
                  uspsConfigured={isUspsConfigured()}
                  uspsLabelsLive={isUspsLabelsLive()}
                  shippoConfigured={isShippoConfigured()}
                  mailClass={uspsConfig.mailClass}
                  defaultParcel={defaultParcel}
                  initialLabelUrl={
                    typeof orderRecord.shipping_label_url === 'string'
                      ? orderRecord.shipping_label_url
                      : null
                  }
                  initialTracking={order.tracking_number}
                  initialCarrier={
                    typeof orderRecord.shipping_carrier === 'string'
                      ? orderRecord.shipping_carrier
                      : null
                  }
                  initialService={
                    typeof orderRecord.shipping_service === 'string'
                      ? orderRecord.shipping_service
                      : null
                  }
                />
              </div>
            </div>
          </section>
          </>
          )}

          {/* Update status */}
          <section className="admin-card">
            <h2 className="admin-section-title">
              {isPickup ? 'Override status' : 'Update status'}
            </h2>
            <div className="mt-4">
              <OrderStatusUpdater
                orderId={order.id}
                currentStatus={normalizedStatus}
                trackingNumber={order.tracking_number}
                shippingMethod={order.shipping_method}
              />
            </div>
          </section>

          {/* Admin notes */}
          <section className="admin-card">
            <h2 className="admin-section-title">Internal notes</h2>
            <div className="mt-4">
              <AdminNotePanel orderId={order.id} currentStatus={normalizedStatus} />
            </div>
          </section>

          {pm !== 'stripe' && !order.refunded_at && (
            <MarkPaidPanel
              orderId={order.id}
              paymentStatus={paymentStatus}
              paymentMethod={normalizeManualSettleMethod(pm)}
            />
          )}

          {/* Refund — Stripe */}
          {pm === 'stripe' && !order.refunded_at && (
            <section className="admin-card">
              <h2 className="admin-section-title">Refund</h2>
              <div className="mt-4">
                <RefundButton
                  orderId={order.id}
                  maxAmount={Number(order.total_amount ?? 0)}
                />
              </div>
            </section>
          )}

          {pm === 'stripe' &&
            Boolean(order.refunded_at) &&
            !orderRecord.inventory_restocked_at && (
              <section className="admin-card">
                <h2 className="admin-section-title">Inventory recovery</h2>
                <div className="mt-4">
                  <RefundButton orderId={order.id} maxAmount={0} restockOnly />
                </div>
              </section>
            )}

          {/* Refund — COD / manual. Hidden while unpaid: there is no money to return. */}
          {pm !== 'stripe' && !order.refunded_at && paymentStatus === 'paid' && (
            <section className="admin-card">
              <h2 className="admin-section-title">Refund</h2>
              <p className="mt-1 text-sm text-earth-500">Cash or manual payment — mark refunded after returning money.</p>
              <div className="mt-4">
                <ManualRefundButton
                  orderId={order.id}
                  amount={Number(order.total_amount ?? 0)}
                />
              </div>
            </section>
          )}

          <section className="admin-card">
            <h2 className="admin-section-title">Remove from admin</h2>
            <p className="mt-1 text-sm text-earth-500">
              Permanently clears this order from your list. Does not refund the customer.
            </p>
            <div className="mt-4">
              <DeleteOrderButton orderId={order.id} orderNumber={order.order_number} />
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {/* Customer */}
          <section className="admin-card">
            <h2 className="admin-section-title">Customer</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Name" value={order.customer_name} />
              <Field label="Email" value={order.customer_email} />
              {order.customer_phone && (
                <Field
                  label="Phone"
                  value={<PhoneValue phone={order.customer_phone} />}
                />
              )}
              <Field
                label="Placed"
                value={new Date(order.created_at).toLocaleString()}
              />
              <Field
                label="Payment"
                value={
                  pm === 'stripe'
                    ? paymentLabel
                    : `${PAYMENT_STATUS_LABEL[paymentStatus]} · ${paymentLabel}${
                        paidAt ? ` · ${new Date(paidAt).toLocaleString()}` : ''
                      }`
                }
              />
              {orderSource !== 'online' && (
                <Field label="Source" value={ORDER_SOURCE_LABEL[orderSource]} />
              )}
              <Field
                label={isPickup ? 'Fulfillment' : 'Shipping'}
                value={isPickup ? shippingLabel : `${shippingLabel} (zone: ${order.shipping_zone ?? 'n/a'})`}
              />
              {isPickup && pickupContactName && (
                <Field label="Collected by" value={pickupContactName} />
              )}
              {isPickup && typeof orderRecord.pickup_slot === 'string' && orderRecord.pickup_slot && (
                <Field label="Pickup window" value={pickupSlotLabel(orderRecord.pickup_slot)} />
              )}
              {typeof orderRecord.substitution_pref === 'string' && orderRecord.substitution_pref && (
                <Field
                  label="If unavailable"
                  value={
                    SUBSTITUTION_OPTIONS.find((o) => o.value === orderRecord.substitution_pref)
                      ?.label ?? String(orderRecord.substitution_pref)
                  }
                />
              )}
              {Number(orderRecord.tip_amount ?? 0) > 0 && (
                <Field
                  label="Driver tip"
                  value={`$${Number(orderRecord.tip_amount).toFixed(2)}`}
                />
              )}
              {!isPickup && <Field label="Tracking #" value={order.tracking_number ?? '—'} />}
              {order.refunded_at && (
                <Field
                  label="Refunded"
                  value={`${new Date(order.refunded_at).toLocaleString()} ($${Number(order.refund_amount ?? 0).toFixed(2)})`}
                />
              )}
            </dl>
          </section>

          {/* Fulfillment */}
          <section className="admin-card">
            <h2 className="admin-section-title">{isPickup ? 'Pickup' : 'Delivery address'}</h2>
            {isPickup ? (
              <div className="mt-3 text-sm leading-relaxed text-earth-700">
                <p className="font-medium text-earth-900">Store pickup</p>
                <p className="mt-1">{STORE.address}</p>
                <p>{STORE.hours}</p>
                <p className="mt-2">
                  <span className="text-earth-500">Collected by: </span>
                  {pickupContactName || order.customer_name || '—'}
                </p>
              </div>
            ) : (
              <address className="mt-3 not-italic text-sm leading-relaxed text-earth-700">
                {order.address_line}
                <br />
                {order.city}
                {order.state ? `, ${order.state}` : ''}
                {order.postal_code ? ` ${order.postal_code}` : ''}
                <br />
                {order.country}
              </address>
            )}
          </section>

          {/* Items */}
          <section className="admin-card">
            <h2 className="admin-section-title">Items</h2>
            {items && items.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }} aria-label="Photo"></th>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Qty</th>
                      <th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const image =
                        typeof item.product_id === 'string'
                          ? imageByProductId.get(item.product_id)
                          : null
                      const recorded = (item as Record<string, unknown>).fulfilled_quantity
                      const fulfilled =
                        typeof recorded === 'number' && Number.isFinite(recorded)
                          ? recorded
                          : Number(item.quantity ?? 0)
                      const short = Number(item.quantity ?? 0) - fulfilled
                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="relative h-10 w-10 overflow-hidden rounded-md border border-earth-200 bg-earth-50">
                              {image ? (
                                <Image src={image} alt="" fill sizes="40px" className="object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <Package className="h-4 w-4 text-earth-300" aria-hidden />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="font-medium text-earth-900">{item.product_name}</td>
                          <td className="tabular-nums">${Number(item.product_price ?? 0).toFixed(2)}</td>
                          <td className="tabular-nums">
                            {short > 0 ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span>{fulfilled}</span>
                                <span className="text-xs text-earth-400 line-through">
                                  {item.quantity}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                  short {short}
                                </span>
                              </span>
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td className="text-right tabular-nums">
                            ${Number(item.subtotal ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="text-right text-earth-600">
                        Subtotal
                      </td>
                      <td className="text-right tabular-nums">
                        ${Number(order.subtotal_amount ?? 0).toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="text-right text-earth-600">
                        {isPickup ? 'Pickup fee' : 'Shipping'}
                      </td>
                      <td className="text-right tabular-nums">
                        {isPickup && Number(order.shipping_fee ?? 0) === 0
                          ? '—'
                          : `$${Number(order.shipping_fee ?? 0).toFixed(2)}`}
                      </td>
                    </tr>
                    {Number(orderRecord.tax_amount ?? 0) > 0 ? (
                      <tr>
                        <td colSpan={4} className="text-right text-earth-600">
                          Sales tax
                        </td>
                        <td className="text-right tabular-nums">
                          ${Number(orderRecord.tax_amount).toFixed(2)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-earth-200">
                      <td colSpan={4} className="pt-2 text-right font-semibold text-earth-900">
                        Total
                      </td>
                      <td className="pt-2 text-right tabular-nums font-semibold text-earth-900">
                        ${Number(order.total_amount ?? 0).toFixed(2)}
                      </td>
                    </tr>
                    {Number(order.refund_amount ?? 0) > 0 ? (
                      <>
                        <tr>
                          <td colSpan={4} className="text-right text-earth-600">
                            Refunded
                          </td>
                          <td className="text-right tabular-nums text-red-700">
                            −${Number(order.refund_amount).toFixed(2)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="text-right font-semibold text-earth-900">
                            Net charged
                          </td>
                          <td className="text-right tabular-nums font-semibold text-earth-900">
                            $
                            {Math.max(
                              0,
                              Number(order.total_amount ?? 0) - Number(order.refund_amount ?? 0)
                            ).toFixed(2)}
                          </td>
                        </tr>
                      </>
                    ) : null}
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-earth-500">No items.</p>
            )}
          </section>

          {/* Availability — record what was handed over and refund the rest */}
          {fulfillmentItems.length > 0 && (
            <section className="admin-card">
              <h2 className="admin-section-title">Availability &amp; shortfall refund</h2>
              <p className="mt-1 text-sm text-earth-500">
                Set what you actually handed over. The refund is priced from the missing lines
                and their sales tax, then sent back to the customer automatically.
              </p>
              <div className="mt-4">
                <OrderItemsFulfillment
                  orderId={order.id}
                  items={fulfillmentItems}
                  paysByCard={pm === 'stripe'}
                  fullyRefunded={Boolean(order.refunded_at)}
                  unpaid={pm !== 'stripe' && paymentStatus === 'unpaid'}
                />
              </div>
            </section>
          )}
        </div>

        {/* Timeline — desktop only alongside main content */}
      </div>

      {/* Audit log — full width below */}
      {statusLogs.length > 0 && (
        <section>
          <h2 className="admin-section-title mb-3">Status log</h2>
          <div className="admin-table-wrap overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>To</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {statusLogs.map((log) => {
                  const to = normalizeOrderStatus(log.to_status)
                  const offPath = isPickup && isShippingOnlyStatus(to)
                  return (
                    <tr key={log.id}>
                      <td className="text-earth-600">
                        {new Date(log.changed_at).toLocaleString()}
                      </td>
                      <td>
                        {log.from_status
                          ? orderStatusLabel(normalizeOrderStatus(log.from_status), {
                              pickup: isPickup,
                            })
                          : '—'}
                      </td>
                      <td className="font-medium text-earth-900">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {orderStatusLabel(to, { pickup: isPickup })}
                          {offPath && (
                            <span className="inline-flex items-center rounded-full bg-earth-100 px-2 py-0.5 text-[11px] font-semibold text-earth-600">
                              not a pickup step
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-earth-600">{log.changed_by ?? '—'}</td>
                      <td className="text-earth-600">{log.note ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function PhoneValue({ phone }: { phone: string }) {
  const tel = telHref(phone)
  const sms = smsHref(phone)
  const link =
    'text-brand-700 no-underline transition-colors duration-150 hover:text-brand-800 hover:underline'

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {tel ? (
        <a href={tel} className={link}>
          {formatPhoneDisplay(phone)}
        </a>
      ) : (
        <span>{phone}</span>
      )}
      {sms ? (
        <a href={sms} className={`text-xs ${link}`}>
          Text
        </a>
      ) : null}
    </span>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-earth-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-earth-900">{value}</dd>
    </div>
  )
}
