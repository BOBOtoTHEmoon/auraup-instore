"use client";

import { useEffect, useMemo, useState } from "react";
import { naira, type CartLine, type Product, type Variant } from "@/lib/pos-client";

/**
 * Pick each option the product actually has, then quantity.
 *
 * Products aren't always split by colour and size. Socks might be split by
 * style, a cap by fit. So this renders one selector per real option dimension,
 * whatever it's called, rather than assuming two fixed ones. Sold-out
 * combinations can't be tapped, and quantity is capped at real stock unless the
 * variant is pre-order.
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
  const dimensions = product.optionNames;
  const [broken, setBroken] = useState(false);
  const [qty, setQty] = useState(1);

  /** Chosen value per option dimension, e.g. { Colour: "Black", Size: "L" }. */
  const [choice, setChoice] = useState<Record<string, string>>({});

  // Preselect any dimension that only has one value, and reset on product swap.
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const name of dimensions) {
      const values = product.optionValues[name] ?? [];
      if (values.length === 1) initial[name] = values[0];
    }
    setChoice(initial);
    setQty(1);
  }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Does this variant match everything chosen so far? */
  const matches = (v: Variant, partial: Record<string, string>) =>
    Object.entries(partial).every((entry) =>
      v.options.some((o) => o.name === entry[0] && o.value === entry[1])
    );

  /** The variant that matches every dimension, once they're all chosen. */
  const selected: Variant | undefined = useMemo(() => {
    if (dimensions.length === 0) return product.variants[0];
    if (dimensions.some((name) => !choice[name])) return undefined;
    return product.variants.find((v) => matches(v, choice));
  }, [product.variants, dimensions, choice]);

  const maxQty = selected ? (selected.isPreorder ? 99 : Math.max(1, selected.stock)) : 1;

  const canAdd =
    Boolean(selected) && (selected!.isPreorder || selected!.stock > 0) && qty >= 1;

  /** Is there any in-stock (or pre-order) variant for this value, given the
      other choices already made? Drives whether a chip is tappable. */
  const valueAvailable = (name: string, value: string) => {
    const others = { ...choice };
    delete others[name];
    return product.variants.some(
      (v) =>
        v.options.some((o) => o.name === name && o.value === value) &&
        matches(v, others) &&
        (v.stock > 0 || v.isPreorder)
    );
  };

  const add = () => {
    if (!selected || !canAdd) return;
    onAdd({
      productId: product.id,
      variantId: selected.id,
      title: product.title,
      color: selected.color,
      // When a product isn't split by colour/size, carry its descriptor
      // (e.g. "Crew") through the size slot so it shows on the ticket and
      // receipt without needing new columns.
      size: selected.size ?? (selected.color ? null : selected.label || null),
      price: selected.price,
      quantity: qty,
      isPreorder: selected.isPreorder,
      image: selected.image ?? product.image,
    });
  };

  const soldOut = product.totalStock <= 0 && !product.isPreorder;

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

        {/* One selector per real option dimension. */}
        {dimensions.map((name) => (
          <div key={name}>
            <div className="field-label">{name}</div>
            <div className="chips">
              {(product.optionValues[name] ?? []).map((value) => {
                const available = valueAvailable(name, value);
                return (
                  <button
                    key={value}
                    className="chip"
                    data-on={choice[name] === value}
                    data-state={available ? undefined : "out"}
                    disabled={!available}
                    onClick={() => {
                      setChoice((c) => ({ ...c, [name]: value }));
                      setQty(1);
                    }}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

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
                  ? `Only ${selected.stock} left`
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
            {soldOut
              ? "Sold out"
              : !selected
                ? dimensions.length
                  ? `Choose ${dimensions[dimensions.findIndex((n) => !choice[n])] ?? "options"}`
                  : "Unavailable"
                : `Add to sale \u2014 ${naira(selected.price * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
