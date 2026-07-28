"use client";

import { useMemo, useState } from "react";
import { api, naira, type Product, type Variant } from "@/lib/pos-client";

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
  onEdited,
}: {
  products: Product[];
  loading: boolean;
  onReload: () => void;
  /** Optimistically update a variant's stock after a successful edit. */
  onEdited: (productId: string, variantId: string, newStock: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ product: Product; variant: Variant } | null>(
    null
  );

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
        shown.map((p) => (
          <StockCard
            key={p.id}
            product={p}
            onEdit={(variant) => setEditing({ product: p, variant })}
          />
        ))
      )}

      {editing && (
        <EditSheet
          product={editing.product}
          variant={editing.variant}
          onClose={() => setEditing(null)}
          onSaved={(newStock) => {
            onEdited(editing.product.id, editing.variant.id, newStock);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Editing one variant's stock ──────────────────────────────── */

function EditSheet({
  product,
  variant,
  onClose,
  onSaved,
}: {
  product: Product;
  variant: Variant;
  onClose: () => void;
  onSaved: (newStock: number) => void;
}) {
  const [value, setValue] = useState(String(variant.stock));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    [variant.color, variant.size].filter(Boolean).join(" / ") || "One size";

  const save = async () => {
    const qty = Number.parseInt(value, 10);
    if (Number.isNaN(qty) || qty < 0) {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    if (qty === variant.stock) {
      onClose();
      return;
    }
    if (!variant.inventoryItemId) {
      setError("This variant can't be edited here. Set it up in Shopify first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await api.setStock(variant.inventoryItemId, qty, variant.stock);
      onSaved(res.quantity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update stock");
      setBusy(false);
    }
  };

  const step = (delta: number) => {
    const n = Number.parseInt(value, 10);
    setValue(String(Math.max(0, (Number.isNaN(n) ? variant.stock : n) + delta)));
  };

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-head">
          <span className="sheet-title">Edit stock</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ticket-body">
          <div className="picker-name" style={{ fontSize: 17 }}>
            {product.title.replace(/^AURAUP\s+/i, "")}
          </div>
          <div className="stock-sub" style={{ marginBottom: 16 }}>
            {label} &middot; was {variant.stock} in stock
          </div>

          <div className="edit-stepper">
            <button onClick={() => step(-1)} aria-label="Fewer">
              &minus;
            </button>
            <input
              className="edit-input"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
              autoFocus
            />
            <button onClick={() => step(1)} aria-label="More">
              +
            </button>
          </div>

          {error && (
            <p className="err-note" style={{ marginTop: 12 }}>{error}</p>
          )}

          <button
            className="primary"
            style={{ marginTop: 16 }}
            onClick={save}
            disabled={busy}
          >
            {busy ? "Saving\u2026" : "Save to Shopify"}
          </button>

          <p className="foot-note" style={{ marginTop: 12 }}>
            Updates the website stock straight away.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── One product, colour down the side, size across ────────────── */

function StockCard({
  product,
  onEdit,
}: {
  product: Product;
  onEdit: (variant: Variant) => void;
}) {
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

                  const editable = Boolean(v.inventoryItemId);

                  return (
                    <td key={s ?? "one"} data-state={state} className="cell">
                      {editable ? (
                        <button
                          className="cell-edit"
                          onClick={() => onEdit(v)}
                          title="Tap to edit stock"
                        >
                          {v.isPreorder ? "pre" : v.stock}
                        </button>
                      ) : v.isPreorder ? (
                        "pre"
                      ) : (
                        v.stock
                      )}
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
