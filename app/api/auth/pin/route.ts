import { NextResponse, type NextRequest } from "next/server";
import {
  findStaffByPin,
  createSession,
  getSession,
  destroySession,
  checkRateLimit,
  recordAttempt,
  LOCKOUT_MINUTES,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/pin — sign in */
export async function POST(req: NextRequest) {
  let pin: string;
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = String(body.pin ?? "");
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a pin" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  // Shared across every serverless instance, unlike the old in-memory count.
  const limit = await checkRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` },
      { status: 429 }
    );
  }

  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "Enter your PIN" }, { status: 400 });
  }

  try {
    const staff = await findStaffByPin(pin);

    if (!staff) {
      await recordAttempt(ip, false);
      const left = limit.remaining - 1;
      return NextResponse.json(
        {
          error:
            left <= 3 && left > 0
              ? `PIN not recognised. ${left} attempt${left === 1 ? "" : "s"} left.`
              : "PIN not recognised",
        },
        { status: 401 }
      );
    }

    await recordAttempt(ip, true);
    const session = await createSession(staff);

    return NextResponse.json({
      staff: { id: staff.id, name: staff.name, role: session.role },
      expiresAt: new Date(session.exp).toISOString(),
    });
  } catch (err) {
    console.error("[auth/pin] error:", err);
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}

/** GET /api/auth/pin — who is signed in here? */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ staff: null });

  return NextResponse.json({
    staff: { id: session.staffId, name: session.staffName, role: session.role },
    expiresAt: new Date(session.exp).toISOString(),
  });
}

/** DELETE /api/auth/pin — sign out */
export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
