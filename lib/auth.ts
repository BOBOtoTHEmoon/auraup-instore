import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, type StaffRow } from "./supabase";

const PIN_SECRET = process.env.STAFF_PIN_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!PIN_SECRET) throw new Error("STAFF_PIN_SECRET is not set");
if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");

export const SESSION_COOKIE = "auraup_staff";
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

/* ── Rate limiting ────────────────────────────────────────────── */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;

export function checkRateLimit(key: string): { allowed: boolean; retryInSeconds?: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && entry.until > now && entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryInSeconds: Math.ceil((entry.until - now) / 1000) };
  }
  if (entry && entry.until <= now) attempts.delete(key);
  return { allowed: true };
}

export function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) {
    attempts.set(key, { count: 1, until: now + LOCKOUT_MS });
  } else {
    entry.count += 1;
    entry.until = now + LOCKOUT_MS;
  }
}

export function clearFailures(key: string) {
  attempts.delete(key);
}

/* ── Staff lookup ─────────────────────────────────────────────── */

export async function findStaffByPin(pin: string): Promise<StaffRow | null> {
  if (!/^\d{4}$/.test(pin.trim())) return null;

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

export interface Session {
  staffId: string;
  staffName: string;
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
