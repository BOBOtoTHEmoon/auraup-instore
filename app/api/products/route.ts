import { NextResponse } from "next/server";
import { fetchAllProducts } from "@/lib/products";
import { ShopifyError } from "@/lib/shopify";
import type { CatalogResponse } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await fetchAllProducts();

    const body: CatalogResponse = {
      products,
      syncedAt: new Date().toISOString(),
      count: products.length,
    };

    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ShopifyError) {
      console.error("[products] Shopify error:", err.message, err.detail);
      return NextResponse.json(
        { error: "Could not reach Shopify", detail: err.message },
        { status: 502 }
      );
    }
    console.error("[products] Unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
