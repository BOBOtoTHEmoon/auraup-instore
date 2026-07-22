import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { products, syncedAt, stale } = await getCatalog();

    return NextResponse.json({
      products,
      syncedAt,
      stale,
      count: products.length,
    });
  } catch (err) {
    // Only reached when Shopify is down AND nothing has ever been cached.
    const message =
      err instanceof ShopifyError ? err.message : "Could not load the catalogue";
    console.error("[products] no catalogue available:", err);

    return NextResponse.json(
      { error: message, products: [], stale: true },
      { status: 502 }
    );
  }
}
