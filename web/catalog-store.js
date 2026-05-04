(function () {
  const keys = {
    settings: "catalogSettings",
    productOverrides: "catalogProductOverrides",
    orders: "catalogOrders",
  };

  const defaultSettings = {
    brandName: "LEXO",
    catalogLabel: "Interactive catalog",
    whatsappNumber: "",
    adminPasswordHash: "35ae3089bd96dc75b1b486951b452ec9833f112ececfa7a40adc961e9fd756d6",
  };

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadSettings() {
    return { ...defaultSettings, ...readJson(keys.settings, {}) };
  }

  function saveSettings(nextSettings) {
    const settings = { ...loadSettings(), ...nextSettings };
    writeJson(keys.settings, settings);
    return settings;
  }

  function loadProductOverrides() {
    return readJson(keys.productOverrides, {});
  }

  function saveProductOverrides(overrides) {
    writeJson(keys.productOverrides, overrides);
    return overrides;
  }

  function applyProductOverrides(catalog, overrides = loadProductOverrides()) {
    catalog.products = catalog.products.map((product) => ({
      ...product,
      originalName: product.originalName || product.name,
      originalCategory: product.originalCategory || product.category,
      originalPrice: product.originalPrice || product.price,
      hidden: false,
      ...(overrides[product.id] || {}),
    }));
    return catalog;
  }

  function loadOrders() {
    return readJson(keys.orders, []);
  }

  function saveOrders(orders) {
    writeJson(keys.orders, orders);
    return orders;
  }

  function addOrder(order) {
    const orders = loadOrders();
    orders.unshift(order);
    saveOrders(orders);
    return orders;
  }

  function updateOrder(orderId, patch) {
    const orders = loadOrders().map((order) => (order.id === orderId ? { ...order, ...patch } : order));
    saveOrders(orders);
    return orders;
  }

  function deleteOrder(orderId) {
    const orders = loadOrders().filter((order) => order.id !== orderId);
    saveOrders(orders);
    return orders;
  }

  function priceNumber(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return Number(digits || 0);
  }

  function formatMoney(value) {
    return "$" + Math.round(value).toLocaleString("es-AR");
  }

  function buildOrderFromLines(lines, customer = {}) {
    const totalItems = lines.reduce((sum, line) => sum + line.qty, 0);
    const totalValue = lines.reduce((sum, line) => sum + priceNumber(line.product.price) * line.qty, 0);
    const now = new Date();

    return {
      id: `LEXO-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      createdAt: now.toISOString(),
      status: "new",
      customer: {
        name: String(customer.name || "").trim(),
        phone: String(customer.phone || "").trim(),
        notes: String(customer.notes || "").trim(),
      },
      items: lines.map(({ product, qty }) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        qty,
        page: product.page,
        lineTotal: priceNumber(product.price) * qty,
      })),
      totalItems,
      totalValue,
    };
  }

  function normalizeWhatsAppNumber(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  async function hashString(value) {
    if (!window.crypto?.subtle) {
      throw new Error("Password hashing needs a secure browser context. Use the local preview server instead of opening the file directly.");
    }

    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  window.CATALOG_STORE = {
    keys,
    defaultSettings,
    loadSettings,
    saveSettings,
    loadProductOverrides,
    saveProductOverrides,
    applyProductOverrides,
    loadOrders,
    saveOrders,
    addOrder,
    updateOrder,
    deleteOrder,
    buildOrderFromLines,
    normalizeWhatsAppNumber,
    priceNumber,
    formatMoney,
    hashString,
  };
})();
