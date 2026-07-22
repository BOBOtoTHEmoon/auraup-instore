/**
 * Shapes the UI consumes. Everything Shopify-specific is normalised
 * into these before it reaches a component.
 */

export type Availability = "in_stock" | "low_stock" | "out_of_stock" | "preorder";

export interface Variant {
  /** Shopify GID, e.g. gid://shopify/ProductVariant/123 */
  id: string;
  /** Shopify GID for the inventory item — needed to adjust stock */
  inventoryItemId: string | null;
  sku: string | null;
  /** Full variant title from Shopify, e.g. "Black / L" */
  title: string;
  /** Parsed out of selectedOptions */
  color: string | null;
  size: string | null;
  /** Price in kobo-free naira units (Shopify returns "70000.00") */
  price: number;
  stock: number;
  availability: Availability;
  /** True when this specific variant is sold as pre-order */
  isPreorder: boolean;
  /** Variant-level image if Shopify has one, else null */
  image: string | null;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  /** Men / Women / Unisex, derived from collections */
  category: string;
  image: string | null;
  tags: string[];
  /** Lowest variant price, for display on the card */
  fromPrice: number;
  /** True when every sellable variant is pre-order */
  isPreorder: boolean;
  /** Distinct colours across variants, in Shopify's order */
  colors: string[];
  /** Distinct sizes across variants, in Shopify's order */
  sizes: string[];
  variants: Variant[];
  totalStock: number;
}

export interface CatalogResponse {
  products: Product[];
  syncedAt: string;
  count: number;
}
