/**
 * HMAC-signed admin session token (Edge-compatible — uses Web Crypto, no node:crypto).
 *
 * Token format: `${version}.${expiresAt}.${signatureBase64Url}`
 * - version:    schema tag, currently "v1"
 * - expiresAt:  unix seconds when the token expires
 * - signature:  HMAC-SHA256(secret, `${version}.${expiresAt}`)
 *
 * The cookie value never contains the admin password — only this short-lived signed token.
 */

const ENCODER_VERSION = 'v1'
export const ADMIN_COOKIE_NAME = 'admin_session'
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8 // 8 hours

function getSecret(): string {
  const dedicated = process.env.ADMIN_SESSION_SECRET?.trim() || ''
  if (process.env.NODE_ENV === 'production') {
    if (dedicated.length < 32) {
      throw new Error('ADMIN_SESSION_SECRET must be set to at least 32 characters in production.')
    }
    return dedicated
  }
  const secret = dedicated || process.env.ADMIN_PASSWORD?.trim() || ''
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET (or ADMIN_PASSWORD in development) is required.')
  }
  return secret
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const bin = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i])
  // btoa is available in both Edge and modern Node
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function signPayload(payload: string): Promise<string> {
  const key = await importKey(getSecret())
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(sig)
}

export async function createAdminSessionToken(now: number = Date.now()): Promise<{
  token: string
  expiresAt: number
}> {
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS
  const payload = `${ENCODER_VERSION}.${expiresAt}`
  const sig = await signPayload(payload)
  return { token: `${payload}.${sig}`, expiresAt }
}

export async function verifyAdminSessionToken(
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [version, expiresAtRaw, sigB64] = parts
  if (version !== ENCODER_VERSION) return false
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false

  let key: CryptoKey
  try {
    key = await importKey(getSecret())
  } catch {
    return false
  }

  let sigBytes: ArrayBuffer
  try {
    const u8 = fromBase64Url(sigB64)
    // Copy into a fresh ArrayBuffer so the type matches BufferSource (Uint8Array<ArrayBufferLike>
    // is not directly assignable when the buffer might be SharedArrayBuffer in strict TS).
    sigBytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  } catch {
    return false
  }

  try {
    return await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${version}.${expiresAtRaw}`)
    )
  } catch {
    return false
  }
}

/** Constant-time string equality using Web Crypto verify (Edge-safe). */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
