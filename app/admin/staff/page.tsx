import { requireAdminPage } from '@/lib/auth/require-admin-page'
import { getAdminActor } from '@/lib/auth/admin-actor'
import { listStaffMembers, type StaffMember } from '@/lib/auth/staff-members'
import { StaffManager } from '@/components/admin/StaffManager'

export const metadata = { title: 'Staff' }

export default async function AdminStaffPage() {
  await requireAdminPage()
  const actor = await getAdminActor()

  let staff: StaffMember[] = []
  let loadError: string | null = null
  try {
    staff = await listStaffMembers()
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Could not load staff.'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Staff</h1>
        <p className="mt-1 text-sm text-earth-500">
          Each person signs in with their own store account. Order history shows who made each change.
          {actor ? ` Signed in as ${actor.name}.` : ''}
        </p>
      </div>
      <StaffManager
        initialStaff={staff}
        canManage={actor?.canManageStaff ?? false}
        currentUserId={actor?.id ?? null}
        loadError={loadError}
      />
    </div>
  )
}
