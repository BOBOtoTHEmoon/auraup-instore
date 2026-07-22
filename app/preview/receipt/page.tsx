"use client";

import { useState } from "react";
import Receipt from "@/components/Receipt";
import type { ReceiptData } from "@/lib/receipt";

/**
 * A receipt with made-up data, at /preview/receipt.
 *
 * Exists so the layout can be checked on a phone, and shown to the client,
 * without recording a real sale or needing a connection to anything.
 */
const SAMPLE: ReceiptData = {
  saleNumber: 42,
  createdAt: new Date().toISOString(),
  staffName: "Precious",
  clientName: "Chioma",
  clientPhone: "08031234567",
  paymentMethod: "transfer",
  subtotal: 260000,
  discount: 10000,
  total: 250000,
  lines: [
    {
      title: "AURAUP MONOGRAM HOODIE",
      color: "Black",
      size: "L",
      quantity: 1,
      lineTotal: 120000,
    },
    {
      title: "AURAUP CROP TEE",
      color: "Bone",
      size: "S",
      quantity: 2,
      lineTotal: 140000,
    },
  ],
};

export default function ReceiptPreview() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <div className="signin">
        <div className="signin-inner">
          <p className="empty">Preview closed.</p>
          <button className="primary" onClick={() => setOpen(true)}>
            Show the receipt again
          </button>
        </div>
      </div>
    );
  }

  return <Receipt data={SAMPLE} onClose={() => setOpen(false)} />;
}
