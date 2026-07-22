import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { fetchOnlineOrders } from "@/lib/orders";
import { resolveRange, type RangePreset } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/**
 * GET /api/export?source=instore&range=month
 * GET /api/export?source=online&range=month
 *
 * Returns a CSV download, one row per line item so the numbers can be
 * pivoted in Excel rather than only read.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const p = req.nextUrl.searchParams;
    const source = p.get("source") === "online" ? "online" : "instore";
    const range = resolveRange(
      (p.get("range") ?? "month") as RangePreset,
      p.get("from") ?? undefined,
      p.get("to") ?? undefined
    );

    const rows =
      source === "online"
        ? await onlineRows(range.from, range.to)
        : await inStoreRows(range.from, range.to);

    const csv = toCsv(rows);
    const stamp = range.from.slice(0, 10);
    const filename = `auraup-${source}-${stamp}.csv`;

    return new NextResponse(csv, {
      headers: {
        // The BOM makes Excel read it as UTF-8, otherwise the naira sign
        // comes out as mojibake.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    console.error("[export] error:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

/* ── Row builders ─────────────────────────────────────────────── */

async function inStoreRows(from: string, to: string) {
  const { data, error } = await db
    .from("sales")
    .select(
      `sale_number, total, discount, payment_method, note, created_at,
       voided_at, void_reason,
       clients ( name, phone ),
       staff!staff_id ( name ),
       voided_by_staff:staff!voided_by ( name ),
       sale_items ( title, color, size, quantity, unit_price, line_total, is_preorder )`
    )
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error(error.message);

  const rows: Array<Record<string, string | number>> = [];

  for (const s of data ?? []) {
    const client = s.clients as { name: string; phone: string } | null;
    const staff = s.staff as { name: string } | null;

    for (const item of s.sale_items ?? []) {
      rows.push({
        Date: new Date(s.created_at).toLocaleDateString("en-NG"),
        Time: new Date(s.created_at).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        "Sale number": s.sale_number,
        Status: s.voided_at ? "VOIDED" : "Recorded",
        Product: item.title,
        Colour: item.color ?? "",
        Size: item.size ?? "",
        Quantity: item.quantity,
        "Unit price": Number(item.unit_price),
        "Line total": Number(item.line_total),
        "Pre-order": item.is_preorder ? "Yes" : "No",
        "Sale total": Number(s.total),
        Discount: Number(s.discount),
        Payment: s.payment_method,
        Staff: staff?.name ?? "",
        Client: client?.name ?? "Walk-in",
        Phone: client?.phone ?? "",
        Note: s.note ?? "",
        "Void reason": s.void_reason ?? "",
        "Voided by":
          (s.voided_by_staff as { name: string } | null)?.name ?? "",
      });
    }
  }

  return rows;
}

async function onlineRows(from: string, to: string) {
  const orders = await fetchOnlineOrders(from, to);
  const rows: Array<Record<string, string | number>> = [];

  for (const o of orders) {
    for (const item of o.items) {
      rows.push({
        Date: new Date(o.createdAt).toLocaleDateString("en-NG"),
        Time: new Date(o.createdAt).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        Order: o.name,
        Product: item.title,
        Variant: item.variant ?? "",
        Quantity: item.quantity,
        "Line total": item.total,
        "Order total": o.total,
        Payment: o.financialStatus ?? "",
        Fulfilment: o.fulfillmentStatus ?? "",
        Customer: o.customer ?? "",
      });
    }
  }

  return rows;
}

/* ── CSV ──────────────────────────────────────────────────────── */

function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "\uFEFFNo records in this period\n";

  const headers = Object.keys(rows[0]);
  const escape = (value: string | number) => {
    const s = String(value ?? "");
    // Quote anything containing a comma, quote or newline, and double up
    // any quotes inside it.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];

  // Leading BOM so Excel opens it as UTF-8.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
