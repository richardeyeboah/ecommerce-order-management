'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ChevronRight,
  ExternalLink,
  Home,
  LogOut,
  Menu,
  Megaphone,
  MessageSquareText,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Truck,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [{ href: '/admin', label: 'Overview', icon: Home, exact: true }],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/orders?queue=needs_action', label: 'Orders', icon: ShoppingBag },
      { href: '/admin/products', label: 'Products', icon: Package },
      { href: '/admin/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Store management',
    items: [
      { href: '/admin/shipping', label: 'Shipping', icon: Truck },
      { href: '/admin/reviews', label: 'Reviews', icon: MessageSquareText },
      { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/admin/staff', label: 'Staff', icon: UserCog },
    ],
  },
] as const

const PAGE_NAMES: Array<[string, string]> = [
  ['/admin/products/new', 'Add product'],
  ['/admin/products/descriptions', 'Product descriptions'],
  ['/admin/products/', 'Edit product'],
  ['/admin/orders/', 'Order details'],
  ['/admin/customers/', 'Customer details'],
  ['/admin/orders', 'Orders'],
  ['/admin/products', 'Products'],
  ['/admin/customers', 'Customers'],
  ['/admin/shipping', 'Shipping'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/announcements', 'Announcements'],
  ['/admin/staff', 'Staff'],
  ['/admin', 'Overview'],
]

function isActive(pathname: string, href: string, exact?: boolean) {
  const pathOnly = href.split('?')[0]
  return exact ? pathname === pathOnly : pathname === pathOnly || pathname.startsWith(`${pathOnly}/`)
}

function pageName(pathname: string) {
  return PAGE_NAMES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Seller Center'
}

function AdminNav({ pathname }: { pathname: string }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-3 py-5">
      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.label} className={groupIndex === 0 ? '' : 'mt-6'}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {group.label}
          </p>
          <nav className="space-y-1" aria-label={group.label}>
            {group.items.map(({ href, label, icon: Icon, ...rest }) => {
              const exact = 'exact' in rest ? rest.exact : false
              const active = isActive(pathname, href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'group flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium no-underline transition-colors duration-150',
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  )}
                >
                  <Icon
                    className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-white' : 'text-slate-400 group-hover:text-slate-700')}
                    strokeWidth={active ? 2 : 1.75}
                    aria-hidden
                  />
                  <span className="flex-1">{label}</span>
                  {active && <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
                </Link>
              )
            })}
          </nav>
        </div>
      ))}
    </div>
  )
}

export function AdminSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  useEffect(() => setOpen(false), [pathname, searchParams])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (pathname === '/admin/login') return null

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    window.location.href = '/admin/login'
  }

  const currentPage = pageName(pathname)

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-slate-100 px-5">
          <Link href="/admin" className="flex items-center gap-3 no-underline">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">
              K
            </span>
            <span>
              <span className="block text-[13px] font-semibold leading-4 text-slate-950">Kintampo</span>
              <span className="block text-[11px] font-medium leading-4 text-slate-400">Seller Center</span>
            </span>
          </Link>
        </div>

        <AdminNav pathname={pathname} />

        <div className="shrink-0 border-t border-slate-100 p-3">
          <Link
            href="/admin/products/fabrics/new"
            className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 no-underline transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add fabric / lace
          </Link>
          <Link
            href="/admin/products/new"
            className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-[13px] font-semibold text-white no-underline transition-colors duration-150 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add product
          </Link>
          <div className="grid grid-cols-2 gap-1">
            <Link
              href="/"
              target="_blank"
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-slate-500 no-underline hover:bg-slate-100 hover:text-slate-900"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Store
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:left-[248px] lg:px-8">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-2 mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open admin navigation"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{currentPage}</p>
          <p className="hidden text-[11px] text-slate-400 sm:block">Kintampo Seller Center</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/admin/products?q="
            className="hidden h-11 w-56 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-400 no-underline hover:border-slate-300 hover:bg-white md:flex"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Search catalog
          </Link>
          <Link
            href="/"
            target="_blank"
            aria-label="View storefront"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 no-underline hover:bg-slate-50 hover:text-slate-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            KA
          </span>
        </div>
      </header>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[1px] lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close admin navigation"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86vw] flex-col bg-white shadow-2xl lg:hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-4">
              <Link href="/admin" className="flex items-center gap-3 no-underline">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">
                  K
                </span>
                <span>
                  <span className="block text-sm font-semibold leading-4 text-slate-950">Kintampo</span>
                  <span className="block text-[11px] leading-4 text-slate-400">Seller Center</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <AdminNav pathname={pathname} />

            <div className="shrink-0 space-y-1 border-t border-slate-100 p-3">
              <Link
                href="/admin/products/fabrics/new"
                className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 no-underline"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add fabric / lace
              </Link>
              <Link
                href="/admin/products/new"
                className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white no-underline"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add product
              </Link>
              <Link
                href="/"
                target="_blank"
                className="flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-medium text-slate-600 no-underline hover:bg-slate-100"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                View storefront
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-4 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
