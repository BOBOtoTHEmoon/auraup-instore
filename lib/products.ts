import "server-only";
import { shopifyGraphQL } from "./shopify";
import type { Product, Variant, Availability } from "@/types/catalog";

const PREORDER_TAGS = (process.env.SHOPIFY_PREORDER_TAGS || "pre-order,preorder")
  .split(",")
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

const LOW_STOCK_AT = 2;

/* ── GraphQL ──────────────────────────────────────────────────── */

const PRODUCTS_QUERY = /* GraphQL */ `
  query PosProducts($cursor: String) {
    products(first: 20, after: $cursor, query: "status:active") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        tags
        featuredImage {
          url
        }
        collections(first: 5) {
          nodes {
            title
          }
        }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            price
            availableForSale
            inventoryQuantity
            inventoryPolicy
            selectedOptions {
              name
              value
            }
            image {
              url
            }
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

/* ── Raw response shapes ──────────────────────────────────────── */

interface RawVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string } | null;
  inventoryItem: { id: string } | null;
}

interface RawProduct {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  featuredImage: { url: string } | null;
  collections: { nodes: Array<{ title: string }> };
  variants: { nodes: RawVariant[] };
}

interface RawResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: RawProduct[];
  };
}

/* ── Public API ───────────────────────────────────────────────── */

/** Pulls every active product, following pagination until Shopify is done. */
export async function fetchAllProducts(): Promise<Product[]> {
  const out: Product[] = [];
  let cursor: string | null = null;
  let guard = 0;

  do {
    const data: RawResponse = await shopifyGraphQL<RawResponse>(PRODUCTS_QUERY, { cursor });
    out.push(...data.products.nodes.map(normaliseProduct));
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    guard += 1;
  } while (cursor && guard < 50);

  return out;
}

/* ── Normalisation ────────────────────────────────────────────── */

function normaliseProduct(raw: RawProduct): Product {
  const tags = raw.tags.map((t) => t.toLowerCase());
  const taggedPreorder = tags.some((t) => PREORDER_TAGS.includes(t));

  const variants = raw.variants.nodes.map((v) => normaliseVariant(v, taggedPreorder));
  const sellable = variants.filter((v) => v.availability !== "out_of_stock");

  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    category: deriveCategory(raw.collections.nodes.map((c) => c.title)),
    image: raw.featuredImage?.url ?? null,
    tags: raw.tags,
    fromPrice: variants.length ? Math.min(...variants.map((v) => v.price)) : 0,
    isPreorder: sellable.length > 0 && sellable.every((v) => v.isPreorder),
    colors: distinct(variants.map((v) => v.color)),
    sizes: distinct(variants.map((v) => v.size)),
    variants,
    totalStock: variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0),
  };
}

function normaliseVariant(raw: RawVariant, taggedPreorder: boolean): Variant {
  const stock = raw.inventoryQuantity ?? 0;

  /**
   * Pre-order detection, in priority order:
   *  1. The product carries your pre-order tag (matches the Liquid sections).
   *  2. Shopify is set to keep selling past zero (inventoryPolicy CONTINUE)
   *     and stock has actually run out — that's Shopify's own pre-order setup.
   */
  const isPreorder =
    taggedPreorder || (raw.inventoryPolicy === "CONTINUE" && stock <= 0 && raw.availableForSale);

  return {
    id: raw.id,
    inventoryItemId: raw.inventoryItem?.id ?? null,
    sku: raw.sku,
    title: raw.title,
    color: pickOption(raw.selectedOptions, ["color", "colour"]),
    size: pickOption(raw.selectedOptions, ["size"]),
    price: Number.parseFloat(raw.price) || 0,
    stock,
    availability: deriveAvailability(stock, isPreorder, raw.availableForSale),
    isPreorder,
    image: raw.image?.url ?? null,
  };
}

function deriveAvailability(
  stock: number,
  isPreorder: boolean,
  availableForSale: boolean
): Availability {
  if (isPreorder) return "preorder";
  if (!availableForSale || stock <= 0) return "out_of_stock";
  if (stock <= LOW_STOCK_AT) return "low_stock";
  return "in_stock";
}

/** Reads a named option off a variant, case-insensitively. */
function pickOption(
  options: Array<{ name: string; value: string }>,
  names: string[]
): string | null {
  const hit = options.find((o) => names.includes(o.name.trim().toLowerCase()));
  return hit?.value ?? null;
}

/** Turns collection titles into the single filter chip the POS shows. */
function deriveCategory(collectionTitles: string[]): string {
  const lower = collectionTitles.map((t) => t.toLowerCase());
  const men = lower.some((t) => t.includes("men") && !t.includes("women"));
  const women = lower.some((t) => t.includes("women"));
  if (men && women) return "Unisex";
  if (men) return "Men";
  if (women) return "Women";
  return "Unisex";
}

function distinct(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
