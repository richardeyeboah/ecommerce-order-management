import { redirect } from 'next/navigation'
import { DeleteAccount } from '@/components/account/DeleteAccount'
import { createClientOptional } from '@/lib/supabase/server'
import { ProfileForm } from './ProfileForm'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const supabase = await createClientOptional()
  if (!supabase) redirect('/login?next=/account/profile&error=configuration')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/account/profile')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()

  return (
    <>
      <p className="section-eyebrow">Settings</p>
      <h1 className="section-title mt-2">Edit profile</h1>
      <p className="section-subtitle mt-2">Update your name and contact details.</p>
      <div className="premium-card mt-8 p-6 sm:p-8">
        <ProfileForm
          userId={user.id}
          initial={{
            full_name: profile?.full_name ?? '',
            phone: profile?.phone ?? '',
            marketing_opt_in: !!profile?.marketing_opt_in,
          }}
        />
      </div>
      <DeleteAccount />
    </>
  )
}
