import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { listStaffMembers, setProfileRole } from '@/lib/auth/staff-members'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Removes staff access (role back to customer). Takes effect on their next request,
 * on the website and in Kintampo Manager. Admin accounts are changed in Supabase only.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response
  if (!auth.actor.canManageStaff) {
    return NextResponse.json({ error: 'Only the owner can remove staff.' }, { status: 403 })
  }

  const { id } = await params
  if (auth.actor.id === id) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 })
  }
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', id).maybeSingle()
  if (profile?.role !== 'staff') {
    return NextResponse.json(
      { error: profile?.role === 'admin' ? 'Admin accounts are changed in Supabase.' : 'Not on the staff list.' },
      { status: 400 }
    )
  }

  try {
    await setProfileRole(id, 'customer')
    return NextResponse.json({ ok: true, staff: await listStaffMembers() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not remove staff.' }, { status: 500 })
  }
}
