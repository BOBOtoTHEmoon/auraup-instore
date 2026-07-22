"use client";

import { useState } from "react";
import { api, type Staff } from "@/lib/pos-client";
import Logo from "./Logo";

/**
 * Four taps and you're in. Deliberately the only thing on screen: staff use
 * this a dozen times a day and shouldn't have to read anything.
 */
export default function PinPad({ onSignedIn }: { onSignedIn: (s: Staff) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const press = async (digit: string) => {
    if (busy || pin.length >= 4) return;

    const next = pin + digit;
    setPin(next);
    setError(null);

    if (next.length < 4) return;

    setBusy(true);
    try {
      const { staff } = await api.signIn(next);
      onSignedIn(staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setTimeout(() => setPin(""), 450);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-inner">
        <div className="signin-logo">
          <Logo height={44} />
        </div>
        <div className="signin-sub">QUIET STRENGTH IN MOTION</div>

        <div className="pips" data-error={Boolean(error)}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} data-on={pin.length > i} />
          ))}
        </div>

        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy}>
              {d}
            </button>
          ))}
          <span />
          <button onClick={() => press("0")} disabled={busy}>
            0
          </button>
          <button
            onClick={() => {
              setPin((p) => p.slice(0, -1));
              setError(null);
            }}
            aria-label="Delete"
          >
            &#9003;
          </button>
        </div>

        <div className="signin-note" data-error={Boolean(error)}>
          {error ?? (busy ? "Checking\u2026" : "Enter your staff PIN")}
        </div>
      </div>
    </div>
  );
}
