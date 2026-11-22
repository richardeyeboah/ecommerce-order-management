import { test, expect } from '@playwright/test'
import { seedCartFromFirstShopProduct, cartBadge } from './helpers'

test.describe.configure({ timeout: 120_000 })

test.describe('Cart', () => {
  test('shows empty state when cart has no items', async ({ page }) => {
    await page.goto('/cart')

    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start shopping' })).toHaveAttribute('href', '/shop')
  })

  test('shows line item and total after cart is seeded', async ({ page }) => {
    await seedCartFromFirstShopProduct(page)

    await expect(page.getByRole('heading', { name: /Cart \(1\)/ })).toBeVisible()
    await expect(page.getByText('Order summary', { exact: true })).toBeVisible()

    const totalRow = page.getByText(/^Total$/).locator('..').locator('span').last()
    await expect(totalRow).toContainText('$')

    await expect(
      page.getByRole('main').getByRole('link', { name: 'Checkout', exact: true })
    ).toBeVisible()
  })

  test('increases quantity with + control', async ({ page }) => {
    await seedCartFromFirstShopProduct(page)

    await page.getByRole('button', { name: /Increase quantity/i }).first().click()

    const qtyControl = page.getByRole('button', { name: /Decrease quantity/i }).first().locator('xpath=..')
    await expect(qtyControl.getByText('2', { exact: true })).toBeVisible()
  })

  test('navbar cart badge shows item count', async ({ page }) => {
    await seedCartFromFirstShopProduct(page, '/')

    await expect(cartBadge(page, /^1$/)).toBeVisible({ timeout: 15_000 })
  })
})
