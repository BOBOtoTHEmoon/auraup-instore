import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS, so this must never
 * be imported into a client component or exposed to the browser.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

export const db = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ── Row types, mirroring schema.sql ──────────────────────────── */

export interface StaffRow {
  id: string;
  name: string;
  pin_hash: string;
  is_active: boolean;
  created_at: string;
}

export interface ClientRow {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaleRow {
  id: string;
  sale_number: number;
  client_id: string | null;
  staff_id: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: "cash" | "transfer" | "card";
  note: string | null;
  inventory_synced: boolean;
  inventory_error: string | null;
  created_at: string;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  inventory_item_id: string | null;
  title: string;
  color: string | null;
  size: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  is_preorder: boolean;
  created_at: string;
}

export interface ClientStatsRow {
  client_id: string;
  name: string;
  phone: string;
  visit_count: number;
  lifetime_value: number;
  last_visit: string | null;
}
