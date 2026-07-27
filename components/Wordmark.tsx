"use client";

/**
 * "AURAUP" in Montserrat (the Shopify store's font) with a light-to-heavy
 * weight ramp across the letters, matching the brand's progressive wordmark.
 * Being real text, it renders reliably when the receipt is flattened to PDF.
 */

// Montserrat weights loaded in layout.tsx. Spread evenly across the letters.
const WEIGHTS = [300, 400, 500, 600, 700, 900];

export default function Wordmark({
  text = "AURAUP",
  size = 20,
  color,
  letterSpacing = 0.02,
}: {
  text?: string;
  size?: number;
  color?: string;
  /** em — kept tight to match the store */
  letterSpacing?: number;
}) {
  const letters = [...text];
  const last = Math.max(1, letters.length - 1);

  return (
    <span
      className="wordmark-fx"
      style={{ fontSize: size, color, letterSpacing: `${letterSpacing}em` }}
      aria-label={text}
    >
      {letters.map((ch, i) => {
        const step = Math.round((i / last) * (WEIGHTS.length - 1));
        return (
          <span key={i} style={{ fontWeight: WEIGHTS[step] }} aria-hidden="true">
            {ch === " " ? "\u00A0" : ch}
          </span>
        );
      })}
    </span>
  );
}
