"use client";

import { useEffect, useRef, useState } from "react";
import { api, naira } from "@/lib/pos-client";
import { PRESETS, type RangePreset } from "@/lib/ranges";
import OrderSheet from "./OrderSheet";

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
  }, [source, qs, preset, customFrom, customTo]);

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

          {source === "online" && online && <OnlineDetail data={online} />}
        </>
      )}
    </div>
  );
}

/* ── In-store ─────────────────────────────────────────────────── */

function InStoreDetail({ data }: { data: InStoreData }) {
  const payments = Object.entries(data.byPayment);

  return (
    <>
      {data.byStaff.length > 0 && (
        <div className="panel">
          <div className="panel-head">Who sold what</div>
          {data.byStaff.map((s) => (
            <div className="sale-row" key={s.name}>
              <div>
                <div className="sale-who">{s.name}</div>
                <div className="sale-meta">
                  {s.count} sale{s.count === 1 ? "" : "s"} &middot; {s.units} units
                </div>
              </div>
              <div className="sale-right">
                <div className="sale-total">{naira(s.revenue)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <div className="panel">
          <div className="panel-head">By payment method</div>
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

      {data.byProduct.length > 0 && (
        <div className="panel">
          <div className="panel-head">Top movers</div>
          {data.byProduct.map((p) => (
            <div className="sale-row" key={p.title}>
              <span className="sale-who">{p.title.replace(/^AURAUP\s+/i, "")}</span>
              <div className="sale-right">
                <div className="sale-total">{naira(p.revenue)}</div>
                <div className="sale-meta">{p.units} units</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">Every sale</div>
        {data.sales.length === 0 ? (
          <p className="empty">Nothing in this period.</p>
        ) : (
          data.sales.map((s) => (
            <div className="sale-row" key={s.id} data-voided={Boolean(s.voided_at)}>
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
                          .join("/")} \u00D7${i.quantity}`
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
                  &middot; {s.staff?.name ?? "\u2014"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
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
                      } \u00D7${i.quantity}`
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
    total: number;
    discount: number;
    payment_method: string;
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
