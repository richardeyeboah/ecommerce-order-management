import { test, expect } from '@playwright/test'

const SAME_ORIGIN = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://127.0.0.1:3002'

/**
 * Admin API protections — these requests pass the CSRF same-origin filter
 * (Origin matches baseURL) so they exercise the actual auth gate.
 */
test.describe('Admin API', () => {
  test.use({ extraHTTPHeaders: { Origin: SAME_ORIGIN } })

  test('rejects unauthenticated product create', async ({ request }) => {
    const response = await request.post('/api/admin/products', {
      data: {
        name: 'X',
        price: 1,
        category: 'Test',
      },
    })
    expect(response.status()).toBe(401)
    await expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/unauthorized/i),
    })
  })

  test('rejects unauthenticated upload', async ({ request }) => {
    const response = await request.post('/api/admin/upload', {
      multipart: {
        file: {
          name: 'x.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
        },
      },
    })
    expect(response.status()).toBe(401)
  })

  test('blocks requests with a cross-site Origin header', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: 'https://attacker.invalid' },
    })
    const response = await ctx.post('/api/admin/products', {
      data: { name: 'X', price: 1, category: 'Test' },
    })
    expect(response.status()).toBe(403)
    await ctx.dispose()
  })
})
