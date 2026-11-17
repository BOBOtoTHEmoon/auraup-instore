/**
 * AuraUP Affiliates: Shopify app proxy.
 * Storefront path /apps/affiliates/* lands here, signed by Shopify.
 *
 *   GET  /r/:slug                  share link: log click, apply code, go to store
 *   GET  /me                       signed-in affiliate's dashboard data
 *   POST /apply                    application form
 *   GET  /admin/overview           admin only
 *   POST /admin/decide             admin only: approve or decline
 *   POST /admin/settings           admin only
 *   POST /admin/register-webhooks  admin only, run once
 *   POST /admin/resend-approval    admin only: resend the approval email
 */
import { db, env, getSettings, gql, json, klaviyoEvent, verifyProxy } from "../_shared/aff.ts";

const ADMIN_IDS = (Deno.env.get("ADMIN_CUSTOMER_IDS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PUBLIC_DOMAIN = env("PUBLIC_DOMAIN"); // auraupstore.com

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!(await verifyProxy(url))) return json({ error: "invalid_signature" }, 401);

  const path = url.pathname.replace(/^.*\/aff-proxy/, "").replace(/\/+$/, "") || "/";
  const prefix = url.searchParams.get("path_prefix") ?? "/apps/affiliates";
  const customerId = url.searchParams.get("logged_in_customer_id") || null;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  try {
    const ref = path.match(/^\/r\/([a-z0-9-]+)$/);
    if (req.method === "GET" && ref) return await referral(ref[1]);

    if (!customerId) return json({ error: "login_required" }, 401);

    if (req.method === "GET" && path === "/me") return json(await me(customerId, prefix));
    if (req.method === "POST" && path === "/apply") return await apply(customerId, body);

    if (path.startsWith("/admin")) {
      if (!ADMIN_IDS.includes(customerId)) return json({ error: "not_found" }, 404);
      if (req.method === "GET" && path === "/admin/overview") return json(await adminOverview());
      if (req.method === "POST" && path === "/admin/decide") return await decide(body, prefix);
      if (req.method === "POST" && path === "/admin/resend-approval") return await resendApproval(body, prefix);
      if (req.method === "POST" && path === "/admin/settings") return await saveSettings(body);
      if (req.method === "POST" && path === "/admin/register-webhooks") return json(await registerWebhooks());
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error(path, err);
    return json({ error: "server_error" }, 500);
  }
});

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

async function referral(slug: string) {
  const { data: aff } = await db.from("aff_affiliates")
    .select("id, code").eq("slug", slug).eq("status", "approved").maybeSingle();
  if (!aff) return redirect("/");
  await db.from("aff_clicks").insert({ affiliate_id: aff.id });
  // Shopify's discount link applies the code, then sends the shopper to the homepage
  return redirect("/discount/" + encodeURIComponent(aff.code) + "?redirect=" + encodeURIComponent("/"));
}

async function me(customerId: string, prefix: string) {
  const { data: aff } = await db.from("aff_affiliates")
    .select("id, full_name, status, code, slug, bank_name, account_number, account_name, bank_verified_at")
    .eq("shopify_customer_id", customerId).maybeSingle();
  if (!aff) return { status: "none" };
  if (aff.status !== "approved") return { status: aff.status };

  const [{ data: stats, error }, s] = await Promise.all([
    db.rpc("aff_dashboard", { p_aff: aff.id }),
    getSettings(),
  ]);
  if (error) throw error;

  return {
    status: "approved",
    profile: {
      firstName: aff.full_name.split(" ")[0],
      code: aff.code,
      link: "https://" + PUBLIC_DOMAIN + prefix + "/r/" + aff.slug,
      bank: aff.account_number
        ? {
          name: aff.bank_name,
          account: "•••• " + String(aff.account_number).slice(-2),
          accountName: aff.account_name,
          verified: !!aff.bank_verified_at,
        }
        : null,
    },
    discount: s.customer_discount,
    minPayout: s.min_payout,
    stats,
  };
}

// deno-lint-ignore no-explicit-any
async function apply(customerId: string, b: any) {
  const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const row = {
    shopify_customer_id: customerId,
    full_name: clean(b.full_name, 120),
    email: clean(b.email, 160).toLowerCase(),
    phone: clean(b.phone, 40),
    instagram: clean(b.instagram, 60).replace(/^@/, ""),
    tiktok: clean(b.tiktok, 60).replace(/^@/, ""),
    audience: clean(b.audience, 40),
    why: clean(b.why, 1000),
  };
  if (!row.full_name || !/^\S+@\S+\.\S+$/.test(row.email) || !row.instagram || b.agreed !== true) {
    return json({ error: "missing_fields" }, 422);
  }

  const { data: existing } = await db.from("aff_affiliates")
    .select("id, status").eq("shopify_customer_id", customerId).maybeSingle();
  if (existing && existing.status !== "declined") return json({ status: existing.status });

  const { error } = existing
    ? await db.from("aff_affiliates").update({ ...row, status: "pending", decided_at: null }).eq("id", existing.id)
    : await db.from("aff_affiliates").insert(row);
  if (error) throw error;
  await klaviyoEvent("Affiliate Application Received", row.email, firstName(row.full_name));
  return json({ status: "pending" });
}

async function adminOverview() {
  const [{ data, error }, settings] = await Promise.all([db.rpc("aff_admin_overview"), getSettings()]);
  if (error) throw error;
  return { ...data, settings };
}

const CREATE_DISCOUNT = [
  "mutation CreateAffiliateCode($input: DiscountCodeBasicInput!) {",
  "  discountCodeBasicCreate(basicCodeDiscount: $input) {",
  "    codeDiscountNode { id }",
  "    userErrors { field message code }",
  "  }",
  "}",
].join("\n");

// deno-lint-ignore no-explicit-any
async function decide(b: any, prefix: string) {
  const { data: aff } = await db.from("aff_affiliates").select("*").eq("id", b.id).maybeSingle();
  if (!aff || aff.status !== "pending") return json({ error: "not_pending" }, 409);
  const now = new Date().toISOString();

  if (b.decision === "decline") {
    await db.from("aff_affiliates").update({ status: "declined", decided_at: now }).eq("id", aff.id);
    await klaviyoEvent("Affiliate Declined", aff.email, firstName(aff.full_name));
    return json({ status: "declined" });
  }
  if (b.decision !== "approve") return json({ error: "bad_decision" }, 422);

  const s = await getSettings();
  const pct = s.customer_discount;
  const base = (String(aff.full_name).split(" ")[0] || "")
    .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10) || "AURA";
  const letters = ["", "A", "B", "C", "D", "E", "F", "G", "H", "J"];

  for (let i = 0; i < letters.length; i++) {
    const code = base + pct + letters[i];                            // TOLU10, then TOLU10A
    const slug = base.toLowerCase() + (i ? "-" + (i + 1) : "");      // tolu, then tolu-2

    const { count } = await db.from("aff_affiliates")
      .select("id", { count: "exact", head: true })
      .or("code.eq." + code + ",slug.eq." + slug);
    if (count) continue;

    const res = await gql(CREATE_DISCOUNT, {
      input: {
        title: "Affiliate: " + aff.full_name + " (" + code + ")",
        code,
        startsAt: now,
        context: { all: "ALL" },
        customerGets: { value: { percentage: pct / 100 }, items: { all: true } },
        appliesOncePerCustomer: false,
        combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
      },
    });
    const r = res.discountCodeBasicCreate;
    if (r.userErrors?.length) {
      const taken = r.userErrors.some((e: { code?: string; message: string }) =>
        e.code === "TAKEN" || /taken|unique|already/i.test(e.message));
      if (taken) continue;
      throw new Error(JSON.stringify(r.userErrors));
    }

    const { error } = await db.from("aff_affiliates").update({
      status: "approved", code, slug, shopify_discount_id: r.codeDiscountNode.id, decided_at: now,
    }).eq("id", aff.id);
    if (error) throw error;
    await sendApprovalEmail(aff.email, aff.full_name, code, slug, pct, prefix);
    return json({ status: "approved", code });
  }
  throw new Error("No free code found for this affiliate");
}

const firstName = (full: string) => String(full || "").trim().split(/\s+/)[0] || "";

async function sendApprovalEmail(
  email: string, fullName: string, code: string, slug: string, discount: number, prefix: string,
) {
  await klaviyoEvent("Affiliate Approved", email, firstName(fullName), {
    code,
    discount,
    link: "https://" + PUBLIC_DOMAIN + prefix + "/r/" + slug,
    dashboard_url: "https://" + PUBLIC_DOMAIN + "/pages/affiliate-dashboard",
  });
}

// deno-lint-ignore no-explicit-any
async function resendApproval(b: any, prefix: string) {
  const { data: aff } = await db.from("aff_affiliates")
    .select("email, full_name, code, slug, status").eq("id", b.id).maybeSingle();
  if (!aff || aff.status !== "approved") return json({ error: "not_approved" }, 409);
  const s = await getSettings();
  await sendApprovalEmail(aff.email, aff.full_name, aff.code, aff.slug, s.customer_discount, prefix);
  return json({ ok: true });
}

// deno-lint-ignore no-explicit-any
async function saveSettings(b: any) {
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const patch = {
    commission_rate: num(b.commission_rate, 0, 50),
    customer_discount: num(b.customer_discount, 1, 50),
    hold_days: num(b.hold_days, 0, 90),
    min_payout: num(b.min_payout, 0, 10_000_000),
  };
  if (Object.values(patch).some((v) => v === null)) return json({ error: "invalid_settings" }, 422);
  const { error } = await db.from("aff_settings")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
  return json({ ok: true });
}

const SUBSCRIBE = [
  "mutation Sub($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {",
  "  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {",
  "    webhookSubscription { id }",
  "    userErrors { field message }",
  "  }",
  "}",
].join("\n");

async function registerWebhooks() {
  const uri = env("SUPABASE_URL") + "/functions/v1/aff-webhooks";
  const out = [];
  for (const topic of ["ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"]) {
    const r = await gql(SUBSCRIBE, { topic, sub: { uri, format: "JSON" } });
    out.push({ topic, ...r.webhookSubscriptionCreate });
  }
  return out;
}
