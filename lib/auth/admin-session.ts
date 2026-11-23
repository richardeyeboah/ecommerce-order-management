/**
 * HMAC-signed admin session token (Edge-compatible — uses Web Crypto, no node:crypto).
 *
 * Token formats:
 * - v1 (store password, older cookies): `v1.${expiresAt}.${signature}`
 * - v2 (who signed in):                  `v2.${expiresAt}.${subject}.${signature}`
 *   subject is `owner` for the store password, or a staff member's user id.
 * The signature is HMAC-SHA256(secret, everything before it).
 *
 * The cookie value never contains the admin password — only this short-lived signed token.
 */

const ENCODER_VERSION = 'v2'
/** Subject for sessions opened with the shared store password. */
export const OWNER_SUBJECT = 'owner'
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

export async function createAdminSessionToken(
  now: number = Date.now(),
  subject: string = OWNER_SUBJECT
): Promise<{
  token: string
  expiresAt: number
}> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(subject)) throw new Error('Invalid admin session subject.')
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS
  const payload = `${ENCODER_VERSION}.${expiresAt}.${subject}`
  const sig = await signPayload(payload)
  return { token: `${payload}.${sig}`, expiresAt }
}

/**
 * Checks the signature and expiry and returns who the session belongs to, or null.
 * v1 cookies (before staff accounts) count as the owner. This does not check that a staff
 * member still has access; `getAdminActor` does that on the server.
 */
export async function readAdminSessionToken(
  token: string | undefined | null,
  now: number = Date.now()
): Promise<{ subject: string } | null> {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  let expiresAtRaw: string, subject: string, sigB64: string
  if (parts.length === 3 && parts[0] === 'v1') {
    ;[, expiresAtRaw, sigB64] = parts
    subject = OWNER_SUBJECT
  } else if (parts.length === 4 && parts[0] === 'v2') {
    ;[, expiresAtRaw, subject, sigB64] = parts
  } else {
    return null
  }
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null

  let key: CryptoKey
  try {
    key = await importKey(getSecret())
  } catch {
    return null
  }

  let sigBytes: ArrayBuffer
  try {
    const u8 = fromBase64Url(sigB64)
    // Copy into a fresh ArrayBuffer so the type matches BufferSource (Uint8Array<ArrayBufferLike>
    // is not directly assignable when the buffer might be SharedArrayBuffer in strict TS).
    sigBytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  } catch {
    return null
  }

  const signed = parts.slice(0, -1).join('.')
  try {
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signed))
    return valid ? { subject } : null
  } catch {
    return null
  }
}

export async function verifyAdminSessionToken(
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  return (await readAdminSessionToken(token, now)) !== null
}

/** Constant-time string equality using Web Crypto verify (Edge-safe). */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
