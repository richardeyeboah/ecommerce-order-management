import { test, expect } from '@playwright/test'
import {
  computeShortfallRefund,
  resolveRefundTaxRate,
} from '../lib/orders/partial-refund'

const RATE = 0.0775

function line(over: Partial<Parameters<typeof computeShortfallRefund>[0]['lines'][number]> = {}) {
  return {
    itemId: 'item-1',
    productName: 'Yam',
    unitPrice: 10,
    orderedQuantity: 3,
    previousFulfilledQuantity: 3,
    nextFulfilledQuantity: 3,
    category: 'Fresh Produce',
    ...over,
  }
}

test.describe('shortfall refunds', () => {
  test('uses the historical store rate when a migrated taxable order has a zero default rate', () => {
    expect(resolveRefundTaxRate(0, 3.1, RATE)).toBe(RATE)
  })

  test('keeps a zero rate for orders that collected no tax', () => {
    expect(resolveRefundTaxRate(0, 0, RATE)).toBe(0)
  })

  test('no shortage refunds nothing', () => {
    const quote = computeShortfallRefund({
      lines: [line()],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 30,
    })
    expect(quote.totalRefund).toBe(0)
    expect(quote.shortLines).toHaveLength(0)
  })

  test('grocery shortage refunds goods with no tax', () => {
    const quote = computeShortfallRefund({
      lines: [line({ nextFulfilledQuantity: 1 })],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 30,
    })
    expect(quote.goodsRefund).toBe(20)
    expect(quote.taxRefund).toBe(0)
    expect(quote.totalRefund).toBe(20)
    expect(quote.shortLines[0].missingQuantity).toBe(2)
  })

  test('taxable shortage refunds the tax that was charged on it', () => {
    const quote = computeShortfallRefund({
      lines: [
        line({ category: 'Cosmetics', unitPrice: 20, orderedQuantity: 2, nextFulfilledQuantity: 1 }),
      ],
      taxRate: RATE,
      orderTaxAmount: 3.1,
      maxRefundable: 43.1,
    })
    expect(quote.goodsRefund).toBe(20)
    expect(quote.taxRefund).toBe(1.55)
    expect(quote.totalRefund).toBe(21.55)
  })

  test('tax refund never exceeds the tax actually collected', () => {
    const quote = computeShortfallRefund({
      lines: [
        line({ category: 'Cosmetics', unitPrice: 100, orderedQuantity: 1, nextFulfilledQuantity: 0 }),
      ],
      taxRate: RATE,
      orderTaxAmount: 1,
      maxRefundable: 200,
    })
    expect(quote.taxRefund).toBe(1)
  })

  test('repeated adjustments only refund the new shortage', () => {
    // First pass already recorded 1 of 3 missing and refunded it.
    const second = computeShortfallRefund({
      lines: [line({ previousFulfilledQuantity: 2, nextFulfilledQuantity: 1 })],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 20,
    })
    expect(second.goodsRefund).toBe(10)
    expect(second.shortLines[0].missingQuantity).toBe(2)
  })

  test('putting an item back nets against the shortage', () => {
    const quote = computeShortfallRefund({
      lines: [line({ previousFulfilledQuantity: 1, nextFulfilledQuantity: 3 })],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 30,
    })
    expect(quote.goodsRefund).toBe(-20)
    expect(quote.totalRefund).toBe(0)
    expect(quote.shortLines).toHaveLength(0)
  })

  test('refund is capped at what is still refundable', () => {
    const quote = computeShortfallRefund({
      lines: [line({ nextFulfilledQuantity: 0 })],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 12,
    })
    expect(quote.totalRefund).toBe(12)
    expect(quote.clamped).toBe(true)
  })

  test('quantities are clamped to what was ordered', () => {
    const quote = computeShortfallRefund({
      lines: [line({ nextFulfilledQuantity: 99 })],
      taxRate: RATE,
      orderTaxAmount: 0,
      maxRefundable: 30,
    })
    expect(quote.lines[0].fulfilledQuantity).toBe(3)
    expect(quote.totalRefund).toBe(0)
  })
})
