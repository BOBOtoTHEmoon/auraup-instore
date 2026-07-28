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

/* ── Local copy of the catalogue ──────────────────────────────── */

const CATALOG_KEY = "auraup.catalog.v1";

export interface StoredCatalog {
  products: Product[];
  syncedAt: string;
}

/**
 * Kept on the device so the rack appears the instant the app opens, and so
 * staff can still sell if the connection is gone before they even start.
 */
export function saveLocalCatalog(products: Product[], syncedAt: string) {
  try {
    localStorage.setItem(
      CATALOG_KEY,
      JSON.stringify({ products, syncedAt } satisfies StoredCatalog)
    );
  } catch {
    // Private browsing or a full quota. Not worth interrupting anyone over.
  }
}

export function readLocalCatalog(): StoredCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCatalog;
    return Array.isArray(parsed.products) && parsed.products.length
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** "3 minutes ago", for the staleness notice. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* ── API ──────────────────────────────────────────────────────── */

export interface Staff {
  id: string;
  name: string;
  role: "staff" | "owner";
}

/** Kept in sync with PIN_LENGTH on the server. */
export const PIN_LENGTH = Number(process.env.NEXT_PUBLIC_PIN_LENGTH) || 6;

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
    call<{ products: Product[]; syncedAt: string; stale: boolean }>(
      "/api/products"
    ),

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
      sale: {
        id: string;
        saleNumber: number;
        total: number;
        staff: string;
        createdAt: string;
      };
      inventorySynced: boolean;
      inventoryError: string | null;
    }>("/api/sales", { method: "POST", body: JSON.stringify(payload) }),

  todaysSales: () =>
    call<{ sales: TodaySale[] }>("/api/sales?today=1&limit=50"),

  pendingSyncs: () =>
    call<{ pending: Array<{ id: string; sale_number: number }>; count: number }>(
      "/api/sales/retry"
    ),

  history: (qs: string) =>
    call<import("@/components/History").InStoreData>(`/api/sales/history?${qs}`),

  onlineOrders: (qs: string) =>
    call<import("@/components/History").OnlineData>(`/api/orders?${qs}`),

  fulfilOrder: (payload: {
    orderId: string;
    trackingCompany?: string;
    trackingNumber?: string;
    notifyCustomer: boolean;
  }) =>
    call<{ fulfilled: boolean; orderName: string; notified: boolean }>(
      "/api/orders/fulfil",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  voidSale: (saleId: string, reason: string) =>
    call<{ voided: boolean; saleNumber: number; stockReturned: boolean }>(
      "/api/sales/void",
      { method: "POST", body: JSON.stringify({ saleId, reason }) }
    ),

  setStock: (inventoryItemId: string, quantity: number, expectedCurrent: number) =>
    call<{ ok: boolean; quantity: number }>("/api/inventory/set", {
      method: "POST",
      body: JSON.stringify({ inventoryItemId, quantity, expectedCurrent }),
    }),

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
  voided_at: string | null;
  void_reason: string | null;
  void_synced: boolean;
  clients: { name: string; phone: string } | null;
  staff: { name: string } | null;
  voided_by_staff: { name: string } | null;
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
