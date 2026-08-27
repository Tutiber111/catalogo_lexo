type Profile = {
  id: string;
  role: "admin" | "salesman" | "customer";
  salesman_code: string | null;
};

type SalesClient = {
  id: string;
  client_code: string;
  name: string;
  legal_name: string;
  address: string;
  locality: string;
  salesman_code: string;
};

type GuestLink = {
  id: string;
  sales_client_id: string | null;
  salesman_code: string | null;
  created_by: string;
  otp_hash: string;
  session_token_hash: string;
  link_token_ciphertext: string;
  failed_attempts: number;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type OrderLineInput = {
  productId?: string;
  quantity?: number;
  page?: number;
};

const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await readJson(req);
    const action = String(body.action || "");
    if (action === "create") return jsonResponse(await createGuestLink(req, body));
    if (action === "list") return jsonResponse(await listGuestLinks(req, body));
    if (action === "revoke") return jsonResponse(await revokeGuestLink(req, body));
    if (action === "redeem") return jsonResponse(await redeemGuestLink(body));
    if (action === "validate") return jsonResponse(await validateGuestSession(body));
    if (action === "submit_order") return jsonResponse(await submitGuestOrder(body));
    throw new HttpError(400, "Unknown guest access action.");
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
  }
});

async function createGuestLink(req: Request, body: Record<string, unknown>) {
  const profile = await loadAuthenticatedProfile(req);
  if (!profile || !["admin", "salesman"].includes(profile.role)) {
    throw new HttpError(403, "Only admins and salesmen can create client access links.");
  }

  const salesmanCode = profile.salesman_code || null;
  if (profile.role === "salesman" && !salesmanCode) {
    throw new HttpError(409, "Your salesman account does not have a salesman code.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_LIFETIME_MS).toISOString();
  const linkToken = randomToken(32);
  const password = randomOtp();
  const linkTokenHash = await sha256(linkToken);
  const otpHash = await sha256(`${linkToken}:${password}`);
  const linkTokenCiphertext = await encryptLinkToken(linkToken);

  const response = await serviceFetch("/rest/v1/catalog_guest_links", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      sales_client_id: null,
      salesman_code: salesmanCode,
      created_by: profile.id,
      link_token_hash: linkTokenHash,
      link_token_ciphertext: linkTokenCiphertext,
      otp_hash: otpHash,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    }),
  });
  const rows = await response.json();
  if (!rows[0]?.id) throw new Error("The access link could not be saved.");

  const accessUrl = buildAccessUrl(String(body.base_url || ""), linkToken);
  return {
    id: rows[0].id,
    access_url: accessUrl,
    one_time_password: password,
    expires_at: expiresAt,
    client: null,
    salesman_code: salesmanCode,
  };
}

async function listGuestLinks(req: Request, body: Record<string, unknown>) {
  const profile = await loadAuthenticatedProfile(req);
  if (!profile || !["admin", "salesman"].includes(profile.role)) {
    throw new HttpError(403, "Only admins and salesmen can view access links.");
  }

  const params = new URLSearchParams({
    select: "id,sales_client_id,salesman_code,created_by,link_token_ciphertext,expires_at,redeemed_at,revoked_at,created_at",
    order: "created_at.desc",
    limit: "100",
  });
  if (profile.role !== "admin") params.set("created_by", `eq.${profile.id}`);
  const response = await serviceFetch(`/rest/v1/catalog_guest_links?${params}`);
  const rows = await response.json();
  const links = await Promise.all(rows.map(async (link: GuestLink) => {
    let accessUrl = "";
    if (link.link_token_ciphertext) {
      try {
        accessUrl = buildAccessUrl(String(body.base_url || ""), await decryptLinkToken(link.link_token_ciphertext));
      } catch (error) {
        console.error("Could not recover guest link URL", link.id, error);
      }
    }
    return {
      id: link.id,
      salesman_code: link.salesman_code,
      expires_at: link.expires_at,
      redeemed_at: link.redeemed_at,
      revoked_at: link.revoked_at,
      created_at: link.created_at,
      access_url: accessUrl,
    };
  }));
  return { links };
}

async function revokeGuestLink(req: Request, body: Record<string, unknown>) {
  const profile = await loadAuthenticatedProfile(req);
  if (!profile || !["admin", "salesman"].includes(profile.role)) {
    throw new HttpError(403, "Only admins and salesmen can revoke access links.");
  }
  const linkId = String(body.link_id || "").trim();
  if (!linkId) throw new HttpError(400, "Choose an access link.");
  const params = new URLSearchParams({ id: `eq.${linkId}`, select: "id,created_by", limit: "1" });
  const response = await serviceFetch(`/rest/v1/catalog_guest_links?${params}`);
  const rows = await response.json();
  const link = rows[0];
  if (!link) throw new HttpError(404, "Access link not found.");
  if (profile.role !== "admin" && link.created_by !== profile.id) {
    throw new HttpError(403, "You can only revoke links you created.");
  }
  const revokedAt = new Date().toISOString();
  await patchLink(linkId, { revoked_at: revokedAt });
  return { id: linkId, revoked_at: revokedAt };
}

async function redeemGuestLink(body: Record<string, unknown>) {
  const linkToken = String(body.link_token || "").trim();
  const password = String(body.one_time_password || "").replace(/\s+/g, "");
  if (!linkToken || !/^\d{6}$/.test(password)) {
    throw new HttpError(400, "Enter the six-digit one-time password.");
  }

  const linkTokenHash = await sha256(linkToken);
  const link = await loadLink("link_token_hash", linkTokenHash);
  assertLinkCanBeRedeemed(link);

  const expectedOtpHash = await sha256(`${linkToken}:${password}`);
  if (expectedOtpHash !== link.otp_hash) {
    const failedAttempts = Number(link.failed_attempts || 0) + 1;
    await patchLink(link.id, {
      failed_attempts: failedAttempts,
      last_attempt_at: new Date().toISOString(),
    });
    if (failedAttempts >= MAX_OTP_ATTEMPTS) {
      await patchLink(link.id, { revoked_at: new Date().toISOString() });
      throw new HttpError(429, "This link was blocked after too many incorrect attempts. Ask your salesman for a new link.");
    }
    throw new HttpError(401, "Incorrect one-time password.");
  }

  const sessionToken = randomToken(32);
  const sessionTokenHash = await sha256(sessionToken);
  const redeemedAt = new Date().toISOString();
  const params = new URLSearchParams({
    id: `eq.${link.id}`,
    redeemed_at: "is.null",
    revoked_at: "is.null",
    select: "id",
  });
  const response = await serviceFetch(`/rest/v1/catalog_guest_links?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      session_token_hash: sessionTokenHash,
      redeemed_at: redeemedAt,
      failed_attempts: 0,
      last_attempt_at: redeemedAt,
      updated_at: redeemedAt,
    }),
  });
  const rows = await response.json();
  if (!rows.length) throw new HttpError(409, "This one-time link has already been used.");

  const client = link.sales_client_id ? await loadSalesClient(link.sales_client_id) : null;
  if (link.sales_client_id && !client) throw new HttpError(404, "The client linked to this access no longer exists.");
  return guestSessionResponse(sessionToken, link, client);
}

async function validateGuestSession(body: Record<string, unknown>) {
  const session = await loadGuestSession(String(body.session_token || ""));
  return guestSessionResponse(String(body.session_token || ""), session.link, session.client);
}

async function submitGuestOrder(body: Record<string, unknown>) {
  const session = await loadGuestSession(String(body.session_token || ""));
  const clientRequestId = requiredUuid(body.client_request_id, "client_request_id");
  const submittedItems = Array.isArray(body.items) ? body.items as OrderLineInput[] : [];
  const deliveryAddress = Object.prototype.hasOwnProperty.call(body, "delivery_address")
    ? cleanText(body.delivery_address, 500)
    : null;
  const requestHash = await sha256(JSON.stringify({
    guestLinkId: session.link.id,
    customerName: cleanText(body.customer_name, 300),
    clientCode: cleanText(body.client_code, 100),
    deliveryAddress,
    transport: cleanText(body.transport, 200),
    notes: cleanText(body.notes, 2000),
    items: submittedItems.slice(0, 250).map((item) => ({
      productId: String(item.productId || "").trim(),
      quantity: Math.trunc(Number(item.quantity || 0)),
      page: Number.isFinite(Number(item.page)) ? Math.trunc(Number(item.page)) : null,
    })),
  }));
  const existingOrder = await loadOrderByClientRequestId(
    clientRequestId,
    session.link.created_by,
  );
  if (existingOrder) {
    if (existingOrder.client_request_hash !== requestHash) {
      throw new HttpError(409, "This order identifier was already used with different data.");
    }
    const notification = await requestOrderNotification(String(existingOrder.id));
    return {
      order_id: existingOrder.id,
      order_number: existingOrder.order_number,
      total_items: existingOrder.total_items,
      total_value: existingOrder.total_value,
      notification,
    };
  }
  const lines = await validatedOrderLines(submittedItems);
  if (!lines.length) throw new HttpError(400, "Add products before sending the order.");

  const totalItems = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalValue = lines.reduce((sum, line) => sum + line.line_total, 0);
  const submittedName = cleanText(body.customer_name, 300);
  const submittedClientCode = cleanText(body.client_code, 100);
  let client = session.client;
  if (!client && submittedClientCode) {
    client = await loadSalesClientByCode(submittedClientCode, session.link.salesman_code);
  }
  const customerName = client?.legal_name || client?.name || submittedName;
  if (!customerName) throw new HttpError(400, "Enter the client name before sending the order.");
  const clientCode = client?.client_code || submittedClientCode;
  const salesmanCode = client?.salesman_code || session.link.salesman_code || null;
  const orderPayload = {
    customer_id: session.link.created_by,
    client_request_id: clientRequestId,
    status: "placed",
    customer_name: customerName,
    customer_phone: "",
    customer_client_code: clientCode,
    sales_client_id: client?.id || null,
    sales_client_code: clientCode,
    sales_client_name: customerName,
    sales_client_address: deliveryAddress ?? client?.address ?? "",
    sales_client_locality: client?.locality || "",
    salesman_code: salesmanCode,
    order_transport: cleanText(body.transport, 200),
    notes: cleanText(body.notes, 2000),
    total_items: totalItems,
    total_value: totalValue,
  };
  let order: Record<string, unknown> | null = null;
  try {
    const orderResponse = await serviceFetch("/rest/v1/orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...orderPayload, client_request_hash: requestHash }),
    });
    const orderRows = await orderResponse.json();
    order = orderRows[0] || null;
  } catch (error) {
    order = await loadOrderByClientRequestId(
      clientRequestId,
      session.link.created_by,
    );
    if (!order) throw error;
    if (order.client_request_hash !== requestHash) {
      throw new HttpError(409, "This order identifier was already used with different data.");
    }
  }
  if (!order?.id) throw new Error("The guest order could not be saved.");

  await serviceFetch("/rest/v1/order_items?on_conflict=order_id,client_line_number", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(lines.map((line, index) => ({
      ...line,
      order_id: order!.id,
      client_line_number: index + 1,
    }))),
  });

  await serviceFetch("/rest/v1/order_notifications?on_conflict=order_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ order_id: order.id }),
  });
  const notification = await requestOrderNotification(order.id);
  return {
    order_id: order.id,
    order_number: order.order_number,
    total_items: totalItems,
    total_value: totalValue,
    notification,
  };
}

async function loadOrderByClientRequestId(
  clientRequestId: string,
  customerId: string,
) {
  const params = new URLSearchParams({
    client_request_id: `eq.${clientRequestId}`,
    customer_id: `eq.${customerId}`,
    select: "id,order_number,client_request_hash,total_items,total_value",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  return rows[0] || null;
}

async function validatedOrderLines(inputs: OrderLineInput[]) {
  const quantities = new Map<string, { quantity: number; page: number | null }>();
  for (const input of inputs.slice(0, 250)) {
    const productId = String(input.productId || "").trim();
    const quantity = Math.trunc(Number(input.quantity || 0));
    if (!productId || quantity < 1 || quantity > 9999) continue;
    const existing = quantities.get(productId);
    quantities.set(productId, {
      quantity: Math.min(9999, (existing?.quantity || 0) + quantity),
      page: Number.isFinite(Number(input.page)) ? Math.trunc(Number(input.page)) : existing?.page || null,
    });
  }
  if (!quantities.size) return [];

  const ids = [...quantities.keys()];
  const params = new URLSearchParams({
    product_id: `in.(${ids.join(",")})`,
    select: "product_id,sku,name,price,hidden,out_of_stock",
  });
  const response = await serviceFetch(`/rest/v1/product_overrides?${params}`);
  const products = await response.json();
  const byId = new Map(products.map((product: Record<string, unknown>) => [String(product.product_id), product]));

  return ids.map((productId) => {
    const product = byId.get(productId) as Record<string, unknown> | undefined;
    if (!product || product.hidden || product.out_of_stock) {
      throw new HttpError(409, `Product ${productId} is unavailable.`);
    }
    const unitPrice = catalogPriceNumber(product.price);
    if (!unitPrice || !product.sku || !product.name) {
      throw new HttpError(409, `Product ${productId} is missing current catalog data.`);
    }
    const requested = quantities.get(productId)!;
    return {
      product_id: productId,
      sku: cleanText(product.sku, 80),
      name: cleanText(product.name, 500),
      unit_price: unitPrice,
      quantity: requested.quantity,
      line_total: unitPrice * requested.quantity,
      page: requested.page,
    };
  });
}

async function requestOrderNotification(orderId: string) {
  try {
    const response = await fetch(`${requiredEnv("SUPABASE_URL")}/functions/v1/send-order-notifications`, {
      method: "POST",
      headers: {
        apikey: requiredEnv("SUPABASE_ANON_KEY"),
        "Content-Type": "application/json",
        "x-order-notification-secret": requiredEnv("ORDER_NOTIFICATION_INTERNAL_SECRET"),
      },
      body: JSON.stringify({ order_id: orderId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "Order email failed.");
    const failed = result?.results?.find((item: Record<string, unknown>) => item.status === "failed");
    return failed ? { ok: false, error: failed.error || "Order email failed." } : { ok: true };
  } catch (error) {
    console.error("Guest order notification failed", error);
    return { ok: false, error: errorMessage(error) };
  }
}

async function loadAuthenticatedProfile(req: Request): Promise<Profile | null> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Sign in first.");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey(), Authorization: authorization },
  });
  if (!response.ok) throw new HttpError(401, "Invalid session.");
  const user = await response.json();
  const params = new URLSearchParams({ id: `eq.${user.id}`, select: "id,role,salesman_code", limit: "1" });
  const profileResponse = await serviceFetch(`/rest/v1/profiles?${params}`);
  const profiles = await profileResponse.json();
  return profiles[0] || null;
}

async function loadGuestSession(sessionToken: string) {
  if (!sessionToken) throw new HttpError(401, "Guest access is missing.");
  const sessionHash = await sha256(sessionToken);
  const link = await loadLink("session_token_hash", sessionHash);
  if (!link || !link.redeemed_at || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, "This client access has expired. Ask your salesman for a new link.");
  }
  const client = link.sales_client_id ? await loadSalesClient(link.sales_client_id) : null;
  if (link.sales_client_id && !client) throw new HttpError(404, "The linked client no longer exists.");
  return { link, client };
}

async function loadLink(column: "link_token_hash" | "session_token_hash", hash: string): Promise<GuestLink | null> {
  const params = new URLSearchParams({
    [column]: `eq.${hash}`,
    select: "id,sales_client_id,salesman_code,created_by,otp_hash,session_token_hash,link_token_ciphertext,failed_attempts,expires_at,redeemed_at,revoked_at,created_at",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/catalog_guest_links?${params}`);
  const rows = await response.json();
  return rows[0] || null;
}

async function loadSalesClient(id: string): Promise<SalesClient | null> {
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: "id,client_code,name,legal_name,address,locality,salesman_code",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/sales_clients?${params}`);
  const rows = await response.json();
  return rows[0] || null;
}

async function loadSalesClientByCode(clientCode: string, salesmanCode: string | null): Promise<SalesClient | null> {
  const params = new URLSearchParams({
    client_code: `eq.${clientCode}`,
    select: "id,client_code,name,legal_name,address,locality,salesman_code",
    limit: "1",
  });
  if (salesmanCode) params.set("salesman_code", `eq.${salesmanCode}`);
  const response = await serviceFetch(`/rest/v1/sales_clients?${params}`);
  const rows = await response.json();
  return rows[0] || null;
}

function assertLinkCanBeRedeemed(link: GuestLink | null): asserts link is GuestLink {
  if (!link) throw new HttpError(404, "Access link not found.");
  if (link.revoked_at) throw new HttpError(410, "This access link was replaced. Ask your salesman for a new one.");
  if (new Date(link.expires_at).getTime() <= Date.now()) throw new HttpError(410, "This access link has expired.");
  if (link.redeemed_at) throw new HttpError(409, "This one-time link has already been used.");
  if (Number(link.failed_attempts || 0) >= MAX_OTP_ATTEMPTS) throw new HttpError(429, "This access link is blocked.");
}

async function patchLink(id: string, patch: Record<string, unknown>) {
  await serviceFetch(`/rest/v1/catalog_guest_links?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

function guestSessionResponse(sessionToken: string, link: GuestLink, client: SalesClient | null) {
  return {
    session_token: sessionToken,
    expires_at: link.expires_at,
    client: client ? publicClient(client) : null,
    salesman_code: link.salesman_code,
  };
}

function publicClient(client: SalesClient) {
  return {
    id: client.id,
    clientCode: client.client_code,
    name: client.name,
    legalName: client.legal_name,
    address: client.address,
    locality: client.locality,
    salesmanCode: client.salesman_code,
  };
}

function buildAccessUrl(baseUrlInput: string, linkToken: string) {
  const requestedUrl = parseCatalogUrl(baseUrlInput);
  const configuredUrl = parseCatalogUrl(Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "");
  const requestedHost = requestedUrl?.hostname.toLowerCase() || "";
  const requestedIsLocal = requestedHost === "localhost" || requestedHost === "127.0.0.1";
  const url = requestedUrl && !requestedIsLocal ? requestedUrl : configuredUrl || requestedUrl;
  if (!url) throw new HttpError(400, "The catalog URL is not configured.");
  url.search = "";
  url.hash = "";
  url.searchParams.set("catalog_access", linkToken);
  return url.toString();
}

function parseCatalogUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

async function serviceFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey(),
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase failed: ${response.status} ${message}`);
  }
  return response;
}

function serviceRoleKey() {
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function requiredUuid(value: unknown, field: string) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(400, `${field} must be a UUID.`);
  }
  return text;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOtp() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, "0");
}

async function guestLinkEncryptionKey() {
  const secret = new TextEncoder().encode(requiredEnv("CATALOG_GUEST_LINK_SECRET"));
  const digest = await crypto.subtle.digest("SHA-256", secret);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptLinkToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await guestLinkEncryptionKey(), new TextEncoder().encode(value));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64Url(combined);
}

async function decryptLinkToken(value: string) {
  const combined = base64UrlToBytes(value);
  if (combined.length < 13) throw new Error("Invalid encrypted link token.");
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await guestLinkEncryptionKey(), encrypted);
  return new TextDecoder().decode(decrypted);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function catalogPriceNumber(value: unknown) {
  return Number(String(value || "").replace(/\D/g, "")) || 0;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

async function readJson(req: Request) {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
