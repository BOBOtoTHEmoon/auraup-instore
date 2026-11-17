/**
 * AuraUP Affiliates: shared helpers for the Edge Functions.
 *
 * Runs on Deno (Supabase Edge Functions), not Next.js. Excluded from the
 * Next build in tsconfig.json and from ESLint.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

export function env(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error("Missing env var " + key);
  return v;
}

export const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

export const SHOP = env("SHOPIFY_STORE_DOMAIN"); // e.g. auraup.myshopify.com
export const API_VERSION = "2026-10";
const CLIENT_ID = env("SHOPIFY_CLIENT_ID");
const CLIENT_SECRET = env("SHOPIFY_CLIENT_SECRET");

const enc = new TextEncoder();

async function hmac(data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data as BufferSource));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Webhooks: base64 HMAC of the raw body, keyed with the app's client secret. */
export async function verifyWebhook(raw: Uint8Array, header: string | null): Promise<boolean> {
  if (!header) return false;
  return safeEqual(toBase64(await hmac(raw)), header);
}

/**
 * App proxy: hex HMAC of the query params (minus signature), sorted by key,
 * each as key=value (repeated keys joined with commas), no separators.
 * Also rejects anything older than 5 minutes.
 */
export async function verifyProxy(url: URL): Promise<boolean> {
  const signature = url.searchParams.get("signature");
  if (!signature) return false;
  const grouped = new Map<string, string[]>();
  for (const [k, v] of url.searchParams) {
    if (k === "signature") continue;
    grouped.set(k, [...(grouped.get(k) ?? []), v]);
  }
  const message = [...grouped.keys()].sort()
    .map((k) => k + "=" + grouped.get(k)!.join(",")).join("");
  const valid = safeEqual(toHex(await hmac(enc.encode(message))), signature);
  const ts = Number(url.searchParams.get("timestamp"));
  const fresh = Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) < 300;
  return valid && fresh;
}

/** Client credentials token (24 hours), cached in aff_kv so every function instance shares it. */
export async function shopifyToken(): Promise<string> {
  const { data } = await db.from("aff_kv").select("value, expires_at")
    .eq("key", "shopify_token").maybeSingle();
  if (data && new Date(data.expires_at).getTime() > Date.now()) return data.value;

  const res = await fetch("https://" + SHOP + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error("Shopify token request failed: " + res.status + " " + (await res.text()));
  const tok = await res.json();
  const expiresIn = Number(tok.expires_in ?? 86399);
  await db.from("aff_kv").upsert({
    key: "shopify_token",
    value: tok.access_token,
    expires_at: new Date(Date.now() + (expiresIn - 600) * 1000).toISOString(),
  });
  return tok.access_token;
}

// deno-lint-ignore no-explicit-any
export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://" + SHOP + "/admin/api/" + API_VERSION + "/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await shopifyToken() },
    body: JSON.stringify({ query, variables }),
  });
  const out = await res.json();
  if (!res.ok || out.errors) throw new Error("Shopify GraphQL error: " + JSON.stringify(out.errors ?? out));
  return out.data as T;
}

export type Settings = {
  commission_rate: number;
  customer_discount: number;
  hold_days: number;
  min_payout: number;
  allow_self_referral: boolean;
};

export async function getSettings(): Promise<Settings> {
  const { data, error } = await db.from("aff_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return {
    commission_rate: Number(data.commission_rate),
    customer_discount: Number(data.customer_discount),
    hold_days: Number(data.hold_days),
    min_payout: Number(data.min_payout),
    allow_self_referral: !!data.allow_self_referral,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sends a custom event to Klaviyo, which triggers the matching flow email.
 * Never throws: an email problem must not block an approval or application.
 * Skipped quietly until KLAVIYO_PRIVATE_KEY is set.
 */
export async function klaviyoEvent(
  metric: string, email: string, firstName: string, properties: Record<string, unknown> = {},
): Promise<void> {
  const key = Deno.env.get("KLAVIYO_PRIVATE_KEY");
  if (!key || !email) return;
  try {
    const res = await fetch("https://a.klaviyo.com/api/events", {
      method: "POST",
      headers: {
        Authorization: "Klaviyo-API-Key " + key,
        accept: "application/vnd.api+json",
        "content-type": "application/vnd.api+json",
        revision: "2026-07-15",
      },
      body: JSON.stringify({
        data: {
          type: "event",
          attributes: {
            properties,
            metric: { data: { type: "metric", attributes: { name: metric } } },
            profile: { data: { type: "profile", attributes: { email, first_name: firstName } } },
          },
        },
      }),
    });
    if (!res.ok) console.error("Klaviyo event failed", metric, res.status, await res.text());
  } catch (err) {
    console.error("Klaviyo event error", metric, err);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
