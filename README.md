# E-Commerce & Order Management System

**Next.js · React · TypeScript · PostgreSQL (Supabase) · Stripe · Playwright**

[Live Site](https://kintampoafricanmarket.com) | [GitHub](https://github.com/richardeyeboah/ecommerce-order-management)

E-Commerce & Order Management System is a full-stack checkout and order management application implemented for a grocery retailer in Columbus, Ohio. It combines customer shopping, Stripe checkout, and staff order management.

**Start here:** [Engineering walkthrough](docs/PORTFOLIO.md) · [Application architecture](docs/PROJECT.md) · [Verification](docs/VERIFICATION.md) · [Staff guide](docs/ADMIN.md)

- Storefront: [kintampoafricanmarket.com](https://kintampoafricanmarket.com)
- Web stack: Next.js 16, React 19, TypeScript, Supabase/PostgreSQL, Stripe, Upstash Redis, Postmark
- Native clients: SwiftUI apps for iPhone, Mac, and Apple Watch in [`apple/`](apple/README.md)

## What the application does

### Customer experience

- Browse and search a catalog of 150+ products
- Create an account, save addresses, manage a wishlist, and review products
- Check out as a guest or signed-in customer
- Choose local pickup or nationwide shipping
- Pay through Stripe and receive an email receipt
- View order status and order history

### Store operations

- Manage products, categories, prices, images, and inventory
- Review customers and orders from protected staff tools
- Process refunds and update fulfillment status
- Generate receipts, pickup labels, and shipping information
- Keep an audit trail of order-status changes

## Reliability and payment controls

Prices and totals are calculated on the server before a Stripe PaymentIntent is created. Checkout snapshots preserve the exact priced lines and tax quote, and a unique Stripe PaymentIntent identifier prevents the same payment from being recorded twice. The commerce reliability migration creates the order, line items, inventory update, and initial status log in one database transaction; retries repair an older empty order safely.

Rate limits use Upstash Redis when configured. Sensitive staff and payment operations run on protected server routes, and secrets stay in local or hosting environment variables.

## Testing

The checked-in Playwright suite declares **61 tests across 13 files**. This is a test inventory, not a claim that all integration tests passed against a deployed store. It includes:

- Server-side protection against price tampering
- Guest and signed-in checkout
- Tax and shipping rules
- Stripe webhooks, refunds, and payment shortfalls
- Receipts and pickup labels
- Cart, navigation, homepage, and mobile behavior
- Shipping-address verification
- Staff and administrative API access

List the tests without running browsers:

```bash
npx playwright test --list
```

Run the full end-to-end suite:

```bash
npx playwright test
```

## Local development

Requirements: Node.js 22 LTS, npm, a dedicated development Supabase project, and Stripe test credentials. Keep development separate from live customers and payments.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Add the required values from `.env.example` to `.env.local`; never commit credentials.

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
npx playwright test --list
```

## Deployment

The repository documents Vercel deployment from `main`; a source review does not confirm which commit is currently live. Supabase provides authentication and PostgreSQL storage, Stripe handles payment processing, and Postmark sends transactional email.

## Repository layout

- `app/` — storefront, account pages, staff tools, and server routes
- `components/` — shared React UI
- `lib/` — data access, checkout, email, rate limiting, and utilities
- `supabase/` — schema setup, incremental SQL scripts, and policies
- `tests/` — Playwright end-to-end coverage
- `apple/` — SwiftUI clients and setup notes
- `mobile/` — Capacitor mobile workspace
- `docs/` — architecture, engineering walkthrough, verification, and staff operations
- `scripts/` — development, catalog import, and maintenance tools

This repository contains application code. Product, customer, order, payment, and credential data must remain in the configured services and environment variables.
