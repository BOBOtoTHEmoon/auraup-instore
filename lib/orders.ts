import "server-only";
import { shopifyGraphQL } from "./shopify";

/**
 * Online orders, read from Shopify.
 *
 * In-store sales never create Shopify orders (they only adjust inventory), so
 * there's no overlap between these and the sales table. Nothing double counts.
 */

export interface OrderAddress {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export interface OnlineOrder {
  id: string;
  legacyId: string;
  name: string;
  createdAt: string;
  note: string | null;

  customer: string | null;
  email: string | null;
  phone: string | null;
  shippingAddress: OrderAddress | null;

  subtotal: number;
  discount: number;
  discountCodes: string[];
  shipping: number;
  shippingMethod: string | null;
  total: number;
  paid: number;
  currency: string;

  financialStatus: string | null;
  fulfillmentStatus: string | null;
  gateways: string[];

  items: Array<{
    title: string;
    variant: string | null;
    quantity: number;
    total: number;
    image: string | null;
  }>;
}

/**
 * Customer details and shipping addresses are protected customer data. Without
 * the read_customers scope Shopify rejects the entire query rather than
 * returning null for those fields, so we ask once, and if refused we drop them
 * and carry on without for the rest of the process.
 */
let customerFieldBlocked = false;

export const customerNamesUnavailable = () => customerFieldBlocked;

const ORDERS_QUERY = (withCustomer: boolean) => /* GraphQL */ `
  query OnlineOrders($cursor: String, $query: String!) {
    orders(
      first: 40
      after: $cursor
      query: $query
      sortKey: CREATED_AT
      reverse: true
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        name
        createdAt
        note
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        discountCodes
        subtotalPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalReceivedSet { shopMoney { amount } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingLine { title }
        ${
          withCustomer
            ? `customer { displayName email phone }
               shippingAddress {
                 name address1 address2 city province zip country phone
               }`
            : ""
        }
        lineItems(first: 25) {
          nodes {
            title
            quantity
            variantTitle
            image { url }
            originalTotalSet { shopMoney { amount } }
          }
        }
      }
    }
  }
`;

interface Money {
  shopMoney: { amount: string; currencyCode?: string };
}

interface RawOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  note: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  paymentGatewayNames: string[];
  discountCodes: string[];
  subtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalReceivedSet: Money;
  totalPriceSet: Money;
  shippingLine: { title: string } | null;
  customer?: { displayName: string; email: string | null; phone: string | null } | null;
  shippingAddress?: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  lineItems: {
    nodes: Array<{
      title: string;
      quantity: number;
      variantTitle: string | null;
      image: { url: string } | null;
      originalTotalSet: Money | null;
    }>;
  };
}

const num = (m: Money | null | undefined) =>
  Number.parseFloat(m?.shopMoney.amount ?? "0") || 0;

export async function fetchOnlineOrders(
  from: string,
  to: string
): Promise<OnlineOrder[]> {
  try {
    return await run(from, to, !customerFieldBlocked);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      !customerFieldBlocked &&
      /read_customers|customer field|shippingAddress|protected customer/i.test(message)
    ) {
      customerFieldBlocked = true;
      return run(from, to, false);
    }
    throw err;
  }
}

async function run(
  from: string,
  to: string,
  withCustomer: boolean
): Promise<OnlineOrder[]> {
  const query = `created_at:>='${from}' AND created_at:<='${to}'`;

  const out: OnlineOrder[] = [];
  let cursor: string | null = null;
  let guard = 0;

  do {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawOrder[];
      };
    } = await shopifyGraphQL(ORDERS_QUERY(withCustomer), { cursor, query });

    for (const o of data.orders.nodes) {
      out.push({
        id: o.id,
        legacyId: o.legacyResourceId,
        name: o.name,
        createdAt: o.createdAt,
        note: o.note,

        customer: o.customer?.displayName ?? null,
        email: o.customer?.email ?? null,
        phone: o.customer?.phone ?? o.shippingAddress?.phone ?? null,
        shippingAddress: o.shippingAddress
          ? {
              name: o.shippingAddress.name,
              line1: o.shippingAddress.address1,
              line2: o.shippingAddress.address2,
              city: o.shippingAddress.city,
              province: o.shippingAddress.province,
              zip: o.shippingAddress.zip,
              country: o.shippingAddress.country,
              phone: o.shippingAddress.phone,
            }
          : null,

        subtotal: num(o.subtotalPriceSet),
        discount: num(o.totalDiscountsSet),
        discountCodes: o.discountCodes ?? [],
        shipping: num(o.totalShippingPriceSet),
        shippingMethod: o.shippingLine?.title ?? null,
        total: num(o.totalPriceSet),
        paid: num(o.totalReceivedSet),
        currency: o.totalPriceSet.shopMoney.currencyCode ?? "NGN",

        financialStatus: o.displayFinancialStatus,
        fulfillmentStatus: o.displayFulfillmentStatus,
        gateways: o.paymentGatewayNames ?? [],

        items: o.lineItems.nodes.map((li) => ({
          title: li.title,
          variant: li.variantTitle,
          quantity: li.quantity,
          total: num(li.originalTotalSet),
          image: li.image?.url ?? null,
        })),
      });
    }

    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    guard += 1;
  } while (cursor && guard < 40);

  return out;
}
