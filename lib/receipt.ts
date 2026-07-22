"use client";

import { naira } from "./pos-client";

/**
 * Receipts.
 *
 * The main delivery route is WhatsApp, because that's what customers in Lagos
 * actually use and staff already have the number. Print is there for anyone
 * who wants paper.
 */

export interface ReceiptLine {
  title: string;
  color: string | null;
  size: string | null;
  quantity: number;
  lineTotal: number;
}

export interface ReceiptData {
  saleNumber: number;
  createdAt: string;
  staffName: string;
  clientName: string | null;
  clientPhone: string | null;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  lines: ReceiptLine[];
}

/* ── Shop details, overridable without touching code ──────────── */

export const SHOP = {
  name: process.env.NEXT_PUBLIC_SHOP_NAME || "AURAUP",
  tagline: process.env.NEXT_PUBLIC_SHOP_TAGLINE || "Quiet Strength In Motion",
  address:
    process.env.NEXT_PUBLIC_SHOP_ADDRESS ||
    "Shop 39, Westbrook Mall, Chisco, Ikate Lekki, Lagos",
  website: process.env.NEXT_PUBLIC_SHOP_WEBSITE || "auraupstore.com",
  social: process.env.NEXT_PUBLIC_SHOP_SOCIAL || "@auraupstore",
};

/* ── Phone numbers ────────────────────────────────────────────── */

/**
 * WhatsApp wants an international number with no plus and no spaces.
 * Nigerian numbers get written every which way, so handle the common ones:
 *   0803 123 4567  ->  2348031234567
 *   +2348031234567 ->  2348031234567
 *   8031234567     ->  2348031234567
 * Anything already long and foreign is left alone, since AuraUp ships abroad.
 */
export function toWhatsAppNumber(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits;
  if (digits.length > 10) return digits; // already international
  return null;
}

/* ── The text version ─────────────────────────────────────────── */

export function buildReceiptText(r: ReceiptData): string {
  const when = new Date(r.createdAt).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines: string[] = [];

  lines.push(`*${SHOP.name}*`);
  lines.push(SHOP.tagline);
  lines.push("");
  lines.push(`Receipt #${String(r.saleNumber).padStart(4, "0")}`);
  lines.push(when);
  if (r.clientName) lines.push(`For: ${r.clientName}`);
  lines.push(`Served by ${r.staffName}`);
  lines.push("");

  for (const item of r.lines) {
    const variant = [item.color, item.size].filter(Boolean).join(" / ");
    lines.push(
      `${item.title.replace(/^AURAUP\s+/i, "")}${variant ? ` (${variant})` : ""} x${item.quantity}`
    );
    lines.push(`   ${naira(item.lineTotal)}`);
  }

  lines.push("");
  lines.push(`Subtotal: ${naira(r.subtotal)}`);
  if (r.discount > 0) lines.push(`Discount: -${naira(r.discount)}`);
  lines.push(`*Total: ${naira(r.total)}*`);
  lines.push(`Paid by ${r.paymentMethod}`);
  lines.push("");
  lines.push(SHOP.address);
  lines.push(SHOP.website);
  lines.push(SHOP.social);
  lines.push("");
  lines.push("Thank you for shopping with us.");

  return lines.join("\n");
}

export function whatsAppLink(r: ReceiptData): string | null {
  const number = toWhatsAppNumber(r.clientPhone);
  const text = encodeURIComponent(buildReceiptText(r));
  // Without a number this still opens WhatsApp with the text ready to send,
  // so staff can pick the contact themselves.
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}
