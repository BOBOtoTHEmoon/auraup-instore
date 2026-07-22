"use client";

import { useEffect, useMemo, useState } from "react";
import { api, naira, type TodaySale } from "@/lib/pos-client";

/** What Ebuka opens at the end of the day. */
export default function Today({ refreshKey }: { refreshKey: number }) {
  const [sales, setSales] = useState<TodaySale[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .todaysSales()
      .then((r) => live && setSales(r.sales))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load"));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const stats = useMemo(() => {
    if (!sales) return null;
    const revenue = sales.reduce((s, x) => s + Number(x.total), 0);
    const units = sales.reduce(
      (s, x) => s + x.sale_items.reduce((a, i) => a + i.quantity, 0),
      0
    );

    const byProduct = new Map<string, number>();
    sales.forEach((s) =>
      s.sale_items.forEach((i) =>
        byProduct.set(i.title, (byProduct.get(i.title) ?? 0) + i.quantity)
      )
    );

    return {
      revenue,
      units,
      count: sales.length,
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
            <div className="sale-row" key={s.id}>
              <div style={{ minWidth: 0 }}>
                <div className="sale-who">
                  {s.clients?.name ?? "Walk-in"}
                  {!s.inventory_synced && <span className="unsynced">not synced</span>}
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
                  {s.payment_method} &middot; {s.staff?.name ?? "\u2014"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
