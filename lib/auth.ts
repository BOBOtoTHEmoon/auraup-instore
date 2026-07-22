import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, type StaffRow } from "./supabase";

const PIN_SECRET = process.env.STAFF_PIN_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!PIN_SECRET) throw new Error("STAFF_PIN_SECRET is not set");
if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");

export const SESSION_COOKIE = "auraup_staff";

/**
 * PIN length. Six digits gives a million combinations instead of ten
 * thousand, which matters now the app sits on a public URL.
 * The client reads NEXT_PUBLIC_PIN_LENGTH so the pad knows when to submit.
 */
export const PIN_LENGTH = Number(process.env.NEXT_PUBLIC_PIN_LENGTH) || 6;
const PIN_PATTERN = /^\d{4,8}$/;
const SESSION_HOURS = 12; // one long shift

/* ── PIN hashing ──────────────────────────────────────────────── */

/**
 * A 4-digit PIN has only 10,000 possibilities, so the hash alone is
 * not the security boundary. What protects it:
 *   - the HMAC secret lives only in server env, never in the DB
 *   - RLS blocks all browser access to the staff table
 *   - failed attempts are rate limited below
 * That's the right level for a 3-person shop floor tool.
 */
export function hashPin(pin: string): string {
  return createHmac("sha256", PIN_SECRET as string).update(pin.trim()).digest("hex");
}

/* ── Rate limiting, shared across instances ───────────────────── */

/**
 * Vercel spreads requests across many short-lived machines, so an
 * in-memory counter never sees the previous attempt and the lockout
 * silently does nothing. Attempts live in Postgres instead, which every
 * instance can see.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;

export async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const { data, error } = await db.rpc("recent_failed_attempts", {
    p_ip: ip,
    p_minutes: WINDOW_MINUTES,
  });

  if (error) {
    // Never lock staff out because the database hiccuped.
    console.error("[auth] rate limit check failed:", error.message);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  const failures = Number(data) || 0;
  return {
    allowed: failures < MAX_ATTEMPTS,
    remaining: Math.max(0, MAX_ATTEMPTS - failures),
  };
}

export async function recordAttempt(ip: string, succeeded: boolean) {
  try {
    await db.from("auth_attempts").insert({ ip, succeeded });
    // Opportunistic cleanup, roughly one run in fifty.
    if (Math.random() < 0.02) await db.rpc("prune_auth_attempts");
  } catch (err) {
    console.error("[auth] could not record attempt:", err);
  }
}

export const LOCKOUT_MINUTES = WINDOW_MINUTES;

/* ── Staff lookup ─────────────────────────────────────────────── */

export async function findStaffByPin(pin: string): Promise<StaffRow | null> {
  if (!PIN_PATTERN.test(pin.trim())) return null;

  const { data, error } = await db
    .from("staff")
    .select("*")
    .eq("pin_hash", hashPin(pin))
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`Staff lookup failed: ${error.message}`);
  return (data as StaffRow) ?? null;
}

/* ── Session cookie ───────────────────────────────────────────── */

export type Role = "staff" | "owner";

export interface Session {
  staffId: string;
  staffName: string;
  role: Role;
  exp: number;
}

function sign(value: string): string {
  return createHmac("sha256", SESSION_SECRET as string).update(value).digest("base64url");
}

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string): Session | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function createSession(staff: StaffRow) {
  const session: Session = {
    staffId: staff.id,
    staffName: staff.name,
    // Older sessions predate roles, so default rather than crash.
    role: (staff as StaffRow & { role?: Role }).role ?? "staff",
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  };

  (await cookies()).set(SESSION_COOKIE, encode(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });

  return session;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? decode(token) : null;
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Use at the top of any protected route handler. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorisedError();
  return session;
}

export class UnauthorisedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorisedError";
  }
}

export const newSecret = () => randomBytes(32).toString("hex");
