type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  company: string | null;
  assigned_salesman_code: string | null;
  role: string;
  price_access_approved: boolean;
  created_at: string;
};

type Notification = {
  profile_id: string;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
  updated_at: string;
};

const DEFAULT_RECIPIENTS = ["martinbertisch@gmail.com", "ventas@lexo.com.ar"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-price-access-secret",
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
    const userId = isInternalRequest(req)
      ? requiredProfileId(body.profile_id)
      : await authenticatedUserId(req);
    const profile = await loadProfile(userId);
    if (!profile) throw new HttpError(404, "Profile not found.");
    if (profile.role !== "customer" || profile.price_access_approved) {
      return jsonResponse({ ok: true, skipped: true });
    }

    const notification = await claimNotification(profile.id);
    if (!notification) return jsonResponse({ ok: true, duplicate: true });

    try {
      const sent = await sendNotification(profile);
      await updateNotification(profile.id, {
        status: "sent",
        recipients: sent.recipients,
        resend_email_id: sent.id,
        last_error: "",
        sent_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true });
    } catch (error) {
      const message = errorMessage(error);
      await updateNotification(profile.id, { status: "failed", last_error: message });
      throw error;
    }
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
  }
});

async function authenticatedUserId(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Sign in first.");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey(), Authorization: authorization },
  });
  if (!response.ok) throw new HttpError(401, "Invalid session.");
  const user = await response.json();
  if (!user.id) throw new HttpError(401, "Invalid session.");
  return String(user.id);
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const params = new URLSearchParams({
    id: `eq.${userId}`,
    select: "id,email,name,phone,company,assigned_salesman_code,role,price_access_approved,created_at",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/profiles?${params}`);
  const rows = await response.json() as Profile[];
  return rows[0] || null;
}

async function claimNotification(profileId: string): Promise<Notification | null> {
  let notification = await loadNotification(profileId);
  if (!notification) {
    await serviceFetch("/rest/v1/price_access_notifications?on_conflict=profile_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ profile_id: profileId }),
    });
    notification = await loadNotification(profileId);
  }
  if (!notification || notification.status === "sent") return null;

  if (notification.status === "processing") {
    const updatedAt = Date.parse(notification.updated_at);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 2 * 60 * 1000) return null;
    await updateNotification(profileId, { status: "failed", last_error: "Previous notification attempt timed out." });
    notification.status = "failed";
  }

  const params = new URLSearchParams({
    profile_id: `eq.${profileId}`,
    status: "in.(pending,failed)",
    select: "profile_id,status,attempts,updated_at",
  });
  const response = await serviceFetch(`/rest/v1/price_access_notifications?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "processing",
      attempts: Number(notification.attempts || 0) + 1,
      last_error: "",
      updated_at: new Date().toISOString(),
    }),
  });
  const rows = await response.json() as Notification[];
  return rows[0] || null;
}

async function loadNotification(profileId: string): Promise<Notification | null> {
  const params = new URLSearchParams({
    profile_id: `eq.${profileId}`,
    select: "profile_id,status,attempts,updated_at",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/price_access_notifications?${params}`);
  const rows = await response.json() as Notification[];
  return rows[0] || null;
}

async function sendNotification(profile: Profile) {
  const recipients = configuredRecipients();
  const label = profile.company || profile.name || profile.email || "Nuevo cliente";
  const subject = `Nueva solicitud de acceso a precios - ${label}`;
  const fields = [
    ["Empresa", profile.company],
    ["Nombre", profile.name],
    ["Email", profile.email],
    ["Teléfono", profile.phone],
    ["Código de vendedor", profile.assigned_salesman_code],
    ["Fecha de registro", formatDate(profile.created_at)],
  ].filter(([, value]) => String(value || "").trim());
  const siteUrl = Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "";
  const text = [
    "Un nuevo cliente creó una cuenta y solicitó acceso a los precios del catálogo.",
    "",
    ...fields.map(([name, value]) => `${name}: ${value}`),
    siteUrl ? `\nAprobar desde el panel de administración: ${siteUrl}` : "",
  ].filter(Boolean).join("\n");
  const htmlRows = fields.map(([name, value]) => `<tr><th style="padding:6px 12px 6px 0;text-align:left;color:#5f6672">${escapeHtml(name)}</th><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#17191d;line-height:1.45"><h2 style="margin:0 0 12px;color:#e21b23">Nueva solicitud de acceso a precios</h2><p>Un nuevo cliente creó una cuenta y está esperando aprobación para ver los precios.</p><table style="border-collapse:collapse">${htmlRows}</table>${siteUrl ? `<p style="margin-top:20px"><a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:10px 16px;background:#e21b23;color:#fff;text-decoration:none;font-weight:700">Abrir panel de administración</a></p>` : ""}</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requiredEnv("ORDER_NOTIFICATION_FROM"),
      to: recipients,
      reply_to: profile.email || undefined,
      subject,
      text,
      html,
    }),
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
  const result = await response.json();
  return { id: String(result.id || ""), recipients };
}

function configuredRecipients() {
  const configured = String(Deno.env.get("PRICE_ACCESS_NOTIFICATION_TO") || "")
    .split(/[;,]/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  return [...new Set(configured.length ? configured : DEFAULT_RECIPIENTS)];
}

function isInternalRequest(req: Request) {
  const expected = requiredEnv("PRICE_ACCESS_INTERNAL_SECRET");
  const received = req.headers.get("x-price-access-secret") || "";
  return received.length === expected.length && received === expected;
}

function requiredProfileId(value: unknown) {
  const profileId = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    throw new HttpError(400, "Invalid profile ID.");
  }
  return profileId;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function updateNotification(profileId: string, patch: Record<string, unknown>) {
  await serviceFetch(`/rest/v1/price_access_notifications?profile_id=eq.${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function serviceFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey(),
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase failed: ${response.status} ${await response.text()}`);
  return response;
}

function serviceRoleKey() {
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(date);
}

function escapeHtml(value: unknown) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
