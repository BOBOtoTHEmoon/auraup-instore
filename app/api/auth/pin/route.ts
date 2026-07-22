import { NextResponse, type NextRequest } from "next/server";
import {
  findStaffByPin,
  createSession,
  getSession,
  destroySession,
  checkRateLimit,
  recordFailure,
  clearFailures,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/pin — sign in with a 4-digit PIN */
export async function POST(req: NextRequest) {
  let pin: string;
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = String(body.pin ?? "");
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a pin" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryInSeconds} seconds.` },
      { status: 429 }
    );
  }

  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4 digits" }, { status: 400 });
  }

  try {
    const staff = await findStaffByPin(pin);

    if (!staff) {
      recordFailure(ip);
      // Deliberately vague: never reveal whether a PIN exists.
      return NextResponse.json({ error: "PIN not recognised" }, { status: 401 });
    }

    clearFailures(ip);
    const session = await createSession(staff);

    return NextResponse.json({
      staff: { id: staff.id, name: staff.name },
      expiresAt: new Date(session.exp).toISOString(),
    });
  } catch (err) {
    console.error("[auth/pin] error:", err);
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}

/** GET /api/auth/pin — who is signed in on this device? */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ staff: null }, { status: 200 });

  return NextResponse.json({
    staff: { id: session.staffId, name: session.staffName },
    expiresAt: new Date(session.exp).toISOString(),
  });
}

/** DELETE /api/auth/pin — sign out */
export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
