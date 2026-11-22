import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildAuthoritativeOrderItems,
  type AuthoritativeProduct,
  type SanitizedCartLine,
} from '@/lib/order-pricing'
import {
  calculateShipping,
  normalizeShippingCountry,
  normalizeShippingMethod,
  normalizeShippingRegion,
  type ShippingMethod,
  type ShippingQuote,
} from '@/lib/shipping'
import {
  calculateSalesTax,
  type ProductTaxClass,
  type SalesTaxQuote,
  type TaxLineInput,
} from '@/lib/tax/sales-tax'

export type ProductWithCategory = AuthoritativeProduct & {
  category: string
  tax_class?: ProductTaxClass | null
  stock_quantity?: number | null
}

export const CHECKOUT_PRODUCT_SELECT = 'id,name,price,in_stock,category,tax_class,stock_quantity'
export const CHECKOUT_PRODUCT_SELECT_LEGACY = 'id,name,price,in_stock,category,stock_quantity'

/** Normalize Supabase product rows for checkout (legacy DBs may omit stock_quantity). */
export function toProductWithCategory(row: {
  id: string
  name: string
  price: number
  in_stock: boolean
  category: string
  tax_class?: ProductTaxClass | null
  stock_quantity?: number | null
}): ProductWithCategory {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    in_stock: row.in_stock,
    category: row.category,
    tax_class: row.tax_class ?? null,
    stock_quantity:
      typeof row.stock_quantity === 'number' && Number.isFinite(row.stock_quantity)
        ? row.stock_quantity
        : null,
  }
}

export async function fetchCheckoutProductMap(
  supabase: SupabaseClient,
  candidateProductIds: string[]
): Promise<{ productMap: Map<string, ProductWithCategory>; error: { message: string } | null }> {
  const primary = await supabase
    .from('products')
    .select(CHECKOUT_PRODUCT_SELECT)
    .in('id', candidateProductIds)

  if (!primary.error) {
    const rows = (primary.data ?? []) as Array<{
      id: string
      name: string
      price: number
      in_stock: boolean
      category: string
      tax_class?: ProductTaxClass | null
      stock_quantity?: number | null
    }>
    return {
      productMap: new Map(rows.map((row) => [row.id, toProductWithCategory(row)])),
      error: null,
    }
  }

  if (!/tax_class|stock_quantity|column/i.test(primary.error.message)) {
    return { productMap: new Map(), error: primary.error }
  }

  const fallback = await supabase
    .from('products')
    .select(CHECKOUT_PRODUCT_SELECT_LEGACY)
    .in('id', candidateProductIds)

  if (fallback.error) {
    return { productMap: new Map(), error: fallback.error }
  }

  const rows = (fallback.data ?? []) as Array<{
    id: string
    name: string
    price: number
    in_stock: boolean
    category: string
    stock_quantity?: number | null
  }>

  return {
    productMap: new Map(rows.map((row) => [row.id, toProductWithCategory(row)])),
    error: null,
  }
}

export type CheckoutTotals = {
  orderItems: ReturnType<typeof buildAuthoritativeOrderItems>['orderItems']
  subtotal: number
  shipping: ShippingQuote
  tax: SalesTaxQuote
  tip: number
  total: number
}

export function computeCheckoutTotals(input: {
  items: SanitizedCartLine[]
  productMap: Map<string, ProductWithCategory>
  country?: string
  state?: string
  shippingMethod?: string
  tipAmount?: number
}): CheckoutTotals {
  const { orderItems, subtotal } = buildAuthoritativeOrderItems(input.items, input.productMap)
  const shipping_method = normalizeShippingMethod(input.shippingMethod)
  const country = normalizeShippingCountry(input.country)
  const state = normalizeShippingRegion(input.state)

  const shipping = calculateShipping({
    subtotal,
    country,
    state,
    method: shipping_method,
  })

  const taxLines: TaxLineInput[] = orderItems.map((item) => ({
    category: input.productMap.get(item.product_id)?.category ?? '',
    taxClass: input.productMap.get(item.product_id)?.tax_class ?? null,
    lineSubtotal: item.subtotal,
  }))

  const tax = calculateSalesTax(taxLines, {
    country,
    state,
    shippingMethod: shipping_method as ShippingMethod,
  })

  const tipRaw = Number(input.tipAmount ?? 0)
  const tip =
    Number.isFinite(tipRaw) && tipRaw > 0
      ? Math.round(Math.min(tipRaw, 100) * 100) / 100
      : 0

  const total = Math.round((subtotal + shipping.fee + tax.taxAmount + tip) * 100) / 100

  return { orderItems, subtotal, shipping, tax, tip, total }
}
