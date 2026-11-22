import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertSameOrigin } from '@/lib/security/same-origin'

export const runtime = 'nodejs'

/**
 * Permanently deletes the signed-in customer's account (App Store guideline 5.1.1(v)).
 *
 * Auth: the native app sends `Authorization: Bearer <access token>`; the website uses its
 * session cookie (and must pass the same-origin check).
 *
 * What happens to their data is decided by the foreign keys in supabase/*.sql:
 * profile, wishlist and saved addresses are deleted with the user (on delete cascade);
 * orders keep their rows for the store's tax and refund records but lose the link to the
 * account (on delete set null). Unpaid checkout snapshots have no foreign key, so they are
 * removed here.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''

  let userId: string | null = null
  if (bearer) {
    const { data } = await supabaseAdmin.auth.getUser(bearer)
    userId = data.user?.id ?? null
  } else {
    const originCheck = assertSameOrigin(req)
    if (!originCheck.ok) return originCheck.response
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) {
    return NextResponse.json({ error: 'Please sign in again, then delete your account.' }, { status: 401 })
  }

  // Staff accounts run the store; removing one by accident would lock the owner out.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (profile?.role === 'admin') {
    return NextResponse.json(
      { error: 'Store staff accounts are removed by the store owner, not from here.' },
      { status: 403 }
    )
  }

  const { error: snapshotError } = await supabaseAdmin
    .from('checkout_snapshots')
    .delete()
    .eq('user_id', userId)
  if (snapshotError && !/does not exist|could not find the table/i.test(snapshotError.message)) {
    console.error('[account/delete] snapshots', snapshotError.message)
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (error) {
    console.error('[account/delete]', error.message)
    return NextResponse.json({ error: 'Could not delete the account. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
