import "server-only";

/**
 * Shopify Admin GraphQL client.
 *
 * Shopify deprecated permanent shpat_ tokens on 1 Jan 2026. Apps created
 * in the Dev Dashboard now get a Client ID + Client Secret, which we swap
 * for a short-lived access token via the client credentials grant.
 * Tokens last 24 hours, so we cache and refresh automatically.
 *
 * Never import this into a client component.
 */

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

/**
 * How long to wait for Shopify before giving up. Node's default connect
 * timeout is 10 seconds, which is an eternity with a customer at the counter.
 * Failing at 7 lets the cached catalogue take over sooner.
 */
const TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS) || 7000;

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export class ShopifyError extends Error {
  constructor(message: string, public detail?: unknown) {
    super(message);
    this.name = "ShopifyError";
  }
}

function assertConfig() {
  if (!DOMAIN) throw new ShopifyError("SHOPIFY_STORE_DOMAIN is not set");
  if (!CLIENT_ID) throw new ShopifyError("SHOPIFY_CLIENT_ID is not set");
  if (!CLIENT_SECRET) throw new ShopifyError("SHOPIFY_CLIENT_SECRET is not set");
}

/* ── Access token: fetch, cache, refresh ──────────────────────── */

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let inFlight: Promise<string> | null = null;

/** Returns a valid access token, fetching a fresh one when needed. */
export async function getAccessToken(): Promise<string> {
  assertConfig();

  // Refresh a minute early so a request never dies mid-flight.
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  // If two requests race, only one hits Shopify.
  if (inFlight) return inFlight;

  inFlight = requestToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function requestToken(): Promise<string> {
  const t = withTimeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID as string,
        client_secret: CLIENT_SECRET as string,
      }),
      cache: "no-store",
      signal: t.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ShopifyError(`Shopify did not respond within ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    t.done();
  }

  const raw = await res.text();

  if (!res.ok) {
    if (raw.includes("shop_not_permitted")) {
      throw new ShopifyError(
        "Shopify says shop_not_permitted. The app and the store must sit in the same " +
          "Dev Dashboard organisation. Open the Dev Dashboard, check the store appears " +
          "under your org, and confirm SHOPIFY_STORE_DOMAIN matches its myshopify domain exactly."
      );
    }
    if (raw.includes("invalid_client")) {
      throw new ShopifyError(
        "Shopify rejected the client credentials. Re-copy the Client ID and Client secret " +
          "from the Dev Dashboard app settings."
      );
    }
    throw new ShopifyError(`Token request failed (${res.status})`, raw);
  }

  let parsed: { access_token?: string; expires_in?: number; scope?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShopifyError("Token endpoint returned something that isn't JSON", raw);
  }

  if (!parsed.access_token) {
    throw new ShopifyError("Token response had no access_token", parsed);
  }

  cachedToken = parsed.access_token;
  tokenExpiresAt = Date.now() + (parsed.expires_in ?? 86399) * 1000;
  return cachedToken;
}

/* ── GraphQL ──────────────────────────────────────────────────── */

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
  attempt = 0
): Promise<T> {
  const token = await getAccessToken();

  const t = withTimeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: t.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ShopifyError(`Shopify did not respond within ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    t.done();
  }

  // Token went stale early. Drop the cache and try once more.
  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return shopifyGraphQL<T>(query, variables, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ShopifyError(
      "Shopify rejected the request. Check the app is installed on the store and has the " +
        "required scopes (read_products, read_inventory, write_inventory, read_locations)."
    );
  }

  if (res.status === 429) {
    if (attempt >= 3) throw new ShopifyError("Rate limited by Shopify, gave up after 3 retries");
    await sleep(1000 * (attempt + 1));
    return shopifyGraphQL<T>(query, variables, attempt + 1);
  }

  if (!res.ok) {
    throw new ShopifyError(`Shopify responded ${res.status}`, await safeText(res));
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    const throttled = json.errors.some(
      (e) => (e.extensions as { code?: string } | undefined)?.code === "THROTTLED"
    );
    if (throttled && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return shopifyGraphQL<T>(query, variables, attempt + 1);
    }
    throw new ShopifyError(json.errors.map((e) => e.message).join("; "), json.errors);
  }

  if (!json.data) throw new ShopifyError("Shopify returned no data");
  return json.data;
}

/** Used by /api/health to prove the whole chain works. */
export async function verifyShopifyConnection() {
  const data = await shopifyGraphQL<{ shop: { name: string; myshopifyDomain: string } }>(
    `query { shop { name myshopifyDomain } }`
  );
  return {
    ...data.shop,
    tokenExpiresAt: new Date(tokenExpiresAt).toISOString(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
