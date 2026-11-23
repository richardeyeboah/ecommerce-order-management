import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { loadStaffActor } from '@/lib/auth/admin-actor'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { isSupabaseAdminRoleBypassEnabled } from '@/lib/auth/admin-access-mode'
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  constantTimeEquals,
  createAdminSessionToken,
} from '@/lib/auth/admin-session'
import {
  clearLoginFailures,
  isAdminLoginRateLimitDisabled,
  isLoginAllowed,
  recordFailedLogin,
} from '@/lib/security/login-rate-limit'
import { assertSameOrigin } from '@/lib/security/same-origin'

export const runtime = 'nodejs'

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function warnProductionMisconfig() {
  if (process.env.NODE_ENV !== 'production') return

  if (!process.env.ADMIN_SESSION_SECRET?.trim()) {
    console.warn(
      '[admin-login] ADMIN_SESSION_SECRET is not set — session cookies are signed with ADMIN_PASSWORD. Set a dedicated secret in production.'
    )
  }

  if (isSupabaseAdminRoleBypassEnabled()) {
    console.warn(
      '[admin-login] ADMIN_ALLOW_SUPABASE_ROLE=1 is enabled in production — password cookie is not required for Supabase admin profiles.'
    )
  }
}

export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  warnProductionMisconfig()

  const ip = getClientIp(req)

  if (process.env.NODE_ENV === 'production' && !isAdminLoginRateLimitDisabled()) {
    const { allowed, retryAfterSecs } = await isLoginAllowed(ip)
    if (!allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${Math.ceil(retryAfterSecs / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(retryAfterSecs) } }
      )
    }
  }

  let body: { email?: unknown; password?: unknown }
  try {
    body = (await req.json()) ?? {}
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const rateLimited = process.env.NODE_ENV === 'production' && !isAdminLoginRateLimitDisabled()
  const supplied = typeof body.password === 'string' ? body.password.trim().normalize('NFKC') : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Staff account: their own email and password, and profiles.role of staff or admin.
  if (email) {
    const staff = await signInStaff(email, typeof body.password === 'string' ? body.password : '')
    if (!staff.ok) {
      if (rateLimited) await recordFailedLogin(ip)
      return NextResponse.json({ error: staff.error }, { status: 401 })
    }
    await clearLoginFailures(ip)
    const { token } = await createAdminSessionToken(Date.now(), staff.userId)
    return withSessionCookie(NextResponse.json({ success: true, name: staff.name, role: staff.role }), token)
  }

  // Store password (ADMIN_PASSWORD): the owner's shared login.
  const expected = process.env.ADMIN_PASSWORD?.trim()
  if (!expected) {
    console.error('[admin-login] ADMIN_PASSWORD is not configured.')
    return NextResponse.json({ error: 'Admin login is not configured.' }, { status: 503 })
  }
  const expectedNorm = expected.normalize('NFKC')

  if (supplied.length === 0 || !constantTimeEquals(supplied, expectedNorm)) {
    if (rateLimited) {
      await recordFailedLogin(ip)
    } else {
      const maskedSupplied =
        supplied.length === 0
          ? '(empty)'
          : `${supplied[0]}…${supplied[supplied.length - 1]} len=${supplied.length}`
      const maskedExpected = `${expectedNorm[0]}…${expectedNorm[expectedNorm.length - 1]} len=${expectedNorm.length}`
      console.warn(
        `[admin-login] FAIL ip=${ip} supplied=${maskedSupplied} expected=${maskedExpected}`
      )
    }
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
  }

  await clearLoginFailures(ip)

  const { token } = await createAdminSessionToken()
  return withSessionCookie(NextResponse.json({ success: true, name: 'Owner', role: 'owner' }), token)
}

function withSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: '/',
  })
  return res
}

/** Checks the password with Supabase Auth, then that the account has a staff role. */
async function signInStaff(
  email: string,
  password: string
): Promise<{ ok: true; userId: string; name: string; role: string } | { ok: false; error: string }> {
  const { url, anonKey, configured } = getSupabasePublicConfig()
  if (!configured || !password) return { ok: false, error: 'Wrong email or password.' }
  const client = createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return { ok: false, error: 'Wrong email or password.' }
  // Only needed to prove the password; the admin cookie is the session from here on.
  await client.auth.signOut().catch(() => {})

  const actor = await loadStaffActor(data.user.id)
  if (!actor || actor.kind === 'owner') {
    return {
      ok: false,
      error: 'This account is not a staff account. Ask the owner to add you under Staff.',
    }
  }
  return { ok: true, userId: data.user.id, name: actor.name, role: actor.kind }
}
