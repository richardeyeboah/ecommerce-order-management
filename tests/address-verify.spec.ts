import { test, expect } from '@playwright/test'
import { lookupUspsCityState } from '../lib/address/usps-address-lookups'
import { isValidUsZip, verifyUsDeliveryAddress } from '../lib/address/verify-us-address'

const GRAMBLING_INPUT = {
  line1: '403 Main Street',
  city: 'grambling',
  state: 'Louisiana',
  postalCode: '71245',
  country: 'United States',
}

test.describe('US delivery address verification', () => {
  test('accepts USPS ZIP+4 postal codes', () => {
    expect(isValidUsZip('12345-6789')).toBe(true)
  })

  test('50314 resolves to Des Moines IA via USPS city-state lookup', async () => {
    test.skip(
      !process.env.USPS_API_CLIENT_ID?.trim() || !process.env.USPS_API_CLIENT_SECRET?.trim(),
      'Set USPS_API_CLIENT_ID/SECRET'
    )

    const result = await lookupUspsCityState('50314')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.city.toLowerCase()).toBe('des moines')
    expect(result.state).toBe('IA')
  })

  test('403 Main Street Grambling LA 71245 verifies when USPS or Geoapify is configured', async () => {
    const hasUsps = Boolean(
      process.env.USPS_API_CLIENT_ID?.trim() && process.env.USPS_API_CLIENT_SECRET?.trim()
    )
    const hasGeoapify = Boolean(process.env.GEOAPIFY_API_KEY?.trim())
    test.skip(!hasUsps && !hasGeoapify, 'Set USPS_API_CLIENT_ID/SECRET or GEOAPIFY_API_KEY')

    let result = await verifyUsDeliveryAddress(GRAMBLING_INPUT)

    if (!result.ok && result.suggested) {
      result = await verifyUsDeliveryAddress({
        ...GRAMBLING_INPUT,
        line1: result.suggested.line1,
        city: result.suggested.city,
        state: result.suggested.state,
        postalCode: result.suggested.postalCode,
      })
    }

    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (hasUsps) {
      expect(result.provider).toBe('usps')
      expect(result.standardized?.postalCode).toMatch(/^71245/)
    }
  })
})
