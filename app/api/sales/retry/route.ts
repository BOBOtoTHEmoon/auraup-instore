import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { retrySaleSync, ValidationError } from "@/lib/sales";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** GET /api/sales/retry — list sales still waiting on Shopify */
export async function GET() {
  try {
    await requireSession();

    const { data, error } = await db
      .from("sales")
      .select("id, sale_number, total, inventory_error, created_at")
      .eq("inventory_synced", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);
    return NextResponse.json({ pending: data ?? [], count: data?.length ?? 0 });
  } catch (err) {
    return handle(err);
  }
}

/**
 * POST /api/sales/retry  { "saleId": "..." }  retries one
 * POST /api/sales/retry  { "all": true }      retries everything pending
 */
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      saleId?: string;
      all?: boolean;
    };

    if (body.all) {
      const { data } = await db
        .from("sales")
        .select("id")
        .eq("inventory_synced", false)
        .limit(50);

      const results = [];
      for (const row of data ?? []) {
        results.push({ saleId: row.id, ...(await retrySaleSync(row.id)) });
      }

      return NextResponse.json({
        retried: results.length,
        succeeded: results.filter((r) => r.ok).length,
        results,
      });
    }

    if (!body.saleId) {
      return NextResponse.json(
        { error: "Send a saleId, or all: true" },
        { status: 400 }
      );
    }

    return NextResponse.json(await retrySaleSync(body.saleId));
  } catch (err) {
    return handle(err);
  }
}

function handle(err: unknown) {
  if (err instanceof UnauthorisedError) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[sales/retry] error:", err);
  return NextResponse.json({ error: "Retry failed" }, { status: 500 });
}
