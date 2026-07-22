import "server-only";
import { shopifyGraphQL, ShopifyError } from "./shopify";

/**
 * Pushes stock changes back to Shopify.
 *
 * Shopify uses compare-and-swap on inventory: every change must declare the
 * quantity you expect to find (changeFromQuantity). If someone else moved that
 * stock between our read and our write, Shopify rejects the change instead of
 * silently clobbering it. So the flow is always: read current level, then
 * adjust, and retry once on a stale read.
 *
 * The idempotency key is required from API version 2026-04 onward. It's derived
 * from the sale id, so retrying a timed-out request can never decrement twice.
 */

const RAW_LOCATION = process.env.SHOPIFY_LOCATION_ID;
const REASON = process.env.SHOPIFY_INVENTORY_REASON || "correction";

export function locationGid(): string {
  if (!RAW_LOCATION) {
    throw new ShopifyError(
      "SHOPIFY_LOCATION_ID is not set. Find it in Shopify admin under Settings > Locations."
    );
  }
  return RAW_LOCATION.startsWith("gid://")
    ? RAW_LOCATION
    : `gid://shopify/Location/${RAW_LOCATION}`;
}

export interface StockChange {
  inventoryItemId: string;
  /** Negative to reduce stock. Selling 2 units is -2. */
  delta: number;
}

/* ── Reading current levels ───────────────────────────────────── */

const LEVELS_QUERY = /* GraphQL */ `
  query CurrentLevels($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) {
            name
            quantity
          }
        }
      }
    }
  }
`;

interface LevelNode {
  id: string;
  inventoryLevel: {
    quantities: Array<{ name: string; quantity: number }>;
  } | null;
}

/**
 * Current "available" quantity per inventory item at the store location.
 * Items not stocked at that location come back absent from the map.
 */
async function fetchCurrentLevels(
  inventoryItemIds: string[],
  locationId: string
): Promise<Map<string, number>> {
  const data = await shopifyGraphQL<{ nodes: Array<LevelNode | null> }>(LEVELS_QUERY, {
    ids: [...new Set(inventoryItemIds)],
    locationId,
  });

  const map = new Map<string, number>();
  for (const node of data.nodes) {
    if (!node?.inventoryLevel) continue;
    const available = node.inventoryLevel.quantities.find((q) => q.name === "available");
    if (available) map.set(node.id, available.quantity);
  }
  return map;
}

/* ── The adjustment ───────────────────────────────────────────── */

interface AdjustResult {
  inventoryAdjustmentGroup: {
    createdAt: string;
    reason: string;
    referenceDocumentUri: string | null;
    changes: Array<{ name: string; delta: number }>;
  } | null;
  userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
}

const MUTATION = (withIdempotency: boolean) => /* GraphQL */ `
  mutation AdjustStock($input: InventoryAdjustQuantitiesInput!${
    withIdempotency ? ", $key: String!" : ""
  }) {
    inventoryAdjustQuantities(input: $input)${
      withIdempotency ? " @idempotent(key: $key)" : ""
    } {
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes { name delta }
      }
      userErrors { field message code }
    }
  }
`;

/**
 * Applies every change in one batched request.
 *
 * @param reference  identifies the sale in Shopify's inventory history
 * @param idempotencyKey  stable per sale, so retries are safe
 */
export async function adjustStock(
  changes: StockChange[],
  reference: string,
  idempotencyKey: string,
  attempt = 0
): Promise<void> {
  const usable = changes.filter((c) => c.inventoryItemId && c.delta !== 0);
  if (!usable.length) return;

  const location = locationGid();
  const levels = await fetchCurrentLevels(
    usable.map((c) => c.inventoryItemId),
    location
  );

  // A variant that isn't stocked at the store can't be decremented there.
  // Say so plainly rather than failing with a cryptic Shopify error.
  const unstocked = usable.filter((c) => !levels.has(c.inventoryItemId));
  if (unstocked.length) {
    throw new ShopifyError(
      `${unstocked.length} item(s) aren't stocked at the store location. ` +
        `In Shopify, open the product and enable the Westbrook Mall location for those variants.`
    );
  }

  const input = {
    reason: REASON,
    name: "available",
    referenceDocumentUri: `logistics://auraup-instore/sale/${reference}`,
    changes: usable.map((c) => ({
      delta: c.delta,
      inventoryItemId: c.inventoryItemId,
      locationId: location,
      // What we expect to be there right now. Shopify rejects the whole
      // batch if reality has moved on.
      changeFromQuantity: levels.get(c.inventoryItemId) as number,
    })),
  };

  let data: { inventoryAdjustQuantities: AdjustResult };

  try {
    data = await shopifyGraphQL<{ inventoryAdjustQuantities: AdjustResult }>(
      MUTATION(true),
      { input, key: idempotencyKey }
    );
  } catch (err) {
    // Older API versions don't expose @idempotent. Required from 2026-04, so
    // this only fires if someone pins an older version.
    const message = err instanceof Error ? err.message : "";
    if (/idempotent|unknown directive/i.test(message)) {
      data = await shopifyGraphQL<{ inventoryAdjustQuantities: AdjustResult }>(
        MUTATION(false),
        { input }
      );
    } else {
      throw err;
    }
  }

  const errors = data.inventoryAdjustQuantities.userErrors ?? [];

  // Someone changed this stock while we were mid-flight. Re-read and go again.
  const stale = errors.some(
    (e) => e.code === "CHANGE_FROM_QUANTITY_STALE" || /stale/i.test(e.message)
  );
  if (stale && attempt < 2) {
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    return adjustStock(changes, reference, idempotencyKey, attempt + 1);
  }

  if (errors.length) {
    throw new ShopifyError(
      `Shopify refused the stock change: ${errors.map((e) => e.message).join("; ")}`,
      errors
    );
  }
}

/* ── Price verification ───────────────────────────────────────── */

interface VariantPrice {
  id: string;
  price: string;
  inventoryItemId: string | null;
  title: string;
  productTitle: string;
}

/**
 * Reads current prices straight from Shopify.
 *
 * The browser sends what it thinks a variant costs, but we never trust that
 * for money. Totals are computed from these values instead.
 */
export async function fetchVariantPrices(
  variantIds: string[]
): Promise<Map<string, VariantPrice>> {
  if (!variantIds.length) return new Map();

  const query = /* GraphQL */ `
    query VariantPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          title
          price
          inventoryItem { id }
          product { title }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    nodes: Array<{
      id: string;
      title: string;
      price: string;
      inventoryItem: { id: string } | null;
      product: { title: string };
    } | null>;
  }>(query, { ids: [...new Set(variantIds)] });

  const map = new Map<string, VariantPrice>();
  for (const node of data.nodes) {
    if (!node) continue;
    map.set(node.id, {
      id: node.id,
      price: node.price,
      inventoryItemId: node.inventoryItem?.id ?? null,
      title: node.title,
      productTitle: node.product.title,
    });
  }
  return map;
}
