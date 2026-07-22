"use client";

import { useCallback, useEffect, useState } from "react";
import Logo from "@/components/Logo";
import PinPad from "@/components/PinPad";
import Catalog from "@/components/Catalog";
import VariantPicker from "@/components/VariantPicker";
import Ticket from "@/components/Ticket";
import Today from "@/components/Today";
import {
  api,
  initials,
  naira,
  type CartLine,
  type Product,
  type Staff,
} from "@/lib/pos-client";

export default function Page() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checking, setChecking] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [tab, setTab] = useState<"sell" | "today">("sell");
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [ticketOpen, setTicketOpen] = useState(false);

  const [toast, setToast] = useState<{
    title: string;
    sub: string;
    tone?: "warn";
  } | null>(null);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const [saleCounter, setSaleCounter] = useState(1);
  const [todayKey, setTodayKey] = useState(0);

  /* ── Session ─────────────────────────────────────────────── */

  useEffect(() => {
    api
      .session()
      .then((r) => setStaff(r.staff))
      .catch(() => setStaff(null))
      .finally(() => setChecking(false));
  }, []);

  /* ── Catalog ─────────────────────────────────────────────── */

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setProductError(null);
    try {
      const r = await api.products();
      setProducts(r.products);
    } catch (err) {
      setProductError(
        err instanceof Error ? err.message : "Could not load the catalog"
      );
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const checkPending = useCallback(async () => {
    try {
      const r = await api.pendingSyncs();
      setPendingSyncs(r.count);
    } catch {
      /* not worth bothering staff about */
    }
  }, []);

  useEffect(() => {
    if (!staff) return;
    loadProducts();
    checkPending();
  }, [staff, loadProducts, checkPending]);

  /* ── Cart ────────────────────────────────────────────────── */

  const addLine = (line: CartLine) => {
    setCart((c) => {
      const found = c.find((x) => x.variantId === line.variantId);
      return found
        ? c.map((x) =>
            x.variantId === line.variantId
              ? { ...x, quantity: x.quantity + line.quantity }
              : x
          )
        : [...c, line];
    });
    setPicking(null);
  };

  const changeQty = (variantId: string, delta: number) =>
    setCart((c) =>
      c.map((x) =>
        x.variantId === variantId
          ? { ...x, quantity: Math.max(1, x.quantity + delta) }
          : x
      )
    );

  const removeLine = (variantId: string) =>
    setCart((c) => c.filter((x) => x.variantId !== variantId));

  const cartUnits = cart.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = cart.reduce((s, l) => s + l.price * l.quantity, 0);

  /* ── After a sale ────────────────────────────────────────── */

  const handleRecorded = (r: {
    saleNumber: number;
    total: number;
    units: number;
    client: string;
    synced: boolean;
  }) => {
    setCart([]);
    setTicketOpen(false);
    setSaleCounter(r.saleNumber + 1);
    setTodayKey((k) => k + 1);

    setToast(
      r.synced
        ? {
            title: "Sale recorded",
            sub: `${r.client} \u00B7 ${r.units} item${r.units === 1 ? "" : "s"} \u00B7 ${naira(r.total)}`,
          }
        : {
            title: "Sale saved, stock not synced",
            sub: "Shopify unreachable. It will retry.",
            tone: "warn",
          }
    );
    setTimeout(() => setToast(null), 3200);

    // Stock moved, so the catalog on screen is stale.
    loadProducts();
    checkPending();
  };

  const retryPending = async () => {
    try {
      const r = await api.retryAll();
      setToast({
        title: `${r.succeeded} of ${r.retried} synced`,
        sub: r.succeeded === r.retried ? "All caught up." : "Some still pending.",
        tone: r.succeeded === r.retried ? undefined : "warn",
      });
      setTimeout(() => setToast(null), 3000);
      checkPending();
      loadProducts();
    } catch {
      setToast({ title: "Retry failed", sub: "Check the connection.", tone: "warn" });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const signOut = async () => {
    await api.signOut().catch(() => {});
    setStaff(null);
    setCart([]);
    setProducts([]);
  };

  /* ── Render ──────────────────────────────────────────────── */

  if (checking) {
    return (
      <div className="signin">
        <div className="signin-inner">
          <Logo height={34} />
        </div>
      </div>
    );
  }

  if (!staff) return <PinPad onSignedIn={setStaff} />;

  return (
    <div className="shell">
      <header className="topbar">
        <Logo height={22} />

        <nav className="tabs">
          <button data-on={tab === "sell"} onClick={() => setTab("sell")}>
            Sell
          </button>
          <button data-on={tab === "today"} onClick={() => setTab("today")}>
            Today
          </button>
        </nav>

        <button className="who" onClick={signOut} title="Sign out">
          <span className="avatar">{initials(staff.name)}</span>
          <span className="who-name">{staff.name}</span>
        </button>
      </header>

      {pendingSyncs > 0 && (
        <div className="banner">
          <span>
            {pendingSyncs} sale{pendingSyncs === 1 ? "" : "s"} not synced to Shopify
          </span>
          <button onClick={retryPending}>Retry</button>
        </div>
      )}

      {productError && (
        <div className="banner">
          <span>{productError}</span>
          <button onClick={loadProducts}>Reload</button>
        </div>
      )}

      {tab === "today" ? (
        <Today refreshKey={todayKey} />
      ) : (
        <div className="split">
          <Catalog
            products={products}
            loading={loadingProducts}
            onPick={setPicking}
          />

          <Ticket
            embedded
            lines={cart}
            saleNumber={saleCounter}
            onQty={changeQty}
            onRemove={removeLine}
            onRecorded={handleRecorded}
          />
        </div>
      )}

      {tab === "sell" && cart.length > 0 && (
        <button className="cartbar" onClick={() => setTicketOpen(true)}>
          <span>
            <span className="cartbar-count">
              {cartUnits} item{cartUnits === 1 ? "" : "s"}
            </span>
            <br />
            <span className="cartbar-total">{naira(cartTotal)}</span>
          </span>
          <span className="cartbar-cta">Review sale &rarr;</span>
        </button>
      )}

      {picking && (
        <VariantPicker
          product={picking}
          onClose={() => setPicking(null)}
          onAdd={addLine}
        />
      )}

      {ticketOpen && (
        <Ticket
          lines={cart}
          saleNumber={saleCounter}
          onQty={changeQty}
          onRemove={removeLine}
          onRecorded={handleRecorded}
          onClose={() => setTicketOpen(false)}
        />
      )}

      {toast && (
        <div className="toast" data-tone={toast.tone}>
          <span className="toast-tick">{toast.tone === "warn" ? "!" : "\u2713"}</span>
          <div>
            <div className="toast-title">{toast.title}</div>
            <div className="toast-sub">{toast.sub}</div>
          </div>
        </div>
      )}
    </div>
  );
}
