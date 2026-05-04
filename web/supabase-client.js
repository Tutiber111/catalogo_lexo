(function () {
  const config = {
    url: "https://iexpvwmtxauvzkcncqoc.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlleHB2d210eGF1dnprY25jcW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODUxNjAsImV4cCI6MjA5MzQ2MTE2MH0.H29L5eOaaLjKnSv6_ro2ECRfaD5wjo5y7dBsyDBRt-E",
  };

  const client = window.supabase?.createClient(config.url, config.anonKey) || null;

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
    if (data.user) await upsertProfile(data.user, { name, phone, company });
    return data.user;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
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
      name: String(profile.name || user.user_metadata?.name || user.email || "").trim(),
      phone: String(profile.phone || user.user_metadata?.phone || "").trim(),
      company: String(profile.company || user.user_metadata?.company || "").trim(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client.from("profiles").upsert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function saveOrder(order, userId) {
    if (!client || !userId) throw new Error("Sign in before saving the order.");

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

    return normalizeOrder({ ...savedOrder, order_items: items });
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

  async function updateOrderStatus(orderId, status) {
    const { error } = await client.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", orderId);
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
    getUser,
    signIn,
    signUp,
    signOut,
    getProfile,
    upsertProfile,
    saveOrder,
    loadMyOrders,
    loadAllOrders,
    updateOrderStatus,
    deleteOrder,
    isAdmin,
  };
})();
