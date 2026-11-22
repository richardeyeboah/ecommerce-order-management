/**
 * Shortfall refunds for partially fulfilled orders.
 *
 * When staff bag an order and something is not on the shelf, the customer keeps
 * the rest and is refunded for what they did not get. The math here is the
 * money path, so it is a pure function with no I/O: every caller passes the
 * amounts that were actually charged and gets back the exact cents to refund.
 *
 * Everything is computed on the *cumulative* shortage (ordered − fulfilled)
 * rather than on a single adjustment. Subtracting the previous cumulative
 * refund from the new one makes repeated adjustments self-correcting: staff can
 * short an item, put one back, and short it again without ever double-refunding.
 */

import { isCategoryTaxable, type ProductTaxClass } from '@/lib/tax/sales-tax'

export type ShortfallLineInput = {
  itemId: string
  productName: string
  unitPrice: number
  orderedQuantity: number
  /** Units recorded as fulfilled before this adjustment (defaults to ordered). */
  previousFulfilledQuantity: number
  /** Units staff are now confirming they handed over. */
  nextFulfilledQuantity: number
  /** Product category, used to decide whether the line carried sales tax. */
  category?: string | null
  /** Immutable tax classification captured when the order was placed. */
  taxClass?: ProductTaxClass | string | null
}

export type ShortfallLineResult = {
  itemId: string
  productName: string
  unitPrice: number
  orderedQuantity: number
  fulfilledQuantity: number
  missingQuantity: number
  /** Value of the units removed by *this* adjustment. */
  refundForLine: number
  taxable: boolean
}

export type ShortfallRefundQuote = {
  lines: ShortfallLineResult[]
  /** Lines short after this adjustment, for receipts and notes. */
  shortLines: ShortfallLineResult[]
  goodsRefund: number
  taxRefund: number
  /** goodsRefund + taxRefund, clamped to what is still refundable. */
  totalRefund: number
  /** True when the clamp reduced the refund below the computed value. */
  clamped: boolean
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function safeQty(n: unknown, fallback = 0): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.trunc(v))
}

function safeMoney(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return 0
  return v
}

export function computeShortfallRefund(input: {
  lines: ShortfallLineInput[]
  /** Combined sales tax rate that was applied at checkout. */
  taxRate: number
  /** Sales tax actually charged on the order — the ceiling for tax refunds. */
  orderTaxAmount: number
  /** Order total minus everything already refunded. */
  maxRefundable: number
}): ShortfallRefundQuote {
  const taxRate = Number.isFinite(input.taxRate) && input.taxRate > 0 ? input.taxRate : 0
  const orderTaxAmount = safeMoney(input.orderTaxAmount)
  const maxRefundable = safeMoney(input.maxRefundable)

  const lines: ShortfallLineResult[] = []
  let goodsRefund = 0
  let taxableShortBefore = 0
  let taxableShortAfter = 0

  for (const raw of input.lines) {
    const ordered = safeQty(raw.orderedQuantity)
    const unitPrice = safeMoney(raw.unitPrice)
    const previous = Math.min(safeQty(raw.previousFulfilledQuantity, ordered), ordered)
    const next = Math.min(safeQty(raw.nextFulfilledQuantity), ordered)
    const taxable = isCategoryTaxable(raw.category ?? '', raw.taxClass)

    // Positive when this adjustment removes units; negative when staff put
    // units back. Both directions net out correctly across adjustments.
    const removedNow = previous - next
    const refundForLine = round2(removedNow * unitPrice)

    taxableShortBefore += taxable ? (ordered - previous) * unitPrice : 0
    taxableShortAfter += taxable ? (ordered - next) * unitPrice : 0
    goodsRefund += refundForLine

    lines.push({
      itemId: raw.itemId,
      productName: raw.productName,
      unitPrice,
      orderedQuantity: ordered,
      fulfilledQuantity: next,
      missingQuantity: ordered - next,
      refundForLine,
      taxable,
    })
  }

  goodsRefund = round2(goodsRefund)

  // Tax follows the goods, but can never exceed the tax actually collected.
  const taxBefore = Math.min(round2(taxableShortBefore * taxRate), orderTaxAmount)
  const taxAfter = Math.min(round2(taxableShortAfter * taxRate), orderTaxAmount)
  const taxRefund = round2(taxAfter - taxBefore)

  const computed = round2(goodsRefund + taxRefund)
  const totalRefund = round2(Math.min(Math.max(computed, 0), maxRefundable))

  return {
    lines,
    shortLines: lines.filter((l) => l.missingQuantity > 0),
    goodsRefund,
    taxRefund,
    totalRefund,
    clamped: computed > totalRefund,
  }
}

/** "2× Yam (short 1), Palm Oil (short 2)" for status logs and emails. */
export function describeShortLines(lines: ShortfallLineResult[]): string {
  return lines
    .map((l) => `${l.productName} — ${l.missingQuantity} of ${l.orderedQuantity} unavailable`)
    .join('; ')
}
