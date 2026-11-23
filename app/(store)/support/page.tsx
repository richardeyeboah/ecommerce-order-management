import type { Metadata } from 'next'
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react'
import { PageHeader } from '@/components/store/PageHeader'
import { TapLink } from '@/components/store/TapLink'
import { STORE, STORE_PHONES, getSupportEmail, getWhatsAppNumber } from '@/lib/constants/store'

/**
 * Customer support page. Also the App Store "Support URL" for the iOS app, so it covers
 * app questions (accounts, deleting an account, orders) as well as the store.
 */
export const metadata: Metadata = {
  title: 'Support',
  description: 'Contact Kintampo African Market: email, phone, WhatsApp, store visits and app help.',
}

const HELP_LINKS = [
  { href: '/track-order', title: 'Track an order', body: 'Order number and email, no sign-in needed.' },
  { href: '/faq', title: 'FAQ', body: 'Pickup, shipping, delivery, payments and returns.' },
  { href: '/shipping', title: 'Shipping & pickup', body: 'Rates, delivery times and free-shipping threshold.' },
  { href: '/returns', title: 'Returns', body: 'Damaged, incorrect or missing items.' },
  { href: '/privacy', title: 'Privacy', body: 'What we collect and how it is used.' },
  { href: '/terms', title: 'Terms', body: 'Terms of sale and use.' },
] as const

export default function SupportPage() {
  const supportEmail = getSupportEmail()
  const whatsapp = getWhatsAppNumber().replace(/\D/g, '')
  const whatsappHref = `https://wa.me/${whatsapp.length === 10 ? `1${whatsapp}` : whatsapp}`

  const contacts = [
    {
      icon: Mail,
      title: 'Email',
      body: 'We reply within one business day.',
      label: supportEmail,
      href: `mailto:${supportEmail}`,
    },
    {
      icon: Phone,
      title: 'Call the store',
      body: STORE.hours,
      label: STORE.phone,
      href: STORE.phoneHref,
    },
    {
      icon: MessageCircle,
      title: 'WhatsApp',
      body: 'Questions, orders and photos of an item.',
      label: 'Message us',
      href: whatsappHref,
    },
    {
      icon: MapPin,
      title: 'Visit',
      body: STORE.hours,
      label: STORE.address,
      href: `https://maps.apple.com/?q=${encodeURIComponent(STORE.address)}`,
    },
  ]

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow="Help"
        title="Support"
        subtitle="Questions about an order, the app or the store. A real person at Kintampo answers."
      />
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="store-container max-w-4xl space-y-12">
          <ul className="grid gap-4 sm:grid-cols-2">
            {contacts.map(({ icon: Icon, title, body, label, href }) => (
              <li key={title} className="premium-card flex gap-4 p-5 sm:p-6">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-earth-900">{title}</h2>
                  <p className="mt-1 text-sm text-earth-600">{body}</p>
                  <TapLink
                    href={href}
                    external={href.startsWith('http')}
                    className="mt-1 break-words text-sm font-medium"
                  >
                    {label}
                  </TapLink>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-sm text-earth-600">
            Other store lines:{' '}
            {STORE_PHONES.slice(1).map((p, i) => (
              <span key={p.href}>
                {i > 0 ? ' · ' : ''}
                <TapLink href={p.href}>{p.label}</TapLink>
              </span>
            ))}
          </p>

          <div>
            <h2 className="text-lg font-semibold text-earth-900">Quick answers</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {HELP_LINKS.map((link) => (
                <li key={link.href}>
                  <TapLink
                    href={link.href}
                    className="block h-full rounded-2xl border border-earth-200 p-4 no-underline transition-colors hover:border-earth-300 hover:bg-earth-50"
                  >
                    <span className="block text-sm font-semibold text-earth-900">{link.title}</span>
                    <span className="mt-1 block text-sm text-earth-600">{link.body}</span>
                  </TapLink>
                </li>
              ))}
            </ul>
          </div>

          <div className="premium-card p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-earth-900">The Kintampo Market app</h2>
            <dl className="mt-4 space-y-4 text-sm leading-relaxed text-earth-600">
              <div>
                <dt className="font-semibold text-earth-900">Signing in</dt>
                <dd className="mt-1">
                  Use the same email and password as this website. Forgot it? Tap{' '}
                  <strong>Forgot password</strong> on the Account tab or{' '}
                  <TapLink href="/forgot-password">reset it here</TapLink>.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-earth-900">Your orders</dt>
                <dd className="mt-1">
                  Account → Orders in the app, or <TapLink href="/track-order">Track order</TapLink>{' '}
                  with your order number. We email you when an order is ready for pickup or ships.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-earth-900">Deleting your account</dt>
                <dd className="mt-1">
                  In the app: Account → <strong>Delete account</strong>. On the website: Account →
                  Profile → <strong>Delete my account</strong>. This removes your login, saved
                  addresses and saved items. Past orders stay in the store&apos;s records for
                  receipts, returns and taxes. You can also email{' '}
                  <TapLink href={`mailto:${supportEmail}`}>{supportEmail}</TapLink> and we will
                  delete it for you.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  )
}
