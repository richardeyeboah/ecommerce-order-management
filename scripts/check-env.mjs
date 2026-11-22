/**
 * Launch readiness: which env vars are set (never prints secret values).
 * Usage: node --env-file=.env.local scripts/check-env.mjs
 *        node --env-file=.env.local scripts/check-env.mjs --production
 */

const isProd = process.argv.includes('--production')

function set(name) {
  const v = process.env[name]?.trim()
  return Boolean(v)
}

const checks = [
  {
    phase: '1 — Local dev (minimum)',
    items: [
      { key: 'NEXT_PUBLIC_SUPABASE_URL', ok: set('NEXT_PUBLIC_SUPABASE_URL'), required: true },
      { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', ok: set('NEXT_PUBLIC_SUPABASE_ANON_KEY'), required: true },
      {
        key: 'NEXT_PUBLIC_SITE_URL',
        ok: set('NEXT_PUBLIC_SITE_URL'),
        required: false,
        hint: 'Use http://localhost:3000 locally',
      },
      {
        key: 'STRIPE (test)',
        ok: set('STRIPE_SECRET_KEY') && set('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
        required: false,
        hint: 'Needed to test checkout',
      },
      {
        key: 'ADMIN_PASSWORD + ADMIN_SESSION_SECRET',
        ok: set('ADMIN_PASSWORD') && set('ADMIN_SESSION_SECRET'),
        required: false,
        hint: 'Needed for /admin locally',
      },
    ],
  },
  {
    phase: '2 — Orders & email',
    items: [
      { key: 'SUPABASE_SERVICE_ROLE_KEY', ok: set('SUPABASE_SERVICE_ROLE_KEY'), required: true },
      {
        key: 'MERCHANT_ORDER_EMAIL',
        ok: set('MERCHANT_ORDER_EMAIL'),
        required: false,
        hint: 'You get emailed when someone pays',
      },
      {
        key: 'Email transport (Gmail / SMTP / Postmark)',
        ok:
          (set('GMAIL_USER') && set('GMAIL_APP_PASSWORD')) ||
          (set('SMTP_HOST') && set('SMTP_USER') && set('SMTP_PASS')) ||
          set('POSTMARK_SERVER_TOKEN'),
        required: false,
        hint: 'At least one of Gmail, SMTP, or Postmark',
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        ok: set('STRIPE_WEBHOOK_SECRET'),
        required: false,
        hint: 'Orders created after payment — use Stripe CLI locally',
      },
    ],
  },
  {
    phase: '3 — Production (Vercel)',
    items: [
      {
        key: 'NEXT_PUBLIC_SITE_URL (https, no trailing slash)',
        ok: set('NEXT_PUBLIC_SITE_URL') && process.env.NEXT_PUBLIC_SITE_URL?.startsWith('https://'),
        required: isProd,
        hint: 'e.g. https://kintampoafricanmarket.com',
      },
      {
        key: 'STRIPE live keys (sk_live_ / pk_live_)',
        ok:
          process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') &&
          process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_live_'),
        required: isProd,
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET (production endpoint)',
        ok: set('STRIPE_WEBHOOK_SECRET'),
        required: isProd,
      },
      {
        key: 'ADMIN_SESSION_SECRET (32+ chars)',
        ok: (process.env.ADMIN_SESSION_SECRET?.length ?? 0) >= 32,
        required: isProd,
      },
      {
        key: 'Upstash distributed admin rate limit',
        ok: set('UPSTASH_REDIS_REST_URL') && set('UPSTASH_REDIS_REST_TOKEN'),
        required: isProd,
      },
      {
        key: 'SHIPPO_WEBHOOK_SECRET (when Shippo is enabled)',
        ok: !set('SHIPPO_API_TOKEN') || set('SHIPPO_WEBHOOK_SECRET'),
        required: isProd && set('SHIPPO_API_TOKEN'),
      },
      {
        key: 'GOOGLE_SITE_VERIFICATION (Search Console HTML tag)',
        ok: set('GOOGLE_SITE_VERIFICATION'),
        required: false,
        hint: 'Paste content= value from verification meta tag',
      },
    ],
  },
  {
    phase: '4 — Optional',
    items: [
      { key: 'USPS API (optional one-click labels)', ok: set('USPS_API_CLIENT_ID') && set('USPS_API_CLIENT_SECRET') && set('USPS_EPS_ACCOUNT_NUMBER') && set('USPS_CRID') && set('USPS_MID'), required: false },
      { key: 'SHIP_FROM address (packing slips)', ok: set('SHIP_FROM_STREET1') && set('SHIP_FROM_ZIP'), required: false },
      { key: 'Twilio SMS (all 4 vars)', ok: set('TWILIO_ACCOUNT_SID') && set('TWILIO_AUTH_TOKEN') && set('TWILIO_FROM_NUMBER') && set('MERCHANT_ALERT_PHONE'), required: false },
      { key: 'Upstash (admin rate limit)', ok: set('UPSTASH_REDIS_REST_URL') && set('UPSTASH_REDIS_REST_TOKEN'), required: false },
    ],
  },
]

let missingRequired = 0

console.log(`\nKintampo African Market — env check${isProd ? ' (production mode)' : ''}\n`)

for (const group of checks) {
  console.log(group.phase)
  for (const item of group.items) {
    const icon = item.ok ? '✓' : '○'
    const req = item.required && !item.ok ? ' REQUIRED' : ''
    console.log(`  ${icon} ${item.key}${req}`)
    if (!item.ok && item.hint) console.log(`      → ${item.hint}`)
    if (item.required && !item.ok) missingRequired++
  }
  console.log('')
}

const supabaseOk = set('NEXT_PUBLIC_SUPABASE_URL') && set('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (supabaseOk) {
  console.log('Next: npm run dev → http://localhost:3000')
  console.log('      npm run check:env after you fill .env.local\n')
} else {
  console.log('Create .env.local:  copy .env.example → .env.local  then paste Supabase keys.\n')
}

if (missingRequired > 0 && isProd) {
  process.exit(1)
}

process.exit(0)
