"use client";

import { useState } from "react";
import { naira } from "@/lib/pos-client";
import type { OrderDetail } from "./History";

/**
 * One online order, opened from the history list.
 *
 * Read-only. Fulfilment stays in Shopify, so there's a button to jump straight
 * to this order there rather than a half-built version of Shopify's own flow.
 */
export default function OrderSheet({
  order,
  storeHandle,
  onClose,
}: {
  order: OrderDetail;
  storeHandle: string;
  onClose: () => void;
}) {
  const address = order.shippingAddress;

  const addressLines = address
    ? [
        address.name,
        address.line1,
        address.line2,
        [address.city, address.province].filter(Boolean).join(", "),
        [address.zip, address.country].filter(Boolean).join(" "),
      ].filter(Boolean)
    : [];

  const outstanding = order.total - order.paid;

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />

        <div className="sheet-head">
          <span className="sheet-title">Order {order.name}</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ticket-body">
          <div className="order-meta">
            <span>
              {new Date(order.createdAt).toLocaleString("en-NG", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="order-status">
              {order.financialStatus && (
                <span className="tag" data-tone="soft">{order.financialStatus}</span>
              )}
              {order.fulfillmentStatus && (
                <span className="tag" data-tone="soft">{order.fulfillmentStatus}</span>
              )}
            </span>
          </div>

          <div className="rule" />

          {/* ── Items ── */}
          {order.items.map((item, i) => (
            <div className="order-line" key={i}>
              <div className="order-thumb">
                {item.image ? <img src={item.image} alt="" /> : null}
              </div>
              <div className="line-main">
                <div className="line-name">{item.title.replace(/^AURAUP\s+/i, "")}</div>
                <div className="line-sub">
                  {item.variant ?? "One size"} &middot; qty {item.quantity}
                </div>
              </div>
              <div className="sale-total">{naira(item.total)}</div>
            </div>
          ))}

          <div className="rule" data-dash="true" />

          {/* ── Money ── */}
          <div className="totals-row">
            <span>Subtotal</span>
            <span>{naira(order.subtotal)}</span>
          </div>

          {order.discount > 0 && (
            <div className="totals-row" data-kind="discount">
              <span>
                Discount
                {order.discountCodes.length > 0 && ` (${order.discountCodes.join(", ")})`}
              </span>
              <span>&minus;{naira(order.discount)}</span>
            </div>
          )}

          {order.shipping > 0 && (
            <div className="totals-row">
              <span>Shipping{order.shippingMethod ? ` (${order.shippingMethod})` : ""}</span>
              <span>{naira(order.shipping)}</span>
            </div>
          )}

          <div className="totals-row" data-kind="grand">
            <span>Total</span>
            <span>{naira(order.total)}</span>
          </div>

          <div className="totals-row">
            <span>Paid{order.gateways.length > 0 && ` via ${order.gateways.join(", ")}`}</span>
            <span>{naira(order.paid)}</span>
          </div>

          {outstanding > 0.5 && (
            <div className="totals-row" data-kind="discount">
              <span>Outstanding</span>
              <span>{naira(outstanding)}</span>
            </div>
          )}

          {/* ── Customer, only when Shopify lets us read it ── */}
          {(order.customer || addressLines.length > 0) && (
            <>
              <div className="rule" data-dash="true" />
              <div className="field-label" style={{ padding: 0, margin: "0 0 8px" }}>
                Ship to
              </div>
              <div className="address">
                {addressLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {order.phone && <div className="mono">{order.phone}</div>}
                {order.email && <div className="mono">{order.email}</div>}
              </div>
            </>
          )}

          {!order.customer && addressLines.length === 0 && (
            <>
              <div className="rule" data-dash="true" />
              <p className="hint-note">
                Customer and address are hidden. Add the <b>read_customers</b> scope to
                the app in the Shopify Dev Dashboard to show them here.
              </p>
            </>
          )}

          {order.note && (
            <>
              <div className="rule" data-dash="true" />
              <div className="field-label" style={{ padding: 0, margin: "0 0 6px" }}>
                Customer note
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{order.note}</p>
            </>
          )}

          <a
            className="primary"
            style={{ display: "grid", placeItems: "center", marginTop: 18, textDecoration: "none" }}
            href={`https://admin.shopify.com/store/${storeHandle}/orders/${order.legacyId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Shopify to fulfil
          </a>
        </div>
      </div>
    </div>
  );
}
