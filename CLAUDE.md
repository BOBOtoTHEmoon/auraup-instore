@AGENTS.md
# AuraUp In-Store

In-store sales logging for AuraUp (auraupstore.com), a Lagos fashion brand.
Shopify handles online orders; this handles physical sales at Westbrook Mall,
Lekki, and pushes stock back to Shopify so both stay in sync.

Stack: Next.js (App Router) + Supabase (Postgres) + Shopify Admin GraphQL API.

## Non-negotiables

**Never trust the client for money.** The browser sends variant ids and
quantities only. Prices are read from Shopify server-side in
`fetchVariantPrices` and all totals computed there. Do not accept a price from
the request body.

**Never import server files into client components.** `lib/shopify.ts`,
`lib/supabase.ts`, `lib/auth.ts`, `lib/sales.ts`, `lib/inventory.ts` all start
with `import "server-only"`. The Shopify secret and Supabase service-role key
must never reach the browser.

**Save the sale before touching Shopify.** Sales are written to Postgres first
with `inventory_synced: false`, then stock is pushed. If Shopify is unreachable
the sale survives and `/api/sales/retry` catches up. Shop wifi drops; a sale
must never be lost because of it.

**Never change `STAFF_PIN_SECRET`.** PINs are HMACs keyed with it. Changing it
invalidates every staff PIN and they all have to be re-added.

## Shopify gotchas (learned the hard way)

**No permanent tokens.** Legacy custom-app `shpat_` tokens were killed on
2026-01-01. The app is a Dev Dashboard app: client id + secret get exchanged for
a 24-hour token via the client credentials grant. `lib/shopify.ts` caches and
refreshes it. Client credentials only work when app and store are in the same
Dev Dashboard organisation.

**`changeFromQuantity` is required** on every inventory change. It's
compare-and-swap: you declare the quantity you expect, and Shopify rejects the
batch if reality has moved. So always read current levels first
(`fetchCurrentLevels`), then adjust. Retry on `CHANGE_FROM_QUANTITY_STALE`.

**The idempotency key is required** from API version 2026-04. It's the sale's
UUID, so retrying a timed-out request can't decrement stock twice.

**Scopes live inside an app version.** Changing scopes means creating and
releasing a new version in the Dev Dashboard, then re-approving on the store.

## Domain rules

**Variants are mandatory.** Tapping a product never adds to the cart; it opens
the picker. Colour, then size, then quantity. Sold-out sizes are unselectable.

**Some products have no colour option.** Colour is baked into the title instead
(WHITE TEE, BEIGE TEE), so `colors: []` is correct, not a bug. Only render
swatches when `colors.length > 0`.

**Pre-order detection** reads the `PRE-ORDER` tag first (matching the storefront
Liquid sections), then falls back to Shopify's continue-selling-at-zero setting.
Configured via `SHOPIFY_PREORDER_TAGS`.

**Pre-order lines still decrement stock**, taking it negative. That's
deliberate: negative stock on a continue-selling variant reads as units owed,
same as an online pre-order.

**Sale lines copy title, colour, size and price at time of sale.** Never
reconstruct a receipt by joining to current product data; renames and price
changes would rewrite history.

## Database

RLS is on with zero policies, so nothing is reachable from a browser. All access
goes through server routes using the service-role key. Views need
`security_invoker = on` or they leak past RLS.

`client_stats` and `client_favourites` power the returning-customer prompt.
`sales_overview` is a readable join for browsing in the Supabase dashboard.

## UI

Mobile first. Staff use phones at the counter; the laptop layout is the
afterthought, not the other way round. Touch targets 46px minimum, inputs 16px
so iOS doesn't zoom.

Monochrome, taken from the storefront. Archivo for structure, Space Mono for
every number. Product photography carries the colour; the interface stays quiet.
No accent colours beyond the warn tone.

Plain CSS with custom properties in `globals.css`, not Tailwind utilities,
despite Tailwind being installed.

## Known gaps

- No offline queue. A full connection drop fails the sale rather than queuing it.
- PIN rate limiting is in-memory, which does not work across serverless
  instances on Vercel. Needs moving to Postgres.
- No receipts or refunds yet.