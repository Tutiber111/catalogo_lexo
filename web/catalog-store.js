(function () {
  const keys = {
    settings: "catalogSettings",
    productOverrides: "catalogProductOverrides",
    orders: "catalogOrders",
    orderArchive: "catalogOrderArchive",
  };

  const defaultSettings = {
    brandName: "LEXO",
    catalogLabel: "Catálogo interactivo",
    whatsappNumber: "",
    adminPasswordHash: "35ae3089bd96dc75b1b486951b452ec9833f112ececfa7a40adc961e9fd756d6",
  };

  const defaultProductVideos = {
    // Prepara EVAK family
    "Prepara:3039": "https://www.youtube.com/watch?v=Jh7B4RRu9f4",
    "Prepara:3040": "https://www.youtube.com/watch?v=Jh7B4RRu9f4",
    "Prepara:P3041": "https://www.youtube.com/watch?v=Jh7B4RRu9f4",
    "Prepara:3042": "https://www.youtube.com/watch?v=Jh7B4RRu9f4",
    "Prepara:3044": "https://www.youtube.com/watch?v=Jh7B4RRu9f4",
    // Prepara Herb Savor family
    "Prepara:20101": "https://www.youtube.com/watch?v=4ZvU0T-a7WM",
    "Prepara:20118": "https://www.youtube.com/watch?v=4ZvU0T-a7WM",
    // Dreamfarm Fluicer family
    "Dreamfarm:3444": "https://www.youtube.com/watch?v=5PH6bvfHoJ0",
    "Dreamfarm:3451": "https://www.youtube.com/watch?v=5PH6bvfHoJ0",
    // OXO POP container family
    "OXO:11233700": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11233600": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11233500": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234000": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11233900": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11233800": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234200": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234100": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234700": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234600": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234500": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234400": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11235000": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234900": "https://www.youtube.com/watch?v=DTujNDIRMZM",
    "OXO:11234800": "https://www.youtube.com/watch?v=DTujNDIRMZM",
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
    const settings = { ...defaultSettings, ...readJson(keys.settings, {}) };
    if (settings.catalogLabel === "Interactive catalog") settings.catalogLabel = "Catálogo interactivo";
    return settings;
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
    catalog.products = catalog.products.map((product) => {
      const videoKey = `${String(product.section || "").trim()}:${String(product.sku || "").trim()}`;
      const baselineVideoUrl = product.originalVideoUrl || product.videoUrl || defaultProductVideos[videoKey] || "";
      const savedOverride = overrides[product.id] || {};
      const productSku = normalizeProductSku(product.sku);
      const overrideSku = normalizeProductSku(savedOverride.sku);
      const matchingOverride = overrideSku && productSku && overrideSku !== productSku ? {} : savedOverride;
      return {
        ...product,
        originalName: product.originalName || product.name,
        originalCategory: product.originalCategory || product.category,
        originalPrice: product.originalPrice || product.price,
        originalVideoUrl: baselineVideoUrl,
        name: product.originalName || product.name,
        category: product.originalCategory || product.category,
        price: product.originalPrice || product.price,
        videoUrl: baselineVideoUrl,
        hidden: false,
        outOfStock: false,
        ...matchingOverride,
      };
    });
    return catalog;
  }

  function normalizeProductSku(value) {
    return String(value || "").trim().replace(/\.0$/, "").replace(/\s+/g, "").toUpperCase();
  }

  function mergeProductOverrides(...sources) {
    return sources.reduce((merged, source) => {
      Object.entries(source || {}).forEach(([productId, override]) => {
        if (!override || typeof override !== "object") return;
        merged[productId] = { ...(merged[productId] || {}), ...override };
      });
      return merged;
    }, {});
  }

  function loadOrders() {
    return archiveSentOrders(readJson(keys.orders, []));
  }

  function saveOrders(orders) {
    writeJson(keys.orders, orders);
    return orders;
  }

  function loadArchivedOrders() {
    return readJson(keys.orderArchive, []);
  }

  function saveArchivedOrders(orders) {
    writeJson(keys.orderArchive, orders);
    return orders;
  }

  function clearArchivedOrders() {
    saveArchivedOrders([]);
    return [];
  }

  function loadAllOrders() {
    return [...loadOrders(), ...loadArchivedOrders()];
  }

  function addOrder(order) {
    const orders = loadOrders();
    orders.unshift(order);
    saveOrders(orders);
    return orders;
  }

  function updateOrder(orderId, patch) {
    if (patch.status === "sent") {
      return archiveOrder(orderId, patch);
    }

    const orders = loadOrders().map((order) => (order.id === orderId ? { ...order, ...patch } : order));
    saveOrders(orders);
    return orders;
  }

  function deleteOrder(orderId) {
    const orders = loadOrders().filter((order) => order.id !== orderId);
    saveOrders(orders);
    return orders;
  }

  function archiveSentOrders(orders) {
    const activeOrders = orders.filter((order) => order.status !== "sent");
    const sentOrders = orders.filter((order) => order.status === "sent");
    if (!sentOrders.length) return activeOrders;

    saveOrders(activeOrders);
    const archiveById = new Map(loadArchivedOrders().map((order) => [order.id, order]));
    sentOrders.forEach((order) => {
      archiveById.set(order.id, {
        ...order,
        status: "sent",
        archivedAt: order.archivedAt || order.updatedAt || new Date().toISOString(),
      });
    });
    saveArchivedOrders([...archiveById.values()].sort((a, b) => new Date(b.archivedAt || b.createdAt) - new Date(a.archivedAt || a.createdAt)));
    return activeOrders;
  }

  function archiveOrder(orderId, patch = {}) {
    const orders = loadOrders();
    const order = orders.find((item) => item.id === orderId);
    if (!order) return orders;

    const now = new Date().toISOString();
    saveOrders(orders.filter((item) => item.id !== orderId));
    const archivedOrder = {
      ...order,
      ...patch,
      status: "sent",
      updatedAt: now,
      archivedAt: now,
    };
    const archive = loadArchivedOrders().filter((item) => item.id !== orderId);
    saveArchivedOrders([archivedOrder, ...archive]);
    return loadOrders();
  }

  function restoreOrder(orderId) {
    const archive = loadArchivedOrders();
    const order = archive.find((item) => item.id === orderId);
    if (!order) return loadOrders();

    const now = new Date().toISOString();
    saveArchivedOrders(archive.filter((item) => item.id !== orderId));
    const restoredOrder = {
      ...order,
      status: "placed",
      updatedAt: now,
      archivedAt: "",
    };
    saveOrders([restoredOrder, ...loadOrders().filter((item) => item.id !== orderId)]);
    return loadOrders();
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
      clientRequestId: randomUuid(),
      createdAt: now.toISOString(),
      status: "new",
      customer: {
        name: String(customer.name || "").trim(),
        phone: String(customer.phone || "").trim(),
        clientCode: String(customer.clientCode || "").trim(),
        notes: String(customer.notes || "").trim(),
        salesClient: customer.salesClient || null,
        salesmanCode: String(customer.salesmanCode || "").trim(),
        transport: String(customer.transport || "").trim(),
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

  function randomUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function isValidClientRequestId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
  }

  function ensureClientRequestId(order) {
    if (!order || typeof order !== "object" || isValidClientRequestId(order.clientRequestId)) return order;
    return {
      ...order,
      clientRequestId: randomUuid(),
    };
  }

  function normalizeWhatsAppNumber(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  async function hashString(value) {
    if (!window.crypto?.subtle) {
      throw new Error("El hash de contraseña necesita un contexto seguro del navegador. Usá el servidor de vista previa local en vez de abrir el archivo directamente.");
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
    mergeProductOverrides,
    loadOrders,
    saveOrders,
    loadArchivedOrders,
    saveArchivedOrders,
    loadAllOrders,
    clearArchivedOrders,
    addOrder,
    updateOrder,
    deleteOrder,
    archiveOrder,
    restoreOrder,
    buildOrderFromLines,
    ensureClientRequestId,
    isValidClientRequestId,
    normalizeWhatsAppNumber,
    priceNumber,
    formatMoney,
    hashString,
  };
})();
