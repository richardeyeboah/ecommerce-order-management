import { test, expect } from '@playwright/test'

test.describe('Navbar', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows brand and links to home', async ({ page }) => {
    const logo = page.getByRole('link', { name: /Kintampo/i }).first()
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('href', '/')
  })

  test('desktop header has search, Home, Shop, and cart', async ({ page }) => {
    const header = page.locator('header').first()
    await expect(
      header.getByRole('searchbox', { name: /search products/i }).first()
    ).toBeVisible()
    await expect(header.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Shop', exact: true })).toBeVisible()
    await expect(header.getByRole('button', { name: /^Cart/i })).toBeVisible()
  })

  test('Shop navigates to shop page', async ({ page }) => {
    await page.locator('header').getByRole('link', { name: 'Shop', exact: true }).click()
    await expect(page).toHaveURL(/\/shop/)
    await expect(page.getByRole('heading', { name: /All products/i })).toBeVisible()
  })

  test('Cart button opens the cart drawer', async ({ page }) => {
    await page
      .locator('header')
      .getByRole('button', { name: /^Cart/i })
      .first()
      .click()
    await expect(page.getByRole('dialog', { name: /shopping cart/i })).toBeVisible()
  })
})

test.describe('Mobile bottom navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('shows tab bar with all 5 tabs', async ({ page }) => {
    await page.goto('/shop')
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Shop' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Cart' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Track' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Account' })).toBeVisible()
  })

  test('Home tab returns to homepage', async ({ page }) => {
    await page.goto('/shop')
    const home = page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'Home' })
    await expect(home).toHaveAttribute('href', '/')
    await home.evaluate((element: HTMLElement) => element.click())
    await expect(page).toHaveURL('/')
  })
})
