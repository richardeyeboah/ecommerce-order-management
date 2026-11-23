# E-Commerce & Order Management System — Project Documentation

## 1. Overview

Kintampo African Market is a full-stack grocery e-commerce application. Customers browse products across departments, check out with Stripe, and receive order updates by email. Staff manage catalog, orders, customers, and fulfillment through a password-protected admin dashboard.

Design direction: **utility-first premium commerce** — fast pages, clear typography, no decorative clutter. See `AGENTS.md` for UI standards.

---

## 2. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router)                               │
│  Shop · Cart · Checkout · Account · Track order             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Next.js API routes + Server Components                     │
│  Auth (Supabase SSR) · Stripe · Email · Admin guards        │
└──────────────┬─────────────────────────────┬──────────────────┘
               │                             │
       ┌───────▼────────┐           ┌────────▼────────┐
       │  Supabase      │           │  Stripe         │
       │  Postgres+RLS  │           │  Payments       │
       │  Auth          │           │  Webhooks       │
       └────────────────┘           └─────────────────┘
```

**Request flow (checkout):**

1. Customer adds items to cart (client state).
2. `POST /api/checkout/payment-intent` validates cart against database prices, applies shipping and Ohio sales tax rules, creates Stripe PaymentIntent.
3. Customer pays via Stripe Payment Element (cards, Apple Pay, etc.).
4. Stripe webhook (`POST /api/stripe/webhook`) confirms payment and creates the order server-side.
5. Customer and merchant receive email notifications; optional SMS via Twilio.

Orders are **never** created from client-supplied prices. All totals are recomputed on the server.

---

## 3. Customer-facing features

### Storefront

- Product catalog with category filters, search autocomplete, and featured collections
- Product detail pages with add-to-cart and frequently-bought-together suggestions
- Mobile-first layout: sticky add-to-cart bar, bottom navigation, slide-in cart drawer
- Homepage hero with in-store photography, live stock count, and customer reviews
- Pickup and delivery options at checkout

### Account

- Email/password auth via Supabase (optional Google OAuth)
- Saved addresses with US address autocomplete (Geoapify or Google Places)
- Order history, reorder, profile management
- Track order page with status timeline

### Checkout

- Stripe Payment Element (live and test modes)
- Server-side price authority, inventory checks, Ohio sales tax on taxable categories
- US address verification (Geoapify / Census fallback)
- Pickup flow for in-store or driver collection (`ready_for_pickup` status)

---

## 4. Admin features

Route prefix: `/admin` (password session + optional Supabase role bypass disabled in production).

| Area | Capabilities |
|------|----------------|
| **Dashboard** | Revenue KPIs, date ranges (today, WTD, MTD), top products, CSV export |
| **Orders** | List, filter, detail, status updates, audit log, refunds (Stripe) |
| **Products** | CRUD, image upload, stock toggle, category grouping |
| **Customers** | Profile list, order history per customer |
| **Shipping** | Printable address slips; optional USPS Labels API one-click labels |

Admin API routes require signed `admin_session` cookie and same-origin checks on mutations.

---

## 5. Security

- **Supabase RLS** on orders, profiles, addresses; service role confined to server
- **Stripe webhook signature** verification before order fulfillment
- **Admin login** HMAC-signed session cookie; optional Upstash Redis rate limiting
- **Profile role escalation** blocked at database trigger level
- **Security headers** (CSP, HSTS, X-Frame-Options) via `next.config.ts`
- **Edge proxy** (`proxy.ts`) redirects unauthenticated users from `/account`, `/checkout`, `/admin`

Run `npm run check:env --production` before go-live.

---

## 6. Environment variables

Copy `.env.example` to `.env.local` for development. Set the same keys in **Vercel → Environment Variables** for production.

### Required for production

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB access |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (emails, Stripe redirects, sitemap) |
| `STRIPE_SECRET_KEY` | Server Stripe API |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client Stripe.js |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) |
| `ADMIN_PASSWORD` | Admin login password |
| `ADMIN_SESSION_SECRET` | Session cookie signing (32+ chars) |
| `GMAIL_USER` + `GMAIL_APP_PASSWORD` | Order notification email (or Postmark/SMTP) |
| `MERCHANT_ORDER_EMAIL` | Where new-order alerts are sent |

### Recommended

| Variable | Purpose |
|----------|---------|
| `GEOAPIFY_API_KEY` | US checkout address autocomplete |
| `UPSTASH_REDIS_REST_URL` + `TOKEN` | Distributed admin login rate limit |
| `GOOGLE_SITE_VERIFICATION` | Search Console HTML tag |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public contact email on site |

### Optional — USPS labels in admin

| Variable | Purpose |
|----------|---------|
| `USPS_API_CLIENT_ID` / `USPS_API_CLIENT_SECRET` | developer.usps.com OAuth |
| `USPS_EPS_ACCOUNT_NUMBER`, `USPS_CRID`, `USPS_MID` | Label payment accounts |
| `USPS_LABELS_ENABLED=1` | After USPS approves Labels API access |

See `.env.example` for ship-from address defaults and tax rate overrides.

---

## 7. Database

SQL migrations live in `supabase/`. Apply via Supabase SQL Editor or MCP in order of dependency:

- Core schema: `orders.sql`, `auth-profiles.sql`, `mvp-features.sql`
- RLS hardening: `rls-orders-order-items.sql`, `secure-checkout-snapshots.sql`
- Features: `shipping-and-status.sql`, `pickup-flow.sql`, `order-numbers.sql`

Key tables: `products`, `orders`, `order_items`, `profiles`, `addresses`, `checkout_snapshots`, `order_status_logs`.

---

## 8. Deployment

### Vercel

1. Connect GitHub repo `richardeyeboah/chuck-and-rich`
2. Root directory: project root
3. Set all production env vars
4. Deploy from `main`

### Stripe webhook (live)

- **Developers → Webhooks → Add destination**
- URL: `https://YOUR-DOMAIN/api/stripe/webhook`
- Event: `payment_intent.succeeded`
- Copy signing secret → `STRIPE_WEBHOOK_SECRET`

### Supabase

- Enable Auth providers as needed
- Set Site URL and redirect URLs to production domain
- Run pending SQL migrations

**Auth emails (signup / password reset) — separate from order Gmail**

Customer **signup no longer requires email confirmation** — accounts are created confirmed and signed in immediately.

Password-reset mail is still sent by **Supabase Auth**, not `GMAIL_*` order alerts.

1. Supabase → Authentication → URL Configuration  
   - Site URL: `https://kintampoafricanmarket.com`  
   - Redirect URLs: `https://kintampoafricanmarket.com/auth/callback` (+ preview URLs if needed)
2. Authentication → Providers → Email → turn **Confirm email** OFF (recommended; app also confirms via service role)
3. Authentication → Emails → SMTP settings (needed for password reset)  
   - Can reuse the same Gmail app password as order mail, or a dedicated transactional SMTP
4. Optional: prove reset — request forgot-password → link lands on `/auth/callback`

**Google login**

1. Google Cloud Console → OAuth client (Web) with authorized redirect URI from Supabase Google provider docs  
2. Supabase → Authentication → Providers → Google → enable + client ID/secret  
3. Vercel: `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=1` → redeploy  
4. Login/signup pages show “Continue with Google” when that flag is set

---

## 9. Operations runbook

| Task | How |
|------|-----|
| New order notification | Email to `MERCHANT_ORDER_EMAIL`; admin live toast if logged in |
| Ship an order | Admin → order → print slip or USPS label → update tracking → status `shipped` |
| Refund | Admin → order → Refund (Stripe orders only) |
| Export sales | Admin → Dashboard → date range → Export CSV |
| Product import | `npm run import:products` (requires service role in `.env.local`) |
| Category cleanup | `npm run categories:reclassify:dry` then `:apply` |

---

## 10. Project structure

```
app/
  (store)/          Customer pages (shop, cart, checkout, account)
  admin/            Staff dashboard
  api/              REST handlers (checkout, stripe, admin)
components/         UI and store components
lib/                Business logic (shipping, orders, email, auth)
supabase/           SQL migrations
public/             Static assets, brand images
tests/              Playwright e2e
```

---

## 11. Support

Store contact: **kkras5050@gmail.com** · (614) 446-0893

Technical issues: check Vercel deployment logs, Supabase logs, and Stripe webhook event history before code changes.
