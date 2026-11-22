'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, ShoppingBag, X } from 'lucide-react'
import { useCart } from '@/context/CartContext'
import { NavbarAuth } from '@/components/NavbarAuth'
import { ShopSearchBar } from '@/components/store/ShopSearchBar'
import { Button } from '@/components/ui/button'
import { StoreLogo } from '@/components/ui/StoreLogo'
import { cn } from '@/lib/utils'

const NAV_LINKS_BASE = [
  { href: '/', label: 'Home' },
  { href: '/shop', label: 'Shop' },
  { href: '/#services', label: 'Services' },
  { href: '/track-order', label: 'Track order' },
  { href: '/account', label: 'Account' },
] as const

const DEPARTMENT_SHORTCUTS_BASE = [
  { href: '/shop?category=Flours%20%26%20Rice', label: 'Rice & flour' },
  { href: '/shop?category=Spices', label: 'Spices' },
  { href: '/shop?category=Beverages', label: 'Drinks' },
  { href: '/shop?category=Fresh%20Produce', label: 'Produce' },
  { href: '/#mobile-market', label: 'Mobile market' },
  { href: '/#services', label: 'More services' },
] as const

function isActive(pathname: string, href: string, search: string) {
  if (href === '/') return pathname === '/'
  if (href.startsWith('/#')) return false
  const [path, query = ''] = href.split('?')
  if (!(pathname === path || pathname.startsWith(`${path}/`))) return false
  if (!query) {
    if (path === '/shop') return pathname === '/shop'
    if (path === '/fashion') return pathname === '/fashion'
    return true
  }
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(search)
  for (const [key, value] of want.entries()) {
    if (have.get(key) !== value) return false
  }
  return true
}

export function Navbar({ showFashion = false }: { showFashion?: boolean }) {
  const { totalItems, openCart } = useCart()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [badgeKey, setBadgeKey] = useState(totalItems)
  const displayedTotalItems = hydrated ? totalItems : 0

  const navLinks = showFashion
    ? [
        NAV_LINKS_BASE[0],
        NAV_LINKS_BASE[1],
        { href: '/fashion', label: 'Fashion' },
        ...NAV_LINKS_BASE.slice(2),
      ]
    : [...NAV_LINKS_BASE]

  const departmentShortcuts = showFashion
    ? [{ href: '/fashion', label: 'Fashion' }, ...DEPARTMENT_SHORTCUTS_BASE]
    : [...DEPARTMENT_SHORTCUTS_BASE]

  useEffect(() => {
    setHydrated(true)
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setBadgeKey(totalItems)
  }, [totalItems])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-50 border-b transition-all duration-200',
          scrolled
            ? 'glass-nav border-earth-200 shadow-[0_1px_12px_rgb(31_31_31/0.035)]'
            : 'border-transparent bg-earth-50/95'
        )}
      >
        <div className="store-container">
          <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
            <StoreLogo />

            <div className="hidden flex-1 px-4 md:block md:max-w-sm lg:max-w-xl">
              <ShopSearchBar compact />
            </div>

            <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
              {navLinks.map(({ href, label }) => {
                const active = isActive(pathname, href, search)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium no-underline transition-colors duration-150',
                      active
                        ? 'bg-white text-earth-900 shadow-[var(--shadow-card)]'
                        : 'text-earth-600 hover:bg-white hover:text-earth-900'
                    )}
                  >
                    {label}
                  </Link>
                )
              })}
              <NavbarAuth className="ml-1" />
              <Button
                type="button"
                size="sm"
                className="relative ml-2 h-11 gap-1.5 px-3.5"
                onClick={openCart}
              >
                <ShoppingBag className="h-4 w-4" aria-hidden />
                Cart
                <span
                  key={badgeKey}
                  suppressHydrationWarning
                  aria-hidden={displayedTotalItems === 0}
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold leading-none text-earth-900 ${displayedTotalItems > 0 ? 'animate-pop' : 'invisible'}`}
                >
                  {displayedTotalItems > 99 ? '99+' : displayedTotalItems || ''}
                </span>
              </Button>
            </nav>

            {/* Mobile only: cart + hamburger */}
            <div className="flex items-center gap-0.5 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative h-11 w-11"
                aria-label={`Cart, ${displayedTotalItems} items`}
                onClick={openCart}
              >
                <ShoppingBag className="h-5 w-5" />
                <span
                  key={badgeKey}
                  suppressHydrationWarning
                  aria-hidden={displayedTotalItems === 0}
                  className={`absolute right-1 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-earth-900 px-0.5 text-[10px] font-semibold leading-none text-white ${displayedTotalItems > 0 ? 'animate-pop' : 'invisible'}`}
                >
                  {displayedTotalItems > 99 ? '99+' : displayedTotalItems || ''}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-expanded={open}
                aria-controls="mobile-nav"
                aria-label={open ? 'Close menu' : 'Open menu'}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          <div className="pb-2.5 md:hidden">
            <ShopSearchBar compact />
          </div>
        </div>
      </header>

      {/* Mobile menu: backdrop + slide-in drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-earth-950/20 backdrop-blur-[2px] md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav
            id="mobile-nav"
            className="animate-slide-in-right fixed inset-y-0 right-0 z-[70] flex w-72 flex-col bg-white shadow-[var(--shadow-premium)] md:hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            aria-label="Mobile"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-earth-100 px-4">
              <span className="text-sm font-semibold text-earth-900">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-col gap-1 overflow-y-auto p-3">
              {navLinks.map(({ href, label }) => {
                const active = isActive(pathname, href, search)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex h-12 items-center justify-between gap-3 rounded-lg px-4 text-[15px] font-medium no-underline transition-colors duration-150',
                      active
                        ? 'bg-earth-100 text-earth-900'
                        : 'text-earth-700 hover:bg-earth-50 hover:text-earth-900'
                    )}
                  >
                    {label}
                  </Link>
                )
              })}

              <div className="mt-3 border-t border-earth-100 pt-3">
                <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-earth-400">
                  Shop by department
                </p>
                <div className="flex flex-col gap-0.5">
                  {departmentShortcuts.map((item) => (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className="flex h-11 items-center rounded-lg px-4 text-sm font-medium text-earth-700 no-underline transition-colors duration-150 hover:bg-earth-50 hover:text-earth-900"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="mt-2 border-t border-earth-100 pt-3 px-1">
                <NavbarAuth onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </nav>
        </>
      )}
    </>
  )
}
