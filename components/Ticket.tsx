"use client";

import { useEffect, useRef, useState } from "react";
import { api, naira, type CartLine } from "@/lib/pos-client";
import Logo from "./Logo";

type Payment = "cash" | "transfer" | "card";

interface Returning {
  name: string;
  visitNumber: number;
  favouriteProduct: string | null;
}

/**
 * The sale itself. Lives in a bottom sheet on a phone and pinned to the right
 * on a counter laptop, but it's the same component either way.
 */
export default function Ticket({
  lines,
  saleNumber,
  onQty,
  onRemove,
  onRecorded,
  onClose,
  embedded = false,
}: {
  lines: CartLine[];
  saleNumber: number;
  onQty: (variantId: string, delta: number) => void;
  onRemove: (variantId: string) => void;
  onRecorded: (result: {
    saleNumber: number;
    total: number;
    units: number;
    client: string;
    synced: boolean;
  }) => void;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<Payment>("transfer");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState<Returning | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTouched = useRef(false);

  /* Look the customer up as the phone number is typed, but wait for a pause
     so we're not firing a request per keystroke. */
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 6) {
      setReturning(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.lookupClient(phone);
        if (res.found && res.client) {
          setReturning({
            name: res.client.name,
            visitNumber: res.visitNumber ?? 1,
            favouriteProduct: res.favouriteProduct ?? null,
          });
          // Fill the name for them, unless they've typed one themselves.
          if (!nameTouched.current) setName(res.client.name);
        } else {
          setReturning(null);
        }
      } catch {
        setReturning(null); // a failed lookup should never block a sale
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [phone]);

  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = subtotal - disc;
  const units = lines.reduce((sum, l) => sum + l.quantity, 0);

  const record = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await api.recordSale({
        client:
          name.trim() || phone.trim()
            ? { name: name.trim() || undefined, phone: phone.trim() || undefined }
            : undefined,
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          title: l.title,
          color: l.color,
          size: l.size,
          quantity: l.quantity,
          isPreorder: l.isPreorder,
        })),
        paymentMethod: payment,
        discount: disc,
        note: note.trim() || undefined,
      });

      onRecorded({
        saleNumber: result.sale.saleNumber,
        total: result.sale.total,
        units,
        client: name.trim() || "Walk-in",
        synced: result.inventorySynced,
      });

      setName("");
      setPhone("");
      setDiscount("");
      setNote("");
      setReturning(null);
      nameTouched.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the sale");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="ticket-body">
      {!embedded && (
        <div className="sheet-head" style={{ padding: "8px 0 0" }}>
          <span className="sheet-title">
            Sale ticket <span className="mono">#{String(saleNumber).padStart(4, "0")}</span>
          </span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
      )}

      {embedded && (
        <div className="sheet-head" style={{ padding: "16px 0 0" }}>
          <span className="ticket-brand">
            <Logo height={13} />
            <span className="sheet-title">Sale ticket</span>
          </span>
          <span className="mono" style={{ color: "var(--mute)", fontSize: 12 }}>
            #{String(saleNumber).padStart(4, "0")}
          </span>
        </div>
      )}

      <div className="rule" />

      {lines.length === 0 ? (
        <p className="empty">Tap a piece to begin the sale.</p>
      ) : (
        <>
          {lines.map((l) => (
            <div className="line" key={l.variantId}>
              <div className="line-main">
                <div className="line-name">{l.title.replace(/^AURAUP\s+/i, "")}</div>
                <div className="line-sub">
                  {[l.color, l.size].filter(Boolean).join(" / ") || "One size"} &middot;{" "}
                  {naira(l.price)}
                  {l.isPreorder && " \u00B7 pre-order"}
                </div>
              </div>
              <div className="mini-stepper">
                <button onClick={() => onQty(l.variantId, -1)} aria-label="Fewer">
                  &minus;
                </button>
                <output>{l.quantity}</output>
                <button onClick={() => onQty(l.variantId, 1)} aria-label="More">
                  +
                </button>
              </div>
              <button
                className="line-drop"
                onClick={() => onRemove(l.variantId)}
                aria-label="Remove"
              >
                &times;
              </button>
            </div>
          ))}

          <div className="rule" data-dash="true" />

          <input
            className="input"
            placeholder="Client name"
            value={name}
            onChange={(e) => {
              nameTouched.current = true;
              setName(e.target.value);
            }}
            autoComplete="off"
          />
          <input
            className="input"
            placeholder="Phone number"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
          />

          {returning && (
            <div className="returning">
              <b>Returning client</b> &middot; visit #{returning.visitNumber}
              {returning.favouriteProduct
                ? ` \u00B7 usually buys ${returning.favouriteProduct.replace(/^AURAUP\s+/i, "")}`
                : ""}
            </div>
          )}

          <div className="segmented">
            {(["cash", "transfer", "card"] as Payment[]).map((m) => (
              <button key={m} data-on={payment === m} onClick={() => setPayment(m)}>
                {m}
              </button>
            ))}
          </div>

          <div className="pair">
            <input
              className="input"
              placeholder="Discount &#8358;"
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))}
            />
            <input
              className="input"
              placeholder="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="rule" data-dash="true" />

          <div className="totals-row">
            <span>Subtotal</span>
            <span>{naira(subtotal)}</span>
          </div>
          {disc > 0 && (
            <div className="totals-row" data-kind="discount">
              <span>Discount</span>
              <span>&minus;{naira(disc)}</span>
            </div>
          )}
          <div className="totals-row" data-kind="grand">
            <span>Total</span>
            <span>{naira(total)}</span>
          </div>

          {error && (
            <p style={{ color: "var(--warn)", fontSize: 12.5, marginTop: 10 }}>{error}</p>
          )}

          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={record} disabled={busy}>
              {busy ? "Recording\u2026" : `Record sale \u2014 ${naira(total)}`}
            </button>
          </div>

          <p className="foot-note">
            Stock syncs to Shopify &middot; Westbrook Mall, Lekki
          </p>
        </>
      )}
    </div>
  );

  if (embedded) return <aside className="desk-ticket">{body}</aside>;

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div style={{ padding: "0 18px" }}>{body}</div>
      </div>
    </div>
  );
}
