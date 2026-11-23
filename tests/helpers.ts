import type { Page } from '@playwright/test'

/**
 * Seeds `lqam-cart` with a deterministic item.
 */
export async function seedCartFromFirstShopProduct(page: Page, target = '/cart') {
  const seededCart = [
    {
      product: {
        id: 'test-product-1',
        name: 'Test Product',
        description: 'Seeded for cart tests',
        price: 9.99,
        category: 'Beverages',
        image_url: null,
        in_stock: true,
        created_at: new Date().toISOString(),
      },
      quantity: 1,
    },
  ]

  await page.addInitScript((cart) => {
    window.localStorage.setItem('lqam-cart', JSON.stringify(cart))
  }, seededCart)
  await page.goto(target, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem('lqam-cart')
    if (!raw) return false
    try {
      return JSON.parse(raw)[0]?.quantity === 1
    } catch {
      return false
    }
  })
}

/** Cart icon link shows count badge (not the desktop “Cart” text link). */
export function cartBadge(page: Page, count: string | RegExp) {
  return page
    .locator('header button')
    .filter({ hasText: /^Cart/ })
    .locator('span')
    .filter({ hasText: count })
}
