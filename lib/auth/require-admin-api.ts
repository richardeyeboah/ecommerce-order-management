import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_COOKIE_NAME, readAdminSessionToken } from '@/lib/auth/admin-session'
import { OWNER_ACTOR, loadStaffActor, type AdminActor } from '@/lib/auth/admin-actor'
import { isSupabaseAdminRoleBypassEnabled } from '@/lib/auth/admin-access-mode'

/**
 * `/api/admin/*` guard — matches `proxy.ts` + `requireAdminPage` policy.
 * Returns who is signed in so routes can record it (order history "changed by").
 * Staff sessions are re-checked against `profiles.role`, so removed staff are locked out at once.
 */
export async function requireAdminApi(): Promise<
  { ok: true; actor: AdminActor } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies()
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value)
  if (session) {
    if (session.subject === 'owner') return { ok: true, actor: OWNER_ACTOR }
    const actor = await loadStaffActor(session.subject)
    if (actor) return { ok: true, actor }
    return {
      ok: false,
      response: NextResponse.json({ error: 'Your staff access was removed.' }, { status: 401 }),
    }
  }

  if (!isSupabaseAdminRoleBypassEnabled()) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[requireAdminApi] profiles:', error.message)
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) }
  }

  if (profile?.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) }
  }

  return {
    ok: true,
    actor: { kind: 'admin', id: user.id, name: user.email ?? 'Admin', email: user.email ?? null, canManageStaff: true },
  }
}
