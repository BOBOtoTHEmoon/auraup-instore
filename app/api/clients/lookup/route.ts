import { NextResponse, type NextRequest } from "next/server";
import { requireSession, UnauthorisedError } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { normalisePhone } from "@/lib/sales";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/lookup?phone=08031234567
 *
 * Called as staff type the phone number. Returns nothing for a new customer,
 * or the details behind "Returning client, visit #4, usually buys X".
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const raw = req.nextUrl.searchParams.get("phone") ?? "";
    const phone = normalisePhone(raw);

    // Too short to be meaningful, don't hit the database on every keystroke.
    if (phone.length < 6) {
      return NextResponse.json({ found: false });
    }

    const { data: client } = await db
      .from("clients")
      .select("id, name, phone")
      .eq("phone", phone)
      .maybeSingle();

    if (!client) return NextResponse.json({ found: false });

    const [{ data: stats }, { data: favourite }] = await Promise.all([
      db
        .from("client_stats")
        .select("visit_count, lifetime_value, last_visit")
        .eq("client_id", client.id)
        .maybeSingle(),
      db
        .from("client_favourites")
        .select("favourite_product, units")
        .eq("client_id", client.id)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      found: true,
      client: { id: client.id, name: client.name, phone: client.phone },
      // visit_count is past visits, so the one being rung up now is +1.
      visitNumber: (stats?.visit_count ?? 0) + 1,
      lifetimeValue: stats?.lifetime_value ?? 0,
      lastVisit: stats?.last_visit ?? null,
      favouriteProduct: favourite?.favourite_product ?? null,
    });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    }
    console.error("[clients/lookup] error:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
