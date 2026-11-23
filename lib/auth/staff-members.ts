import { supabaseAdmin } from '@/lib/supabase-admin'

export type StaffMember = {
  id: string
  name: string | null
  email: string | null
  role: 'staff' | 'admin'
  addedAt: string | null
}

/** Everyone with a staff or admin role, admins first, then by name. */
export async function listStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, created_at')
    .in('role', ['staff', 'admin'])
  if (error) throw new Error(error.message)

  const members = await Promise.all(
    (data ?? []).map(async (row) => {
      let email: string | null = null
      try {
        const { data: user } = await supabaseAdmin.auth.admin.getUserById(row.id as string)
        email = user.user?.email ?? null
      } catch {
        /* show without email */
      }
      return {
        id: row.id as string,
        name: (row.full_name as string | null)?.trim() || null,
        email,
        role: row.role as 'staff' | 'admin',
        addedAt: (row.created_at as string | null) ?? null,
      }
    })
  )
  return members.sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) ||
      (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '')
  )
}

/** Finds a customer account by email (staff sign in with a normal store account). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < 200) return null
  }
  return null
}

/** Sets a profile's role. The service role bypasses the protect_profiles_role trigger. */
export async function setProfileRole(userId: string, role: 'customer' | 'staff'): Promise<void> {
  const { error } = await supabaseAdmin.from('profiles').update({ role }).eq('id', userId)
  if (error) {
    if (/check constraint|violates/i.test(error.message)) {
      throw new Error(
        'The database needs the staff-accounts update first (supabase/migrations/20261123120000_staff_accounts.sql).'
      )
    }
    throw new Error(error.message)
  }
}
