import { strFromU8, strToU8, unzipSync, zipSync } from "npm:fflate@0.8.2";
import { ORDER_TEMPLATE_BASE64 } from "./order-template-base64.ts";

type OrderNotification = {
  id: string;
  order_id: string;
  attempts: number;
};

type RequestContext = {
  userId: string;
  isAdmin: boolean;
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
  customer_id: string;
  customer_email?: string;
  order_number: number | null;
  status: string;
  customer_name: string;
  customer_phone: string;
  sales_client_id: string | null;
  sales_client_code: string;
  sales_client_name: string;
  sales_client_address: string;
  sales_client_locality: string;
  salesman_code: string;
  notes: string;
  total_items: number;
  total_value: number;
  created_at: string;
  order_items: OrderItem[];
};

type EmailAttachment = {
  filename: string;
  content: string;
  content_type: string;
};

type SentEmail = {
  id: string;
  to: string[];
};

const ORDER_TEMPLATE_SHEET_PATH = "xl/worksheets/sheet3.xml";
const ORDER_TEMPLATE_LAST_INPUT_ROW = 262;

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
    const context = await loadRequestContext(req);
    const result = await sendPendingOrderNotifications(body.order_id, {
      context,
      force: Boolean(body.force),
    });
    return jsonResponse(result);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: errorMessage(error) }, 500);
  }
});

async function sendPendingOrderNotifications(orderId: string | undefined, options: { context: RequestContext; force?: boolean }) {
  if (orderId) {
    if (options.force && !options.context.isAdmin) {
      throw new Error("Only admins can resend order emails.");
    }
    await ensureCanSendOrderNotification(orderId, options.context);
    await ensureNotification(orderId, Boolean(options.force));
  }

  const notifications = await loadPendingNotifications(orderId);
  const results = [];

  for (const notification of notifications) {
    const locked = await lockNotification(notification);
    if (!locked) continue;

    try {
      const order = await loadOrder(notification.order_id);
      const sentEmail = await sendOrderEmail(order);
      await updateNotification(notification.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        resend_email_id: sentEmail.id,
        resend_to: sentEmail.to.join(", "),
        last_error: "",
      });
      results.push({ order_id: notification.order_id, status: "sent", email_id: sentEmail.id });
    } catch (error) {
      const message = errorMessage(error);
      await updateNotification(notification.id, {
        status: "failed",
        resend_email_id: "",
        last_error: message,
      });
      results.push({ order_id: notification.order_id, status: "failed", error: message });
    }
  }

  return { processed: results.length, results };
}

async function ensureCanSendOrderNotification(orderId: string, context: RequestContext) {
  if (context.isAdmin) return;
  const params = new URLSearchParams({
    id: `eq.${orderId}`,
    customer_id: `eq.${context.userId}`,
    select: "id",
    limit: "1",
  });
  const response = await supabaseFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  if (!rows.length) throw new Error("You can only send notifications for your own orders.");
}

async function ensureNotification(orderId: string, force = false) {
  if (force) {
    const params = new URLSearchParams({
      order_id: `eq.${orderId}`,
      select: "id",
    });
    const response = await supabaseFetch(`/rest/v1/order_notifications?${params}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "pending",
        last_error: "",
        resend_email_id: "",
        updated_at: new Date().toISOString(),
      }),
    });
    const rows = await response.json();
    if (rows.length) return;
  }

  await supabaseFetch("/rest/v1/order_notifications?on_conflict=order_id", {
    method: "POST",
    headers: { Prefer: force ? "resolution=merge-duplicates" : "resolution=ignore-duplicates" },
    body: JSON.stringify({
      order_id: orderId,
      status: "pending",
      last_error: "",
      resend_email_id: "",
      updated_at: new Date().toISOString(),
    }),
  });
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
    select: "id,customer_id,order_number,status,customer_name,customer_phone,sales_client_id,sales_client_code,sales_client_name,sales_client_address,sales_client_locality,salesman_code,notes,total_items,total_value,created_at,order_items(sku,name,unit_price,quantity,line_total,page)",
  });
  const response = await supabaseFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  if (!rows.length) throw new Error(`Order ${orderId} not found`);
  const order = rows[0];
  order.customer_email = await loadCustomerEmail(order.customer_id);
  return order;
}

async function loadCustomerEmail(customerId: string) {
  if (!customerId) return "";
  const params = new URLSearchParams({
    id: `eq.${customerId}`,
    select: "email",
    limit: "1",
  });
  const response = await supabaseFetch(`/rest/v1/profiles?${params}`);
  const rows = await response.json();
  return rows[0]?.email || "";
}

async function loadRequestContext(req: Request): Promise<RequestContext> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing authenticated user.");
  }

  const userResponse = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey(),
      Authorization: authorization,
    },
  });
  if (!userResponse.ok) {
    throw new Error("Invalid authenticated user.");
  }

  const user = await userResponse.json();
  const userId = String(user.id || "");
  if (!userId) throw new Error("Invalid authenticated user.");

  const params = new URLSearchParams({
    id: `eq.${userId}`,
    select: "role",
    limit: "1",
  });
  const profileResponse = await supabaseFetch(`/rest/v1/profiles?${params}`);
  const rows = await profileResponse.json();

  return {
    userId,
    isAdmin: String(rows[0]?.role || "") === "admin",
  };
}

async function updateNotification(id: string, patch: Record<string, unknown>) {
  await supabaseFetch(`/rest/v1/order_notifications?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function sendOrderEmail(order: Order): Promise<SentEmail> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const to = emailList(requiredEnv("ORDER_NOTIFICATION_TO"));
  const from = requiredEnv("ORDER_NOTIFICATION_FROM");
  const siteUrl = Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "";
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  const emailSuffix = order.customer_email ? ` (${order.customer_email})` : "";
  const subject = `Nuevo pedido ${orderLabel} - ${order.customer_name || "Cliente"}${emailSuffix}`;
  const text = buildOrderText(order, siteUrl);
  const html = buildOrderHtml(order, siteUrl);
  const attachment = await buildOrderWorkbookAttachment(order);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html, attachments: [attachment] }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Resend failed: ${response.status} ${message}`);
  }

  const result = await response.json();
  return {
    id: String(result.id || ""),
    to,
  };
}

async function buildOrderWorkbookAttachment(order: Order): Promise<EmailAttachment> {
  const template = base64ToBytes(ORDER_TEMPLATE_BASE64);
  const files = unzipSync(template);
  const sheet = files[ORDER_TEMPLATE_SHEET_PATH];
  if (!sheet) throw new Error(`Missing order template sheet ${ORDER_TEMPLATE_SHEET_PATH}`);

  let sheetXml = strFromU8(sheet);
  sheetXml = clearOrderInputCells(sheetXml, order.order_items.length);
  const clientCode = order.sales_client_code || clientCodeFromNotes(order.notes);
  const clientCodeType = numericCellValue(clientCode) === null ? "string" : "number";
  sheetXml = upsertCell(sheetXml, "B1", order.sales_client_name || order.customer_name || "", "string");
  sheetXml = upsertCell(sheetXml, "F1", clientCode, clientCodeType);
  sheetXml = upsertCell(sheetXml, "B3", orderSalesClientAddress(order), "string");

  order.order_items.forEach((item, index) => {
    const row = 8 + index;
    const skuType = numericCellValue(item.sku) === null ? "string" : "number";
    sheetXml = upsertCell(sheetXml, `A${row}`, item.sku, skuType);
    sheetXml = upsertCell(sheetXml, `B${row}`, item.quantity, "number");
  });

  files[ORDER_TEMPLATE_SHEET_PATH] = strToU8(sheetXml);
  prepareWorkbookForRecalculation(files);
  const workbook = zipSync(files);
  const orderLabel = order.order_number ? String(order.order_number) : order.id;

  return {
    filename: `Nota de Pedido ${safeFilename(orderLabel)}.xlsx`,
    content: bytesToBase64(workbook),
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

function prepareWorkbookForRecalculation(files: Record<string, Uint8Array>) {
  delete files["xl/calcChain.xml"];

  updateXmlFile(files, "[Content_Types].xml", (xml) =>
    xml.replace(
      /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g,
      "",
    )
  );

  updateXmlFile(files, "xl/_rels/workbook.xml.rels", (xml) =>
    xml.replace(
      /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/calcChain"[^>]*\/>/g,
      "",
    )
  );

  updateXmlFile(files, "xl/workbook.xml", markWorkbookForFullCalculation);

  Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .forEach((path) => updateXmlFile(files, path, clearCachedFormulaValues));
}

function updateXmlFile(files: Record<string, Uint8Array>, path: string, update: (xml: string) => string) {
  const file = files[path];
  if (!file) return;
  files[path] = strToU8(update(strFromU8(file)));
}

function markWorkbookForFullCalculation(workbookXml: string) {
  const calcPr = '<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcOnSave="1"/>';

  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b[^>]*\/>/, calcPr);
  }

  if (/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b[^>]*>[\s\S]*?<\/calcPr>/, calcPr);
  }

  return workbookXml.replace("</workbook>", `${calcPr}</workbook>`);
}

function clearCachedFormulaValues(sheetXml: string) {
  return sheetXml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, (cellXml) => {
    if (!cellXml.includes("<f")) return cellXml;
    return markFormulaCellsDirty(cellXml).replace(/<v(?:\/>|>[\s\S]*?<\/v>)/g, "");
  });
}

function markFormulaCellsDirty(cellXml: string) {
  return cellXml.replace(/<f\b([^>]*)>/g, (_match, attributes: string) => {
    const selfClosing = /\/\s*$/.test(attributes);
    const cleanAttributes = attributes.replace(/\/\s*$/, "");
    const nextAttributes = setXmlAttribute(setXmlAttribute(cleanAttributes, "ca", "1"), "aca", "1");
    return `<f${nextAttributes}${selfClosing ? "/" : ""}>`;
  });
}

function setXmlAttribute(attributes: string, name: string, value: string) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (pattern.test(attributes)) {
    return attributes.replace(pattern, ` ${name}="${value}"`);
  }
  return `${attributes} ${name}="${value}"`;
}

function clearOrderInputCells(sheetXml: string, itemCount: number) {
  let nextXml = clearCell(sheetXml, "B1");
  nextXml = clearCell(nextXml, "B3");
  nextXml = clearCell(nextXml, "F1");
  const lastRow = Math.max(ORDER_TEMPLATE_LAST_INPUT_ROW, 8 + itemCount - 1);
  for (let row = 8; row <= lastRow; row += 1) {
    nextXml = clearCell(nextXml, `A${row}`);
    nextXml = clearCell(nextXml, `B${row}`);
  }
  return nextXml;
}

function upsertCell(sheetXml: string, ref: string, value: string | number, type: "string" | "number") {
  const rowNumber = cellRow(ref);
  const existingCell = findCell(sheetXml, ref);
  const cellXml = existingCell
    ? writeCellValue(existingCell, ref, value, type)
    : createCell(ref, value, type);

  if (existingCell) {
    return sheetXml.replace(existingCell, cellXml);
  }

  const rowPattern = new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  if (rowPattern.test(sheetXml)) {
    return sheetXml.replace(rowPattern, (_match, open, content, close) => {
      return `${open}${insertCellInColumnOrder(content, cellXml, ref)}${close}`;
    });
  }

  const selfClosingRowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*/>`);
  if (selfClosingRowPattern.test(sheetXml)) {
    return sheetXml.replace(selfClosingRowPattern, (row) => `${row.slice(0, -2)}>${cellXml}</row>`);
  }

  return sheetXml.replace("</sheetData>", `<row r="${rowNumber}">${cellXml}</row></sheetData>`);
}

function clearCell(sheetXml: string, ref: string) {
  const existingCell = findCell(sheetXml, ref);
  return existingCell ? sheetXml.replace(existingCell, clearCellValue(existingCell, ref)) : sheetXml;
}

function findCell(sheetXml: string, ref: string) {
  const escapedRef = escapeRegExp(ref);
  const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*\\/>|<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>[\\s\\S]*?<\\/c>`);
  return sheetXml.match(cellPattern)?.[0] || "";
}

function clearCellValue(cellXml: string, ref: string) {
  const attributes = normalizeCellAttributes(cellXml.match(/^<c\b([^>]*)/)?.[1] || ` r="${ref}"`, ref, "");
  return `<c${attributes}/>`;
}

function writeCellValue(cellXml: string, ref: string, value: string | number, type: "string" | "number") {
  const rawAttributes = cellXml.match(/^<c\b([^>]*)/)?.[1] || ` r="${ref}"`;
  const attributes = normalizeCellAttributes(rawAttributes, ref, type);
  return `<c${attributes}>${cellPayload(value, type)}</c>`;
}

function createCell(ref: string, value: string | number, type: "string" | "number") {
  const attributes = normalizeCellAttributes(` r="${ref}"`, ref, type);
  return `<c${attributes}>${cellPayload(value, type)}</c>`;
}

function normalizeCellAttributes(attributes: string, ref: string, type: "" | "string" | "number") {
  let normalized = attributes
    .replace(/\bt="[^"]*"/g, "")
    .replace(/\/\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\br="/.test(normalized)) {
    normalized = `r="${ref}" ${normalized}`.trim();
  }
  if (type === "string") {
    normalized = `${normalized} t="inlineStr"`;
  }
  return normalized ? ` ${normalized}` : "";
}

function cellPayload(value: string | number, type: "string" | "number") {
  if (type === "number") {
    const numericValue = typeof value === "number" ? value : numericCellValue(value);
    return `<v>${numericValue ?? 0}</v>`;
  }
  return `<is><t>${escapeXml(String(value || ""))}</t></is>`;
}

function numericCellValue(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = String(value || "").trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function insertCellInColumnOrder(rowContent: string, cellXml: string, ref: string) {
  const newColumn = columnIndex(ref);
  const cellPattern = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;
  let result = "";
  let lastIndex = 0;
  let inserted = false;

  for (const match of rowContent.matchAll(cellPattern)) {
    const existingRef = match[0].match(/\br="([A-Z]+\d+)"/)?.[1];
    if (!inserted && existingRef && columnIndex(existingRef) > newColumn) {
      result += rowContent.slice(lastIndex, match.index) + cellXml;
      inserted = true;
      lastIndex = match.index || 0;
    }
  }

  if (inserted) {
    result += rowContent.slice(lastIndex);
    return result;
  }

  return `${rowContent}${cellXml}`;
}

function cellRow(ref: string) {
  const match = ref.match(/\d+$/);
  if (!match) throw new Error(`Invalid cell reference ${ref}`);
  return match[0];
}

function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0];
  if (!letters) throw new Error(`Invalid cell reference ${ref}`);
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function clientCodeFromNotes(notes: string) {
  const match = String(notes || "").match(/C[oó]digo de cliente:\s*([^\n]+)/i);
  return match ? match[1].trim() : "";
}

function orderSalesClientAddress(order: Order) {
  return [order.sales_client_address, order.sales_client_locality].filter(Boolean).join(" - ");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|#]+/g, "-").replace(/\s+/g, " ").trim() || "pedido";
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOrderText(order: Order, siteUrl: string) {
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  return [
    `Nuevo pedido ${orderLabel}`,
    "",
    `Cliente: ${order.customer_name || "-"}`,
    order.sales_client_code ? `Código de cliente: ${order.sales_client_code}` : "",
    orderSalesClientAddress(order) ? `Dirección: ${orderSalesClientAddress(order)}` : "",
    order.salesman_code ? `Código de vendedor: ${order.salesman_code}` : "",
    `Email de cuenta: ${order.customer_email || "-"}`,
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
      ${order.sales_client_code ? `<p><strong>Código de cliente:</strong> ${escapeHtml(order.sales_client_code)}</p>` : ""}
      ${orderSalesClientAddress(order) ? `<p><strong>Dirección:</strong> ${escapeHtml(orderSalesClientAddress(order))}</p>` : ""}
      ${order.salesman_code ? `<p><strong>Código de vendedor:</strong> ${escapeHtml(order.salesman_code)}</p>` : ""}
      <p><strong>Email de cuenta:</strong> ${escapeHtml(order.customer_email || "-")}</p>
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
