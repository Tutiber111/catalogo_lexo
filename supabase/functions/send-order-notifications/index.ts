import { strFromU8, strToU8, unzipSync, zipSync } from "npm:fflate@0.8.2";
import { ORDER_TEMPLATE_BASE64 } from "./order-template-base64.ts";

type OrderNotification = {
  id: string;
  order_id: string;
  attempts: number;
};

type DeliveryNotification = OrderNotification & {
  status: string;
  resend_email_id: string;
  resend_to: string;
  resend_last_event: string;
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
  customer_company?: string;
  order_number: number | null;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_client_code: string;
  sales_client_id: string | null;
  sales_client_code: string;
  sales_client_name: string;
  sales_client_address: string;
  sales_client_locality: string;
  branch_order_group_id: string | null;
  client_branch_id: string | null;
  branch_name: string;
  branch_address: string;
  branch_locality: string;
  salesman_code: string;
  order_transport: string;
  notes: string;
  total_items: number;
  total_value: number;
  created_at: string;
  order_items: OrderItem[];
};

type CustomerProfile = {
  email: string;
  client_code: string;
  company: string;
  role: string;
  salesman_code: string;
  assigned_salesman_code: string;
};

type EmailAttachment = {
  filename: string;
  content: string;
  content_type: string;
};

type SentEmail = {
  id: string;
  to: string[];
  warning: string;
};

const ORDER_TEMPLATE_SHEET_PATH = "xl/worksheets/sheet3.xml";
const ORDER_TEMPLATE_LAST_INPUT_ROW = 262;
const ORDER_SELECT = "id,customer_id,order_number,status,customer_name,customer_phone,customer_client_code,sales_client_id,sales_client_code,sales_client_name,sales_client_address,sales_client_locality,salesman_code,order_transport,notes,branch_order_group_id,client_branch_id,branch_name,branch_address,branch_locality,total_items,total_value,created_at,order_items(sku,name,unit_price,quantity,line_total,page)";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-order-notification-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await readJson(req);
    const context = await loadRequestContext(req);
    if (body.action === "sync_delivery") {
      if (!context.isAdmin) throw new Error("Only admins can check delivery status.");
      return jsonResponse(await syncRecentDeliveryStatuses());
    }
    if (body.order_group_id) {
      return jsonResponse(await sendOrderGroupNotification(requiredUuid(body.order_group_id, "order_group_id"), {
        context,
        force: Boolean(body.force),
      }));
    }
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
    orderId = await canonicalNotificationOrderId(requiredUuid(orderId, "order_id"), options.context);
    const ready = await ensureNotification(orderId, Boolean(options.force));
    if (!ready) {
      return {
        processed: 0,
        results: [{
          order_id: orderId,
          status: "processing",
          error: "This grouped email is already being prepared. Wait before retrying.",
        }],
      };
    }
  }

  const notifications = await loadPendingNotifications(orderId);
  const results = [];

  for (const notification of notifications) {
    const locked = await lockNotification(notification);
    if (!locked) continue;

    try {
      const order = await loadOrder(notification.order_id);
      const groupedOrders = order.branch_order_group_id
        ? await loadOrderGroup(order.branch_order_group_id)
        : [order];
      const sentEmail = groupedOrders.length > 1
        ? await sendOrderBatchEmail(groupedOrders)
        : await sendOrderEmail(order);
      await updateNotification(notification.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        resend_email_id: sentEmail.id,
        resend_to: sentEmail.to.join(", "),
        resend_last_event: "sent",
        delivery_checked_at: new Date().toISOString(),
        delivery_error: "",
        last_error: sentEmail.warning,
      });
      results.push({
        order_id: notification.order_id,
        status: "sent",
        email_id: sentEmail.id,
        ...(sentEmail.warning ? { warning: sentEmail.warning } : {}),
      });
    } catch (error) {
      const message = errorMessage(error);
      await updateNotification(notification.id, {
        status: "failed",
        resend_email_id: "",
        resend_last_event: "failed",
        delivery_checked_at: new Date().toISOString(),
        delivery_error: message,
        last_error: message,
      });
      results.push({ order_id: notification.order_id, status: "failed", error: message });
    }
  }

  return { processed: results.length, results };
}

async function sendOrderGroupNotification(orderGroupId: string, options: { context: RequestContext; force?: boolean }) {
  const orders = await loadOrderGroup(orderGroupId);
  if (!orders.length) throw new Error(`Order group ${orderGroupId} not found`);
  await ensureCanSendOrderGroupNotification(orders, options.context);
  return sendPendingOrderNotifications(orders[0].id, options);
}

async function canonicalNotificationOrderId(orderId: string, context: RequestContext) {
  const order = await loadOrder(orderId);
  if (!order.branch_order_group_id) {
    await ensureCanSendOrderNotification(orderId, context);
    return orderId;
  }
  const orders = await loadOrderGroup(order.branch_order_group_id);
  await ensureCanSendOrderGroupNotification(orders, context);
  return orders[0].id;
}

async function ensureCanSendOrderGroupNotification(orders: Order[], context: RequestContext) {
  if (!orders.length) throw new Error("The order group is empty.");
  if (context.isAdmin) return;
  if (orders.some((order) => order.customer_id !== context.userId)) {
    throw new Error("You can only send notifications for your own order groups.");
  }
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

async function ensureNotification(orderId: string, force = false): Promise<boolean> {
  if (force) {
    const existingParams = new URLSearchParams({
      order_id: `eq.${orderId}`,
      select: "id,status,updated_at",
      limit: "1",
    });
    const existingResponse = await supabaseFetch(`/rest/v1/order_notifications?${existingParams}`);
    const existingRows = await existingResponse.json();
    const existing = existingRows[0];
    if (existing?.status === "processing") {
      const updatedAt = new Date(existing.updated_at || 0).getTime();
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 180_000) return false;
    }

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
        resend_last_event: "",
        delivery_checked_at: null,
        delivery_error: "",
        updated_at: new Date().toISOString(),
      }),
    });
    const rows = await response.json();
    if (rows.length) return true;
  }

  await supabaseFetch("/rest/v1/order_notifications?on_conflict=order_id", {
    method: "POST",
    headers: { Prefer: force ? "resolution=merge-duplicates" : "resolution=ignore-duplicates" },
    body: JSON.stringify({
      order_id: orderId,
      status: "pending",
      last_error: "",
      resend_email_id: "",
      resend_last_event: "",
      delivery_checked_at: null,
      delivery_error: "",
      updated_at: new Date().toISOString(),
    }),
  });
  return true;
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
    select: ORDER_SELECT,
  });
  const response = await supabaseFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  if (!rows.length) throw new Error(`Order ${orderId} not found`);
  return hydrateOrder(rows[0]);
}

async function loadOrderGroup(orderGroupId: string): Promise<Order[]> {
  const params = new URLSearchParams({
    branch_order_group_id: `eq.${orderGroupId}`,
    select: ORDER_SELECT,
    order: "created_at.asc,id.asc",
  });
  const response = await supabaseFetch(`/rest/v1/orders?${params}`);
  const rows = await response.json();
  return Promise.all(rows.map(hydrateOrder));
}

async function hydrateOrder(order: Order): Promise<Order> {
  const customerProfile = await loadCustomerProfile(order.customer_id);
  order.customer_email = customerProfile.email;
  order.customer_company = customerProfile.company;
  if (!order.customer_client_code) order.customer_client_code = customerProfile.client_code;
  order.salesman_code = await resolveOrderSalesmanCode(order, customerProfile);
  return order;
}

async function syncRecentDeliveryStatuses() {
  const params = new URLSearchParams({
    select: "id,order_id,attempts,status,resend_email_id,resend_to,resend_last_event",
    resend_email_id: "neq.",
    order: "updated_at.desc",
    limit: "50",
  });
  const response = await supabaseFetch(`/rest/v1/order_notifications?${params}`);
  const notifications: DeliveryNotification[] = await response.json();
  const results = [];
  let configurationError = "";

  for (const notification of notifications) {
    const ids = splitValues(notification.resend_email_id);
    const recipients = splitValues(notification.resend_to);
    const events: Array<{ id: string; recipient: string; event: string }> = [];
    const errors: string[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      try {
        const message = await loadResendEmail(ids[index]);
        events.push({
          id: ids[index],
          recipient: recipients[index] || emailList(message.to).join(", ") || "destinatario",
          event: String(message.last_event || "sent").toLowerCase(),
        });
      } catch (error) {
        const message = errorMessage(error);
        if (message.includes("restricted_api_key")) {
          configurationError = "La API key de Resend solo permite enviar emails; necesita acceso completo para consultar la entrega.";
          errors.push(`${recipients[index] || ids[index]}: ${configurationError}`);
        } else {
          errors.push(`${recipients[index] || ids[index]}: ${message}`);
        }
      }
    }
    const lastEvent = aggregateDeliveryEvent(events.map((entry) => entry.event))
      || notification.resend_last_event
      || (notification.status === "sent" ? "sent" : "");
    const eventDetails = events
      .filter((entry) => !["delivered", "opened", "clicked"].includes(entry.event))
      .map((entry) => `${entry.recipient}: ${entry.event}`);
    const deliveryError = [...eventDetails, ...errors].join(" | ");
    await updateNotification(notification.id, {
      resend_last_event: lastEvent,
      delivery_checked_at: new Date().toISOString(),
      delivery_error: deliveryError,
    });
    results.push({ order_id: notification.order_id, last_event: lastEvent, error: deliveryError });
  }

  return { checked: results.length, results, configuration_error: configurationError };
}

async function loadResendEmail(emailId: string) {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}` },
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function aggregateDeliveryEvent(events: string[]) {
  const priority: Record<string, number> = {
    complained: 90,
    bounced: 80,
    failed: 80,
    suppressed: 80,
    canceled: 80,
    delivery_delayed: 60,
    queued: 30,
    scheduled: 30,
    sent: 30,
    delivered: 10,
    opened: 5,
    clicked: 5,
  };
  return [...events].sort((first, second) => (priority[second] || 40) - (priority[first] || 40))[0] || "";
}

function splitValues(value: string) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function loadCustomerProfile(customerId: string): Promise<CustomerProfile> {
  if (!customerId) {
    return {
      email: "",
      client_code: "",
      company: "",
      role: "",
      salesman_code: "",
      assigned_salesman_code: "",
    };
  }
  const params = new URLSearchParams({
    id: `eq.${customerId}`,
    select: "email,client_code,company,role,salesman_code,assigned_salesman_code",
    limit: "1",
  });
  const response = await supabaseFetch(`/rest/v1/profiles?${params}`);
  const rows = await response.json();
  return {
    email: rows[0]?.email || "",
    client_code: rows[0]?.client_code || "",
    company: rows[0]?.company || "",
    role: rows[0]?.role || "",
    salesman_code: rows[0]?.salesman_code || "",
    assigned_salesman_code: rows[0]?.assigned_salesman_code || "",
  };
}

async function resolveOrderSalesmanCode(order: Order, customerProfile: CustomerProfile) {
  if (order.sales_client_id) {
    const params = new URLSearchParams({
      id: `eq.${order.sales_client_id}`,
      select: "salesman_code",
      limit: "1",
    });
    const response = await supabaseFetch(`/rest/v1/sales_clients?${params}`);
    const rows = await response.json();
    const linkedCode = String(rows[0]?.salesman_code || "").trim();
    if (linkedCode) return linkedCode;
  }

  if (customerProfile.role === "salesman") {
    return String(customerProfile.salesman_code || "").trim();
  }
  if (customerProfile.assigned_salesman_code) {
    return String(customerProfile.assigned_salesman_code).trim();
  }
  if (customerProfile.role === "admin") {
    return String(order.salesman_code || "").trim();
  }
  return "";
}

async function loadSalesmanEmail(salesmanCode: string) {
  const code = String(salesmanCode || "").trim();
  if (!code) return "";

  const params = new URLSearchParams({
    salesman_code: `eq.${code}`,
    role: "eq.salesman",
    select: "email,order_notification_email",
    limit: "1",
  });
  const response = await supabaseFetch(`/rest/v1/profiles?${params}`);
  const rows = await response.json();
  return String(rows[0]?.order_notification_email || rows[0]?.email || "").trim();
}

async function loadRequestContext(req: Request): Promise<RequestContext> {
  const internalSecret = req.headers.get("x-order-notification-secret") || "";
  const expectedInternalSecret = Deno.env.get("ORDER_NOTIFICATION_INTERNAL_SECRET") || "";
  if (internalSecret && expectedInternalSecret && internalSecret === expectedInternalSecret) {
    return { userId: "internal", isAdmin: true };
  }

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
  const siteUrl = Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "";
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  const emailSuffix = order.customer_email ? ` (${order.customer_email})` : "";
  const branchSuffix = order.branch_name ? ` - Sucursal ${order.branch_name}` : "";
  return deliverPreparedOrderEmail(order, {
    subject: `Nuevo pedido ${orderLabel}${branchSuffix} - ${orderDisplayClientName(order) || "Cliente"}${emailSuffix}`,
    text: buildOrderText(order, siteUrl),
    html: buildOrderHtml(order, siteUrl),
    attachments: [await buildOrderWorkbookAttachment(order)],
  });
}

async function sendOrderBatchEmail(orders: Order[]): Promise<SentEmail> {
  const primaryOrder = orders[0];
  const siteUrl = Deno.env.get("ORDER_NOTIFICATION_SITE_URL") || "";
  const emailSuffix = primaryOrder.customer_email ? ` (${primaryOrder.customer_email})` : "";
  const subject = `Nuevo pedido para ${orders.length} sucursales - ${orderDisplayClientName(primaryOrder) || "Cliente"}${emailSuffix}`;
  const templateFiles = prepareOrderTemplateFiles();
  const attachments: EmailAttachment[] = [];
  for (const order of orders) {
    attachments.push(await buildOrderWorkbookAttachment(order, templateFiles));
  }
  return deliverPreparedOrderEmail(primaryOrder, {
    subject,
    text: buildOrderBatchText(orders, siteUrl),
    html: buildOrderBatchHtml(orders, siteUrl),
    attachments,
  });
}

async function deliverPreparedOrderEmail(order: Order, message: {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}): Promise<SentEmail> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const primaryRecipients = uniqueEmails(emailList(requiredEnv("ORDER_NOTIFICATION_TO")));
  if (!primaryRecipients.length) throw new Error("ORDER_NOTIFICATION_TO has no valid recipients.");
  const salesmanEmail = await loadSalesmanEmail(order.salesman_code);
  const missingSalesmanEmail = Boolean(order.salesman_code) && !salesmanEmail;
  const from = requiredEnv("ORDER_NOTIFICATION_FROM");
  const salesmanNeedsCopy = salesmanEmail
    && !primaryRecipients.some((email) => email.toLowerCase() === salesmanEmail.toLowerCase());
  const usesTestingSender = /@resend\.dev\b/i.test(from);
  const optionalRecipients = salesmanNeedsCopy && !usesTestingSender ? [salesmanEmail] : [];
  const recipients = uniqueEmails([...primaryRecipients, ...optionalRecipients]);
  const [visibleRecipient, ...blindCopyRecipients] = recipients;
  const emailId = await sendResendEmail(apiKey, {
    from,
    to: [visibleRecipient],
    ...(blindCopyRecipients.length ? { bcc: blindCopyRecipients } : {}),
    ...message,
  });

  const warnings = [
    ...(missingSalesmanEmail
      ? [`Salesman copy skipped: no notification email was found for salesman code ${order.salesman_code}.`]
      : []),
    ...(salesmanNeedsCopy && usesTestingSender
      ? ["Salesman copy skipped: verify a sending domain in Resend and update ORDER_NOTIFICATION_FROM."]
      : []),
  ];
  return {
    id: emailId,
    to: recipients,
    warning: warnings.join(" | "),
  };
}

async function sendResendEmail(apiKey: string, payload: Record<string, unknown>) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Resend failed: ${response.status} ${message}`);
  }

  const result = await response.json();
  return String(result.id || "");
}

async function buildOrderWorkbookAttachment(
  order: Order,
  preparedTemplateFiles?: Record<string, Uint8Array>,
): Promise<EmailAttachment> {
  const files = { ...(preparedTemplateFiles || prepareOrderTemplateFiles()) };
  const sheet = files[ORDER_TEMPLATE_SHEET_PATH];
  if (!sheet) throw new Error(`Missing order template sheet ${ORDER_TEMPLATE_SHEET_PATH}`);

  let sheetXml = strFromU8(sheet);
  sheetXml = clearOrderInputCells(sheetXml, order.order_items.length);
  const clientCode = orderClientCode(order);
  const clientCodeType = numericCellValue(clientCode) === null ? "string" : "number";
  sheetXml = upsertCell(sheetXml, "B1", orderDisplayClientName(order), "string");
  sheetXml = upsertCell(sheetXml, "B2", orderDeliveryAddress(order), "string");
  sheetXml = upsertCell(sheetXml, "F1", clientCode, clientCodeType);
  sheetXml = upsertCell(sheetXml, "B3", order.order_transport || "", "string");
  sheetXml = upsertCell(sheetXml, "K1", order.notes || "", "string");

  order.order_items.forEach((item, index) => {
    const row = 8 + index;
    const skuType = numericCellValue(item.sku) === null ? "string" : "number";
    sheetXml = upsertCell(sheetXml, `A${row}`, item.sku, skuType);
    sheetXml = upsertCell(sheetXml, `B${row}`, item.quantity, "number");
  });

  files[ORDER_TEMPLATE_SHEET_PATH] = strToU8(sheetXml);
  const workbook = zipSync(files, { level: 1 });
  const orderLabel = order.order_number ? String(order.order_number) : order.id;

  return {
    filename: `Nota de Pedido ${safeFilename(orderLabel)}${order.branch_name ? ` - ${safeFilename(order.branch_name)}` : ""}.xlsx`,
    content: bytesToBase64(workbook),
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

function prepareOrderTemplateFiles() {
  const files = unzipSync(base64ToBytes(ORDER_TEMPLATE_BASE64));
  prepareWorkbookForRecalculation(files);
  return files;
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
  nextXml = clearCell(nextXml, "B2");
  nextXml = clearCell(nextXml, "B3");
  nextXml = clearCell(nextXml, "F1");
  nextXml = clearCell(nextXml, "K1");
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

function orderClientCode(order: Order) {
  return order.sales_client_code || order.customer_client_code || clientCodeFromNotes(order.notes);
}

function orderDisplayClientName(order: Order) {
  return order.sales_client_name || order.customer_company || order.customer_name || "";
}

function orderEmailCompanyLine(order: Order) {
  const company = order.customer_company || "";
  if (!company || company === orderDisplayClientName(order)) return "";
  return company;
}

function orderSalesClientAddress(order: Order) {
  return [order.sales_client_address, order.sales_client_locality].filter(Boolean).join(" - ");
}

function orderBranchAddress(order: Order) {
  return [order.branch_address, order.branch_locality].filter(Boolean).join(" - ");
}

function orderDeliveryAddress(order: Order) {
  if (order.branch_name) return orderBranchAddress(order) || order.branch_name;
  return orderSalesClientAddress(order);
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

function buildOrderBatchText(orders: Order[], siteUrl: string) {
  const primaryOrder = orders[0];
  const totalItems = orders.reduce((sum, order) => sum + Number(order.total_items || 0), 0);
  const totalValue = orders.reduce((sum, order) => sum + Number(order.total_value || 0), 0);
  return [
    `Nuevo pedido distribuido en ${orders.length} sucursales`,
    "",
    `Cliente: ${orderDisplayClientName(primaryOrder) || "-"}`,
    orderClientCode(primaryOrder) ? `Código de cliente: ${orderClientCode(primaryOrder)}` : "",
    primaryOrder.salesman_code ? `Código de vendedor: ${primaryOrder.salesman_code}` : "",
    `Email de cuenta: ${primaryOrder.customer_email || "-"}`,
    primaryOrder.customer_phone ? `Teléfono: ${primaryOrder.customer_phone}` : "",
    primaryOrder.notes ? `Observaciones: ${primaryOrder.notes}` : "",
    "",
    ...orders.map((order) => {
      const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
      const destination = orderBranchAddress(order) || "Sin domicilio especificado";
      return `${order.branch_name || "Sucursal"} · Pedido ${orderLabel} · ${destination} · ${order.total_items} unidades · ${formatMoney(Number(order.total_value))}`;
    }),
    "",
    `Total general: ${totalItems} unidades · ${formatMoney(totalValue)}`,
    `Se adjuntan ${orders.length} archivos Excel, uno por sucursal.`,
    siteUrl ? `Catálogo: ${siteUrl}` : "",
  ].filter(Boolean).join("\n");
}

function buildOrderBatchHtml(orders: Order[], siteUrl: string) {
  const primaryOrder = orders[0];
  const totalItems = orders.reduce((sum, order) => sum + Number(order.total_items || 0), 0);
  const totalValue = orders.reduce((sum, order) => sum + Number(order.total_value || 0), 0);
  const rows = orders.map((order) => {
    const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
    return `
      <tr>
        <td>${escapeHtml(order.branch_name || "Sucursal")}</td>
        <td>${escapeHtml(orderLabel)}</td>
        <td>${escapeHtml(orderBranchAddress(order) || "-")}</td>
        <td>${escapeHtml(String(order.total_items))}</td>
        <td>${escapeHtml(formatMoney(Number(order.total_value)))}</td>
      </tr>
    `;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#16161a">
      <h2>Nuevo pedido para ${escapeHtml(String(orders.length))} sucursales</h2>
      <p><strong>Cliente:</strong> ${escapeHtml(orderDisplayClientName(primaryOrder) || "-")}</p>
      ${orderClientCode(primaryOrder) ? `<p><strong>Código de cliente:</strong> ${escapeHtml(orderClientCode(primaryOrder))}</p>` : ""}
      ${primaryOrder.salesman_code ? `<p><strong>Código de vendedor:</strong> ${escapeHtml(primaryOrder.salesman_code)}</p>` : ""}
      <p><strong>Email de cuenta:</strong> ${escapeHtml(primaryOrder.customer_email || "-")}</p>
      ${primaryOrder.customer_phone ? `<p><strong>Teléfono:</strong> ${escapeHtml(primaryOrder.customer_phone)}</p>` : ""}
      ${primaryOrder.notes ? `<p><strong>Observaciones:</strong> ${escapeHtml(primaryOrder.notes)}</p>` : ""}
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#dde1e7">
        <thead><tr><th>Sucursal</th><th>Pedido</th><th>Destino</th><th>Unidades</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><strong>Total general:</strong> ${escapeHtml(String(totalItems))} unidades · ${escapeHtml(formatMoney(totalValue))}</p>
      <p>Se adjuntan ${escapeHtml(String(orders.length))} archivos Excel, uno por sucursal.</p>
      ${siteUrl ? `<p><a href="${escapeHtml(siteUrl)}">Abrir catálogo</a></p>` : ""}
    </div>
  `;
}

function buildOrderText(order: Order, siteUrl: string) {
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id;
  const companyName = orderEmailCompanyLine(order);
  return [
    `Nuevo pedido ${orderLabel}`,
    "",
    `Cliente: ${orderDisplayClientName(order) || "-"}`,
    order.branch_name ? `Sucursal: ${order.branch_name}` : "",
    orderBranchAddress(order) ? `Destino: ${orderBranchAddress(order)}` : "",
    companyName ? `Empresa: ${companyName}` : "",
    orderClientCode(order) ? `Código de cliente: ${orderClientCode(order)}` : "",
    orderSalesClientAddress(order) ? `Dirección: ${orderSalesClientAddress(order)}` : "",
    order.salesman_code ? `Código de vendedor: ${order.salesman_code}` : "",
    `Email de cuenta: ${order.customer_email || "-"}`,
    `Teléfono: ${order.customer_phone || "-"}`,
    `Fecha: ${new Date(order.created_at).toLocaleString("es-AR")}`,
    order.notes ? `Observaciones: ${order.notes}` : "",
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
  const companyName = orderEmailCompanyLine(order);
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
      <p><strong>Cliente:</strong> ${escapeHtml(orderDisplayClientName(order) || "-")}</p>
      ${order.branch_name ? `<p><strong>Sucursal:</strong> ${escapeHtml(order.branch_name)}</p>` : ""}
      ${orderBranchAddress(order) ? `<p><strong>Destino:</strong> ${escapeHtml(orderBranchAddress(order))}</p>` : ""}
      ${companyName ? `<p><strong>Empresa:</strong> ${escapeHtml(companyName)}</p>` : ""}
      ${orderClientCode(order) ? `<p><strong>Código de cliente:</strong> ${escapeHtml(orderClientCode(order))}</p>` : ""}
      ${orderSalesClientAddress(order) ? `<p><strong>Dirección:</strong> ${escapeHtml(orderSalesClientAddress(order))}</p>` : ""}
      ${order.salesman_code ? `<p><strong>Código de vendedor:</strong> ${escapeHtml(order.salesman_code)}</p>` : ""}
      <p><strong>Email de cuenta:</strong> ${escapeHtml(order.customer_email || "-")}</p>
      <p><strong>Teléfono:</strong> ${escapeHtml(order.customer_phone || "-")}</p>
      <p><strong>Fecha:</strong> ${escapeHtml(new Date(order.created_at).toLocaleString("es-AR"))}</p>
      ${order.notes ? `<p><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>` : ""}
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

function requiredUuid(value: unknown, field: string) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${field} must be a UUID.`);
  }
  return text;
}

function emailList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueEmails(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
