import { NextResponse } from "next/server";
import { verifyShopifyConnection, ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * Hit /api/health first. If this returns your shop name,
 * the token and scopes are correct and we can move on.
 */
export async function GET() {
  try {
    const shop = await verifyShopifyConnection();
    return NextResponse.json({
      ok: true,
      shop: shop.name,
      domain: shop.myshopifyDomain,
      apiVersion: process.env.SHOPIFY_API_VERSION || "2025-01",
    });
  } catch (err) {
    const message = err instanceof ShopifyError ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
