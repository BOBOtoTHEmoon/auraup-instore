"use client";

import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { naira } from "@/lib/pos-client";
import { SHOP, type ReceiptData } from "@/lib/receipt";
import Wordmark from "./Wordmark";

/**
 * Shown after a sale and reopenable from Today or History.
 *
 * Two ways out: send the receipt to the customer as a PDF (via the phone's
 * share sheet, no caption, just the file), or print it. Nothing else, because
 * at a counter nothing else gets used.
 */
export default function Receipt({
  data,
  onClose,
}: {
  data: ReceiptData;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoData, setLogoData] = useState<string | null>(null);
  const paper = useRef<HTMLDivElement>(null);

  // Load the logo as inline data once. html-to-image can't reliably capture a
  // normal <img> on mobile (it may not have finished loading when the snapshot
  // is taken), but an embedded data URL is always there.
  useEffect(() => {
    let live = true;
    fetch("/auraup-logo.png")
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("no logo"))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(new Error("read failed"));
            fr.readAsDataURL(blob);
          })
      )
      .then((url) => live && setLogoData(url))
      .catch(() => {
        /* no logo file — the wordmark still carries the brand */
      });
    return () => {
      live = false;
    };
  }, []);

  // While this receipt is open, mark the body so the print stylesheet knows to
  // print only the receipt and hide the dashboard behind it.
  useEffect(() => {
    document.body.classList.add("receipt-open");
    return () => document.body.classList.remove("receipt-open");
  }, []);

  const fileStem = `auraup-receipt-${String(data.saleNumber).padStart(4, "0")}`;

  /** Render the receipt to a PDF sized to its own shape (no A4 whitespace). */
  const buildPdf = async (): Promise<Blob> => {
    const node = paper.current!;
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      cacheBust: true,
    });

    // Measure the rendered image so the PDF page matches its aspect ratio.
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image failed"));
      img.src = dataUrl;
    });

    const mmW = 80; // standard receipt width
    const mmH = (mmW * img.height) / img.width;

    const pdf = new jsPDF({ unit: "mm", format: [mmW, mmH] });
    pdf.addImage(dataUrl, "PNG", 0, 0, mmW, mmH);
    return pdf.output("blob");
  };

  const sendToCustomer = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const blob = await buildPdf();
      const file = new File([blob], `${fileStem}.pdf`, { type: "application/pdf" });

      const canShareFile =
        typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

      if (canShareFile) {
        // No title, no text — so WhatsApp attaches the PDF with no caption.
        await navigator.share({ files: [file] });
      } else {
        // Desktop or unsupported: download the PDF instead.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError("Could not make the receipt. Try Print.");
      }
    } finally {
      setBusy(false);
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

        {/* This block is the only thing that prints or exports. */}
        <div className="receipt" id="receipt" ref={paper}>
          {logoData && (
            <img className="receipt-logo-img" src={logoData} alt="" />
          )}
          <div className="receipt-brand">
            <Wordmark text={SHOP.name} size={22} letterSpacing={0.02} />
          </div>
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

        {/* Actions */}
        <div className="sheet-actions no-print">
          <button className="primary" onClick={sendToCustomer} disabled={busy}>
            {busy ? "Preparing\u2026" : "Send to customer"}
          </button>

          <button
            className="ghost-btn"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => window.print()}
          >
            Print
          </button>

          {error && <p className="err-note" style={{ marginTop: 10 }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
