import { test, expect } from '@playwright/test'

test.describe.configure({ timeout: 120_000 })

test.describe('Checkout', () => {
  test('allows guest checkout without signing in', async ({ page }) => {
    await page.goto('/checkout')

    await expect(page).toHaveURL(/\/checkout/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('order confirmation loads without login when no order id', async ({ page }) => {
    await page.goto('/order-confirmation')

    await expect(page).toHaveURL(/\/order-confirmation/)
    await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible()
  })

  test('order tracking API requires order number and email for guests', async ({ page }) => {
    const response = await page.request.get('/api/orders/track?id=test-order')
    expect(response.status()).toBe(400)
    await expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/order number.*email/i),
    })
  })

  test('direct order creation API is disabled (use payment checkout)', async ({ page }) => {
    const response = await page.request.post('/api/orders', {
      data: {
        name: 'Test Customer',
        address: '123 Test Street',
        city: 'Columbus',
        state: 'Ohio',
        country: 'United States',
        items: [],
      },
    })

    expect(response.status()).toBe(410)
    await expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/stripe checkout|payment/i),
    })
  })
})
