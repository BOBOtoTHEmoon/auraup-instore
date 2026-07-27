"use client";

import { useEffect, useRef, useState } from "react";
import { api, naira } from "@/lib/pos-client";
import { PRESETS, type RangePreset } from "@/lib/ranges";
import OrderSheet from "./OrderSheet";
import Receipt from "./Receipt";
import type { ReceiptData } from "@/lib/receipt";

type Source = "instore" | "online";

/**
 * The record. In-store and online sit in separate tabs because they're
 * genuinely different things: one has staff and a payment method, the other
 * has fulfilment status. Forcing them into one table would lose both.
 */
export default function History() {
  const [source, setSource] = useState<Source>("instore");
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [inStore, setInStore] = useState<InStoreData | null>(null);
  const [online, setOnline] = useState<OnlineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ range: preset });
  if (preset === "custom") {
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
  }
  const qs = params.toString();

  /* Switching tabs and ranges quickly leaves older requests in flight. Only
     the newest one is allowed to touch state, otherwise a slow failure can
     overwrite a fast success and you get last month's label on this month's
     numbers. */
  const requestId = useRef(0);
  // Reserved for future manual refresh; kept in the dependency array so a
  // change here would re-run the load.
  const reloadKey = 0;

  useEffect(() => {
    if (preset === "custom" && (!customFrom || !customTo)) return;

    const id = ++requestId.current;
    const current = () => requestId.current === id;

    setLoading(true);
    setError(null);

    const job =
      source === "instore"
        ? api.history(qs).then((d) => current() && setInStore(d))
        : api.onlineOrders(qs).then((d) => current() && setOnline(d));

    job
      .catch((e) => current() && setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => current() && setLoading(false));
  }, [source, qs, preset, customFrom, customTo, reloadKey]);

  const data = source === "instore" ? inStore : online;
  const showData = data && !error;

  return (
    <div className="today history">
      {/* ── controls ── */}
      <div className="history-bar no-print">
        <div className="segmented">
          <button data-on={source === "instore"} onClick={() => setSource("instore")}>
            In-store
          </button>
          <button data-on={source === "online"} onClick={() => setSource("online")}>
            Online
          </button>
        </div>

        <div className="filters">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              data-on={preset === p.key}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button data-on={preset === "custom"} onClick={() => setPreset("custom")}>
            Custom
          </button>
        </div>

        {preset === "custom" && (
          <div className="pair" style={{ marginTop: 10 }}>
            <input
              className="input"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <input
              className="input"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}

        <div className="history-actions">
          <a className="ghost-btn" href={`/api/export?source=${source}&${qs}`}>
            Download CSV
          </a>
          <button className="ghost-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {error && <p className="empty">{error}</p>}

      {loading && !data && (
        <div className="stats">
          <div className="skeleton" style={{ height: 104, gridColumn: "1 / -1" }} />
          <div className="skeleton" style={{ height: 84 }} />
          <div className="skeleton" style={{ height: 84 }} />
        </div>
      )}

      {showData && data && (
        <>
          <div className="print-header">
            <strong>AURAUP</strong>
            <span>
              {source === "instore" ? "In-store sales" : "Online orders"} &middot;{" "}
              {data.range.label}
            </span>
          </div>

          <div className="stats">
            <div className="stat" data-lead="true">
              <div className="stat-label">
                Revenue &middot; {data.range.label}
              </div>
              <div className="stat-value">{naira(data.totals.revenue)}</div>
              <div className="stat-sub">
                {source === "instore"
                  ? `${data.totals.count} sales${
                      (data as InStoreData).totals.voided
                        ? `, ${(data as InStoreData).totals.voided} voided`
                        : ""
                    }`
                  : `${data.totals.count} orders`}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                {source === "instore" ? "Sales" : "Orders"}
              </div>
              <div className="stat-value">{data.totals.count}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Units</div>
              <div className="stat-value">{data.totals.units}</div>
            </div>
          </div>

          {source === "instore" && inStore && (
            <InStoreDetail data={inStore} />
          )}

          {source === "online" && online && (
            <OnlineDetail data={online} />
          )}
        </>
      )}
    </div>
  );
}

/* ── In-store ─────────────────────────────────────────────────── */

type InStoreSale = InStoreData["sales"][number];

function InStoreDetail({ data }: { data: InStoreData }) {
  const payments = Object.entries(data.byPayment);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const [open, setOpen] = useState<InStoreSale | null>(null);

  // Bars in the movers chart are relative to the best-selling item by units.
  const topUnits = Math.max(1, ...data.byProduct.map((p) => p.units));

  return (
    <>
      {/* Two summaries share one card, so they read as a glance, not a log. */}
      {(data.byStaff.length > 0 || payments.length > 0) && (
        <div className="panel breakdown">
          {data.byStaff.length > 0 && (
            <div className="breakdown-col">
              <div className="panel-head">By staff</div>
              {data.byStaff.map((s) => (
                <div className="sale-row" key={s.name}>
                  <div>
                    <div className="sale-who">{s.name}</div>
                    <div className="sale-meta">
                      {plural(s.count, "sale")} · {plural(s.units, "unit")}
                    </div>
                  </div>
                  <div className="sale-total">{naira(s.revenue)}</div>
                </div>
              ))}
            </div>
          )}

          {payments.length > 0 && (
            <div className="breakdown-col">
              <div className="panel-head">By payment</div>
              {payments.map(([method, amount]) => (
                <div className="sale-row" key={method}>
                  <span className="sale-who" style={{ textTransform: "capitalize" }}>
                    {method}
                  </span>
                  <span className="sale-total">{naira(amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* A ranked bar chart, so it's clearly "what's selling" and not a price list. */}
      {data.byProduct.length > 0 && (
        <div className="panel">
          <div className="panel-head">What&apos;s selling</div>
          {data.byProduct.map((p, i) => (
            <div className="mover" key={p.title}>
              <div className="mover-top">
                <span className="mover-rank mono">{i + 1}</span>
                <span className="mover-name">{p.title.replace(/^AURAUP\s+/i, "")}</span>
                <span className="mover-units mono">{plural(p.units, "unit")}</span>
                <span className="mover-rev mono">{naira(p.revenue)}</span>
              </div>
              <div className="mover-bar">
                <span style={{ width: `${(p.units / topUnits) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          All sales
          <span className="panel-count mono">{data.sales.length}</span>
        </div>
        {data.sales.length === 0 ? (
          <p className="empty">Nothing in this period.</p>
        ) : (
          data.sales.map((s) => (
            <button
              className="sale-row tappable"
              key={s.id}
              data-voided={Boolean(s.voided_at)}
              onClick={() => setOpen(s)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="sale-who">
                  {s.clients?.name ?? "Walk-in"}
                  {s.voided_at && <span className="tag" data-tone="void">Voided</span>}
                </div>
                <div className="sale-items">
                  {s.sale_items
                    .map(
                      (i) =>
                        `${i.title.replace(/^AURAUP\s+/i, "")} ${[i.color, i.size]
                          .filter(Boolean)
                          .join("/")} ×${i.quantity}`
                    )
                    .join(",  ")}
                </div>
              </div>
              <div className="sale-right">
                <div className="sale-total">{naira(Number(s.total))}</div>
                <div className="sale-meta">
                  {new Date(s.created_at).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · {s.staff?.name ?? "—"}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {open && <SaleSheet sale={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ── One in-store sale, opened from the log ───────────────────── */

function saleToReceipt(s: InStoreSale): ReceiptData {
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

function SaleSheet({ sale, onClose }: { sale: InStoreSale; onClose: () => void }) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const when = new Date(sale.created_at).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (receipt) return <Receipt data={receipt} onClose={() => setReceipt(null)} />;

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-head">
          <span className="sheet-title">
            Sale <span className="mono">#{String(sale.sale_number).padStart(4, "0")}</span>
          </span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ticket-body">
          <div className="order-meta">
            <span>{when}</span>
            <span className="order-status">
              <span className="tag" data-tone="soft" style={{ textTransform: "capitalize" }}>
                {sale.payment_method}
              </span>
              {sale.voided_at && <span className="tag" data-tone="void">Voided</span>}
            </span>
          </div>

          <div className="rule" />

          {sale.sale_items.map((i, idx) => (
            <div className="order-line" key={idx}>
              <div className="line-main">
                <div className="line-name">{i.title.replace(/^AURAUP\s+/i, "")}</div>
                <div className="line-sub">
                  {[i.color, i.size].filter(Boolean).join(" / ") || "One size"} · qty {i.quantity}
                </div>
              </div>
              <div className="sale-total">{naira(Number(i.line_total))}</div>
            </div>
          ))}

          <div className="rule" data-dash="true" />

          <div className="totals-row">
            <span>Subtotal</span>
            <span>{naira(Number(sale.subtotal))}</span>
          </div>
          {Number(sale.discount) > 0 && (
            <div className="totals-row" data-kind="discount">
              <span>Discount</span>
              <span>−{naira(Number(sale.discount))}</span>
            </div>
          )}
          <div className="totals-row" data-kind="grand">
            <span>Total</span>
            <span>{naira(Number(sale.total))}</span>
          </div>

          <div className="totals-row">
            <span>Customer</span>
            <span>{sale.clients?.name ?? "Walk-in"}</span>
          </div>
          <div className="totals-row">
            <span>Served by</span>
            <span>{sale.staff?.name ?? "—"}</span>
          </div>

          {sale.voided_at && (
            <>
              <div className="rule" data-dash="true" />
              <p className="hint-note">
                Voided by {sale.voided_by_staff?.name ?? "staff"}
                {sale.void_reason ? ` · ${sale.void_reason}` : ""}. Stock was returned.
              </p>
            </>
          )}

          {sale.note && (
            <>
              <div className="rule" data-dash="true" />
              <div className="field-label" style={{ padding: 0, margin: "0 0 6px" }}>
                Note
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{sale.note}</p>
            </>
          )}

          <button
            className="primary"
            style={{ marginTop: 18 }}
            onClick={() => setReceipt(saleToReceipt(sale))}
          >
            Send receipt
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Online ───────────────────────────────────────────────────── */

function OnlineDetail({ data }: { data: OnlineData }) {
  const [open, setOpen] = useState<OrderDetail | null>(null);

  return (
    <div className="panel">
      <div className="panel-head">Orders from the website</div>
      {data.orders.length === 0 ? (
        <p className="empty">No online orders in this period.</p>
      ) : (
        data.orders.map((o) => (
          <button
            className="sale-row tappable"
            key={o.id}
            onClick={() => setOpen(o)}
          >
            <div style={{ minWidth: 0 }}>
              <div className="sale-who">
                {o.customer ?? o.name}
                {o.fulfillmentStatus && (
                  <span className="tag" data-tone="soft">
                    {o.fulfillmentStatus}
                  </span>
                )}
              </div>
              <div className="sale-items">
                {o.items
                  .map(
                    (i) =>
                      `${i.title.replace(/^AURAUP\s+/i, "")}${
                        i.variant ? " " + i.variant : ""
                      } ×${i.quantity}`
                  )
                  .join(",  ")}
              </div>
            </div>
            <div className="sale-right">
              <div className="sale-total">{naira(o.total)}</div>
              <div className="sale-meta">
                {new Date(o.createdAt).toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "short",
                })}{" "}
                &middot; {o.name} &middot; view
              </div>
            </div>
          </button>
        ))
      )}

      {open && (
        <OrderSheet
          order={open}
          storeHandle={data.storeHandle}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/* ── Shapes ───────────────────────────────────────────────────── */

interface Totals {
  count: number;
  revenue: number;
  units: number;
}

export interface InStoreData {
  range: { from: string; to: string; label: string };
  sales: Array<{
    id: string;
    sale_number: number;
    subtotal: number;
    total: number;
    discount: number;
    payment_method: string;
    note: string | null;
    created_at: string;
    voided_at: string | null;
    void_reason: string | null;
    clients: { name: string; phone: string } | null;
    staff: { name: string } | null;
    voided_by_staff: { name: string } | null;
    sale_items: Array<{
      title: string;
      color: string | null;
      size: string | null;
      quantity: number;
      line_total: number;
    }>;
  }>;
  totals: Totals & { voided: number; discount: number };
  byStaff: Array<{ name: string; revenue: number; count: number; units: number }>;
  byProduct: Array<{ title: string; units: number; revenue: number }>;
  byPayment: Record<string, number>;
}

export interface OrderDetail {
  id: string;
  legacyId: string;
  name: string;
  createdAt: string;
  note: string | null;
  customer: string | null;
  email: string | null;
  phone: string | null;
  shippingAddress: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  subtotal: number;
  discount: number;
  discountCodes: string[];
  shipping: number;
  shippingMethod: string | null;
  total: number;
  paid: number;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  gateways: string[];
  items: Array<{
    title: string;
    variant: string | null;
    quantity: number;
    total: number;
    image: string | null;
  }>;
}

export interface OnlineData {
  range: { from: string; to: string; label: string };
  orders: OrderDetail[];
  totals: Totals;
  /** Used to build the "open in Shopify" link */
  storeHandle: string;
}
