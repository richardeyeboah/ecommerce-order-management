import { cookies } from 'next/headers'
import { ADMIN_COOKIE_NAME, OWNER_SUBJECT, readAdminSessionToken } from '@/lib/auth/admin-session'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** Profile roles that can open the store dashboard and Kintampo Manager. */
export const STAFF_ROLES = ['staff', 'admin'] as const

/**
 * Who is behind an admin session.
 * - owner: signed in with the shared store password (ADMIN_PASSWORD).
 * - staff / admin: signed in with their own account (profiles.role).
 * Owners and admins can add and remove staff; staff can do everything else.
 */
export type AdminActor =
  | { kind: 'owner'; id: null; name: string; canManageStaff: true }
  | { kind: 'staff' | 'admin'; id: string; name: string; email: string | null; canManageStaff: boolean }

export const OWNER_ACTOR: AdminActor = {
  kind: 'owner',
  id: null,
  name: 'Owner',
  canManageStaff: true,
}

/** Short text for `order_status_logs.changed_by` and similar "who did it" columns. */
export function actorLabel(actor: AdminActor | null | undefined): string {
  if (!actor) return 'admin'
  return actor.kind === 'owner' ? 'owner' : actor.name.slice(0, 80)
}

/**
 * Looks up a staff account. Runs on every admin request, so removing someone's staff role
 * locks them out at once instead of when their 8-hour cookie runs out.
 */
export async function loadStaffActor(userId: string): Promise<AdminActor | null> {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .maybeSingle()
  if (error || !profile) return null
  const role = profile.role as string
  if (role !== 'staff' && role !== 'admin') return null

  let email: string | null = null
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    email = data.user?.email ?? null
  } catch {
    /* name falls back below */
  }
  const name = (profile.full_name as string | null)?.trim() || email || 'Staff member'
  return { kind: role, id: userId, name, email, canManageStaff: role === 'admin' }
}

/** The signed-in admin for this request, or null (no cookie, expired, or access removed). */
export async function getAdminActor(): Promise<AdminActor | null> {
  const cookieStore = await cookies()
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value)
  if (!session) return null
  if (session.subject === OWNER_SUBJECT) return OWNER_ACTOR
  return loadStaffActor(session.subject)
}
