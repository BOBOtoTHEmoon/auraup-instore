import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { setStock } from "@/lib/inventory";
import { ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory/set
 * { inventoryItemId, quantity, expectedCurrent }
 *
 * Owner only. Editing stock is a trusted action, so it's gated on the role in
 * the session, not just on the client hiding the button.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();

    if (session.role !== "owner") {
      return NextResponse.json(
        { error: "Only an owner can edit stock" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      inventoryItemId?: string;
      quantity?: number;
      expectedCurrent?: number;
    };

    if (!body.inventoryItemId?.startsWith("gid://shopify/InventoryItem/")) {
      return NextResponse.json({ error: "Send a valid inventoryItemId" }, { status: 400 });
    }
    if (typeof body.quantity !== "number" || typeof body.expectedCurrent !== "number") {
      return NextResponse.json(
        { error: "Send quantity and expectedCurrent as numbers" },
        { status: 400 }
      );
    }

    const quantity = await setStock(
      body.inventoryItemId,
      Math.round(body.quantity),
      Math.round(body.expectedCurrent)
    );

    return NextResponse.json({ ok: true, quantity });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[inventory/set] error:", err);
    return NextResponse.json({ error: "Could not update stock" }, { status: 500 });
  }
}
