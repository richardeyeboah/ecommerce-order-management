import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { getSupabasePublicConfig } from '@/lib/supabase/config'

export const runtime = 'nodejs'

/**
 * Called from the checkout success page once a payment is confirmed.
 * Persists the customer's phone (on profile) and shipping address (in addresses)
 * so future checkouts can pre-fill without re-typing.
 *
 * - Phone is only written if profile.phone is empty.
 * - Address is upserted: if an identical line1+city+postal already exists
 *   we leave it alone, otherwise we insert a new one. The first address
 *   ever saved is set as default automatically.
 */
export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  let user: { id: string; email?: string | null } | null = null
  if (bearer) {
    const { url, anonKey, configured } = getSupabasePublicConfig()
    if (configured && url && anonKey) {
      const client = createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data } = await client.auth.getUser(bearer)
      user = data.user
    }
  } else {
    const supabase = await createClient()
    const result = await supabase.auth.getUser()
    user = result.data.user
  }
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: {
    fullName?: string
    phone?: string
    line1?: string
    line2?: string
    city?: string
    state?: string
    country?: string
    postalCode?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  const fullName = (body.fullName ?? '').trim().slice(0, 120)
  const phone = (body.phone ?? '').trim().slice(0, 32)
  const line1 = (body.line1 ?? '').trim().slice(0, 200)
  const line2 = (body.line2 ?? '').trim().slice(0, 200)
  const city = (body.city ?? '').trim().slice(0, 80)
  const state = (body.state ?? '').trim().slice(0, 80)
  const country = (body.country ?? '').trim().slice(0, 80) || 'United States'
  const postalCode = (body.postalCode ?? '').trim().slice(0, 20)

  // 1. Profile: only fill blanks — never overwrite what the user already set.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, phone')
    .eq('id', user.id)
    .maybeSingle()

  const profileUpdate: { full_name?: string; phone?: string } = {}
  if (!profile?.full_name?.trim() && fullName) profileUpdate.full_name = fullName
  if (!profile?.phone?.trim() && phone) profileUpdate.phone = phone

  if (Object.keys(profileUpdate).length > 0) {
    await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', user.id)
  }

  // 2. Address: skip if exact match exists; insert otherwise.
  if (line1 && city) {
    const { data: existing } = await supabaseAdmin
      .from('addresses')
      .select('id, is_default')
      .eq('user_id', user.id)
      .ilike('line1', line1)
      .ilike('city', city)
      .ilike('postal_code', postalCode || '%')
      .maybeSingle()

    if (!existing) {
      const { count } = await supabaseAdmin
        .from('addresses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      const isFirst = !count || count === 0
      await supabaseAdmin.from('addresses').insert({
        user_id: user.id,
        label: null,
        full_name: fullName || user.email?.split('@')[0] || 'Customer',
        phone: phone || null,
        line1,
        line2: line2 || null,
        city,
        state: state || null,
        country,
        postal_code: postalCode || null,
        is_default: isFirst,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
