type FailureAlert = {
  id: string;
  order_number: number | null;
  recipient_email: string;
  failure_reason: string;
  created_at: string;
  status: string;
  attempts: number;
  first_attempt_at: string | null;
  updated_at: string;
  email_payload: Record<string, unknown> | null;
};
const TABLE = "/rest/v1/order_email_failure_alerts";
const LEASE_MS = 5 * 60_000;
const SAFE_WINDOW_MS = 23 * 60 * 60_000;

// Independent of attachment preparation and order notification workers.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({error: "Method not allowed."}, 405);
  const expected = Deno.env.get("ORDER_NOTIFICATION_INTERNAL_SECRET")
    || Deno.env.get("PRICE_ACCESS_INTERNAL_SECRET") || "";
  if (!secretMatches(req.headers.get("x-order-notification-secret") || "", expected)) {
    return json({error: "Unauthorized."}, 401);
  }
  try {
    const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
    const safeCutoff = new Date(Date.now() - SAFE_WINDOW_MS).toISOString();
    const params = new URLSearchParams({select:"*", order:"created_at.asc", limit:"1", attempts:"lt.5",
      and:`(or(status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${cutoff})),or(first_attempt_at.is.null,first_attempt_at.gt.${safeCutoff}))`});
    const rows: FailureAlert[] = await (await serviceFetch(`${TABLE}?${params}`)).json();
    const results = [];
    for (const row of rows) results.push(await processAlert(row));
    return json({results});
  } catch (error) {
    console.error("Order email failure alert:", errorMessage(error));
    return json({error:"Could not process order-email failure alerts."}, 500);
  }
});

async function processAlert(row: FailureAlert) {
  if (["sent", "cancelled"].includes(row.status)) return {status:row.status};
  if (row.attempts >= 5) return {status:"retry_limit"};
  if (row.first_attempt_at && Date.now() - Date.parse(row.first_attempt_at) >= SAFE_WINDOW_MS) {
    return {status:"retry_expired"};
  }
  if (row.status === "processing" && Date.now() - Date.parse(row.updated_at) < LEASE_MS) {
    return {status:"processing"};
  }
  const payload = row.email_payload || buildAlertPayload(row);
  const params = new URLSearchParams({id:`eq.${row.id}`,status:`eq.${row.status}`,
    updated_at:`eq.${row.updated_at}`,select:"id"});
  const claimed = await (await serviceFetch(`${TABLE}?${params}`, {
    method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({status:"processing",attempts:row.attempts+1,
      first_attempt_at:row.first_attempt_at || new Date().toISOString(),
      email_payload:payload,updated_at:new Date().toISOString()})
  })).json();
  if (!claimed.length) return {status:"processing"};
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method:"POST",signal:AbortSignal.timeout(15_000),
      headers:{Authorization:`Bearer ${requiredEnv("RESEND_API_KEY")}`,"Content-Type":"application/json",
        "Idempotency-Key":`order-email-failure/${row.id}`},body:JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
    const result = await response.json();
    if (!result.id) throw new Error("Resend did not confirm an alert email ID.");
    await updateAlert(row, {status:"sent",resend_email_id:String(result.id),last_error:""});
    return {status:"sent",alert_id:row.id,email_id:String(result.id)};
  } catch (error) {
    await updateAlert(row, {status:"failed",last_error:errorMessage(error)});
    return {status:"failed",alert_id:row.id};
  }
}

function buildAlertPayload(row: FailureAlert) {
  const label = row.order_number ? `#${row.order_number}` : "without an order number";
  const text = `An email failure was detected for order ${label}.\n\n`
    + `Detected: ${row.created_at}\nReason: ${row.failure_reason}\n\n`
    + "The order remains saved. Automatic retries may still be running or may have recovered it. "
    + "Check its current email status in the catalog admin panel before resending.\n"
    + "https://catalogolexo.com.ar/\n\nOne alert is sent per failed email, rather than one per retry.";
  return {from:requiredEnv("ORDER_NOTIFICATION_FROM"),to:[row.recipient_email],
    subject:`[Lexo] Order ${label}: email failure`,text};
}

async function updateAlert(row: FailureAlert, patch: Record<string, unknown>) {
  const params = new URLSearchParams({id:`eq.${row.id}`,status:"eq.processing",
    attempts:`eq.${row.attempts+1}`,select:"id"});
  const updated = await (await serviceFetch(`${TABLE}?${params}`,{
    method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
  })).json();
  if (!updated.length) throw new Error("Failure alert lease was lost.");
}

async function serviceFetch(path: string, init: RequestInit = {}) {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}${path}`,{
    ...init,signal:AbortSignal.timeout(10_000),
    headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",...(init.headers || {})}
  });
  if (!response.ok) throw new Error(`Supabase failed: ${response.status} ${await response.text()}`);
  return response;
}
function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
function secretMatches(received: string, expected: string) {
  if (!expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let i=0;i<expected.length;i++) difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function json(value: unknown, status=200) {
  return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
}
