import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { voidSale, retryVoidSync, ValidationError } from "@/lib/sales";
import { ShopifyError } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/void
 *   { "saleId": "...", "reason": "wrong size" }   cancel and return stock
 *   { "saleId": "...", "retry": true }            retry a failed stock return
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      saleId?: string;
      reason?: string;
      retry?: boolean;
    };

    if (!body.saleId) {
      return NextResponse.json({ error: "Send a saleId" }, { status: 400 });
    }

    if (body.retry) {
      return NextResponse.json(await retryVoidSync(body.saleId));
    }

    const reason = (body.reason ?? "").trim();
    if (reason.length < 2) {
      return NextResponse.json(
        { error: "Give a short reason, it shows in the history" },
        { status: 400 }
      );
    }

    const result = await voidSale(body.saleId, session.staffId, reason);

    return NextResponse.json({
      voided: true,
      saleNumber: result.saleNumber,
      stockReturned: result.stockReturned,
      error: result.error ?? null,
    });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[sales/void] error:", err);
    return NextResponse.json({ error: "Could not void the sale" }, { status: 500 });
  }
}
