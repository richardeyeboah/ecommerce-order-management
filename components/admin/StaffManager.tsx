'use client'

import { useState } from 'react'
import { UserMinus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { StaffMember } from '@/lib/auth/staff-members'

export function StaffManager({
  initialStaff,
  canManage,
  currentUserId,
  loadError,
}: {
  initialStaff: StaffMember[]
  canManage: boolean
  currentUserId: string | null
  loadError: string | null
}) {
  const [staff, setStaff] = useState(initialStaff)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(loadError ?? '')
  const [notice, setNotice] = useState('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy('add')
    setError('')
    setNotice('')
    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not add staff.')
      return
    }
    setStaff(data.staff)
    setNotice(`${email} can now sign in to the dashboard and Kintampo Manager with their own password.`)
    setEmail('')
  }

  async function remove(member: StaffMember) {
    const who = member.name ?? member.email ?? 'this person'
    if (!window.confirm(`Remove staff access for ${who}? They keep their customer account.`)) return
    setBusy(member.id)
    setError('')
    setNotice('')
    const res = await fetch(`/api/admin/staff/${member.id}`, { method: 'DELETE', credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Could not remove staff.')
      return
    }
    setStaff(data.staff)
    setNotice(`${who} no longer has staff access.`)
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <form onSubmit={add} className="admin-card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="staff-add-email" className="form-label">
              Add staff by email
            </label>
            <Input
              id="staff-add-email"
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-earth-500">
              They need a store account with this email first (website sign-up or the Kintampo app).
            </p>
          </div>
          <Button type="submit" size="lg" disabled={busy !== null} className="sm:mb-6">
            <UserPlus className="h-4 w-4" aria-hidden />
            {busy === 'add' ? 'Adding…' : 'Add staff'}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-earth-600">Only the owner can add or remove staff.</p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Access</th>
              {canManage && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="text-earth-500">
                  No staff accounts yet. Everyone is using the store password.
                </td>
              </tr>
            ) : (
              staff.map((member) => (
                <tr key={member.id}>
                  <td className="font-medium text-earth-900">
                    {member.name ?? '—'}
                    {member.id === currentUserId && <span className="ml-2 text-xs text-earth-500">(you)</span>}
                  </td>
                  <td className="text-earth-600">{member.email ?? '—'}</td>
                  <td>
                    <span
                      className={`admin-status-pill ${
                        member.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'
                      }`}
                    >
                      {member.role === 'admin' ? 'Admin' : 'Staff'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="text-right">
                      {member.role === 'staff' && member.id !== currentUserId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void remove(member)}
                          disabled={busy !== null}
                        >
                          <UserMinus className="h-4 w-4" aria-hidden />
                          {busy === member.id ? 'Removing…' : 'Remove'}
                        </Button>
                      ) : (
                        <span className="text-xs text-earth-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
