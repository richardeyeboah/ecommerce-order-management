<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design Direction — Premium Utility-First Commerce Platform

This site is **NOT** a themed cultural marketplace. It is a **premium high-performance commerce platform** for African & Caribbean grocery. Treat every decision the way a Stripe / Apple / Linear / Sam's Club / Costco team would.

## North star

> Frictionless shopping. Fast pages. Sharp UI. No clutter, no gimmicks, no cultural theatre.

## Hard rules (do not violate)

1. **Performance over fluff.** Nothing that visibly slows the page. No blob animations, parallax, kente overlays, animated grain, drifting blurs, decorative floating cards, full-bleed video, marquee scrollers, or always-on background motion.
2. **Subtle, snappy motion only.** Hover/focus/click feedback ≤ 200ms. No 700ms fades on scroll. No staggered bounce-in. No `btn-shine` sweeps. Reveal-on-scroll is optional and must be fast (≤ 200ms, single fade, no translate).
3. **No emotional branding copy.** No "with love", "cinematic", "your kitchen tells stories", "memories", "cook tonight". Use direct utility copy: "Free pickup", "In stock", "Ships in 24h", "170+ products".
4. **No cultural theming in chrome.** No kente patterns, flags as decoration, country selectors, ethnic emojis, "shop by culture", founder story sections. Cultural relevance belongs in product names and category labels only.
5. **Display font for marketing only.** Body, navigation, product, cart, forms, tables, headings → all sans (`--font-sans` Montserrat). The display font is reserved for at most a single H1 per landing surface.
6. **Shadows: minimal.** One soft shadow on cards, one slightly deeper on hover. No glow shadows, no colored shadows, no inset stacks.
7. **Spacing: consistent rhythm.** Use the existing tokens. Page sections use `py-12 sm:py-16 lg:py-20` — not more.
8. **Color: warm market palette (owner-approved 2026-07).** Brand red (`--color-brand-600` #CE1126) for primary actions, prices, links, active states. Marigold gold (`--color-accent-*`) for badges, deal tags, and dark-footer accents. Surfaces stay white/warm stone; large tinted areas limited to soft `accent-50` washes and the dark footer. Reference: makolastores.us energy with cleaner execution.

## Inspiration

Apple product pages · Stripe.com · Linear.app · Sams Club catalog · Costco product grid · Shopify Polaris admin · Notion grid · Vercel docs.

## Anti-inspiration

Etsy, Anthropologie, World Market, "boutique" Shopify themes with parallax storytelling, anything described as "cinematic".

## Required priorities (in order)

1. **E-commerce utility** — elite search, advanced filters, smart categories, sticky cart, quick add-to-cart, fast browsing, recently viewed, frequently bought together, smart sort.
2. **Premium UI polish** — perfect spacing, sharp typography hierarchy, modern shadows, snappy transitions, crisp responsive layouts.
3. **Motion design** — smooth state transitions, hover affordances, cart count animation (tiny), loading skeletons, no scroll theatrics.
4. **Mobile UX** — app-like, sticky nav, bottom controls, thumb-friendly tap targets ≥ 44px, instant route transitions.
5. **Product experience** — recommendations, recently viewed, FBT, sort/filter combinations.

## Checklist before merging UI

- [ ] No element animates for longer than 200ms.
- [ ] No idle/background animation runs after the page is loaded.
- [ ] Heading hierarchy: at most one H1 per route; H2 sections use sans, not display.
- [ ] Every interactive element has a hover and focus state, both ≤ 150ms.
- [ ] Tap targets on mobile are ≥ 44×44px.
- [ ] Loading states use skeletons, not spinners (except for ≤ 200ms async actions).
- [ ] No purely decorative imagery in the hero or chrome — only product/category photos with utility.
- [ ] Copy is direct: prices, stock state, shipping, count. No prose.

If a request conflicts with these rules, follow the rules and call out the conflict.
