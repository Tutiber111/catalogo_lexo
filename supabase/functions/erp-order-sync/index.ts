const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-erp-sync-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await assertIntegrationToken(request.headers.get("x-erp-sync-token") || "");
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "claim") {
      const limit = Math.min(50, Math.max(1, Math.trunc(Number(body.limit || 10))));
      const rows = await rpc("claim_erp_order_exports", { p_limit: limit });
      return json({ jobs: Array.isArray(rows) ? rows : [] });
    }

    const orderId = requiredUuid(body.order_id, "order_id");
    const leaseToken = requiredUuid(body.lease_token, "lease_token");
    if (action === "ack") {
      const erpOrderId = requiredUuid(body.erp_order_id, "erp_order_id");
      const erpOrderNumber = cleanText(body.erp_order_number, 120);
      if (!erpOrderNumber) throw new HttpError(400, "erp_order_number is required.");
      const accepted = await rpc("ack_erp_order_export", {
        p_order_id: orderId,
        p_lease_token: leaseToken,
        p_erp_order_id: erpOrderId,
        p_erp_order_number: erpOrderNumber,
      });
      if (accepted !== true) throw new HttpError(409, "The synchronization lease is no longer valid.");
      return json({ ok: true });
    }

    if (action === "fail") {
      const accepted = await rpc("fail_erp_order_export", {
        p_order_id: orderId,
        p_lease_token: leaseToken,
        p_error: cleanText(body.error, 2000) || "ERP rejected the order.",
        p_retryable: body.retryable !== false,
      });
      if (accepted !== true) throw new HttpError(409, "The synchronization lease is no longer valid.");
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown synchronization action.");
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Synchronization failed." },
      error instanceof HttpError ? error.status : 500,
    );
  }
});

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${requiredEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Supabase RPC ${name} failed with status ${response.status}.`);
  }
  return result;
}

async function assertIntegrationToken(provided: string) {
  const expected = requiredEnv("ERP_ORDER_SYNC_TOKEN");
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  if (left.length !== right.length) throw new HttpError(401, "Invalid synchronization token.");
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  if (difference !== 0) throw new HttpError(401, "Invalid synchronization token.");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requiredUuid(value: unknown, field: string) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(400, `${field} must be a UUID.`);
  }
  return text;
}

function cleanText(value: unknown, maximumLength: number) {
  return String(value || "").trim().slice(0, maximumLength);
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
