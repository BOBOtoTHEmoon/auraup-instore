import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { fetchOnlineOrders } from "@/lib/orders";
import { resolveRange, type RangePreset } from "@/lib/ranges";
import { ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/** GET /api/orders?range=month  — online orders from Shopify */
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const p = req.nextUrl.searchParams;
    const range = resolveRange(
      (p.get("range") ?? "month") as RangePreset,
      p.get("from") ?? undefined,
      p.get("to") ?? undefined
    );

    const orders = await fetchOnlineOrders(range.from, range.to);

    // Strips .myshopify.com so the client can build an admin URL
    const storeHandle = (process.env.SHOPIFY_STORE_DOMAIN ?? "").replace(
      ".myshopify.com",
      ""
    );

    return NextResponse.json({
      range,
      storeHandle,
      orders,
      totals: {
        count: orders.length,
        revenue: orders.reduce((s, o) => s + o.total, 0),
        units: orders.reduce(
          (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
          0
        ),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[orders] error:", err);
    return NextResponse.json({ error: "Could not load online orders" }, { status: 500 });
  }
}
