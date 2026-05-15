(function () {
  const config = {
    url: "https://iexpvwmtxauvzkcncqoc.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlleHB2d210eGF1dnprY25jcW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODUxNjAsImV4cCI6MjA5MzQ2MTE2MH0.H29L5eOaaLjKnSv6_ro2ECRfaD5wjo5y7dBsyDBRt-E",
  };

  let recoveryMode = hasRecoveryMarkers();

  const client = window.supabase?.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }) || null;

  if (client) {
    client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        window.dispatchEvent(new CustomEvent("catalog:password-recovery"));
      }
    });
  }

  function hasRecoveryMarkers() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return Boolean(
      search.get("code") ||
        hash.get("code") ||
        hash.get("access_token") ||
        hash.get("refresh_token") ||
        hash.get("type") === "recovery" ||
        window.location.hash === "#reset-password",
    );
  }

  function isRecoveryMode() {
    return recoveryMode;
  }

  function clearRecoveryMode() {
    recoveryMode = false;
  }

  function isAvailable() {
    return Boolean(client);
  }

  async function getUser() {
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return data.user;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function signUp({ email, password, name, phone, company }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone, company },
      },
    });
    if (error) throw error;
    const user = data.session?.user || (await getUser());
    if (user) await upsertProfile(user, { name, phone, company });
    return data.user;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function sendPasswordReset(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
  }

  async function updatePassword(password) {
    await ensureRecoverySession();
    const { data, error } = await client.auth.updateUser({ password });
    if (error) throw error;
    return data.user;
  }

  async function ensureRecoverySession() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = search.get("code") || hash.get("code");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return data.session;
    }

    if (accessToken && refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      return data.session;
    }

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Falta la sesión de recuperación. Pedí un nuevo email de recuperación de contraseña y abrí el enlace más reciente en este mismo navegador.");
    return data.session;
  }

  async function getProfile(userId) {
    if (!client || !userId) return null;
    const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function upsertProfile(user, profile = {}) {
    if (!client || !user) return null;
    const payload = {
      id: user.id,
      email: user.email,
      name: String(profile.name || user.user_metadata?.name || user.email || "").trim() || user.email || "",
      phone: String(profile.phone || user.user_metadata?.phone || "").trim(),
      company: String(profile.company || user.user_metadata?.company || "").trim(),
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await client.from("profiles").upsert(payload, { onConflict: "id" }).select().single();
    if (error && error.message?.includes("'email' column")) {
      const { email, ...payloadWithoutEmail } = payload;
      const retry = await client.from("profiles").upsert(payloadWithoutEmail, { onConflict: "id" }).select().single();
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    return data;
  }

  async function saveOrder(order, userId) {
    if (!client || !userId) throw new Error("Iniciá sesión antes de enviar el pedido.");

    const orderPayload = {
      customer_id: userId,
      status: "placed",
      customer_name: order.customer.name,
      customer_phone: order.customer.phone,
      notes: order.customer.notes,
      total_items: order.totalItems,
      total_value: order.totalValue,
    };
    const { data: savedOrder, error: orderError } = await client.from("orders").insert(orderPayload).select().single();
    if (orderError) throw orderError;

    const items = order.items.map((item) => ({
      order_id: savedOrder.id,
      product_id: item.productId,
      sku: item.sku,
      name: item.name,
      unit_price: CATALOG_STORE.priceNumber(item.price),
      quantity: item.qty,
      line_total: item.lineTotal,
      page: item.page,
    }));
    const { error: itemsError } = await client.from("order_items").insert(items);
    if (itemsError) throw itemsError;

    const notification = await requestOrderNotification(savedOrder.id);

    return { ...normalizeOrder({ ...savedOrder, order_items: items }), notification };
  }

  async function requestOrderNotification(orderId) {
    try {
      const { error: queueError } = await client.from("order_notifications").insert({ order_id: orderId });
      if (queueError && queueError.code !== "23505") {
        console.warn("No se pudo crear la cola de notificacion; la funcion intentara repararla", queueError);
      }

      const { data, error: functionError } = await client.functions.invoke("send-order-notifications", {
        body: { order_id: orderId },
      });
      if (functionError) throw functionError;
      const failed = data?.results?.find((result) => result.status === "failed");
      if (failed) throw new Error(failed.error || "No se pudo enviar el email del pedido.");
      return { ok: true, data };
    } catch (error) {
      console.warn("No se pudo enviar la notificacion del pedido", error);
      return { ok: false, error: error.message || String(error) };
    }
  }

  async function loadMyOrders(userId) {
    if (!client || !userId) return [];
    const { data, error } = await client
      .from("orders")
      .select("*, order_items(*)")
      .eq("customer_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(normalizeOrder);
  }

  async function loadAllOrders() {
    if (!client) return [];
    const { data, error } = await client.from("orders").select("*, order_items(*)").order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(normalizeOrder);
  }

  async function loadActiveOrders() {
    if (!client) return [];
    const { data, error } = await client.from("orders").select("*, order_items(*)").neq("status", "sent").order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(normalizeOrder);
  }

  async function loadProductOverrides() {
    if (!client) return {};
    const { data, error } = await client.from("product_overrides").select("*");
    if (error) throw error;
    return (data || []).reduce((overrides, row) => {
      const override = {
        sku: row.sku || "",
        updatedAt: row.updated_at || "",
      };
      if (row.name) override.name = row.name;
      if (row.category) override.category = row.category;
      if (row.price) override.price = row.price;
      if (row.hidden) override.hidden = true;
      overrides[row.product_id] = override;
      return overrides;
    }, {});
  }

  async function upsertProductOverrides(overrides) {
    if (!client) throw new Error("Supabase no está disponible.");
    const user = await getUser();
    if (!user) throw new Error("Iniciá sesión con tu cuenta administradora de Supabase antes de actualizar el catálogo.");

    const rows = Object.entries(overrides || {}).map(([productId, override]) => ({
      product_id: productId,
      sku: String(override.sku || "").trim(),
      name: String(override.name || "").trim(),
      category: String(override.category || "").trim(),
      price: String(override.price || "").trim(),
      hidden: Boolean(override.hidden),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }));

    if (!rows.length) return [];
    const { data, error } = await client.from("product_overrides").upsert(rows, { onConflict: "product_id" }).select();
    if (error) throw error;
    return data || [];
  }

  async function updateOrderStatus(orderId, status) {
    const now = new Date().toISOString();
    const payload = {
      status,
      updated_at: now,
      archived_at: status === "sent" ? now : null,
    };
    let { error } = await client.from("orders").update(payload).eq("id", orderId);
    if (error && error.message?.includes("archived_at")) {
      const retry = await client.from("orders").update({ status, updated_at: now }).eq("id", orderId);
      error = retry.error;
    }
    if (error) throw error;
  }

  async function deleteOrder(orderId) {
    const { error } = await client.from("orders").delete().eq("id", orderId);
    if (error) throw error;
  }

  async function isAdmin(userId) {
    const profile = await getProfile(userId);
    return profile?.role === "admin";
  }

  function normalizeOrder(order) {
    return {
      id: order.id,
      displayId: order.order_number ? `#${order.order_number}` : order.id,
      remote: true,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      archivedAt: order.archived_at,
      status: order.status,
      customer: {
        name: order.customer_name || "",
        phone: order.customer_phone || "",
        notes: order.notes || "",
      },
      items: (order.order_items || []).map((item) => ({
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        price: CATALOG_STORE.formatMoney(item.unit_price),
        qty: item.quantity,
        page: item.page,
        lineTotal: Number(item.line_total || 0),
      })),
      totalItems: order.total_items,
      totalValue: Number(order.total_value || 0),
    };
  }

  window.CATALOG_SUPABASE = {
    config,
    client,
    isAvailable,
    isRecoveryMode,
    clearRecoveryMode,
    getUser,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
    ensureRecoverySession,
    getProfile,
    upsertProfile,
    saveOrder,
    requestOrderNotification,
    loadMyOrders,
    loadAllOrders,
    loadActiveOrders,
    loadProductOverrides,
    upsertProductOverrides,
    updateOrderStatus,
    deleteOrder,
    isAdmin,
  };
})();
