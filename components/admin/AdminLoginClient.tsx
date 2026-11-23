'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Eye, EyeOff, Lock, PackageCheck, ShoppingBag } from 'lucide-react'
import { createClient, isSupabaseBrowserConfigured } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AdminLoginClient({
  allowSupabaseAdmin,
  forbidden,
  devMode = false,
  adminPasswordConfigured = true,
  adminSecretConfigured = true,
}: {
  allowSupabaseAdmin: boolean
  forbidden: boolean
  devMode?: boolean
  adminPasswordConfigured?: boolean
  adminSecretConfigured?: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [showStaffPassword, setShowStaffPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [mode, setMode] = useState<'account' | 'staff' | 'supabase'>('account')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rateLimited, setRateLimited] = useState(false)

  async function handleDevBypass() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/dev-login', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (res.ok) {
      // Hard navigation so the browser sends a fresh request with the new cookie.
      // router.push does a soft client-side nav that often races the Set-Cookie.
      window.location.assign('/admin')
      return
    }
    setLoading(false)
    setError('Dev bypass is disabled in production.')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      try {
        setCapsLock(e.getModifierState('CapsLock'))
      } catch {
        /* ignore older browsers */
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  async function handleSupabase(e: React.FormEvent) {
    e.preventDefault()
    if (!isSupabaseBrowserConfigured()) {
      setError('Admin sign-in is temporarily unavailable.')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error: signError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (signError) {
      setLoading(false)
      setError(signError.message)
      return
    }
    // Hard navigation so the new Supabase session cookies are visible to the proxy.
    window.location.assign('/admin')
  }

  async function handleAccount(e: React.FormEvent) {
    e.preventDefault()
    await postLogin({ email: email.trim(), password })
  }

  async function handleStaffPassword(e: React.FormEvent) {
    e.preventDefault()
    await postLogin({ password: staffPassword })
  }

  async function postLogin(payload: { email?: string; password: string }) {
    setLoading(true)
    setError('')
    setRateLimited(false)
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      // Hard navigation guarantees the freshly-set admin_session cookie is sent
      // with the next request. router.push does a soft client-side nav that
      // sometimes raced the Set-Cookie header on the previous response, which
      // is why "press Enter, nothing happens, then reload works".
      window.location.assign('/admin')
      return
    }
    setLoading(false)

    const data = await res.json().catch(() => ({}))
    if (res.status === 429) {
      setRateLimited(true)
      setError(
        typeof data.error === 'string'
          ? data.error
          : 'Too many login attempts. Try again later.'
      )
      return
    }
    if (res.status === 503) {
      setError(
        typeof data.error === 'string'
          ? data.error
          : 'Admin login is not configured on this deployment.'
      )
      return
    }
    setError(typeof data.error === 'string' ? data.error : 'Wrong email or password.')
  }

  return (
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-slate-800/60" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-slate-950">
              K
            </span>
            <div>
              <p className="text-sm font-semibold">Kintampo</p>
              <p className="text-xs text-slate-400">Seller Center</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operations workspace</p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.045em] xl:text-5xl">
            Run the store from one place.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-slate-400">
            Process orders, manage inventory, print shipping labels, and track store performance.
          </p>
          <ul className="mt-10 grid gap-3 text-sm text-slate-300">
            <li className="flex items-center gap-3">
              <ShoppingBag className="h-4 w-4 text-slate-500" aria-hidden />
              Order and fulfillment workflows
            </li>
            <li className="flex items-center gap-3">
              <PackageCheck className="h-4 w-4 text-slate-500" aria-hidden />
              Inventory and catalog controls
            </li>
            <li className="flex items-center gap-3">
              <BarChart3 className="h-4 w-4 text-slate-500" aria-hidden />
              Sales and product reporting
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">Private staff access · Kintampo African Market</p>
      </aside>

      <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-500 no-underline transition-colors hover:text-slate-950"
          >
            ← Back to store
          </Link>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgb(15_23_42/0.08)] sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Lock className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-slate-950">
              Sign in to Seller Center
            </h1>
            <p className="mt-1 text-sm text-earth-600">
              Use your staff account, or the store password if you&apos;re the owner.
            </p>

            {forbidden && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                <span>
                  {allowSupabaseAdmin
                    ? 'Access denied. Enter the correct staff password or use an authorized Supabase admin account.'
                    : 'Access denied. Staff password only — sign in below.'}
                </span>
              </div>
            )}

            {devMode && (
              <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden />
                  <div className="space-y-1">
                    <p className="font-semibold">Dev mode bypass</p>
                    <p className="text-xs leading-snug text-amber-800">
                      You&apos;re on <code className="rounded bg-amber-100 px-1">localhost</code>.
                      Click below to sign in without typing the password.
                      <br />
                      <code className="rounded bg-amber-100 px-1">ADMIN_PASSWORD</code>{' '}
                      {adminPasswordConfigured ? '✓ set' : '✗ NOT set in .env.local'} ·{' '}
                      <code className="rounded bg-amber-100 px-1">ADMIN_SESSION_SECRET</code>{' '}
                      {adminSecretConfigured ? '✓ set' : '✗ NOT set in .env.local'}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-400 bg-white"
                  onClick={() => void handleDevBypass()}
                  disabled={loading}
                >
                  {loading ? 'Signing in…' : 'Skip password & enter admin (dev only)'}
                </Button>
                <p className="text-[11px] leading-snug text-amber-700">
                  This button is hidden in production. On Vercel, set{' '}
                  <code className="rounded bg-amber-100 px-1">ADMIN_PASSWORD</code> in Environment
                  Variables and redeploy.
                </p>
              </div>
            )}

            <div
              className="mt-5 flex gap-1 rounded-lg border border-earth-200 bg-earth-50 p-1 text-sm"
              role="radiogroup"
              aria-label="Sign-in method"
            >
              {(
                [
                  ['account', 'Staff account'],
                  ['staff', 'Store password'],
                  ...(allowSupabaseAdmin ? ([['supabase', 'Supabase admin']] as const) : []),
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-center transition-colors duration-150 data-[active=true]:bg-white data-[active=true]:font-semibold data-[active=true]:shadow-sm"
                  data-active={mode === value}
                >
                  <input
                    type="radio"
                    name="admin-sign-in-method"
                    className="sr-only"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value)
                      setError('')
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>

            {mode === 'account' ? (
              <form onSubmit={handleAccount} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="staff-email" className="form-label">
                    Email
                  </label>
                  <Input
                    id="staff-email"
                    type="email"
                    autoComplete="username"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="staff-account-pass" className="form-label">
                    Password
                  </label>
                  <Input
                    id="staff-account-pass"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="text-xs text-earth-500">
                    The same email and password you use to shop on the website.
                  </p>
                </div>
                {error && (
                  <div
                    className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                      rateLimited ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
                    }`}
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
                <p className="text-xs text-earth-500">
                  New staff: the owner adds you under Staff in the dashboard.
                </p>
              </form>
            ) : allowSupabaseAdmin && mode === 'supabase' ? (
              <form onSubmit={handleSupabase} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="admin-email" className="form-label">
                    Email
                  </label>
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="admin-pass" className="form-label">
                    Password
                  </label>
                  <Input
                    id="admin-pass"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm font-medium text-red-700" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleStaffPassword} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="staff-pass" className="form-label">
                    Staff password
                  </label>
                  <div className="relative">
                    <Input
                      id="staff-pass"
                      type={showStaffPassword ? 'text' : 'password'}
                      autoComplete="off"
                      required
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      className="pr-10"
                      spellCheck={false}
                      autoCapitalize="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowStaffPassword((v) => !v)}
                      className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-earth-500 transition-colors hover:bg-earth-100 hover:text-earth-700"
                      aria-label={showStaffPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showStaffPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                  {capsLock && (
                    <p className="flex items-center gap-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Caps Lock is on
                    </p>
                  )}
                </div>

                {error && (
                  <div
                    className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                      rateLimited
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-red-50 text-red-700'
                    }`}
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>

                <details className="text-xs text-earth-500">
                  <summary className="cursor-pointer font-medium hover:text-earth-700">
                    Can&apos;t sign in?
                  </summary>
                  <ul className="mt-2 space-y-1.5 pl-1">
                    <li>• Passwords are case-sensitive.</li>
                    <li>• After 5 failed attempts, wait 15 minutes and try again.</li>
                    <li>• Contact the store owner to reset access.</li>
                  </ul>
                </details>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
