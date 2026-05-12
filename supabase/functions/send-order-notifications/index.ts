type OrderNotification = {
  id: string;
  order_id: string;
  attempts: number;
};

type OrderItem = {
  sku: string;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  page: number | null;
};

type Order = {
  id: string;
  order_number: number | null;
  status: string;
  customer_name: string;
  customer_phone: string;
  notes: string;
  total_items: number;
  total_value: number;
  created_at: string;
  order_items: OrderItem[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await readJson(req);
    const result = await sendPendingOrderNotifications(body.order_id);
    return jsonResponse(result);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: errorMessage(error) }, 500);
  }
});

async function sendPendingOrderNotifications(orderId?: string) {
  const notifications = await loadPendingNotifications(orderId);
  const results = [];

  for (const notification of notifications) {
    const locked = await lockNotification(notification);
    if (!locked) continue;

    try {
      const order = await loadOrder(notification.order_id);
      await sendOrderEmail(order);
      await updateNotification(notification.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: "",
      });
      results.push({ order_id: notification.order_id, status: "sent" });
    } catch (error) {
      const message = errorMessage(error);
      await updateNotification(notification.id, {
        status: "failed",
        last_error: message,
      });
      results.push({ order_id: notification.order_id, status: "failed", error: message });
    }
  }

  return { processed: results.length, results };
}

async function loadPendingNotifications(orderId?: string): Promise<OrderNotification[]> {
  const params = new URLSearchParams({
    select: "id,order_id,attempts",
    status: "eq.pending",
    order: "created_at.asc",
    limit: "10",
  });
  if (orderId) params.set("order_id", `eq.${orderId}`);

  const response = await supabaseFetch(`/rest/v1/order_notifications?${params}`);
  return response.json();
}

async function lockNotification(notification: OrderNotification) {
  const params = new URLSearchParams({
    id: `eq.${notification.id}`,
    status: "eq.pending",
    select: "id",
  });
  const response = await supabaseFetch(`/rest/v1/order_notifications?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "processing",
      attempts: notification.attempts + 1,
      updated_at: new Date().toISOString(),
    }),
  });
  const rows = await response.json();
  return rows.length > 0;
}

async function loadOrder(orderId: string): Promise<Order> {
  const params = new URLSearchParams({
    id: `eq.${orderId}`,
    select: "id,order_number,status,customer_name,customer_phone,notes,total_items,total_value,created_at,order_items(sku,name,unit_price,quantity,line_total,page)",
  });
  const response = await supabaseFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  if (!rows.length) throw new Error(`Order ${orderId} not found`);
  return rows[0];
}

async function updateNotification(id: string, patch: Record<string, unknown>) {
  await supabaseFetch(`/rest/v1/order_notifications?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function sendOrderEmail(order: Order) {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const to = emailList(requiredEnv("ORDER_NOTIFICATION_TO"));
  const from = requiredEnv("ORDER_NOTIFICATION_FROM");
  const siteUrl = Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "";
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  const subject = `Nuevo pedido ${orderLabel} - ${order.customer_name || "Cliente"}`;
  const text = buildOrderText(order, siteUrl);
  const html = buildOrderHtml(order, siteUrl);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Resend failed: ${response.status} ${message}`);
  }
}

function buildOrderText(order: Order, siteUrl: string) {
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  return [
    `Nuevo pedido ${orderLabel}`,
    "",
    `Cliente: ${order.customer_name || "-"}`,
    `Teléfono: ${order.customer_phone || "-"}`,
    `Fecha: ${new Date(order.created_at).toLocaleString("es-AR")}`,
    order.notes ? `Notas: ${order.notes}` : "",
    "",
    ...order.order_items.map((item) =>
      `${item.quantity} x ${item.sku} - ${item.name} - ${formatMoney(Number(item.unit_price))} c/u - ${formatMoney(Number(item.line_total))}${item.page ? ` - Página ${item.page}` : ""}`
    ),
    "",
    `Unidades: ${order.total_items}`,
    `Total: ${formatMoney(Number(order.total_value))}`,
    siteUrl ? `Catálogo: ${siteUrl}` : "",
  ].filter(Boolean).join("\n");
}

function buildOrderHtml(order: Order, siteUrl: string) {
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  const rows = order.order_items.map((item) => `
    <tr>
      <td>${escapeHtml(String(item.quantity))}</td>
      <td>${escapeHtml(item.sku)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(formatMoney(Number(item.unit_price)))}</td>
      <td>${escapeHtml(formatMoney(Number(item.line_total)))}</td>
      <td>${escapeHtml(item.page ? String(item.page) : "")}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#16161a">
      <h2>Nuevo pedido ${escapeHtml(orderLabel)}</h2>
      <p><strong>Cliente:</strong> ${escapeHtml(order.customer_name || "-")}</p>
      <p><strong>Teléfono:</strong> ${escapeHtml(order.customer_phone || "-")}</p>
      <p><strong>Fecha:</strong> ${escapeHtml(new Date(order.created_at).toLocaleString("es-AR"))}</p>
      ${order.notes ? `<p><strong>Notas:</strong> ${escapeHtml(order.notes)}</p>` : ""}
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#dde1e7">
        <thead>
          <tr>
            <th>Cant.</th>
            <th>SKU</th>
            <th>Producto</th>
            <th>Precio</th>
            <th>Total</th>
            <th>Página</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p><strong>Unidades:</strong> ${escapeHtml(String(order.total_items))}</p>
      <p><strong>Total:</strong> ${escapeHtml(formatMoney(Number(order.total_value)))}</p>
      ${siteUrl ? `<p><a href="${escapeHtml(siteUrl)}">Abrir catálogo</a></p>` : ""}
    </div>
  `;
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const url = requiredEnv("SUPABASE_URL");
  const serviceKey = serviceRoleKey();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase REST failed: ${response.status} ${message}`);
  }
  return response;
}

function serviceRoleKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys);
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.startsWith("eyJ")) return value;
      if (typeof value === "string") {
        const nested = Deno.env.get(value);
        if (nested) return nested;
      }
    }
  }

  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

async function readJson(req: Request) {
  if (req.method !== "POST") return {};
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function emailList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatMoney(value: number) {
  return "$" + Math.round(value).toLocaleString("es-AR");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
