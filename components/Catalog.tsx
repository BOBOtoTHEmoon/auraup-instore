"use client";

import { useMemo, useState } from "react";
import { naira, type Product } from "@/lib/pos-client";

/**
 * The rack. Two columns on a phone, more as the screen grows.
 * Tapping a tile never adds anything straight to the sale, it opens the
 * variant picker, because size and colour always have to be chosen.
 */
export default function Catalog({
  products,
  loading,
  onPick,
}: {
  products: Product[];
  loading: boolean;
  onPick: (p: Product) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => {
    const found = new Set(products.map((p) => p.category));
    return ["All", ...[...found].sort()];
  }, [products]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!q || p.title.toLowerCase().includes(q))
    );
  }, [products, query, category]);

  return (
    <section className="catalog">
      <input
        className="search"
        placeholder="Search the rack&#8230;"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
        autoComplete="off"
      />

      <div className="filters">
        {categories.map((c) => (
          <button key={c} data-on={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: "3 / 4.6" }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="empty">
          {query ? `Nothing matching \u201C${query}\u201D.` : "No products in this category."}
        </p>
      ) : (
        <div className="grid">
          {shown.map((p) => (
            <Tile key={p.id} product={p} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

function Tile({ product, onPick }: { product: Product; onPick: (p: Product) => void }) {
  const [broken, setBroken] = useState(false);

  const soldOut = product.totalStock <= 0 && !product.isPreorder;
  const flag = product.isPreorder ? "preorder" : soldOut ? "out" : product.totalStock <= 3 ? "low" : null;

  return (
    <button className="tile" onClick={() => onPick(product)}>
      <div className="tile-img">
        {product.image && !broken ? (
          <img
            src={product.image}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="tile-fallback">{product.title}</span>
        )}

        {flag && (
          <span className="flag" data-kind={flag}>
            {flag === "preorder" ? "Pre-order" : flag === "out" ? "Sold out" : "Low"}
          </span>
        )}
      </div>

      <div className="tile-body">
        <div className="tile-name">{product.title.replace(/^AURAUP\s+/i, "")}</div>
        <div className="tile-meta">
          <span className="tile-price">{naira(product.fromPrice)}</span>
        </div>
        {product.sizes.length > 0 && (
          <div className="tile-sizes">{product.sizes.join(" \u00B7 ")}</div>
        )}
      </div>
    </button>
  );
}
