import { createHash, timingSafeEqual } from 'crypto'

/**
 * Shared secret appended as ?token=… on the Shippo webhook URL.
 * Prefer SHIPPO_WEBHOOK_SECRET; otherwise derive a stable token from the API key
 * so registration works without an extra env var.
 */
export function getShippoWebhookToken(): string | null {
  const explicit = process.env.SHIPPO_WEBHOOK_SECRET?.trim()
  if (explicit) return explicit
  if (process.env.NODE_ENV === 'production') return null
  const api = process.env.SHIPPO_API_TOKEN?.trim()
  if (!api) return null
  return createHash('sha256').update(`shippo-webhook:${api}`).digest('hex').slice(0, 32)
}

export function isValidShippoWebhookToken(received: string | null | undefined): boolean {
  const expected = getShippoWebhookToken()
  if (!expected) return false
  const got = (received ?? '').trim()
  if (!got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
