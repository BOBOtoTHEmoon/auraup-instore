"use client";

import type { Product, Variant } from "@/types/catalog";

export type { Product, Variant };

/* ── Formatting ───────────────────────────────────────────────── */

// Postgres numeric columns come back as strings through PostgREST, so coerce
// rather than trusting the type on the way in.
export const naira = (n: number | string) =>
  "\u20A6" + Math.round(Number(n) || 0).toLocaleString("en-NG");

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* ── Cart ─────────────────────────────────────────────────────── */

export interface CartLine {
  productId: string;
  variantId: string;
  title: string;
  color: string | null;
  size: string | null;
  price: number;
  quantity: number;
  isPreorder: boolean;
  image: string | null;
}

/** Same product, colour and size collapses into one line. */
export const lineKey = (l: { variantId: string }) => l.variantId;

/* ── API ──────────────────────────────────────────────────────── */

export interface Staff {
  id: string;
  name: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      (body as { error?: string }).error || `Request failed (${res.status})`
    );
  }
  return body as T;
}

export const api = {
  session: () => call<{ staff: Staff | null }>("/api/auth/pin"),

  signIn: (pin: string) =>
    call<{ staff: Staff }>("/api/auth/pin", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),

  signOut: () => call<{ ok: boolean }>("/api/auth/pin", { method: "DELETE" }),

  products: () =>
    call<{ products: Product[]; syncedAt: string }>("/api/products"),

  lookupClient: (phone: string) =>
    call<{
      found: boolean;
      client?: { name: string; phone: string };
      visitNumber?: number;
      lifetimeValue?: number;
      favouriteProduct?: string | null;
    }>(`/api/clients/lookup?phone=${encodeURIComponent(phone)}`),

  recordSale: (payload: {
    client?: { name?: string; phone?: string };
    items: Array<{
      productId: string;
      variantId: string;
      title: string;
      color: string | null;
      size: string | null;
      quantity: number;
      isPreorder: boolean;
    }>;
    paymentMethod: string;
    discount: number;
    note?: string;
  }) =>
    call<{
      sale: { id: string; saleNumber: number; total: number; staff: string };
      inventorySynced: boolean;
      inventoryError: string | null;
    }>("/api/sales", { method: "POST", body: JSON.stringify(payload) }),

  todaysSales: () =>
    call<{ sales: TodaySale[] }>("/api/sales?today=1&limit=50"),

  pendingSyncs: () =>
    call<{ pending: Array<{ id: string; sale_number: number }>; count: number }>(
      "/api/sales/retry"
    ),

  retryAll: () =>
    call<{ retried: number; succeeded: number }>("/api/sales/retry", {
      method: "POST",
      body: JSON.stringify({ all: true }),
    }),
};

export interface TodaySale {
  id: string;
  sale_number: number;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string;
  note: string | null;
  inventory_synced: boolean;
  created_at: string;
  clients: { name: string; phone: string } | null;
  staff: { name: string } | null;
  sale_items: Array<{
    title: string;
    color: string | null;
    size: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    is_preorder: boolean;
  }>;
}
