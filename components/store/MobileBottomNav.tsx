'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, PackageSearch, ShoppingBag, Store, User } from 'lucide-react'
import { useCart } from '@/context/CartContext'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/', label: 'Home', icon: Home, match: (path: string) => path === '/' },
  {
    href: '/shop',
    label: 'Shop',
    icon: Store,
    match: (path: string) =>
      path === '/shop' || path === '/fashion' || path.startsWith('/products/'),
  },
  {
    href: '/cart',
    label: 'Cart',
    icon: ShoppingBag,
    match: (path: string) => path === '/cart' || path.startsWith('/checkout'),
    isCart: true,
  },
  {
    href: '/track-order',
    label: 'Track',
    icon: PackageSearch,
    match: (path: string) =>
      path === '/track-order' || path.startsWith('/order-confirmation'),
  },
  {
    href: '/account',
    label: 'Account',
    icon: User,
    match: (path: string) =>
      path.startsWith('/account') || path === '/login' || path === '/signup',
  },
] as const

const HIDE_ON_PREFIXES = ['/checkout']

export function MobileBottomNav() {
  const pathname = usePathname()
  const { totalItems } = useCart()

  if (HIDE_ON_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-earth-200 bg-white md:hidden"
      // Solid white — glass blur let product labels bleed through on scroll.
      // Hidden on iPad (md: 768px+) since full navbar is shown
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Mobile navigation"
    >
      <ul className="mx-auto grid h-[60px] max-w-lg grid-cols-5">
        {TABS.map(({ href, label, icon: Icon, match, ...rest }) => {
          const active = match(pathname)
          const isCart = 'isCart' in rest && rest.isCart

          if (isCart) {
            return (
              <li key={href}>
                <Link
                  href="/cart"
                  aria-label={`Cart, ${totalItems} item${totalItems === 1 ? '' : 's'}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 no-underline transition-colors duration-150',
                    active ? 'text-brand-700' : 'text-earth-500'
                  )}
                >
                  <span className="relative flex h-6 w-6 items-center justify-center">
                    <Icon className={cn('h-[22px] w-[22px]', active && 'stroke-[2.25]')} aria-hidden />
                    <span
                      key={totalItems}
                      suppressHydrationWarning
                      aria-hidden={totalItems === 0}
                      className={cn(
                        'absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-700 px-0.5 text-[10px] font-semibold leading-none text-white',
                        totalItems > 0 ? 'animate-pop' : 'invisible'
                      )}
                    >
                      {totalItems > 99 ? '99+' : totalItems || ''}
                    </span>
                  </span>
                  <span className={cn('text-[11px] font-medium leading-none tracking-tight', active && 'font-semibold')}>
                    {label}
                  </span>
                </Link>
              </li>
            )
          }

          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'group relative flex h-full flex-col items-center justify-center gap-0.5 px-1 no-underline transition-colors duration-150',
                  active ? 'text-brand-700' : 'text-earth-500'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <Icon className={cn('h-[22px] w-[22px]', active && 'stroke-[2.25]')} aria-hidden />
                </span>
                <span className={cn('text-[11px] font-medium leading-none tracking-tight', active && 'font-semibold')}>
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
