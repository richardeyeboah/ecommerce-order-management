import Link from 'next/link'
import { Lock, MapPin, Phone, ShieldCheck } from 'lucide-react'
import { getSupportEmail, STORE } from '@/lib/constants/store'
import { PaymentMethodIcons } from '@/components/store/PaymentMethodIcons'
import { SocialLinks } from '@/components/store/SocialLinks'
import { StorePhoneLinks } from '@/components/store/StorePhoneLinks'
import { OrderByPhone } from '@/components/store/OrderByPhone'
import { StoreLogo } from '@/components/ui/StoreLogo'

const SHOP_LINKS_BASE = [
  { href: '/shop', label: 'All products' },
  { href: '/bundles', label: 'Bundles' },
  { href: '/#mobile-market', label: 'Mobile market' },
  { href: '/#services', label: 'Services' },
  { href: '/shop?category=Spices', label: 'Spices' },
  { href: '/shop?category=Flours%20%26%20Rice', label: 'Rice & flour' },
  { href: '/shop?category=Beverages', label: 'Beverages' },
] as const

const ACCOUNT_LINKS = [
  { href: '/track-order', label: 'Track order' },
  { href: '/account', label: 'My account' },
  { href: '/cart', label: 'Cart' },
  { href: '/checkout', label: 'Checkout' },
] as const

const HELP_LINKS = [
  { href: '/support', label: 'Support' },
  { href: '/faq', label: 'FAQ' },
  { href: '/shipping', label: 'Shipping' },
  { href: '/returns', label: 'Returns' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/about', label: 'About' },
  { href: '/feedback', label: 'Website feedback' },
  { href: '/track-order', label: 'Track order' },
] as const

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const

export function Footer({ showFashion = false }: { showFashion?: boolean }) {
  const supportEmail = getSupportEmail()
  const shopLinks = showFashion
    ? [
        SHOP_LINKS_BASE[0],
        { href: '/fashion', label: 'Fashion' },
        ...SHOP_LINKS_BASE.slice(1),
      ]
    : [...SHOP_LINKS_BASE]
  return (
    <footer className="mt-auto border-t border-earth-200 bg-white pb-[calc(4rem+env(safe-area-inset-bottom,0px))] text-earth-600 md:pb-0">
      <div className="store-container py-12 sm:py-16 lg:py-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 sm:gap-x-8 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <StoreLogo variant="footer" />
            <p className="mt-5 max-w-xs text-sm leading-6 text-earth-500">
              African &amp; Caribbean groceries. Store pickup and US shipping.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs font-medium text-earth-500">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} /> Secure checkout
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" strokeWidth={1.75} /> Stripe
              </span>
            </div>
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-earth-500">Follow</p>
              <SocialLinks className="mt-3" />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-earth-500">Shop</p>
            <ul className="mt-3 text-sm">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-earth-600 no-underline hover:text-earth-900"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-earth-500">Account</p>
            <ul className="mt-3 text-sm">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-earth-600 no-underline hover:text-earth-900"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-earth-500">Help</p>
            <ul className="mt-3 text-sm">
              {HELP_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-earth-600 no-underline hover:text-earth-900"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex min-h-11 items-center break-all text-earth-600 no-underline hover:text-earth-900"
                >
                  {supportEmail}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-earth-500">Visit us</p>
            <p className="mt-5 flex items-start gap-2.5 text-sm leading-6 text-earth-600">
              <MapPin className="mt-1 h-4 w-4 shrink-0 text-earth-500" strokeWidth={1.75} aria-hidden />
              <span>{STORE.address}</span>
            </p>
            <p className="mt-3 flex items-start gap-2 text-sm">
              <Phone className="mt-3 h-4 w-4 shrink-0 text-earth-500" strokeWidth={1.75} aria-hidden />
              <StorePhoneLinks />
            </p>
            <p className="mt-2 text-xs text-earth-500">{STORE.hours}</p>
          </div>
        </div>

        <OrderByPhone compact className="mt-10" />

        <div className="mt-12 border-t border-earth-200 pt-8">
          <PaymentMethodIcons />
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-earth-200 pt-6 text-xs text-earth-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {STORE.name}. All rights reserved.
          </p>
          <p className="flex gap-3">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex min-h-11 min-w-11 items-center px-1 text-earth-500 no-underline hover:text-earth-900"
              >
                {l.label}
              </Link>
            ))}
          </p>
        </div>
      </div>
    </footer>
  )
}
