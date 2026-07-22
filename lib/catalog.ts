import "server-only";
import { fetchAllProducts } from "./products";
import { db } from "./supabase";
import type { Product } from "@/types/catalog";

/**
 * The catalogue, with a fallback.
 *
 * Shop wifi drops and Shopify occasionally takes ten seconds to answer. Staff
 * standing at a counter with a customer cannot wait for that, and an empty
 * screen means they cannot sell at all.
 *
 * So: try Shopify, and on any failure serve the last catalogue we managed to
 * pull, clearly marked as stale. Selling from slightly old stock numbers beats
 * not selling.
 */

const CACHE_ID = "products";

export interface CatalogResult {
  products: Product[];
  syncedAt: string;
  /** True when this came from the cache because Shopify was unreachable. */
  stale: boolean;
  /** Why we fell back, for the log rather than the customer. */
  reason?: string;
}

export async function getCatalog(): Promise<CatalogResult> {
  try {
    const products = await fetchAllProducts();
    const syncedAt = new Date().toISOString();

    // Save in the background. A failed cache write must never fail the request.
    void saveCache(products, syncedAt);

    return { products, syncedAt, stale: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error("[catalog] Shopify unreachable, trying cache:", reason);

    const cached = await readCache();
    if (cached) {
      return { ...cached, stale: true, reason };
    }

    // Nothing cached yet, so there is genuinely nothing to show.
    throw err;
  }
}

async function saveCache(products: Product[], syncedAt: string) {
  try {
    await db.from("catalog_cache").upsert({
      id: CACHE_ID,
      payload: products,
      product_count: products.length,
      synced_at: syncedAt,
    });
  } catch (err) {
    console.error("[catalog] could not write cache:", err);
  }
}

async function readCache(): Promise<{ products: Product[]; syncedAt: string } | null> {
  try {
    const { data, error } = await db
      .from("catalog_cache")
      .select("payload, synced_at")
      .eq("id", CACHE_ID)
      .maybeSingle();

    if (error || !data) return null;

    return {
      products: data.payload as Product[],
      syncedAt: data.synced_at as string,
    };
  } catch (err) {
    console.error("[catalog] could not read cache:", err);
    return null;
  }
}
