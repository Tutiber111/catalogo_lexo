type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  client_code: string | null;
  role: string;
};

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
    await requireAdmin(req);
    const body = await readJson(req);
    const action = String(body.action || "");
    if (action === "search") return jsonResponse({ customers: await searchCustomers(body.query) });
    if (action === "reset") return jsonResponse(await resetCustomerPassword(body));
    throw new HttpError(400, "Unknown password administration action.");
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
  }
});

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Sign in first.");

  const userResponse = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey(),
      Authorization: authorization,
    },
  });
  if (!userResponse.ok) throw new HttpError(401, "Invalid session.");
  const user = await userResponse.json();

  const params = new URLSearchParams({ id: `eq.${user.id}`, select: "id,role", limit: "1" });
  const profileResponse = await serviceFetch(`/rest/v1/profiles?${params}`);
  const profiles = await profileResponse.json();
  if (profiles[0]?.role !== "admin") throw new HttpError(403, "Only administrators can change customer passwords.");
}

async function searchCustomers(value: unknown) {
  const query = normalizeSearchTerm(value);
  if (query.length < 2) throw new HttpError(400, "Enter at least two characters.");

  const params = new URLSearchParams({
    role: "eq.customer",
    or: `(email.ilike.*${query}*,name.ilike.*${query}*,company.ilike.*${query}*,client_code.ilike.*${query}*)`,
    select: "id,email,name,company,client_code,role",
    order: "company.asc.nullslast,email.asc",
    limit: "12",
  });
  const response = await serviceFetch(`/rest/v1/profiles?${params}`);
  const profiles = await response.json() as Profile[];
  return profiles.map(publicProfile);
}

async function resetCustomerPassword(body: Record<string, unknown>) {
  const userId = String(body.user_id || "").trim();
  const password = String(body.password || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new HttpError(400, "Choose a valid customer account.");
  }
  if (password.length < 8) throw new HttpError(400, "The temporary password must have at least eight characters.");
  if (password.length > 72) throw new HttpError(400, "The temporary password is too long.");

  const profile = await loadCustomerProfile(userId);
  if (!profile) throw new HttpError(404, "Customer account not found.");

  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      apikey: serviceRoleKey(),
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase Auth failed: ${response.status} ${detail}`);
  }

  return {
    ok: true,
    customer: publicProfile(profile),
  };
}

async function loadCustomerProfile(userId: string): Promise<Profile | null> {
  const params = new URLSearchParams({
    id: `eq.${userId}`,
    role: "eq.customer",
    select: "id,email,name,company,client_code,role",
    limit: "1",
  });
  const response = await serviceFetch(`/rest/v1/profiles?${params}`);
  const profiles = await response.json();
  return profiles[0] || null;
}

function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    email: profile.email || "",
    name: profile.name || "",
    company: profile.company || "",
    clientCode: profile.client_code || "",
  };
}

function normalizeSearchTerm(value: unknown) {
  return String(value || "")
    .trim()
    .slice(0, 80)
    .replace(/[%_*(),]/g, " ")
    .replace(/\s+/g, " ");
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
    const detail = await response.text();
    throw new Error(`Supabase failed: ${response.status} ${detail}`);
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
