"use client";

import { useCallback, useEffect, useState } from "react";
import Logo from "@/components/Logo";
import PinPad from "@/components/PinPad";
import Catalog from "@/components/Catalog";
import VariantPicker from "@/components/VariantPicker";
import Ticket from "@/components/Ticket";
import Today from "@/components/Today";
import History from "@/components/History";
import Inventory from "@/components/Inventory";
import Receipt from "@/components/Receipt";
import type { ReceiptData } from "@/lib/receipt";
import {
  api,
  initials,
  naira,
  readLocalCatalog,
  saveLocalCatalog,
  timeAgo,
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
  /** When the catalogue on screen was last confirmed against Shopify. */
  const [catalogAge, setCatalogAge] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);

  const [tab, setTab] = useState<"sell" | "stock" | "today" | "history">("sell");
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [ticketOpen, setTicketOpen] = useState(false);

  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [toast, setToast] = useState<{
    title: string;
    sub: string;
    tone?: "warn";
  } | null>(null);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const [saleCounter, setSaleCounter] = useState(1);
  const [todayKey, setTodayKey] = useState(0);

  /* ── Session ─────────────────────────────────────────────── */

  const isOwner = staff?.role === "owner";

  useEffect(() => {
    api
      .session()
      .then((r) => {
        setStaff(r.staff);
        if (r.staff?.role === "owner") setTab("stock");
      })
      .catch(() => setStaff(null))
      .finally(() => setChecking(false));
  }, []);

  /* ── Catalog ─────────────────────────────────────────────── */

  const loadProducts = useCallback(async () => {
    // Paint whatever is on the device first, so the rack is never empty while
    // we wait on the network.
    const local = readLocalCatalog();
    if (local) {
      setProducts(local.products);
      setCatalogAge(local.syncedAt);
    }

    setLoadingProducts(!local);
    setProductError(null);

    try {
      const r = await api.products();
      setProducts(r.products);
      setCatalogAge(r.syncedAt);
      setCatalogStale(Boolean(r.stale));
      if (!r.stale) saveLocalCatalog(r.products, r.syncedAt);
    } catch (err) {
      // Falling back to the device copy is fine. Only complain if there
      // isn't one, because then there is genuinely nothing to sell from.
      if (local) {
        setCatalogStale(true);
      } else {
        setProductError(
          err instanceof Error ? err.message : "Could not load the catalogue"
        );
      }
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
    receipt: ReceiptData;
    units: number;
    synced: boolean;
  }) => {
    setCart([]);
    setTicketOpen(false);
    setSaleCounter(r.receipt.saleNumber + 1);
    setTodayKey((k) => k + 1);

    // Straight to the receipt, since the customer is still standing there.
    setReceipt(r.receipt);

    if (!r.synced) {
      setToast({
        title: "Sale saved, stock not synced",
        sub: "Shopify unreachable. It will retry.",
        tone: "warn",
      });
      setTimeout(() => setToast(null), 3200);
    }

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

  if (!staff)
    return (
      <PinPad
        onSignedIn={(s) => {
          setStaff(s);
          setTab(s.role === "owner" ? "stock" : "sell");
        }}
      />
    );

  return (
    <div className="shell">
      <header className="topbar">
        <Logo height={22} />

        <nav className="tabs">
          {isOwner ? (
            <button data-on={tab === "stock"} onClick={() => setTab("stock")}>
              Stock
            </button>
          ) : (
            <button data-on={tab === "sell"} onClick={() => setTab("sell")}>
              Sell
            </button>
          )}
          <button data-on={tab === "today"} onClick={() => setTab("today")}>
            Today
          </button>
          <button data-on={tab === "history"} onClick={() => setTab("history")}>
            History
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

      {catalogStale && !productError && catalogAge && (
        <div className="banner" data-tone="soft">
          <span>
            Showing saved products from {timeAgo(catalogAge)}. Stock may have
            moved since.
          </span>
          <button onClick={loadProducts}>Refresh</button>
        </div>
      )}

      {tab === "stock" ? (
        <Inventory
          products={products}
          loading={loadingProducts}
          onReload={loadProducts}
        />
      ) : tab === "history" ? (
        <History />
      ) : tab === "today" ? (
        <Today
          refreshKey={todayKey}
          onChanged={() => {
            // Voiding puts stock back, so the catalog on screen is stale.
            loadProducts();
            checkPending();
          }}
        />
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

      {tab === "sell" && !isOwner && cart.length > 0 && (
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

      {receipt && <Receipt data={receipt} onClose={() => setReceipt(null)} />}

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
