import {
  normalizeShippingCountry,
  normalizeShippingRegion,
  normalizeShippingMethod as normalizeShipMethod,
} from '@/lib/shipping'

/**
 * Ohio grocery-style categories: no sales tax at checkout.
 * Taxable: alcohol, cosmetics, non-food (sponges, household, etc.) — see TAXABLE_CATEGORY_KEYS.
 */
export const FOOD_EXEMPT_CATEGORY_KEYS = new Set(
  [
    'Beverages',
    'Bread',
    'Canned',
    'Caribbean product',
    'Dairy And Tea',
    'Flours & Rice',
    'Fresh Produce',
    'Frozen foods',
    'Meat and Seafood',
    'Motherland',
    'Snack',
    'Spices',
    'Sample',
  ].map(normalizeCategoryKey)
)

/** Categories that always collect Ohio store sales tax when tax applies. */
export const TAXABLE_CATEGORY_KEYS = new Set(
  [
    'Alcohol',
    'Cosmetics',
    'Non food',
    'African Prints',
    'Wax',
    'Lace',
    'Headtie',
    'Kente',
    'Brocade',
    'Ready-to-wear',
    'Hair & Braiding',
  ].map(normalizeCategoryKey)
)

export const PRODUCT_TAX_CLASSES = ['grocery_exempt', 'taxable_general', 'alcohol'] as const
export type ProductTaxClass = (typeof PRODUCT_TAX_CLASSES)[number]

export function normalizeCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
}

export function isCategoryTaxable(
  category: string,
  taxClass?: ProductTaxClass | string | null
): boolean {
  if (taxClass === 'grocery_exempt') return false
  if (taxClass === 'taxable_general' || taxClass === 'alcohol') return true

  const key = normalizeCategoryKey(category)
  if (!key) return false
  if (TAXABLE_CATEGORY_KEYS.has(key)) return true
  if (FOOD_EXEMPT_CATEGORY_KEYS.has(key)) return false

  // Future admin-entered labels (non-food merchandise).
  if (key.includes('alcohol') || key.includes('liquor') || key.includes('wine') || key.includes('beer')) {
    return true
  }
  if (key.includes('cosmetic') || key.includes('beauty') || key.includes('personal care')) {
    return true
  }
  if (key.includes('non food') || key.includes('non-food') || key === 'nonfood') {
    return true
  }
  if (key.includes('household') && !key.includes('food')) return true
  if (key.includes('bath') && key.includes('sponge')) return true
  if (
    key.includes('fashion') ||
    key.includes('apparel') ||
    key.includes('clothing') ||
    key.includes('fabric') ||
    key.includes('ankara') ||
    key.includes('print') ||
    key.includes('wax') ||
    key.includes('lace') ||
    key.includes('kente') ||
    key.includes('brocade') ||
    key.includes('bazin') ||
    key.includes('headtie') ||
    key.includes('gele') ||
    key.includes('braid') ||
    key.includes('hair')
  ) {
    return true
  }

  // Default: treat unknown categories as grocery (exempt).
  return false
}

/** Columbus store combined rate (state + local). Override via env. */
export function getStoreSalesTaxRate(): number {
  const raw =
    process.env.STORE_SALES_TAX_RATE?.trim() ||
    process.env.NEXT_PUBLIC_STORE_SALES_TAX_RATE?.trim() ||
    '0.0775'
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0 || n > 0.2) return 0.0775
  return n
}

export type TaxLineInput = {
  category: string
  lineSubtotal: number
  taxClass?: ProductTaxClass | string | null
}

export type TaxDestination = 'pickup' | 'us' | 'international' | 'unknown'

export type SalesTaxQuote = {
  /** True when sales tax is collected for an Ohio destination or store pickup. */
  applies: boolean
  destination: TaxDestination
  rate: number
  taxableSubtotal: number
  taxAmount: number
  jurisdictionLabel: string
}

/**
 * Until additional nexus states are configured, the store collects tax only for
 * Ohio pickup/delivery/shipping. Grocery categories remain exempt everywhere.
 */
export function resolveTaxDestination(input: {
  country?: string
  state?: string
  shippingMethod?: string
}): TaxDestination {
  if (normalizeShipMethod(input.shippingMethod) === 'pickup') return 'pickup'

  const country = normalizeShippingCountry(input.country)
  const isUnitedStates = !country || country === 'united states'
  if (!isUnitedStates) return 'international'

  const state = normalizeShippingRegion(input.state)
  if (!state) return 'unknown'
  return 'us'
}

export function shouldApplyStoreSalesTax(input: {
  country?: string
  state?: string
  shippingMethod?: string
}): boolean {
  const dest = resolveTaxDestination(input)
  if (dest === 'pickup') return true
  if (dest !== 'us') return false
  return normalizeShippingRegion(input.state) === 'OH'
}

export function calculateSalesTax(
  lines: TaxLineInput[],
  dest: {
    country?: string
    state?: string
    shippingMethod?: string
  }
): SalesTaxQuote {
  const rate = getStoreSalesTaxRate()
  const destination = resolveTaxDestination(dest)
  const applies = shouldApplyStoreSalesTax(dest)
  const pct = (rate * 100).toFixed(2).replace(/\.?0+$/, '')
  const jurisdictionLabel =
    destination === 'pickup'
      ? `Store pickup · Columbus, OH (${pct}%)`
      : !applies
        ? ''
        : `Ohio (${pct}%)`

  let taxableSubtotal = 0
  for (const line of lines) {
    if (line.lineSubtotal <= 0) continue
    if (isCategoryTaxable(line.category, line.taxClass)) {
      taxableSubtotal += line.lineSubtotal
    }
  }
  taxableSubtotal = Math.round(taxableSubtotal * 100) / 100

  const taxAmount = applies ? Math.round(taxableSubtotal * rate * 100) / 100 : 0

  return { applies, destination, rate, taxableSubtotal, taxAmount, jurisdictionLabel }
}
