"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { naira } from "@/lib/pos-client";
import Logo from "./Logo";
import {
  SHOP,
  buildReceiptText,
  whatsAppLink,
  toWhatsAppNumber,
  type ReceiptData,
} from "@/lib/receipt";

/**
 * Shown straight after a sale, and reopenable from Today.
 *
 * Three ways out: WhatsApp (the one people will actually use), copy, or print.
 * The printed version is sized for an 80mm till roll but falls back fine on A4.
 */
export default function Receipt({
  data,
  onClose,
}: {
  data: ReceiptData;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const paper = useRef<HTMLDivElement>(null);

  const hasNumber = Boolean(toWhatsAppNumber(data.clientPhone));

  /**
   * Renders the receipt to a PNG and hands it to the phone's share sheet, so
   * the customer gets a proper branded image in WhatsApp rather than text.
   * Desktop has no share sheet, so it downloads instead.
   */
  const shareImage = async () => {
    if (!paper.current || busy) return;
    setBusy(true);
    setImageError(null);

    try {
      const dataUrl = await toPng(paper.current, {
        // 2x so it stays crisp when someone pinches to zoom
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });

      const blob = await (await fetch(dataUrl)).blob();
      const file = new File(
        [blob],
        `auraup-receipt-${String(data.saleNumber).padStart(4, "0")}.png`,
        { type: "image/png" }
      );

      const canShareFile =
        typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

      if (canShareFile) {
        await navigator.share({
          files: [file],
          title: `AuraUp receipt #${String(data.saleNumber).padStart(4, "0")}`,
        });
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = file.name;
        link.click();
      }
    } catch (err) {
      // A cancelled share sheet isn't a failure, it's someone changing their mind.
      if ((err as Error)?.name !== "AbortError") {
        setImageError("Could not make the image. Send the text instead.");
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildReceiptText(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const when = new Date(data.createdAt).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip no-print" />

        <div className="sheet-head no-print">
          <span className="sheet-title">Receipt</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* ── The receipt itself, this is what prints ── */}
        <div className="receipt" id="receipt" ref={paper}>
          <div className="receipt-logo">
            <Logo height={26} />
          </div>
          <div className="receipt-brand">{SHOP.name}</div>
          <div className="receipt-tagline">{SHOP.tagline}</div>

          <div className="receipt-rule" />

          <div className="receipt-meta">
            <div>
              <span>Receipt</span>
              <span>#{String(data.saleNumber).padStart(4, "0")}</span>
            </div>
            <div>
              <span>Date</span>
              <span>{when}</span>
            </div>
            {data.clientName && (
              <div>
                <span>Customer</span>
                <span>{data.clientName}</span>
              </div>
            )}
            <div>
              <span>Served by</span>
              <span>{data.staffName}</span>
            </div>
          </div>

          <div className="receipt-rule" data-dash="true" />

          {data.lines.map((line, i) => {
            const variant = [line.color, line.size].filter(Boolean).join(" / ");
            return (
              <div className="receipt-line" key={i}>
                <div>
                  <div className="receipt-item">
                    {line.title.replace(/^AURAUP\s+/i, "")}
                  </div>
                  <div className="receipt-variant">
                    {variant || "One size"} &times; {line.quantity}
                  </div>
                </div>
                <div className="receipt-amount">{naira(line.lineTotal)}</div>
              </div>
            );
          })}

          <div className="receipt-rule" data-dash="true" />

          <div className="receipt-total-row">
            <span>Subtotal</span>
            <span>{naira(data.subtotal)}</span>
          </div>
          {data.discount > 0 && (
            <div className="receipt-total-row">
              <span>Discount</span>
              <span>&minus;{naira(data.discount)}</span>
            </div>
          )}
          <div className="receipt-total-row" data-grand="true">
            <span>Total</span>
            <span>{naira(data.total)}</span>
          </div>
          <div className="receipt-total-row">
            <span>Paid by</span>
            <span style={{ textTransform: "capitalize" }}>{data.paymentMethod}</span>
          </div>

          <div className="receipt-rule" />

          <div className="receipt-foot">
            <div>{SHOP.address}</div>
            <div>{SHOP.website}</div>
            <div>{SHOP.social}</div>
            <div className="receipt-thanks">Thank you for shopping with us.</div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="sheet-actions no-print">
          <button className="primary" onClick={shareImage} disabled={busy}>
            {busy ? "Preparing\u2026" : "Send as image"}
          </button>

          <a
            className="ghost-btn"
            style={{ marginTop: 10, width: "100%" }}
            href={whatsAppLink(data) ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            {hasNumber ? "Send as text on WhatsApp" : "Share as text on WhatsApp"}
          </a>

          {imageError && <p className="err-note" style={{ marginTop: 10 }}>{imageError}</p>}

          {!hasNumber && (
            <p className="hint-note" style={{ marginTop: 8 }}>
              No phone number on this sale, so WhatsApp will ask you to pick the
              contact.
            </p>
          )}

          <div className="history-actions" style={{ marginTop: 10 }}>
            <button className="ghost-btn" onClick={copy}>
              {copied ? "Copied" : "Copy text"}
            </button>
            <button className="ghost-btn" onClick={() => window.print()}>
              Print
            </button>
          </div>

          <button className="link-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
