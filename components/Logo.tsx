"use client";

import { useState } from "react";

/**
 * The AuraUp mark. Falls back to the wordmark if the image file is missing,
 * so a bad path never leaves a blank corner at the counter.
 *
 * Put the logo at: public/auraup-logo.png
 */
export default function Logo({
  height = 20,
  onDark = false,
}: {
  height?: number;
  onDark?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="wordmark" style={{ fontSize: height * 0.82 }}>
        AURAUP
      </span>
    );
  }

  return (
    <img
      src="/auraup-logo.png"
      alt="AuraUp"
      className="logo"
      data-on-dark={onDark}
      style={{ height }}
      onError={() => setFailed(true)}
    />
  );
}
