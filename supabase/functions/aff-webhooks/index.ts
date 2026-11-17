/**
 * AuraUP Affiliates: Shopify webhooks.
 * orders/paid records a commission, refunds/create and orders/cancelled reverse it.
 */
import { db, getSettings, round2, verifyWebhook } from "../_shared/aff.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256")))) {
    return new Response("invalid signature", { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id");

  // Shopify retries deliveries; process each one once
  if (webhookId) {
    const { error } = await db.from("aff_webhook_events").insert({ id: webhookId, topic });
    if (error?.code === "23505") return new Response("duplicate");
    if (error) return new Response("db error", { status: 500 });
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(raw));
    if (topic === "orders/paid") await onOrderPaid(payload);
    else if (topic === "refunds/create") await onRefund(payload);
    else if (topic === "orders/cancelled") await onCancelled(payload);
    return new Response("ok");
  } catch (err) {
    console.error(topic, err);
    // Forget the delivery so Shopify's retry gets processed
    if (webhookId) await db.from("aff_webhook_events").delete().eq("id", webhookId);
    return new Response("error", { status: 500 });
  }
});

// deno-lint-ignore no-explicit-any
async function onOrderPaid(order: any) {
  const codes: string[] = (order.discount_codes ?? [])
    .map((d: { code: string }) => String(d.code).trim().toUpperCase());
  if (!codes.length) return;

  const { data: aff } = await db.from("aff_affiliates")
    .select("id, shopify_customer_id, commission_rate")
    .in("code", codes).eq("status", "approved").limit(1).maybeSingle();
  if (!aff) return;

  const s = await getSettings();
  const buyerId = order.customer?.id ? Number(order.customer.id) : null;
  if (!s.allow_self_referral && buyerId && buyerId === Number(aff.shopify_customer_id)) return;

  // Subtotal after discounts, before shipping, in shop currency (NGN)
  const base = Number(order.subtotal_price ?? 0);
  if (base <= 0) return;

  const rate = Number(aff.commission_rate ?? s.commission_rate);
  const placedAt = new Date(order.processed_at ?? order.created_at ?? Date.now());
  const approvesAt = new Date(placedAt.getTime() + s.hold_days * 86_400_000);

  const { error } = await db.from("aff_commissions").upsert({
    affiliate_id: aff.id,
    source: order.source_name === "pos" ? "instore" : "online",
    order_ref: String(order.id),
    order_name: order.name,
    order_value: base,
    rate,
    amount: round2((base * rate) / 100),
    placed_at: placedAt.toISOString(),
    approves_at: approvesAt.toISOString(),
  }, { onConflict: "source,order_ref", ignoreDuplicates: true });
  if (error) throw error;
}

// deno-lint-ignore no-explicit-any
async function onRefund(refund: any) {
  const { data: c } = await db.from("aff_commissions")
    .select("id, amount, reversed_amount, rate, status")
    .eq("order_ref", String(refund.order_id)).maybeSingle();
  if (!c || c.status === "reversed") return;

  const refunded = (refund.refund_line_items ?? [])
    .reduce((sum: number, li: { subtotal?: string }) => sum + Number(li.subtotal ?? 0), 0);
  if (refunded <= 0) return;

  const amount = Number(c.amount);
  const reversed = Math.min(amount, round2(Number(c.reversed_amount) + (refunded * Number(c.rate)) / 100));
  const status = reversed >= amount && c.status !== "paid" ? "reversed" : c.status;

  const { error } = await db.from("aff_commissions")
    .update({ reversed_amount: reversed, status }).eq("id", c.id);
  if (error) throw error;
}

// deno-lint-ignore no-explicit-any
async function onCancelled(order: any) {
  const { data: c } = await db.from("aff_commissions")
    .select("id, amount, status").eq("order_ref", String(order.id)).maybeSingle();
  if (!c || c.status === "paid" || c.status === "reversed") return;

  const { error } = await db.from("aff_commissions")
    .update({ status: "reversed", reversed_amount: c.amount }).eq("id", c.id);
  if (error) throw error;
}
