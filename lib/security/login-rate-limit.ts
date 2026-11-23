import { Redis } from '@upstash/redis'

const WINDOW_SEC = 15 * 60
const MAX_FAILURES = 5
const REDIS_KEY_PREFIX = 'lq:admin-login-fail:'

function isTruthyEnv(name: string | undefined): boolean {
  const v = name?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Admin login lockouts are enabled by default. The disable flag is accepted
 * only outside production for local troubleshooting.
 */
export function isAdminLoginRateLimitDisabled(): boolean {
  if (isTruthyEnv(process.env.ADMIN_ENFORCE_LOGIN_RATE_LIMIT)) return false
  if (
    process.env.NODE_ENV !== 'production' &&
    isTruthyEnv(process.env.ADMIN_DISABLE_LOGIN_RATE_LIMIT)
  ) return true
  return false
}

interface RateEntry {
  count: number
  resetAt: number
}

const memoryAttempts = new Map<string, RateEntry>()

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  return new Redis({ url, token })
}

let redisClient: Redis | null | undefined

function redis(): Redis | null {
  if (redisClient === undefined) {
    redisClient = getRedis()
  }
  return redisClient
}

export function isDistributedLoginRateLimitEnabled(): boolean {
  return redis() !== null
}

/** Returns true when the client may attempt a login (not locked out). */
export async function isLoginAllowed(clientKey: string): Promise<{
  allowed: boolean
  retryAfterSecs: number
}> {
  if (isAdminLoginRateLimitDisabled()) {
    return { allowed: true, retryAfterSecs: 0 }
  }

  const r = redis()
  if (r) {
    const count = Number(await r.get(`${REDIS_KEY_PREFIX}${clientKey}`)) || 0
    if (count >= MAX_FAILURES) {
      const ttl = await r.ttl(`${REDIS_KEY_PREFIX}${clientKey}`)
      return { allowed: false, retryAfterSecs: Math.max(ttl, 1) }
    }
    return { allowed: true, retryAfterSecs: 0 }
  }

  const now = Date.now()
  const entry = memoryAttempts.get(clientKey)
  if (!entry || now > entry.resetAt) {
    return { allowed: true, retryAfterSecs: 0 }
  }
  if (entry.count >= MAX_FAILURES) {
    return { allowed: false, retryAfterSecs: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSecs: 0 }
}

/** Record a failed password attempt. */
export async function recordFailedLogin(clientKey: string): Promise<void> {
  if (isAdminLoginRateLimitDisabled()) return

  const r = redis()
  if (r) {
    const key = `${REDIS_KEY_PREFIX}${clientKey}`
    const count = await r.incr(key)
    if (count === 1) {
      await r.expire(key, WINDOW_SEC)
    }
    return
  }

  const now = Date.now()
  const entry = memoryAttempts.get(clientKey)
  if (!entry || now > entry.resetAt) {
    memoryAttempts.set(clientKey, { count: 1, resetAt: now + WINDOW_SEC * 1000 })
    return
  }
  entry.count += 1
}

/** Clear failures after a successful login. */
export async function clearLoginFailures(clientKey: string): Promise<void> {
  const r = redis()
  if (r) {
    await r.del(`${REDIS_KEY_PREFIX}${clientKey}`)
    return
  }
  memoryAttempts.delete(clientKey)
}
