"use client";

import { useEffect, useMemo, useState } from "react";
import { naira, type CartLine, type Product, type Variant } from "@/lib/pos-client";

/**
 * Colour, then size, then quantity. Nothing reaches the sale without all three
 * being real: sold-out sizes can't be tapped, and quantity is capped at what's
 * actually on the shelf unless the variant is pre-order.
 */
export default function VariantPicker({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const hasColours = product.colors.length > 0;

  const [colour, setColour] = useState<string | null>(
    hasColours ? product.colors[0] : null
  );
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [broken, setBroken] = useState(false);

  /** Variants matching the chosen colour. */
  const inColour = useMemo(
    () => product.variants.filter((v) => (hasColours ? v.color === colour : true)),
    [product.variants, colour, hasColours]
  );

  // Reset the size whenever the colour changes, since availability differs.
  // If there's only one option, choose it so staff don't have to.
  useEffect(() => {
    setSize(inColour.length === 1 ? inColour[0].size : null);
    setQty(1);
  }, [colour, product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected: Variant | undefined = useMemo(
    () => inColour.find((v) => v.size === size) ?? (inColour.length === 1 ? inColour[0] : undefined),
    [inColour, size]
  );

  const maxQty = selected
    ? selected.isPreorder
      ? 99
      : Math.max(1, selected.stock)
    : 1;

  const canAdd =
    Boolean(selected) &&
    (selected!.isPreorder || selected!.stock > 0) &&
    qty >= 1;

  const add = () => {
    if (!selected || !canAdd) return;
    onAdd({
      productId: product.id,
      variantId: selected.id,
      title: product.title,
      color: selected.color,
      size: selected.size,
      price: selected.price,
      quantity: qty,
      isPreorder: selected.isPreorder,
      image: selected.image ?? product.image,
    });
  };

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-head">
          <span className="sheet-title">Add to sale</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="picker-hero">
          <div className="picker-thumb">
            {product.image && !broken ? (
              <img src={product.image} alt="" onError={() => setBroken(true)} />
            ) : null}
          </div>
          <div>
            <div className="picker-cat">{product.category}</div>
            <div className="picker-name">
              {product.title.replace(/^AURAUP\s+/i, "")}
            </div>
            <div className="picker-price mono">{naira(product.fromPrice)}</div>
          </div>
        </div>

        {hasColours && (
          <>
            <div className="field-label">Colour</div>
            <div className="chips">
              {product.colors.map((c) => {
                const any = product.variants.some(
                  (v) => v.color === c && (v.stock > 0 || v.isPreorder)
                );
                return (
                  <button
                    key={c}
                    className="chip"
                    data-on={colour === c}
                    data-state={any ? undefined : "out"}
                    disabled={!any}
                    onClick={() => setColour(c)}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {inColour.some((v) => v.size) && (
          <>
            <div className="field-label">Size</div>
            <div className="chips">
              {inColour.map((v) => {
                const out = !v.isPreorder && v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    className="chip"
                    data-on={size === v.size}
                    data-state={out ? "out" : v.isPreorder ? "preorder" : undefined}
                    disabled={out}
                    onClick={() => {
                      setSize(v.size);
                      setQty(1);
                    }}
                  >
                    {v.size ?? "One size"}
                    {v.isPreorder && <span className="chip-note">pre</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {selected && (
          <div
            className="availability"
            data-tone={
              selected.isPreorder ? "preorder" : selected.stock <= 2 ? "low" : undefined
            }
          >
            {selected.isPreorder
              ? "Pre-order \u2014 customer pays now, receives later"
              : selected.stock <= 0
                ? "Out of stock"
                : selected.stock <= 2
                  ? `Only ${selected.stock} left in this size`
                  : `${selected.stock} in stock`}
          </div>
        )}

        <div className="field-label">Quantity</div>
        <div className="stepper">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>
            &minus;
          </button>
          <output>{qty}</output>
          <button
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty}
          >
            +
          </button>
        </div>

        <div className="sheet-actions">
          <button className="primary" disabled={!canAdd} onClick={add}>
            {!selected
              ? "Select a size"
              : `Add to sale \u2014 ${naira(selected.price * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
