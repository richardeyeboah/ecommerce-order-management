/** Stored in checkout_snapshots.payload — rebuilt server-side with DB prices on fulfill */
export type CheckoutSnapshotPayload = {
  items: {
    productId: string
    quantity: number
    productName?: string
    unitPrice?: number
    category?: string
    taxClass?: string | null
  }[]
  customer_name: string
  customer_phone: string
  address_line: string
  city: string
  state: string | null
  country: string
  postal_code: string | null
  shipping_method: string
  shipping_zone: string | null
  account_email: string
  /** For pickup orders: who is collecting (customer, friend, or courier). */
  pickup_contact_name?: string | null
  /** refund | call | substitute */
  substitution_pref?: string | null
  /** today_asap | today_afternoon | … */
  pickup_slot?: string | null
  /** Driver tip dollars */
  tip_amount?: number | null
  /** Immutable server quote used to reproduce the charge during fulfillment/refunds. */
  quoted_subtotal?: number
  quoted_shipping_fee?: number
  quoted_tax_amount?: number
  quoted_tax_rate?: number
  quoted_taxable_subtotal?: number
  quoted_tax_jurisdiction?: string
  quoted_total?: number
}
