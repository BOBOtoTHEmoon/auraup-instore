"use client";

import { useMemo, useState } from "react";
import { naira, type Product, type Variant } from "@/lib/pos-client";

type Filter = "all" | "low" | "out" | "preorder";

/**
 * The owner's view of the rack.
 *
 * Every variant's stock laid out as colour by size, because "how many black
 * hoodies in L" is the question, and a flat list of variants makes you count.
 */
export default function Inventory({
  products,
  loading,
  onReload,
}: {
  products: Product[];
  loading: boolean;
  onReload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    let outOfStock = 0;
    let low = 0;
    let variants = 0;

    for (const p of products) {
      for (const v of p.variants) {
        variants += 1;
        if (v.isPreorder) continue;
        units += Math.max(0, v.stock);
        value += Math.max(0, v.stock) * v.price;
        if (v.stock <= 0) outOfStock += 1;
        else if (v.stock <= 2) low += 1;
      }
    }
    return { units, value, outOfStock, low, variants };
  }, [products]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q)) return false;

      switch (filter) {
        case "low":
          return p.variants.some((v) => !v.isPreorder && v.stock > 0 && v.stock <= 2);
        case "out":
          return p.variants.some((v) => !v.isPreorder && v.stock <= 0);
        case "preorder":
          return p.isPreorder || p.variants.some((v) => v.isPreorder);
        default:
          return true;
      }
    });
  }, [products, query, filter]);

  return (
    <div className="today">
      <div className="stats">
        <div className="stat" data-lead="true">
          <div className="stat-label">Stock value at retail</div>
          <div className="stat-value">{naira(totals.value)}</div>
          <div className="stat-sub">
            {totals.units} units across {totals.variants} variants
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Out of stock</div>
          <div className="stat-value">{totals.outOfStock}</div>
          <div className="stat-sub">variants</div>
        </div>
        <div className="stat">
          <div className="stat-label">Running low</div>
          <div className="stat-value">{totals.low}</div>
          <div className="stat-sub">2 or fewer</div>
        </div>
      </div>

      <div className="history-bar no-print" style={{ marginTop: 14 }}>
        <input
          className="search"
          type="search"
          placeholder="Search products&#8230;"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filters" style={{ marginTop: 10 }}>
          {(
            [
              ["all", "Everything"],
              ["low", "Running low"],
              ["out", "Out of stock"],
              ["preorder", "Pre-order"],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <button key={key} data-on={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="history-actions">
          <button className="ghost-btn" onClick={onReload}>
            Refresh from Shopify
          </button>
          <button className="ghost-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {loading && products.length === 0 ? (
        <>
          <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </>
      ) : shown.length === 0 ? (
        <p className="empty">Nothing matches that.</p>
      ) : (
        shown.map((p) => <StockCard key={p.id} product={p} />)
      )}
    </div>
  );
}

/* ── One product, colour down the side, size across ────────────── */

function StockCard({ product }: { product: Product }) {
  const [broken, setBroken] = useState(false);

  /* Sizes in the order Shopify gives them, not alphabetical, so S M L XL
     stays in the order a human expects. */
  const sizes = product.sizes.length ? product.sizes : [null];
  const colors = product.colors.length ? product.colors : [null];

  const find = (color: string | null, size: string | null): Variant | undefined =>
    product.variants.find(
      (v) => (color === null || v.color === color) && (size === null || v.size === size)
    );

  const units = product.variants.reduce(
    (sum, v) => sum + (v.isPreorder ? 0 : Math.max(0, v.stock)),
    0
  );
  const value = product.variants.reduce(
    (sum, v) => sum + (v.isPreorder ? 0 : Math.max(0, v.stock) * v.price),
    0
  );

  return (
    <div className="panel stock-card">
      <div className="stock-head">
        <div className="stock-thumb">
          {product.image && !broken ? (
            <img src={product.image} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="stock-name">{product.title.replace(/^AURAUP\s+/i, "")}</div>
          <div className="stock-sub">
            {product.category} &middot; {naira(product.fromPrice)}
            {product.isPreorder && (
              <span className="tag" data-tone="soft">Pre-order</span>
            )}
          </div>
        </div>
        <div className="stock-right">
          <div className="sale-total">{units}</div>
          <div className="sale-meta">{naira(value)}</div>
        </div>
      </div>

      <div className="grid-scroll">
        <table className="stock-grid">
          <thead>
            <tr>
              <th />
              {sizes.map((s) => (
                <th key={s ?? "one"}>{s ?? "One size"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c ?? "default"}>
                <th>{c ?? "Stock"}</th>
                {sizes.map((s) => {
                  const v = find(c, s);
                  if (!v) return <td key={s ?? "one"} className="none">&ndash;</td>;

                  const state = v.isPreorder
                    ? "preorder"
                    : v.stock <= 0
                      ? "out"
                      : v.stock <= 2
                        ? "low"
                        : "ok";

                  return (
                    <td key={s ?? "one"} data-state={state}>
                      {v.isPreorder ? "pre" : v.stock}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
