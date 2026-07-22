import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { resolveRange, type RangePreset } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/** GET /api/sales/history?range=month — in-store sales with a staff breakdown */
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const p = req.nextUrl.searchParams;
    const range = resolveRange(
      (p.get("range") ?? "month") as RangePreset,
      p.get("from") ?? undefined,
      p.get("to") ?? undefined
    );

    const { data, error } = await db
      .from("sales")
      .select(
        `id, sale_number, subtotal, discount, total, payment_method, note,
         inventory_synced, created_at, voided_at, void_reason,
         clients ( name, phone ),
         staff!staff_id ( name ),
         voided_by_staff:staff!voided_by ( name ),
         sale_items ( title, color, size, quantity, unit_price, line_total, is_preorder )`
      )
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) throw new Error(error.message);

    const sales = data ?? [];
    const live = sales.filter((s) => !s.voided_at);

    /* Per staff, so you can see who sold what over the period. */
    const byStaff = new Map<string, { revenue: number; count: number; units: number }>();
    for (const s of live) {
      const who = (s.staff as { name: string } | null)?.name ?? "Unknown";
      const entry = byStaff.get(who) ?? { revenue: 0, count: 0, units: 0 };
      entry.revenue += Number(s.total);
      entry.count += 1;
      entry.units += (s.sale_items ?? []).reduce(
        (a: number, i: { quantity: number }) => a + i.quantity,
        0
      );
      byStaff.set(who, entry);
    }

    /* Per product, for the top movers list. */
    const byProduct = new Map<string, { units: number; revenue: number }>();
    for (const s of live) {
      for (const i of s.sale_items ?? []) {
        const entry = byProduct.get(i.title) ?? { units: 0, revenue: 0 };
        entry.units += i.quantity;
        entry.revenue += Number(i.line_total);
        byProduct.set(i.title, entry);
      }
    }

    /* Payment split, useful when reconciling the cash drawer. */
    const byPayment: Record<string, number> = {};
    for (const s of live) {
      byPayment[s.payment_method] =
        (byPayment[s.payment_method] ?? 0) + Number(s.total);
    }

    return NextResponse.json({
      range,
      sales,
      totals: {
        count: live.length,
        voided: sales.length - live.length,
        revenue: live.reduce((sum, s) => sum + Number(s.total), 0),
        discount: live.reduce((sum, s) => sum + Number(s.discount), 0),
        units: live.reduce(
          (sum, s) =>
            sum +
            (s.sale_items ?? []).reduce(
              (a: number, i: { quantity: number }) => a + i.quantity,
              0
            ),
          0
        ),
      },
      byStaff: [...byStaff.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue),
      byProduct: [...byProduct.entries()]
        .map(([title, v]) => ({ title, ...v }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 20),
      byPayment,
    });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    console.error("[sales/history] error:", err);
    return NextResponse.json({ error: "Could not load history" }, { status: 500 });
  }
}
