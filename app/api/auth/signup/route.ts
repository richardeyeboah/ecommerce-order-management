import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isPasswordAcceptableForSignup } from '@/lib/auth/password-strength'
import { sendTransactionalEmail } from '@/lib/email/send-order-emails'
import { CANONICAL_SITE_URL, getPublicSiteUrl } from '@/lib/site-url'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Welcome note after a new account. Best effort: signup succeeds even if email is down. */
async function sendWelcomeEmail(email: string, firstName: string): Promise<void> {
  const origin = getPublicSiteUrl()
  const site = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? CANONICAL_SITE_URL : origin
  const shop = `${site}/shop`
  const sent = await sendTransactionalEmail({
    to: email,
    subject: 'Welcome to Kintampo African Market',
    text: [
      `Hi ${firstName},`,
      '',
      'Your Kintampo African Market account is ready.',
      'Order online for free pickup in Columbus, or get it shipped (free on orders $120+).',
      'Track orders, save items and check out faster when you sign in.',
      '',
      `Start shopping: ${shop}`,
    ].join('\n'),
    html: `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1c1917;max-width:480px;margin:0 auto;padding:24px;">
  <p style="margin:0 0 16px;font-size:16px;font-weight:600;">Welcome, ${escapeHtml(firstName)}</p>
  <p style="margin:0 0 12px;font-size:14px;color:#57534e;">Your Kintampo African Market account is ready.</p>
  <p style="margin:0 0 20px;font-size:14px;color:#57534e;">Order online for free pickup in Columbus, or get it shipped (free on orders $120+). Sign in to track orders, save items and check out faster.</p>
  <p style="margin:0 0 24px;">
    <a href="${shop}" style="display:inline-block;background:#CE1126;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px;">Start shopping</a>
  </p>
  <p style="margin:0;font-size:12px;color:#78716c;">You're receiving this because an account was created with this email.</p>
</body></html>`,
  })
  if (!sent) console.warn('[auth/signup] welcome email not sent')
}

export const runtime = 'nodejs'

type Body = {
  email?: string
  password?: string
  firstName?: string
  lastName?: string
  phone?: string
  marketingOptIn?: boolean
  termsAccepted?: boolean
}

function isValidOptionalPhone(phone: string): boolean {
  if (!phone) return true
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  // Paginate lightly — grocery store volume is small; stop early on match.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === normalized)
    if (hit) return hit.id
    if (data.users.length < 200) break
  }
  return null
}

/**
 * Create a store account that can sign in immediately — no email confirmation step.
 * If an unconfirmed leftover account exists for the same email, refresh password and confirm it
 * so "sign up again" works instead of trapping the customer in a confirm loop.
 */
export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  const firstName = body.firstName?.trim() ?? ''
  const lastName = body.lastName?.trim() ?? ''
  const phone = body.phone?.trim() ?? ''
  const marketingOptIn = Boolean(body.marketingOptIn)
  const termsAccepted = Boolean(body.termsAccepted)

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 })
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'Enter your first and last name.' }, { status: 400 })
  }
  if (!termsAccepted) {
    return NextResponse.json({ error: 'Please accept the Terms and Privacy Policy.' }, { status: 400 })
  }
  if (!isValidOptionalPhone(phone)) {
    return NextResponse.json(
      { error: 'Enter a valid phone number, or leave it blank.' },
      { status: 400 }
    )
  }
  if (!isPasswordAcceptableForSignup(password)) {
    return NextResponse.json(
      { error: 'Use a stronger password (8+ chars, upper, lower, number, special).' },
      { status: 400 }
    )
  }

  const fullName = `${firstName} ${lastName}`.trim()
  const userMeta = {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    phone: phone || null,
    marketing_opt_in: marketingOptIn,
    terms_accepted_at: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMeta,
    })

    if (!error && data.user) {
      await sendWelcomeEmail(email, firstName).catch((e) => console.error('[auth/signup] welcome', e))
      return NextResponse.json({ ok: true })
    }

    const msg = (error?.message ?? '').toLowerCase()
    const already =
      msg.includes('already') || msg.includes('registered') || msg.includes('exists')

    if (!already) {
      console.error('[auth/signup] createUser', error?.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    const existingId = await findUserIdByEmail(email)
    if (!existingId) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Sign in or reset your password.' },
        { status: 409 }
      )
    }

    const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(existingId)
    if (getErr || !existing.user) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Sign in or reset your password.' },
        { status: 409 }
      )
    }

    // Confirmed account → ask them to sign in (do not overwrite password).
    if (existing.user.email_confirmed_at) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Sign in or reset your password.' },
        { status: 409 }
      )
    }

    // Unconfirmed leftover — confirm + set the password they just chose so they can continue.
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      user_metadata: userMeta,
    })
    if (updateErr) {
      console.error('[auth/signup] updateUser', updateErr.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, recovered: true })
  } catch (e) {
    console.error('[auth/signup]', e)
    return NextResponse.json({ error: 'Sign-up is temporarily unavailable.' }, { status: 503 })
  }
}
