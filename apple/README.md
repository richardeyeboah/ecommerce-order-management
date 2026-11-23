# Kintampo — Native Apple apps (SwiftUI)

Native **iPhone** (primary), Mac, and Watch clients for Kintampo African Market.  
Lives next to the Next.js web store — web code is not replaced.

## Honest status

| Item | Status |
|------|--------|
| Browse / search / cart | Ready |
| Auth, wishlist, addresses, orders | Ready |
| Native Stripe PaymentSheet checkout | Ready (iOS) against `/api/mobile/checkout/*` |
| Store manager (staff order queue, status updates, tracking, history) | Ready against `/api/admin/orders*` — same admin password as the web dashboard |
| Customer feedback form | Ready against `/api/feedback` |
| Apple Pay | Optional — set `APPLE_PAY_MERCHANT_ID` after Apple Developer + Stripe setup |
| App Store packaging | Needs your Apple **Development Team**, real app icon art, TestFlight QA |
| Live customer charges | Still on **Stripe test keys** until you switch to `pk_live_…` |

This is a **usable customer beta**, not a finished App Store submission.

## Quick start

```bash
cd apple
cp Config.example.xcconfig Config.xcconfig   # once
# Fill keys from repo-root .env.local
open KintampoMarket.xcodeproj
```

1. Select target **KintampoMarket**
2. Signing → your **Team**
3. Run on iPhone Simulator or device

## Config keys

From `.env.local`:

- `SUPABASE_URL` ← `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_ANON_KEY` ← `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SITE_URL` ← `https://kintampoafricanmarket.com`
- `STRIPE_PUBLISHABLE_KEY` ← `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `APPLE_PAY_MERCHANT_ID` ← leave blank until merchant ID exists

## Checkout

iOS uses **Stripe PaymentSheet** → `POST /api/mobile/checkout/payment-intent` → `GET /api/mobile/checkout/status`.  
Do not open Safari checkout from the app for payment.

After paying: cart clears only when status confirms an order. If confirmation is slow, use **Check payment status** — do not pay twice.

## Store manager: the Kintampo Manager app

Staff tools are a **separate app**, `KintampoManager` (bundle id `com.kintampoafricanmarket.manager`,
dark icon), in the same Xcode project. Like Shopify, DoorDash Merchant or Amazon Seller, the shopping app
contains no staff screens or staff code at all; customers never see a store-manager entry.

- Code: `apple/KintampoManager/` (staff-only) plus the shared `KintampoMarket/Models`, `Services`,
  `Theme` and two shared components. The customer target never compiles `KintampoManager/`.
- Install it only on staff phones (Xcode, or TestFlight / unlisted App Store distribution once the
  Apple Developer Program is active). The web dashboard at `/admin` remains for bulk work.
- Sign in with `ADMIN_PASSWORD` (the same password as `/admin/login`). The app keeps the signed
  `admin_session` cookie, so staff stay signed in for the session TTL.

- **Needs action** queue (ordered / processing / ready for pickup) or all orders, a status filter, and search by name, email or `LQ-` number
- One-tap **Mark <next step>** follows the pickup or shipping flow from `lib/order-status.ts`; pickup orders never offer carrier statuses
- Tracking number, a note to the customer, and the full status history. Status changes email the customer (server side)

Backed by `GET /api/admin/orders`, `GET /api/admin/orders/:id` and the existing `PATCH /api/admin/orders/:id`.

## Tests

```bash
bash apple/Tests/run.sh                 # Swift regression checks (mock network)
node apple/Tests/fixture-server.cjs     # local fixture on 127.0.0.1:4317 for the simulator
```

The fixture's store-manager password is `fixture-admin`. Checkout routes need Stripe **test** keys in the
environment; without them the fixture still serves browsing, accounts, feedback and store-manager routes.

## Regenerating the Xcode project

```bash
cd apple && python3 sync_xcode_project.py
# or: xcodegen generate
```
