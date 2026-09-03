type Profile = {
  id: string;
  name: string | null;
  role: string;
  price_access_approved: boolean;
};

type EmailPayload = {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
};

type Notification = {
  profile_id: string;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  attempts: number;
  updated_at: string;
  first_attempt_at: string | null;
  email_payload: EmailPayload | null;
};

const TABLE = "/rest/v1/price_access_approval_notifications";
const LEASE_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const CATALOG_URL = "https://catalogolexo.com.ar/";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  try {
    // This endpoint is only called by the database trigger and retry job.
    const expected = requiredEnv("PRICE_ACCESS_INTERNAL_SECRET");
    const received = req.headers.get("x-price-access-secret") || "";
    if (!secretMatches(received, expected)) throw new HttpError(401, "Unauthorized.");
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Invalid request.");
    }
    const params = new URLSearchParams({ select: "*", limit: "5", order: "created_at.asc" });
    if (body.profile_id !== undefined) {
      const id = String(body.profile_id);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new HttpError(400, "Invalid profile ID.");
      }
      params.set("profile_id", `eq.${id}`);
    } else {
      const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
      const retryCutoff = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
      params.set("attempts", "lt.5");
      params.set("and", `(or(status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${cutoff})),or(first_attempt_at.is.null,first_attempt_at.gt.${retryCutoff}))`);
    }
    const rows = await (await serviceFetch(`${TABLE}?${params}`)).json() as Notification[];
    const results = [];
    for (const row of rows) {
      if (results.length) await new Promise((resolve) => setTimeout(resolve, 600));
      results.push(await processNotification(row));
    }
    return jsonResponse({ ok: results.every((result) => result.status !== "failed"), results });
  } catch (error) {
    console.error("Approval email:", errorMessage(error));
    return jsonResponse({ error: error instanceof HttpError ? error.message : "Could not process approval email." },
      error instanceof HttpError ? error.status : 500);
  }
});

async function processNotification(row: Notification) {
  const result = (status: string) => ({ profile_id: row.profile_id, status });
  if (row.status === "sent" || row.status === "cancelled") return result(row.status);
  if (row.attempts >= 5) return result("retry_limit");
  if (row.first_attempt_at && Date.now() - Date.parse(row.first_attempt_at) >= RETRY_WINDOW_MS) {
    return result("retry_expired");
  }
  if (row.status === "processing" && Date.now() - Date.parse(row.updated_at) < LEASE_MS) {
    return result("processing");
  }

  const now = new Date().toISOString();
  // Compare-and-set prevents overlapping trigger/cron deliveries from claiming the same row.
  const params = new URLSearchParams({
    profile_id: `eq.${row.profile_id}`,
    updated_at: `eq.${row.updated_at}`,
    status: `eq.${row.status}`,
    attempts: `eq.${row.attempts}`,
    select: "*",
  });
  const claimed = await (await serviceFetch(`${TABLE}?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "processing",
      attempts: row.attempts + 1,
      first_attempt_at: row.first_attempt_at || now,
      updated_at: now,
      last_error: "",
    }),
  })).json() as Notification[];
  const notification = claimed[0];
  if (!notification) return result("processing");

  try {
    const profileParams = new URLSearchParams({
      id: `eq.${notification.profile_id}`,
      select: "id,name,role,price_access_approved",
      limit: "1",
    });
    const profiles = await (await serviceFetch(`/rest/v1/profiles?${profileParams}`)).json() as Profile[];
    const profile = profiles[0];
    if (!profile || profile.role !== "customer" || !profile.price_access_approved) {
      await updateNotification(notification, { status: "cancelled", last_error: "Client no longer has approved price access." });
      return result("cancelled");
    }

    let payload = notification.email_payload;
    if (!payload) {
      // Use the account's registered address, not a user-editable profile email.
      const user = await (await serviceFetch(`/auth/v1/admin/users/${profile.id}`)).json();
      const email = String(user.email || "").trim();
      if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)) {
        throw new Error("The client account has no valid registered email.");
      }
      payload = buildEmail(profile, email);
      // Persist the exact payload before sending: retries must reuse it with the same key.
      await updateNotification(notification, { email_payload: payload });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `price-access-approved/${notification.profile_id}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
    const sent = await response.json();
    if (!sent.id) throw new Error("Resend did not return an email ID.");
    await updateNotification(notification, {
      status: "sent",
      resend_email_id: String(sent.id),
      sent_at: new Date().toISOString(),
      last_error: "",
    });
    return result("sent");
  } catch (error) {
    const message = errorMessage(error);
    console.error(`Approval email ${row.profile_id}:`, message);
    await updateNotification(notification, { status: "failed", last_error: message.slice(0, 2000) });
    return result("failed");
  }
}

function buildEmail(profile: Profile, email: string): EmailPayload {
  const greeting = profile.name?.trim() ? `Hola ${profile.name.trim()},` : "Hola,";
  const title = "Tu acceso al Cat\u00e1logo Lexo fue aprobado";
  const message = "Ya pod\u00e9s ver los precios y realizar pedidos en nuestro cat\u00e1logo.";
  const login = "Ingres\u00e1 con el email y la contrase\u00f1a de tu cuenta. No necesit\u00e1s registrarte nuevamente.";
  return {
    from: requiredEnv("ORDER_NOTIFICATION_FROM"),
    to: [email],
    reply_to: "ventas@lexo.com.ar",
    subject: title,
    text: [greeting, "", message, login, "", `Abrir cat\u00e1logo: ${CATALOG_URL}`, "", "Gracias por elegir Lexo."].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;color:#17191d;line-height:1.5;max-width:560px;margin:auto">
<h1 style="font-size:26px;color:#e21b23">LEXO</h1>
<h2 style="font-size:22px">${title}</h2>
<p>${escapeHtml(greeting)}</p><p>${message}</p><p>${login}</p>
<p style="margin:24px 0"><a href="${CATALOG_URL}" style="display:inline-block;padding:12px 20px;background:#e21b23;color:#fff;text-decoration:none;font-weight:bold;border-radius:4px">Abrir cat\u00e1logo</a></p>
<p>Gracias por elegir Lexo.</p></div>`,
  };
}

async function updateNotification(notification: Notification, patch: Record<string, unknown>) {
  const params = new URLSearchParams({
    profile_id: `eq.${notification.profile_id}`,
    status: "eq.processing",
    attempts: `eq.${notification.attempts}`,
  });
  const response = await serviceFetch(`${TABLE}?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  const rows = await response.json();
  if (!rows.length) throw new Error("Approval notification lease was lost.");
}

async function serviceFetch(path: string, init: RequestInit = {}) {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase failed: ${response.status} ${await response.text()}`);
  return response;
}

function secretMatches(received: string, expected: string) {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

