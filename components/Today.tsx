"use client";

import { useEffect, useMemo, useState } from "react";
import { api, naira, type TodaySale } from "@/lib/pos-client";
import Receipt from "./Receipt";
import type { ReceiptData } from "@/lib/receipt";

/** What Ebuka opens at the end of the day. */
export default function Today({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged?: () => void;
}) {
  const [sales, setSales] = useState<TodaySale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<TodaySale | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .todaysSales()
      .then((r) => live && setSales(r.sales))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load"));
    return () => {
      live = false;
    };
  }, [refreshKey, reload]);

  /** Voided sales are shown but never counted. */
  const stats = useMemo(() => {
    if (!sales) return null;
    const live = sales.filter((s) => !s.voided_at);

    const revenue = live.reduce((s, x) => s + Number(x.total), 0);
    const units = live.reduce(
      (s, x) => s + x.sale_items.reduce((a, i) => a + i.quantity, 0),
      0
    );

    const byProduct = new Map<string, number>();
    live.forEach((s) =>
      s.sale_items.forEach((i) =>
        byProduct.set(i.title, (byProduct.get(i.title) ?? 0) + i.quantity)
      )
    );

    return {
      revenue,
      units,
      count: live.length,
      voided: sales.length - live.length,
      top: [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [sales]);

  if (error) return <p className="empty">{error}</p>;

  if (!sales || !stats) {
    return (
      <div className="today">
        <div className="stats">
          <div className="skeleton" style={{ height: 104, gridColumn: "1 / -1" }} />
          <div className="skeleton" style={{ height: 84 }} />
          <div className="skeleton" style={{ height: 84 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="today">
      <div className="stats">
        <div className="stat" data-lead="true">
          <div className="stat-label">Revenue today</div>
          <div className="stat-value">{naira(stats.revenue)}</div>
          <div className="stat-sub">
            {stats.count === 0
              ? "No sales logged yet"
              : `across ${stats.count} sale${stats.count === 1 ? "" : "s"}`}
            {stats.voided > 0 && `, ${stats.voided} voided`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Sales</div>
          <div className="stat-value">{stats.count}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Units</div>
          <div className="stat-value">{stats.units}</div>
        </div>
      </div>

      {stats.top.length > 0 && (
        <div className="panel">
          <div className="panel-head">Moving today</div>
          {stats.top.map(([title, qty]) => (
            <div className="sale-row" key={title}>
              <span className="sale-who">{title.replace(/^AURAUP\s+/i, "")}</span>
              <span className="sale-meta">{qty} sold</span>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">Sales</div>
        {sales.length === 0 ? (
          <p className="empty">Nothing yet today.</p>
        ) : (
          sales.map((s) => (
            <div
              className="sale-row"
              key={s.id}
              data-voided={Boolean(s.voided_at)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="sale-who">
                  {s.clients?.name ?? "Walk-in"}
                  {s.voided_at && <span className="tag" data-tone="void">Voided</span>}
                  {!s.voided_at && !s.inventory_synced && (
                    <span className="tag" data-tone="warn">Not synced</span>
                  )}
                </div>
                <div className="sale-items">
                  {s.sale_items
                    .map(
                      (i) =>
                        `${i.title.replace(/^AURAUP\s+/i, "")} ${[i.color, i.size]
                          .filter(Boolean)
                          .join("/")} \u00D7${i.quantity}`
                    )
                    .join(",  ")}
                </div>
                {s.voided_at && (
                  <div className="sale-items">
                    Voided by {s.voided_by_staff?.name ?? "staff"}
                    {s.void_reason ? ` \u00B7 ${s.void_reason}` : ""}
                  </div>
                )}
              </div>

              <div className="sale-right">
                <div className="sale-total">{naira(Number(s.total))}</div>
                <div className="sale-meta">
                  {s.payment_method} &middot; {s.staff?.name ?? "\u2014"}
                </div>
                <div className="row-actions">
                  <button className="void-btn" onClick={() => setReceipt(toReceipt(s))}>
                    Receipt
                  </button>
                  {!s.voided_at && (
                    <button className="void-btn" onClick={() => setVoiding(s)}>
                      Void
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {receipt && <Receipt data={receipt} onClose={() => setReceipt(null)} />}

      {voiding && (
        <VoidDialog
          sale={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            setReload((r) => r + 1);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

/** A stored sale, reshaped into what the receipt needs. */
function toReceipt(s: TodaySale): ReceiptData {
  return {
    saleNumber: s.sale_number,
    createdAt: s.created_at,
    staffName: s.staff?.name ?? "Staff",
    clientName: s.clients?.name ?? null,
    clientPhone: s.clients?.phone ?? null,
    paymentMethod: s.payment_method,
    subtotal: Number(s.subtotal),
    discount: Number(s.discount),
    total: Number(s.total),
    lines: s.sale_items.map((i) => ({
      title: i.title,
      color: i.color,
      size: i.size,
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
  };
}

/* ── Void confirmation ────────────────────────────────────────── */

function VoidDialog({
  sale,
  onClose,
  onDone,
}: {
  sale: TodaySale;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.voidSale(sale.id, reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void");
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-head">
          <span className="sheet-title">Void sale</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ticket-body">
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            Cancelling sale{" "}
            <span className="mono">#{String(sale.sale_number).padStart(4, "0")}</span> for{" "}
            <b>{sale.clients?.name ?? "Walk-in"}</b>, {naira(Number(sale.total))}.
          </p>
          <p style={{ fontSize: 13, color: "var(--mute)", marginTop: 8, lineHeight: 1.5 }}>
            The stock goes back to Shopify. The sale stays in the history marked as
            voided, so nothing disappears.
          </p>

          <input
            className="input"
            style={{ marginTop: 14 }}
            placeholder="Reason, e.g. wrong size"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />

          {error && (
            <p style={{ color: "var(--warn)", fontSize: 12.5 }}>{error}</p>
          )}

          <button
            className="primary"
            style={{ marginTop: 8 }}
            onClick={submit}
            disabled={busy || reason.trim().length < 2}
          >
            {busy ? "Voiding\u2026" : "Void and return stock"}
          </button>
        </div>
      </div>
    </div>
  );
}
