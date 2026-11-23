import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { findUserIdByEmail, listStaffMembers, setProfileRole } from '@/lib/auth/staff-members'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Staff list. Anyone signed in may see it; only the owner and admins may change it. */
export async function GET() {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response
  try {
    const staff = await listStaffMembers()
    return NextResponse.json({ staff, canManageStaff: auth.actor.canManageStaff })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load staff.' }, { status: 500 })
  }
}

/** Adds a staff member by the email of their store account. */
export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response
  if (!auth.actor.canManageStaff) {
    return NextResponse.json({ error: 'Only the owner can add staff.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 })
  }

  try {
    const userId = await findUserIdByEmail(email)
    if (!userId) {
      return NextResponse.json(
        {
          error:
            'No store account uses that email. Ask them to create an account on the website or in the Kintampo app first, then add them here.',
        },
        { status: 404 }
      )
    }
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (profile?.role === 'admin' || profile?.role === 'staff') {
      return NextResponse.json({ error: 'They are already on the staff list.' }, { status: 409 })
    }
    await setProfileRole(userId, 'staff')
    return NextResponse.json({ ok: true, staff: await listStaffMembers() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not add staff.' }, { status: 500 })
  }
}
