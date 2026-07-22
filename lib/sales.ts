import "server-only";
import { db, type SaleRow } from "./supabase";
import { adjustStock, fetchVariantPrices } from "./inventory";

/* ── Input shapes ─────────────────────────────────────────────── */

export interface SaleLineInput {
  productId: string;
  variantId: string;
  title: string;
  color: string | null;
  size: string | null;
  quantity: number;
  isPreorder?: boolean;
}

export interface CreateSaleInput {
  client?: { name?: string; phone?: string };
  items: SaleLineInput[];
  paymentMethod: "cash" | "transfer" | "card";
  discount?: number;
  note?: string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/* ── Validation ───────────────────────────────────────────────── */

const PAYMENTS = ["cash", "transfer", "card"] as const;

export function validateSaleInput(body: unknown): CreateSaleInput {
  if (!body || typeof body !== "object") throw new ValidationError("Send a JSON body");
  const b = body as Record<string, unknown>;

  const items = b.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("A sale needs at least one item");
  }
  if (items.length > 50) throw new ValidationError("Too many items in one sale");

  const parsed: SaleLineInput[] = items.map((raw, i) => {
    const it = raw as Record<string, unknown>;
    const quantity = Number(it.quantity);

    if (typeof it.variantId !== "string" || !it.variantId.startsWith("gid://")) {
      throw new ValidationError(`Item ${i + 1} is missing a valid variantId`);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new ValidationError(`Item ${i + 1} has an invalid quantity`);
    }

    return {
      productId: String(it.productId ?? ""),
      variantId: it.variantId,
      title: String(it.title ?? "").slice(0, 300),
      color: it.color ? String(it.color).slice(0, 100) : null,
      size: it.size ? String(it.size).slice(0, 50) : null,
      quantity,
      isPreorder: Boolean(it.isPreorder),
    };
  });

  const paymentMethod = String(b.paymentMethod ?? "").toLowerCase();
  if (!PAYMENTS.includes(paymentMethod as (typeof PAYMENTS)[number])) {
    throw new ValidationError("paymentMethod must be cash, transfer or card");
  }

  const discount = b.discount === undefined ? 0 : Number(b.discount);
  if (!Number.isFinite(discount) || discount < 0) {
    throw new ValidationError("Discount must be zero or more");
  }

  const client = b.client as { name?: unknown; phone?: unknown } | undefined;

  return {
    items: parsed,
    paymentMethod: paymentMethod as CreateSaleInput["paymentMethod"],
    discount,
    note: b.note ? String(b.note).slice(0, 1000) : undefined,
    client: client
      ? {
          name: client.name ? String(client.name).trim().slice(0, 200) : undefined,
          phone: client.phone ? normalisePhone(String(client.phone)) : undefined,
        }
      : undefined,
  };
}

/** Strips spaces and dashes so 0803 123 4567 and 08031234567 match. */
export function normalisePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "").trim();
}

/* ── Client upsert ────────────────────────────────────────────── */

async function upsertClient(client?: CreateSaleInput["client"]): Promise<string | null> {
  if (!client?.phone) return null;

  const { data: existing } = await db
    .from("clients")
    .select("id, name")
    .eq("phone", client.phone)
    .maybeSingle();

  if (existing) {
    // Keep the newest name they gave us, but never blank one out.
    if (client.name && client.name !== existing.name) {
      await db.from("clients").update({ name: client.name }).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data, error } = await db
    .from("clients")
    .insert({ name: client.name || "Walk-in", phone: client.phone })
    .select("id")
    .single();

  if (error) throw new Error(`Could not save client: ${error.message}`);
  return data.id;
}

/* ── The main event ───────────────────────────────────────────── */

export interface RecordedSale {
  sale: SaleRow;
  inventorySynced: boolean;
  inventoryError?: string;
}

export async function recordSale(
  input: CreateSaleInput,
  staffId: string
): Promise<RecordedSale> {
  // 1. Prices come from Shopify, never from the browser.
  const priceMap = await fetchVariantPrices(input.items.map((i) => i.variantId));

  const missing = input.items.filter((i) => !priceMap.has(i.variantId));
  if (missing.length) {
    throw new ValidationError(
      `Shopify doesn't recognise ${missing.length} of these variants. Refresh the catalog and try again.`
    );
  }

  const lines = input.items.map((item) => {
    const variant = priceMap.get(item.variantId)!;
    const unitPrice = Number.parseFloat(variant.price) || 0;
    return {
      ...item,
      unitPrice,
      lineTotal: round2(unitPrice * item.quantity),
      inventoryItemId: variant.inventoryItemId,
    };
  });

  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const discount = round2(Math.min(input.discount ?? 0, subtotal));
  const total = round2(subtotal - discount);

  // 2. Client record.
  const clientId = await upsertClient(input.client);

  // 3. Save the sale before touching Shopify. If the network dies after this,
  //    the sale still exists and can be re-synced.
  const { data: sale, error: saleError } = await db
    .from("sales")
    .insert({
      client_id: clientId,
      staff_id: staffId,
      subtotal,
      discount,
      total,
      payment_method: input.paymentMethod,
      note: input.note ?? null,
      inventory_synced: false,
    })
    .select("*")
    .single();

  if (saleError) throw new Error(`Could not save the sale: ${saleError.message}`);

  const { error: itemsError } = await db.from("sale_items").insert(
    lines.map((l) => ({
      sale_id: sale.id,
      shopify_product_id: l.productId,
      shopify_variant_id: l.variantId,
      inventory_item_id: l.inventoryItemId,
      title: l.title,
      color: l.color,
      size: l.size,
      unit_price: l.unitPrice,
      quantity: l.quantity,
      line_total: l.lineTotal,
      is_preorder: Boolean(l.isPreorder),
    }))
  );

  if (itemsError) {
    // Roll the header back so we never keep an empty sale.
    await db.from("sales").delete().eq("id", sale.id);
    throw new Error(`Could not save the sale lines: ${itemsError.message}`);
  }

  // 4. Push stock to Shopify.
  const result = await syncSaleInventory(sale as SaleRow, lines);

  return {
    sale: { ...(sale as SaleRow), inventory_synced: result.ok },
    inventorySynced: result.ok,
    inventoryError: result.error,
  };
}

/* ── Inventory sync, reusable for retries ─────────────────────── */

interface SyncableLine {
  inventoryItemId: string | null;
  quantity: number;
}

export async function syncSaleInventory(
  sale: SaleRow,
  lines: SyncableLine[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Pre-order lines decrement too. Stock goes negative, which is exactly how
    // Shopify records an obligation you still owe the customer, and matches
    // what happens when someone pre-orders online.
    await adjustStock(
      lines
        .filter((l) => l.inventoryItemId)
        .map((l) => ({ inventoryItemId: l.inventoryItemId as string, delta: -l.quantity })),
      String(sale.sale_number),
      // The sale id is already a UUID, which is the format Shopify expects
      // for an idempotency key. Same key on every retry of the same sale.
      sale.id
    );

    await db
      .from("sales")
      .update({ inventory_synced: true, inventory_error: null })
      .eq("id", sale.id);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[sales] inventory sync failed for sale ${sale.sale_number}:`, message);

    await db
      .from("sales")
      .update({ inventory_synced: false, inventory_error: message.slice(0, 500) })
      .eq("id", sale.id);

    return { ok: false, error: message };
  }
}

/** Re-runs the Shopify push for a sale that failed earlier. */
export async function retrySaleSync(saleId: string) {
  const { data: sale, error } = await db
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .single();

  if (error || !sale) throw new ValidationError("No sale with that id");
  if (sale.inventory_synced) return { ok: true, alreadySynced: true };

  const { data: items } = await db
    .from("sale_items")
    .select("inventory_item_id, quantity")
    .eq("sale_id", saleId);

  const result = await syncSaleInventory(
    sale as SaleRow,
    (items ?? []).map((i) => ({
      inventoryItemId: i.inventory_item_id,
      quantity: i.quantity,
    }))
  );

  return { ...result, alreadySynced: false };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
