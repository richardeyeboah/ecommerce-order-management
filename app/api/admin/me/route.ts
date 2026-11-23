import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'

export const dynamic = 'force-dynamic'

/** Who is signed in to the dashboard or Kintampo Manager. */
export async function GET() {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response
  const { actor } = auth
  return NextResponse.json({
    name: actor.name,
    role: actor.kind,
    email: actor.kind === 'owner' ? null : actor.email,
    canManageStaff: actor.canManageStaff,
  })
}
