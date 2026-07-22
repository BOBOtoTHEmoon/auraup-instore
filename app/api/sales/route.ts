import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { recordSale, validateSaleInput, ValidationError } from "@/lib/sales";
import { db } from "@/lib/supabase";
import { ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/** POST /api/sales — record a sale */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const input = validateSaleInput(await req.json().catch(() => null));
    const result = await recordSale(input, session.staffId);

    return NextResponse.json(
      {
        sale: {
          id: result.sale.id,
          saleNumber: result.sale.sale_number,
          subtotal: result.sale.subtotal,
          discount: result.sale.discount,
          total: result.sale.total,
          paymentMethod: result.sale.payment_method,
          createdAt: result.sale.created_at,
          staff: session.staffName,
        },
        // The sale is saved either way. This only reports whether Shopify
        // stock was updated, so the UI can show a quiet warning if not.
        inventorySynced: result.inventorySynced,
        inventoryError: result.inventoryError ?? null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}

/** GET /api/sales?limit=20 — recent sales with their lines */
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 100);
    const todayOnly = req.nextUrl.searchParams.get("today") === "1";

    let query = db
      .from("sales")
      .select(
        `id, sale_number, subtotal, discount, total, payment_method, note,
         inventory_synced, created_at,
         clients ( name, phone ),
         staff ( name ),
         sale_items ( title, color, size, quantity, unit_price, line_total, is_preorder )`
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (todayOnly) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      query = query.gte("created_at", start.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ sales: data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof UnauthorisedError) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ShopifyError) {
    console.error("[sales] Shopify error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  console.error("[sales] error:", err);
  return NextResponse.json({ error: "Could not complete the sale" }, { status: 500 });
}
