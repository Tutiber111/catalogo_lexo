(function () {
  const adminState = {
    settings: CATALOG_STORE.loadSettings(),
    orders: [],
    loadedOrders: [],
    source: "local",
    orderView: "all",
    orderClientSearch: "",
    selectedOrderClientKey: "",
    selectedOrderClientLabel: "",
    isAdmin: false,
    lastStockChange: null,
    pendingPriceApprovals: [],
    isLoadingPriceApprovals: false,
    passwordCustomers: [],
    selectedPasswordCustomer: null,
    isSearchingPasswordCustomer: false,
    isResettingCustomerPassword: false,
    catalogHealthIssues: [],
    isCheckingCatalogHealth: false,
    isLoadingOrderHealth: false,
    orderHealthConfigurationWarning: "",
    priceImportPreview: null,
  };

  const adminEls = {
    openAdmin: document.querySelector("#openAdmin"),
    adminDrawer: document.querySelector("#adminDrawer"),
    adminApp: document.querySelector("#adminApp"),
    closeAdmin: document.querySelector("#closeAdmin"),
    settingBrandName: document.querySelector("#settingBrandName"),
    settingCatalogLabel: document.querySelector("#settingCatalogLabel"),
    settingWhatsapp: document.querySelector("#settingWhatsapp"),
    saveSettings: document.querySelector("#saveSettings"),
    adminDataStatus: document.querySelector("#adminDataStatus"),
    allOrdersTab: document.querySelector("#allOrdersTab"),
    activeOrdersTab: document.querySelector("#activeOrdersTab"),
    archivedOrdersTab: document.querySelector("#archivedOrdersTab"),
    orderClientSearch: document.querySelector("#orderClientSearch"),
    clearOrderClientSearch: document.querySelector("#clearOrderClientSearch"),
    orderClientSuggestions: document.querySelector("#orderClientSuggestions"),
    orderClientSearchStatus: document.querySelector("#orderClientSearchStatus"),
    orderSummary: document.querySelector("#orderSummary"),
    ordersList: document.querySelector("#ordersList"),
    exportOrders: document.querySelector("#exportOrders"),
    clearOrders: document.querySelector("#clearOrders"),
    priceListFile: document.querySelector("#priceListFile"),
    downloadPriceTemplate: document.querySelector("#downloadPriceTemplate"),
    importPriceList: document.querySelector("#importPriceList"),
    applyPriceListImport: document.querySelector("#applyPriceListImport"),
    clearProductOverrides: document.querySelector("#clearProductOverrides"),
    priceListImportStatus: document.querySelector("#priceListImportStatus"),
    priceListImportPreview: document.querySelector("#priceListImportPreview"),
    stockUpdateForm: document.querySelector("#stockUpdateForm"),
    stockSkuInput: document.querySelector("#stockSkuInput"),
    markOutOfStock: document.querySelector("#markOutOfStock"),
    undoStockChange: document.querySelector("#undoStockChange"),
    stockUpdateStatus: document.querySelector("#stockUpdateStatus"),
    refreshPriceApprovals: document.querySelector("#refreshPriceApprovals"),
    priceApprovalsStatus: document.querySelector("#priceApprovalsStatus"),
    priceApprovalsList: document.querySelector("#priceApprovalsList"),
    customerPasswordSearchForm: document.querySelector("#customerPasswordSearchForm"),
    customerPasswordSearch: document.querySelector("#customerPasswordSearch"),
    searchCustomerPassword: document.querySelector("#searchCustomerPassword"),
    customerPasswordResults: document.querySelector("#customerPasswordResults"),
    selectedPasswordCustomer: document.querySelector("#selectedPasswordCustomer"),
    customerPasswordForm: document.querySelector("#customerPasswordForm"),
    customerTemporaryPassword: document.querySelector("#customerTemporaryPassword"),
    confirmCustomerTemporaryPassword: document.querySelector("#confirmCustomerTemporaryPassword"),
    showCustomerTemporaryPassword: document.querySelector("#showCustomerTemporaryPassword"),
    setCustomerTemporaryPassword: document.querySelector("#setCustomerTemporaryPassword"),
    customerPasswordStatus: document.querySelector("#customerPasswordStatus"),
    runCatalogHealth: document.querySelector("#runCatalogHealth"),
    exportCatalogHealth: document.querySelector("#exportCatalogHealth"),
    catalogHealthStatus: document.querySelector("#catalogHealthStatus"),
    catalogHealthSummary: document.querySelector("#catalogHealthSummary"),
    catalogHealthList: document.querySelector("#catalogHealthList"),
    refreshOrderHealth: document.querySelector("#refreshOrderHealth"),
    orderHealthStatus: document.querySelector("#orderHealthStatus"),
    orderHealthSummary: document.querySelector("#orderHealthSummary"),
    orderHealthList: document.querySelector("#orderHealthList"),
    adminOrderDialog: document.querySelector("#adminOrderDialog"),
    adminOrderDialogContent: document.querySelector("#adminOrderDialogContent"),
    toast: document.querySelector("#toast"),
  };

  function initAdmin() {
    bindAdminEvents();
    refreshAdminAccess();
  }

  function bindAdminEvents() {
    adminEls.openAdmin.addEventListener("click", openAdmin);
    adminEls.closeAdmin.addEventListener("click", closeAdmin);
    adminEls.saveSettings.addEventListener("click", saveSettings);
    adminEls.allOrdersTab.addEventListener("click", () => setOrderView("all"));
    adminEls.activeOrdersTab.addEventListener("click", () => setOrderView("active"));
    adminEls.archivedOrdersTab.addEventListener("click", () => setOrderView("archived"));
    adminEls.orderClientSearch.addEventListener("input", handleOrderClientSearch);
    adminEls.orderClientSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape") adminEls.orderClientSuggestions.hidden = true;
    });
    adminEls.clearOrderClientSearch.addEventListener("click", clearOrderClientSearch);
    adminEls.orderClientSuggestions.addEventListener("click", selectOrderClientSuggestion);
    adminEls.exportOrders.addEventListener("click", exportOrdersCsv);
    adminEls.clearOrders.addEventListener("click", clearLocalOrders);
    adminEls.downloadPriceTemplate.addEventListener("click", downloadPriceTemplate);
    adminEls.importPriceList.addEventListener("click", previewPriceListImport);
    adminEls.applyPriceListImport.addEventListener("click", applyPriceListImport);
    adminEls.priceListFile.addEventListener("change", clearPriceListImportPreview);
    adminEls.clearProductOverrides.addEventListener("click", clearLocalProductOverrides);
    adminEls.stockUpdateForm.addEventListener("submit", markSkuOutOfStock);
    adminEls.undoStockChange.addEventListener("click", undoLastStockChange);
    adminEls.refreshPriceApprovals.addEventListener("click", renderPendingPriceApprovals);
    adminEls.priceApprovalsList.addEventListener("click", handlePriceApprovalClick);
    adminEls.customerPasswordSearchForm.addEventListener("submit", searchCustomerForPassword);
    adminEls.customerPasswordResults.addEventListener("click", handlePasswordCustomerSelection);
    adminEls.customerPasswordForm.addEventListener("submit", resetSelectedCustomerPassword);
    adminEls.showCustomerTemporaryPassword.addEventListener("change", toggleCustomerPasswordVisibility);
    adminEls.runCatalogHealth.addEventListener("click", runCatalogHealthCheck);
    adminEls.exportCatalogHealth.addEventListener("click", exportCatalogHealthReport);
    adminEls.refreshOrderHealth.addEventListener("click", () => renderOrderHealth({ sync: true }));
    adminEls.orderHealthList.addEventListener("click", handleOrderHealthAction);
    adminEls.adminOrderDialog.addEventListener("close", () => {
      adminEls.adminOrderDialogContent.innerHTML = "";
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".order-client-search")) adminEls.orderClientSuggestions.hidden = true;
    });
    window.addEventListener("catalog:orders-changed", () => {
      renderOrders();
      renderOrderHealth();
    });
    window.addEventListener("catalog:products-updated", runCatalogHealthCheck);
    window.addEventListener("catalog:auth-changed", (event) => refreshAdminAccess(event.detail));
  }

  async function refreshAdminAccess(detail = {}) {
    adminState.isAdmin = detail.profile?.role === "admin";

    if (!detail.profile && CATALOG_SUPABASE.isAvailable()) {
      try {
        const user = await CATALOG_SUPABASE.getUser();
        const profile = user ? await CATALOG_SUPABASE.getProfile(user.id) : null;
        adminState.isAdmin = profile?.role === "admin";
      } catch (error) {
        adminState.isAdmin = false;
      }
    }

    adminEls.openAdmin.hidden = !adminState.isAdmin;
    if (!adminState.isAdmin) closeAdmin();
    else if (location.hash === "#admin") openAdmin();
  }

  function openAdmin() {
    if (!adminState.isAdmin) {
      showToast("Iniciá sesión con una cuenta administradora");
      return;
    }
    adminEls.adminDrawer.classList.add("is-open");
    adminEls.adminDrawer.setAttribute("aria-hidden", "false");
    showAdmin();
  }

  function closeAdmin() {
    adminEls.adminDrawer.classList.remove("is-open");
    adminEls.adminDrawer.setAttribute("aria-hidden", "true");
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  function showAdmin() {
    adminEls.adminApp.hidden = false;
    fillSettings();
    renderOrders();
    renderPendingPriceApprovals();
    runCatalogHealthCheck();
    renderOrderHealth();
  }

  async function runCatalogHealthCheck() {
    if (!adminState.isAdmin || adminState.isCheckingCatalogHealth) return;
    adminState.isCheckingCatalogHealth = true;
    adminEls.runCatalogHealth.disabled = true;
    adminEls.runCatalogHealth.textContent = "Revisando...";
    adminEls.catalogHealthStatus.textContent = "Revisando páginas, productos, códigos y posiciones...";

    try {
      const overrides = await loadCurrentProductOverrides();
      const catalog = CATALOG_STORE.applyProductOverrides(cloneCatalog(window.CATALOG_DATA || { pages: [], products: [] }), overrides);
      adminState.catalogHealthIssues = analyzeCatalogHealth(catalog);
      renderCatalogHealth();
    } catch (error) {
      adminState.catalogHealthIssues = [];
      adminEls.catalogHealthSummary.innerHTML = "";
      adminEls.catalogHealthList.innerHTML = "";
      adminEls.catalogHealthStatus.textContent = error.message || "No se pudo revisar el catálogo.";
    } finally {
      adminState.isCheckingCatalogHealth = false;
      adminEls.runCatalogHealth.disabled = false;
      adminEls.runCatalogHealth.textContent = "Revisar catálogo";
    }
  }

  function analyzeCatalogHealth(catalog) {
    const pages = Array.isArray(catalog.pages) ? catalog.pages : [];
    const products = Array.isArray(catalog.products) ? catalog.products : [];
    const issues = [];
    const productById = new Map();
    const pageByNumber = new Map();
    const skuGroups = new Map();
    const priceGroupIds = new Set();
    const add = (severity, code, message, detail = {}) => issues.push({ severity, code, message, ...detail });

    pages.forEach((page) => {
      const pageNumber = Number(page.number);
      if (!Number.isFinite(pageNumber)) add("error", "PAGE_NUMBER", "Hay una página sin número válido.");
      else if (pageByNumber.has(pageNumber)) add("error", "DUPLICATE_PAGE", `La página ${pageNumber} aparece más de una vez.`, { page: pageNumber });
      else pageByNumber.set(pageNumber, page);
    });

    products.forEach((product) => {
      const id = String(product.id || "").trim();
      const sku = normalizeSku(product.sku);
      if (!id) add("error", "MISSING_PRODUCT_ID", "Hay un producto sin ID de catálogo.", { sku, page: product.page });
      else if (productById.has(id)) add("error", "DUPLICATE_PRODUCT_ID", `El ID ${id} está repetido.`, { productId: id, sku, page: product.page });
      else productById.set(id, product);

      if (!sku) add("error", "MISSING_SKU", `El producto ${id || "sin ID"} no tiene SKU.`, { productId: id, page: product.page });
      else {
        if (!skuGroups.has(sku)) skuGroups.set(sku, []);
        skuGroups.get(sku).push(product);
      }
      if (!String(product.name || "").trim()) add("error", "MISSING_NAME", `El producto ${sku || id} no tiene nombre.`, { productId: id, sku, page: product.page });
      if (!String(product.price || "").trim()) add("error", "MISSING_PRICE", `El producto ${sku || id} no tiene precio.`, { productId: id, sku, page: product.page });
      if (sku && /^\d+$/.test(sku) && !String(product.ean || "").trim()) add("warning", "MISSING_EAN", `El producto ${sku} no tiene EAN.`, { productId: id, sku, page: product.page });
      if (!pageByNumber.has(Number(product.page))) {
        add("error", "UNKNOWN_PRODUCT_PAGE", `El producto ${sku || id} apunta a una página inexistente (${product.page || "sin página"}).`, { productId: id, sku, page: product.page });
      }
      if (!validRect(product.hotspot)) add("error", "INVALID_HOTSPOT", `El área clickeable de ${sku || id} falta o sale de la página.`, { productId: id, sku, page: product.page });
    });

    skuGroups.forEach((group, sku) => {
      if (group.length < 2) return;
      const identities = new Set(group.map((product) => `${normalizedText(product.section)}|${normalizedText(product.name)}`));
      const pages = group.map((product) => Number(product.page));
      const pageSet = new Set(pages);
      const pagesLabel = [...pageSet].join(", ");
      if (identities.size > 1) {
        add("error", "SKU_COLLISION", `El SKU ${sku} corresponde a productos distintos.`, { sku, page: pagesLabel, productId: group.map((product) => product.id).join(" | ") });
        return;
      }
      if (pageSet.size < group.length) {
        const repeatedPage = pages.find((page, index) => pages.indexOf(page) !== index);
        add("error", "DUPLICATE_SKU_ON_PAGE", `El SKU ${sku} fue detectado más de una vez en la página ${repeatedPage}.`, { sku, page: repeatedPage, productId: group.map((product) => product.id).join(" | ") });
        return;
      }
      const isPopSummary = group.every((product) => normalizedText(product.section) === "oxo" && normalizedText(product.name).includes("contenedor pop")) && pageSet.has(253);
      add(
        "info",
        isPopSummary ? "INTENTIONAL_POP_REPEAT" : "REPEATED_SOURCE_LISTING",
        isPopSummary
          ? `El SKU ${sku} se repite intencionalmente en la página resumen de POP.`
          : `El SKU ${sku} está publicado en más de una página del catálogo fuente.`,
        { sku, page: pagesLabel, productId: group.map((product) => product.id).join(" | ") },
      );
    });

    pages.forEach((page) => {
      const pageProductIds = Array.isArray(page.products) ? page.products : [];
      const pageProducts = [];
      pageProductIds.forEach((id) => {
        const product = productById.get(id);
        if (!product) {
          add("error", "UNKNOWN_PAGE_PRODUCT", `La página ${page.number} referencia el producto inexistente ${id}.`, { page: page.number, productId: id });
          return;
        }
        pageProducts.push(product);
        if (Number(product.page) !== Number(page.number)) {
          add("error", "PAGE_MISMATCH", `${product.sku} figura en la página ${page.number}, pero el producto apunta a la ${product.page}.`, { page: page.number, sku: product.sku, productId: id });
        }
      });

      products.filter((product) => Number(product.page) === Number(page.number)).forEach((product) => {
        if (!pageProductIds.includes(product.id)) {
          add("error", "PRODUCT_NOT_ON_PAGE", `${product.sku || product.id} apunta a la página ${page.number}, pero no está en su lista de productos.`, { page: page.number, sku: product.sku, productId: product.id });
        }
      });

      for (let first = 0; first < pageProducts.length; first += 1) {
        for (let second = first + 1; second < pageProducts.length; second += 1) {
          const a = pageProducts[first];
          const b = pageProducts[second];
          if (normalizeSku(a.sku) === normalizeSku(b.sku)) continue;
          if (rectOverlapRatio(a.hotspot, b.hotspot) >= 0.75) {
            add("warning", "OVERLAPPING_HOTSPOTS", `Las áreas de ${a.sku} y ${b.sku} se superponen en la página ${page.number}.`, { page: page.number, sku: `${a.sku} | ${b.sku}`, productId: `${a.id} | ${b.id}` });
          }
        }
      }

      (page.priceGroups || []).forEach((group, index) => {
        const groupId = String(group.id || `${page.number}-${index}`);
        if (priceGroupIds.has(groupId)) add("error", "DUPLICATE_PRICE_GROUP", `El grupo de precio ${groupId} está repetido.`, { page: page.number });
        priceGroupIds.add(groupId);
        if (!validPoint(group.position) || (group.cover && !validSize(group.cover))) {
          add("error", "INVALID_PRICE_POSITION", `El precio ${groupId} tiene una posición o cobertura inválida.`, { page: page.number });
        }
        const groupedProducts = (group.productIds || []).map((id) => productById.get(id)).filter(Boolean);
        (group.productIds || []).filter((id) => !productById.has(id)).forEach((id) => {
          add("error", "UNKNOWN_PRICE_PRODUCT", `El precio ${groupId} referencia el producto inexistente ${id}.`, { page: page.number, productId: id });
        });
        const prices = new Set(groupedProducts.filter((product) => !product.outOfStock).map((product) => normalizedPrice(product.price)).filter(Boolean));
        if (prices.size > 1) {
          add("error", "MIXED_GROUP_PRICES", `El grupo ${groupId} reúne productos con precios diferentes.`, { page: page.number, sku: groupedProducts.map((product) => product.sku).join(" | ") });
        }
      });
    });

    return issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Number(a.page || 0) - Number(b.page || 0));
  }

  function renderCatalogHealth() {
    const issues = adminState.catalogHealthIssues;
    const errors = issues.filter((issue) => issue.severity === "error").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    const information = issues.filter((issue) => issue.severity === "info").length;
    adminEls.catalogHealthStatus.textContent = errors
      ? `Se encontraron ${issues.length} observaciones. Corregí primero los errores.`
      : warnings
        ? `Se encontraron ${warnings} advertencias para revisar, sin errores estructurales.`
      : "No se encontraron problemas estructurales en el catálogo.";
    adminEls.catalogHealthSummary.innerHTML = `
      <span><strong>${errors}</strong> errores</span>
      <span><strong>${warnings}</strong> advertencias</span>
      <span><strong>${information}</strong> repeticiones informativas</span>
    `;
    adminEls.catalogHealthList.innerHTML = issues.slice(0, 150).map((issue) => `
      <article class="health-issue is-${issue.severity}">
        <span class="health-severity">${issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Revisar" : "Informativo"}</span>
        <div class="health-issue-detail">
          <strong>${escapeHtml(issue.message)}</strong>
          <p>${escapeHtml([issue.sku ? `SKU ${issue.sku}` : "", issue.page ? `Página ${issue.page}` : "", issue.productId ? `ID ${issue.productId}` : "", issue.code].filter(Boolean).join(" · "))}</p>
        </div>
      </article>
    `).join("") || '<p class="empty-state">Todo en orden.</p>';
    if (issues.length > 150) adminEls.catalogHealthList.insertAdjacentHTML("beforeend", `<p class="empty-state">Hay ${issues.length - 150} observaciones adicionales en el informe descargable.</p>`);
    adminEls.exportCatalogHealth.disabled = !issues.length;
  }

  function exportCatalogHealthReport() {
    if (!adminState.catalogHealthIssues.length) return;
    const rows = [["Severidad", "Tipo", "Mensaje", "SKU", "Página", "ID de catálogo"]];
    adminState.catalogHealthIssues.forEach((issue) => rows.push([
      issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Advertencia" : "Informativo",
      issue.code,
      issue.message,
      issue.sku || "",
      issue.page || "",
      issue.productId || "",
    ]));
    downloadCsv(`estado-catalogo-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\r\n"));
  }

  async function renderOrderHealth(options = {}) {
    if (!adminState.isAdmin || adminState.isLoadingOrderHealth || !CATALOG_SUPABASE.isAvailable()) return;
    adminState.isLoadingOrderHealth = true;
    adminEls.refreshOrderHealth.disabled = true;
    adminEls.refreshOrderHealth.textContent = options.sync ? "Consultando..." : "Cargando...";
    adminEls.orderHealthStatus.textContent = options.sync ? "Consultando los últimos eventos en Resend..." : "Cargando notificaciones...";
    try {
      if (options.sync) {
        const syncResult = await CATALOG_SUPABASE.syncOrderDeliveryStatuses();
        adminState.orderHealthConfigurationWarning = syncResult.configuration_error || "";
      }
      const orders = await CATALOG_SUPABASE.loadAllOrders();
      renderOrderHealthRows(orders);
    } catch (error) {
      adminEls.orderHealthSummary.innerHTML = "";
      adminEls.orderHealthList.innerHTML = "";
      adminEls.orderHealthStatus.textContent = error.message || "No se pudo consultar el estado de los emails.";
    } finally {
      adminState.isLoadingOrderHealth = false;
      adminEls.refreshOrderHealth.disabled = false;
      adminEls.refreshOrderHealth.textContent = "Actualizar estado";
    }
  }

  function renderOrderHealthRows(orders) {
    const entries = orders.map((order) => ({ order, health: orderEmailHealth(order) }));
    const attention = entries.filter((entry) => entry.health.level === "attention");
    const delayed = entries.filter((entry) => entry.health.level === "delayed");
    const healthy = entries.filter((entry) => entry.health.level === "healthy");
    const awaiting = entries.filter((entry) => entry.health.level === "awaiting");
    const storedConfigurationWarning = entries.find((entry) => entry.order.notification?.deliveryError?.includes("API key de Resend"))?.order.notification.deliveryError || "";
    const configurationWarning = adminState.orderHealthConfigurationWarning || storedConfigurationWarning;
    adminEls.orderHealthStatus.textContent = configurationWarning
      ? "Los envíos siguen funcionando, pero la API key actual de Resend no permite confirmar la entrega."
      : attention.length || delayed.length
      ? `${attention.length + delayed.length} pedido${attention.length + delayed.length === 1 ? " requiere" : "s requieren"} revisión.`
      : "No hay fallas de email detectadas.";
    adminEls.orderHealthSummary.innerHTML = `
      <span><strong>${healthy.length}</strong> entregados</span>
      <span><strong>${awaiting.length}</strong> en curso</span>
      <span><strong>${delayed.length}</strong> demorados</span>
      <span><strong>${attention.length}</strong> con error</span>
    `;
    const visible = [...attention, ...delayed, ...awaiting, ...healthy].slice(0, 40);
    adminEls.orderHealthList.innerHTML = visible.map(({ order, health }) => `
      <article class="order-health-row is-${health.level}">
        <div class="order-health-main">
          <div class="order-health-heading">
            <strong>${escapeHtml(order.displayId || order.id)} · ${escapeHtml(orderBuyerLabel(order))}</strong>
            <span class="delivery-event-badge">${escapeHtml(health.label)}</span>
          </div>
          <p>${escapeHtml(formatDate(order.createdAt))}${order.notification?.resendTo ? ` · ${escapeHtml(order.notification.resendTo)}` : ""}</p>
          ${health.detail ? `<p>${escapeHtml(health.detail)}</p>` : ""}
        </div>
        ${order.remote && ["attention", "delayed"].includes(health.level) ? `<button class="secondary-button compact-button" type="button" data-health-resend="${escapeHtml(order.id)}">Reintentar</button>` : ""}
      </article>
    `).join("") || '<p class="empty-state">Todavía no hay pedidos.</p>';
  }

  function orderEmailHealth(order) {
    const notification = order.notification;
    if (!notification) return { level: "attention", label: "Sin registro", detail: "No existe una notificación asociada al pedido." };
    const event = String(notification.resendLastEvent || "").toLowerCase();
    if (["delivered", "opened", "clicked"].includes(event)) return { level: "healthy", label: deliveryEventLabel(event), detail: deliveryCheckDetail(notification) };
    if (event === "delivery_delayed") return { level: "delayed", label: "Demorado", detail: notification.deliveryError || notification.lastError || deliveryCheckDetail(notification) };
    if (["bounced", "failed", "suppressed", "canceled", "complained"].includes(event)) return { level: "attention", label: deliveryEventLabel(event), detail: notification.deliveryError || notification.lastError };
    if (notification.status === "failed") return { level: "attention", label: "Falló el envío", detail: notification.lastError };
    const updatedAt = Date.parse(notification.updatedAt || order.createdAt || "");
    const stuck = ["pending", "processing"].includes(notification.status) && Number.isFinite(updatedAt) && Date.now() - updatedAt > 15 * 60 * 1000;
    if (stuck) return { level: "delayed", label: "Sin completar", detail: notification.lastError || "La notificación lleva más de 15 minutos sin completarse." };
    return { level: "awaiting", label: event ? deliveryEventLabel(event) : notificationStatusLabel(notification.status), detail: notification.deliveryError || notification.lastError || deliveryCheckDetail(notification) };
  }

  async function handleOrderHealthAction(event) {
    const button = event.target.closest("[data-health-resend]");
    if (!button) return;
    try {
      button.disabled = true;
      button.textContent = "Reintentando...";
      await CATALOG_SUPABASE.resendOrderNotification(button.dataset.healthResend);
      await Promise.all([renderOrders(), renderOrderHealth({ sync: true })]);
      showToast("Email reenviado");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Reintentar";
      showToast(error.message || "No se pudo reenviar el email");
    }
  }

  function deliveryCheckDetail(notification) {
    return notification.deliveryCheckedAt ? `Última consulta: ${formatDate(notification.deliveryCheckedAt)}` : "";
  }

  function deliveryEventLabel(event) {
    return {
      delivered: "Entregado",
      opened: "Abierto",
      clicked: "Abierto",
      delivery_delayed: "Demorado",
      bounced: "Rebotado",
      failed: "Falló",
      suppressed: "Suprimido",
      canceled: "Cancelado",
      complained: "Marcado como spam",
      queued: "En cola",
      scheduled: "Programado",
      sent: "Enviado",
    }[event] || event || "En curso";
  }

  function validPoint(value) {
    return value && finiteUnit(value.x) && finiteUnit(value.y);
  }

  function validSize(value) {
    return value && Number(value.w) > 0 && Number(value.h) > 0 && Number(value.w) <= 1 && Number(value.h) <= 1;
  }

  function validRect(value) {
    return validPoint(value) && validSize(value) && Number(value.x) + Number(value.w) <= 1.001 && Number(value.y) + Number(value.h) <= 1.001;
  }

  function finiteUnit(value) {
    return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
  }

  function rectOverlapRatio(a, b) {
    if (!validRect(a) || !validRect(b)) return 0;
    const overlapWidth = Math.max(0, Math.min(Number(a.x) + Number(a.w), Number(b.x) + Number(b.w)) - Math.max(Number(a.x), Number(b.x)));
    const overlapHeight = Math.max(0, Math.min(Number(a.y) + Number(a.h), Number(b.y) + Number(b.h)) - Math.max(Number(a.y), Number(b.y)));
    const intersection = overlapWidth * overlapHeight;
    return intersection / Math.min(Number(a.w) * Number(a.h), Number(b.w) * Number(b.h));
  }

  function normalizedText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function normalizedPrice(value) {
    return String(value || "").replace(/[^0-9]/g, "");
  }

  function severityRank(value) {
    return value === "error" ? 0 : value === "warning" ? 1 : 2;
  }

  async function renderPendingPriceApprovals() {
    if (!adminState.isAdmin || adminState.isLoadingPriceApprovals) return;
    adminState.isLoadingPriceApprovals = true;
    adminEls.refreshPriceApprovals.disabled = true;
    adminEls.priceApprovalsStatus.textContent = "Cargando cuentas pendientes...";

    try {
      adminState.pendingPriceApprovals = await CATALOG_SUPABASE.loadPendingPriceApprovals();
      renderPendingPriceApprovalsList();
    } catch (error) {
      adminState.pendingPriceApprovals = [];
      adminEls.priceApprovalsList.innerHTML = "";
      adminEls.priceApprovalsStatus.textContent = friendlyPriceApprovalError(error);
    } finally {
      adminState.isLoadingPriceApprovals = false;
      adminEls.refreshPriceApprovals.disabled = false;
    }
  }

  function renderPendingPriceApprovalsList() {
    const profiles = adminState.pendingPriceApprovals;
    adminEls.priceApprovalsStatus.textContent = profiles.length
      ? `${profiles.length} cuenta${profiles.length === 1 ? "" : "s"} esperando acceso a precios.`
      : "No hay cuentas pendientes de aprobación.";
    adminEls.priceApprovalsList.innerHTML = profiles.map((profile) => `
      <article class="price-approval-row" data-price-approval="${escapeHtml(profile.id)}">
        <div class="price-approval-identity">
          <strong>${escapeHtml(profile.company || profile.name || "Cliente sin nombre")}</strong>
          <span>${escapeHtml(profile.email || "")}</span>
        </div>
        <div class="price-approval-meta">
          ${profile.name && profile.company ? `<span>${escapeHtml(profile.name)}</span>` : ""}
          ${profile.phone ? `<span>${escapeHtml(profile.phone)}</span>` : ""}
          ${profile.assigned_salesman_code ? `<span>Vendedor: ${escapeHtml(profile.assigned_salesman_code)}</span>` : ""}
          <span>Registro: ${escapeHtml(formatApprovalDate(profile.created_at))}</span>
        </div>
        <button class="primary-button" type="button" data-approve-price-access="${escapeHtml(profile.id)}">Aprobar precios</button>
      </article>
    `).join("");
  }

  async function handlePriceApprovalClick(event) {
    const button = event.target.closest("[data-approve-price-access]");
    if (!button || !adminState.isAdmin) return;
    const profileId = button.dataset.approvePriceAccess;
    button.disabled = true;
    button.textContent = "Aprobando...";

    try {
      await CATALOG_SUPABASE.approveProfilePriceAccess(profileId);
      adminState.pendingPriceApprovals = adminState.pendingPriceApprovals.filter((profile) => profile.id !== profileId);
      renderPendingPriceApprovalsList();
      showToast("Cuenta aprobada. Ya puede ver precios y realizar pedidos.");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Aprobar precios";
      showToast(friendlyPriceApprovalError(error));
    }
  }

  function formatApprovalDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Sin fecha" : date.toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function friendlyPriceApprovalError(error) {
    const message = String(error?.message || "No se pudieron cargar las cuentas pendientes.");
    if (message.includes("price_access_approved")) {
      return "Falta aplicar la actualización de acceso a precios en Supabase.";
    }
    return message;
  }

  async function searchCustomerForPassword(event) {
    event.preventDefault();
    if (!adminState.isAdmin || adminState.isSearchingPasswordCustomer) return;
    const query = adminEls.customerPasswordSearch.value.trim();
    if (query.length < 2) {
      setCustomerPasswordStatus("Ingresá al menos dos caracteres para buscar.");
      adminEls.customerPasswordSearch.focus();
      return;
    }

    adminState.isSearchingPasswordCustomer = true;
    adminEls.searchCustomerPassword.disabled = true;
    adminEls.searchCustomerPassword.textContent = "Buscando...";
    setCustomerPasswordStatus("Buscando cuentas...");
    try {
      adminState.passwordCustomers = await CATALOG_SUPABASE.searchCustomerAccounts(query);
      renderPasswordCustomerResults();
    } catch (error) {
      adminState.passwordCustomers = [];
      adminEls.customerPasswordResults.hidden = true;
      setCustomerPasswordStatus(friendlyCustomerPasswordError(error));
    } finally {
      adminState.isSearchingPasswordCustomer = false;
      adminEls.searchCustomerPassword.disabled = false;
      adminEls.searchCustomerPassword.textContent = "Buscar";
    }
  }

  function renderPasswordCustomerResults() {
    const customers = adminState.passwordCustomers;
    adminEls.customerPasswordResults.hidden = false;
    if (!customers.length) {
      adminEls.customerPasswordResults.innerHTML = `<p>No se encontraron cuentas.</p>`;
      setCustomerPasswordStatus("Revisá el email, nombre, empresa o código ingresado.");
      return;
    }

    adminEls.customerPasswordResults.innerHTML = customers.map((customer) => `
      <button class="customer-password-result" type="button" data-password-customer="${escapeHtml(customer.id)}">
        <strong>${escapeHtml(customer.role === "salesman"
          ? (customer.name || customer.company || customer.email || "Vendedor sin nombre")
          : (customer.company || customer.name || customer.email || "Cliente sin nombre"))}</strong>
        <span>${escapeHtml(customer.email || "Sin email")}</span>
        <small>${customer.role === "salesman" ? "Vendedor" : "Cliente"}${customer.clientCode ? ` · Código ${escapeHtml(customer.clientCode)}` : ""}</small>
      </button>
    `).join("");
    setCustomerPasswordStatus(`${customers.length} cuenta${customers.length === 1 ? " encontrada" : "s encontradas"}. Elegí la correcta.`);
  }

  function handlePasswordCustomerSelection(event) {
    const button = event.target.closest("[data-password-customer]");
    if (!button || !adminState.isAdmin) return;
    const customer = adminState.passwordCustomers.find((item) => item.id === button.dataset.passwordCustomer);
    if (!customer) return;
    adminState.selectedPasswordCustomer = customer;
    adminEls.customerPasswordResults.hidden = true;
    adminEls.selectedPasswordCustomer.hidden = false;
    adminEls.selectedPasswordCustomer.innerHTML = `
      <span>Cuenta seleccionada</span>
      <strong>${escapeHtml(customer.role === "salesman"
        ? (customer.name || customer.company || "Vendedor")
        : (customer.company || customer.name || "Cliente"))}</strong>
      <small>${customer.role === "salesman" ? "Vendedor" : "Cliente"} · ${escapeHtml(customer.email || "Sin email")}${customer.clientCode ? ` · Código ${escapeHtml(customer.clientCode)}` : ""}</small>
      <button class="secondary-button compact-button" type="button" data-change-password-customer>Elegir otra</button>
    `;
    adminEls.selectedPasswordCustomer.querySelector("[data-change-password-customer]").addEventListener("click", clearSelectedPasswordCustomer);
    adminEls.customerPasswordForm.hidden = false;
    adminEls.customerTemporaryPassword.value = "";
    adminEls.confirmCustomerTemporaryPassword.value = "";
    adminEls.showCustomerTemporaryPassword.checked = false;
    toggleCustomerPasswordVisibility();
    setCustomerPasswordStatus("Ingresá y confirmá la nueva contraseña temporal.");
    adminEls.customerTemporaryPassword.focus();
  }

  function clearSelectedPasswordCustomer() {
    adminState.selectedPasswordCustomer = null;
    adminEls.selectedPasswordCustomer.hidden = true;
    adminEls.selectedPasswordCustomer.innerHTML = "";
    adminEls.customerPasswordForm.hidden = true;
    adminEls.customerTemporaryPassword.value = "";
    adminEls.confirmCustomerTemporaryPassword.value = "";
    adminEls.customerPasswordSearch.focus();
  }

  function toggleCustomerPasswordVisibility() {
    const type = adminEls.showCustomerTemporaryPassword.checked ? "text" : "password";
    adminEls.customerTemporaryPassword.type = type;
    adminEls.confirmCustomerTemporaryPassword.type = type;
  }

  async function resetSelectedCustomerPassword(event) {
    event.preventDefault();
    if (!adminState.isAdmin || adminState.isResettingCustomerPassword) return;
    const customer = adminState.selectedPasswordCustomer;
    const password = adminEls.customerTemporaryPassword.value;
    const confirmation = adminEls.confirmCustomerTemporaryPassword.value;
    if (!customer) {
      setCustomerPasswordStatus("Elegí una cuenta primero.");
      return;
    }
    if (password.length < 8) {
      setCustomerPasswordStatus("La contraseña temporal debe tener al menos 8 caracteres.");
      adminEls.customerTemporaryPassword.focus();
      return;
    }
    if (password !== confirmation) {
      setCustomerPasswordStatus("Las dos contraseñas no coinciden.");
      adminEls.confirmCustomerTemporaryPassword.focus();
      return;
    }

    const label = customer.company || customer.name || customer.email || "esta cuenta";
    if (!confirm(`¿Reemplazar la contraseña de ${label}? La contraseña anterior dejará de funcionar.`)) return;

    adminState.isResettingCustomerPassword = true;
    adminEls.setCustomerTemporaryPassword.disabled = true;
    adminEls.setCustomerTemporaryPassword.textContent = "Cambiando...";
    setCustomerPasswordStatus("Actualizando la contraseña...");
    try {
      await CATALOG_SUPABASE.setCustomerTemporaryPassword(customer.id, password);
      adminEls.customerTemporaryPassword.value = "";
      adminEls.confirmCustomerTemporaryPassword.value = "";
      setCustomerPasswordStatus(`Contraseña actualizada correctamente para ${customer.email || label}.`);
      showToast("Contraseña actualizada");
    } catch (error) {
      setCustomerPasswordStatus(friendlyCustomerPasswordError(error));
    } finally {
      adminState.isResettingCustomerPassword = false;
      adminEls.setCustomerTemporaryPassword.disabled = false;
      adminEls.setCustomerTemporaryPassword.textContent = "Cambiar contraseña";
    }
  }

  function setCustomerPasswordStatus(message) {
    adminEls.customerPasswordStatus.textContent = message;
  }

  function friendlyCustomerPasswordError(error) {
    const message = String(error?.message || "No se pudo cambiar la contraseña de la cuenta.");
    if (message.includes("Only administrators")) return "Solo una cuenta administradora puede cambiar contraseñas.";
    if (message.includes("at least eight")) return "La contraseña temporal debe tener al menos 8 caracteres.";
    if (message.includes("Account not found") || message.includes("Customer account not found")) return "No se encontró esa cuenta.";
    if (message.includes("Invalid session") || message.includes("Sign in first")) return "La sesión administradora venció. Volvé a iniciar sesión.";
    return message;
  }

  function fillSettings() {
    adminState.settings = CATALOG_STORE.loadSettings();
    adminEls.settingBrandName.value = adminState.settings.brandName;
    adminEls.settingCatalogLabel.value = adminState.settings.catalogLabel;
    adminEls.settingWhatsapp.value = adminState.settings.whatsappNumber;
  }

  async function saveSettings() {
    const nextSettings = {
      brandName: adminEls.settingBrandName.value.trim() || "LEXO",
      catalogLabel: adminEls.settingCatalogLabel.value.trim() || "Catálogo interactivo",
      whatsappNumber: adminEls.settingWhatsapp.value.trim(),
    };

    adminState.settings = CATALOG_STORE.saveSettings(nextSettings);
    document.querySelector("#brandName").textContent = adminState.settings.brandName;
    document.querySelector("#catalogLabel").textContent = adminState.settings.catalogLabel;
    showToast("Configuración guardada");
  }

  async function previewPriceListImport() {
    const file = adminEls.priceListFile.files?.[0];
    if (!file) {
      setImportStatus("Elegí un archivo Excel primero.");
      return;
    }
    if (!window.XLSX) {
      setImportStatus("El lector de Excel todavía está cargando. Probá de nuevo en un momento.");
      return;
    }

    try {
      adminEls.importPriceList.disabled = true;
      adminEls.applyPriceListImport.disabled = true;
      setImportStatus("Analizando archivo Excel...");

      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const importedRows = readPriceListRows(workbook);
      const currentOverrides = await loadCurrentProductOverrides();
      const currentCatalog = CATALOG_STORE.applyProductOverrides(cloneCatalog(window.CATALOG_DATA || { products: [] }), currentOverrides);
      const result = buildProductOverrides(importedRows, currentCatalog.products || []);
      adminState.priceImportPreview = { ...result, fileName: file.name, applied: false };
      renderPriceListImportPreview();

      if (!result.matchedRows) {
        setImportStatus(`Ningún SKU de ${file.name} coincide con el catálogo. No se aplicó ningún cambio.`);
        return;
      }
      if (result.conflictingDuplicates.length || result.ambiguousCatalogSkus.length) {
        setImportStatus("La vista previa encontró conflictos. Corregí esos códigos en el archivo antes de aplicar cambios.");
        return;
      }
      if (!result.updatedProducts) {
        setImportStatus("El archivo coincide con el catálogo, pero no contiene cambios nuevos.");
        return;
      }

      adminEls.applyPriceListImport.disabled = false;
      setImportStatus(`Vista previa lista: ${result.updatedProducts} producto${result.updatedProducts === 1 ? "" : "s"} cambiar${result.updatedProducts === 1 ? "á" : "án"}. Revisá el detalle antes de aplicar.`);
    } catch (error) {
      adminState.priceImportPreview = null;
      renderPriceListImportPreview();
      setImportStatus(error.message || "No se pudo analizar el archivo Excel.");
    } finally {
      adminEls.importPriceList.disabled = false;
    }
  }

  async function applyPriceListImport() {
    const result = adminState.priceImportPreview;
    if (!result || result.applied || !result.updatedProducts) return;
    if (result.conflictingDuplicates.length || result.ambiguousCatalogSkus.length) {
      setImportStatus("No se puede aplicar una importación con conflictos de códigos.");
      return;
    }
    const accepted = confirm(`Se actualizar${result.updatedProducts === 1 ? "á" : "án"} ${result.updatedProducts} producto${result.updatedProducts === 1 ? "" : "s"} desde ${result.fileName}. ¿Aplicar estos cambios al catálogo?`);
    if (!accepted) return;

    try {
      adminEls.importPriceList.disabled = true;
      adminEls.applyPriceListImport.disabled = true;
      setImportStatus("Aplicando cambios revisados...");

      const mergedLocal = CATALOG_STORE.mergeProductOverrides(CATALOG_STORE.loadProductOverrides(), result.overrides);
      CATALOG_STORE.saveProductOverrides(mergedLocal);

      let remoteMessage = "Guardado como vista previa local en este navegador.";
      if (CATALOG_SUPABASE.isAvailable()) {
        try {
          const user = await CATALOG_SUPABASE.getUser();
          const profile = user ? await CATALOG_SUPABASE.getProfile(user.id) : null;
          if (profile?.role === "admin") {
            await CATALOG_SUPABASE.upsertProductOverrides(result.overrides);
            remoteMessage = "Guardado en Supabase para todos.";
          } else if (user) {
            remoteMessage = `Guardado solo localmente. El usuario de Supabase ${user.email} no es administrador.`;
          } else {
            remoteMessage = "Guardado solo localmente. Iniciá sesión desde el panel de perfil con tu cuenta administradora de Supabase para actualizar a todos.";
          }
        } catch (error) {
          remoteMessage = `Guardado solo localmente. Falló la actualización de Supabase: ${error.message}`;
        }
      }

      window.dispatchEvent(new CustomEvent("catalog:products-updated"));
      result.applied = true;
      renderPriceListImportPreview();
      setImportStatus(`Se actualizaron ${result.updatedProducts} productos del catálogo. ${result.unmatchedSkus.length} códigos del Excel no se encontraron. ${remoteMessage}`);
      showToast("Importación de Excel completa");
    } catch (error) {
      setImportStatus(error.message || "No se pudo importar el archivo Excel.");
    } finally {
      adminEls.importPriceList.disabled = false;
      adminEls.applyPriceListImport.disabled = Boolean(result.applied);
    }
  }

  function clearPriceListImportPreview() {
    adminState.priceImportPreview = null;
    adminEls.applyPriceListImport.disabled = true;
    adminEls.priceListImportPreview.innerHTML = "";
    if (adminEls.priceListFile.files?.[0]) setImportStatus("Archivo seleccionado. Revisalo antes de aplicar cambios.");
  }

  function renderPriceListImportPreview() {
    const preview = adminState.priceImportPreview;
    if (!preview) {
      adminEls.priceListImportPreview.innerHTML = "";
      return;
    }
    const conflictCount = preview.conflictingDuplicates.length + preview.ambiguousCatalogSkus.length;
    const changeRows = preview.changes.slice(0, 80).map((change) => `
      <div class="import-preview-change">
        <strong>${escapeHtml(change.sku)}</strong>
        <span>${escapeHtml(change.name)}</span>
        <small>${change.fields.map((field) => `${escapeHtml(importFieldLabel(field.field))}: ${escapeHtml(field.before || "vacío")} → ${escapeHtml(field.after || "vacío")}`).join(" · ")}</small>
      </div>
    `).join("");
    const conflictRows = [
      ...preview.conflictingDuplicates.map((item) => `<li><strong>${escapeHtml(item.sku)}</strong>: el Excel contiene ${item.count} filas con datos diferentes.</li>`),
      ...preview.ambiguousCatalogSkus.map((item) => `<li><strong>${escapeHtml(item.sku)}</strong>: corresponde a productos distintos en el catálogo (${escapeHtml(item.names.join(", "))}).</li>`),
    ].join("");

    adminEls.priceListImportPreview.innerHTML = `
      <div class="import-preview-summary">
        <span><strong>${preview.updatedProducts}</strong> productos cambian</span>
        <span><strong>${preview.unchangedRows}</strong> sin cambios</span>
        <span><strong>${preview.unmatchedSkus.length}</strong> códigos nuevos o no encontrados</span>
        <span><strong>${preview.missingCatalogSkus.length}</strong> códigos del catálogo ausentes</span>
        <span><strong>${preview.duplicateRows.length}</strong> códigos repetidos en el Excel</span>
        <span class="${conflictCount ? "is-alert" : ""}"><strong>${conflictCount}</strong> conflictos</span>
      </div>
      ${conflictRows ? `<div class="import-preview-conflicts"><strong>Conflictos que bloquean la importación</strong><ul>${conflictRows}</ul></div>` : ""}
      ${preview.unmatchedSkus.length ? `<details class="import-preview-details"><summary>Códigos del Excel que no existen en el catálogo</summary><p>${escapeHtml(preview.unmatchedSkus.slice(0, 60).join(", "))}${preview.unmatchedSkus.length > 60 ? "…" : ""}</p></details>` : ""}
      ${preview.missingCatalogSkus.length ? `<details class="import-preview-details"><summary>Códigos del catálogo que no aparecen en el archivo</summary><p>${escapeHtml(preview.missingCatalogSkus.slice(0, 60).join(", "))}${preview.missingCatalogSkus.length > 60 ? "…" : ""}</p></details>` : ""}
      ${changeRows ? `<div class="import-preview-changes">${changeRows}${preview.changes.length > 80 ? `<p>Hay ${preview.changes.length - 80} cambios adicionales.</p>` : ""}</div>` : `<p class="empty-state">No hay valores distintos para aplicar.</p>`}
      ${preview.applied ? `<p class="import-preview-applied">Cambios aplicados.</p>` : ""}
    `;
  }

  function importFieldLabel(field) {
    return ({ name: "Nombre", price: "Precio", outOfStock: "Sin stock", videoUrl: "Video" })[field] || field;
  }

  async function downloadPriceTemplate() {
    if (!window.XLSX) {
      setImportStatus("La herramienta de plantilla Excel todavía está cargando. Probá de nuevo en un momento.");
      return;
    }

    try {
      adminEls.downloadPriceTemplate.disabled = true;
      setImportStatus("Preparando plantilla con datos actuales...");

      const overrides = await loadCurrentProductOverrides();
      CATALOG_STORE.saveProductOverrides(overrides);
      const catalog = CATALOG_STORE.applyProductOverrides(cloneCatalog(window.CATALOG_DATA || { products: [] }), overrides);
      const rows = [
        ["Código", "Descripción", "Precio", "Categoría", "Página", "ID de catálogo", "Sin stock", "Video YouTube"],
        ...(catalog.products || []).map((product) => [
          product.sku || "",
          product.name || "",
          product.price || "",
          product.category || "",
          product.page || "",
          product.id || "",
          product.outOfStock ? "Sí" : "No",
          product.videoUrl || "",
        ]),
      ];

      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 16 },
        { wch: 52 },
        { wch: 14 },
        { wch: 24 },
        { wch: 10 },
        { wch: 16 },
        { wch: 12 },
        { wch: 48 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Actualización catálogo");
      XLSX.writeFile(workbook, `lexo-catalog-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setImportStatus("Plantilla descargada. Editá los datos y los enlaces de YouTube, y después subila acá.");
    } catch (error) {
      setImportStatus(error.message || "No se pudo preparar la plantilla.");
    } finally {
      adminEls.downloadPriceTemplate.disabled = false;
    }
  }

  function clearLocalProductOverrides() {
    if (!confirm("¿Borrar los cambios de vista previa local de productos en este dispositivo? Las actualizaciones de Supabase seguirán online.")) return;
    CATALOG_STORE.saveProductOverrides({});
    window.dispatchEvent(new CustomEvent("catalog:products-updated"));
    setImportStatus("Cambios de vista previa local borrados.");
    showToast("Vista previa local borrada");
  }

  async function markSkuOutOfStock(event) {
    event.preventDefault();
    const sku = normalizeSku(adminEls.stockSkuInput.value);
    if (!sku) {
      setStockStatus("Ingresá un código de producto.");
      return;
    }
    if (!adminState.isAdmin) {
      setStockStatus("Iniciá sesión con una cuenta administradora.");
      return;
    }
    if (!CATALOG_SUPABASE.isAvailable()) {
      setStockStatus("Supabase no está disponible.");
      return;
    }

    try {
      setStockBusy(true, "Actualizando...");
      setStockStatus("");
      const currentOverrides = await loadCurrentProductOverrides();
      const products = findProductsBySku(sku, currentOverrides);
      if (!products.length) {
        setStockStatus(`No existe ningún producto con código ${sku}.`);
        return;
      }
      const productIdentities = new Set(products.map((product) => [
        normalizeHeaderCell(product.section),
        normalizeHeaderCell(product.name),
      ].join("|")));
      if (productIdentities.size > 1) {
        setStockStatus(`${sku} corresponde a más de un producto distinto. No se modificó ninguno; revisá el catálogo antes de continuar.`);
        return;
      }

      const nextOverrides = {};
      const previousOverrides = {};
      products.forEach((product) => {
        previousOverrides[product.id] = buildStockOverride(product, currentOverrides, Boolean(product.outOfStock));
        nextOverrides[product.id] = buildStockOverride(product, currentOverrides, true);
      });

      await CATALOG_SUPABASE.setProductStockStatus(nextOverrides, true);
      CATALOG_STORE.saveProductOverrides(CATALOG_STORE.mergeProductOverrides(CATALOG_STORE.loadProductOverrides(), nextOverrides));
      adminState.lastStockChange = {
        sku,
        count: products.length,
        overrides: previousOverrides,
      };
      adminEls.undoStockChange.disabled = false;
      window.dispatchEvent(new CustomEvent("catalog:products-updated"));
      setStockStatus(`${sku} marcado como 0 stock en ${products.length} producto${products.length === 1 ? "" : "s"}.`);
      showToast("Producto actualizado a 0 stock");
    } catch (error) {
      setStockStatus(error.message || "No se pudo actualizar el stock.");
      showToast("No se pudo actualizar el stock");
    } finally {
      setStockBusy(false);
    }
  }

  async function undoLastStockChange() {
    const change = adminState.lastStockChange;
    if (!change) return;
    try {
      setStockBusy(true, "Deshaciendo...");
      await CATALOG_SUPABASE.upsertProductOverrides(change.overrides);
      CATALOG_STORE.saveProductOverrides(CATALOG_STORE.mergeProductOverrides(CATALOG_STORE.loadProductOverrides(), change.overrides));
      adminState.lastStockChange = null;
      adminEls.undoStockChange.disabled = true;
      window.dispatchEvent(new CustomEvent("catalog:products-updated"));
      setStockStatus(`Cambio de ${change.sku} deshecho.`);
      showToast("Cambio de stock deshecho");
    } catch (error) {
      setStockStatus(error.message || "No se pudo deshacer el cambio.");
      showToast("No se pudo deshacer el cambio");
    } finally {
      setStockBusy(false);
    }
  }

  async function loadCurrentProductOverrides() {
    const localOverrides = CATALOG_STORE.loadProductOverrides();
    try {
      const remoteOverrides = await CATALOG_SUPABASE.loadProductOverrides();
      return CATALOG_STORE.mergeProductOverrides(localOverrides, remoteOverrides);
    } catch (error) {
      return localOverrides;
    }
  }

  function findProductsBySku(sku, overrides = {}) {
    const catalog = CATALOG_STORE.applyProductOverrides(cloneCatalog(window.CATALOG_DATA || { products: [] }), overrides);
    const productIndex = buildProductSkuIndex(catalog.products || []);
    return [...(productIndex.primary.get(sku) || [])];
  }

  function buildStockOverride(product, overrides, outOfStock) {
    return {
      ...(overrides[product.id] || {}),
      sku: product.sku,
      name: product.name,
      category: product.category || "",
      price: product.price,
      outOfStock,
    };
  }

  function setStockBusy(isBusy, label = "Pasar a 0 stock") {
    adminEls.markOutOfStock.disabled = isBusy;
    adminEls.markOutOfStock.textContent = label;
    adminEls.stockSkuInput.disabled = isBusy;
    adminEls.undoStockChange.disabled = isBusy || !adminState.lastStockChange;
  }

  function setStockStatus(message) {
    adminEls.stockUpdateStatus.textContent = message;
  }

  function readPriceListRows(workbook) {
    const rows = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      let header = null;

      sheetRows.forEach((row) => {
        if (!header) {
          header = detectPriceListHeader(row);
          return;
        }

        const sku = normalizeSku(row[header.sku]);
        const name = cleanCell(row[header.name]);
        const price = formatImportedPrice(row[header.price]);
        const outOfStock = header.outOfStock >= 0 ? parseStockValue(row[header.outOfStock]) : null;
        const videoUrl = header.videoUrl >= 0 ? cleanCell(row[header.videoUrl]) : null;
        if (!sku || (!name && !price && outOfStock === null && videoUrl === null)) return;
        rows.push({ sku, name, price, outOfStock, videoUrl });
      });
    });
    return rows;
  }

  function detectPriceListHeader(row) {
    const cells = row.map(normalizeHeaderCell);
    const sku = cells.findIndex((cell) => ["sku", "cod", "codigo", "articulo", "item"].includes(cell) || cell.includes("codigo"));
    const name = cells.findIndex((cell) => cell.includes("descripcion") || cell.includes("producto") || cell.includes("nombre") || cell.includes("detalle"));
    const price = cells.findIndex((cell) => cell.includes("precio") || cell === "pvp" || cell.includes("lista"));
    const outOfStock = cells.findIndex((cell) => cell.includes("sinstock") || cell.includes("agotado") || cell.includes("stock"));
    const videoUrl = cells.findIndex((cell) => cell.includes("video") || cell.includes("youtube"));
    if (sku >= 0 && (name >= 0 || price >= 0 || outOfStock >= 0 || videoUrl >= 0)) return { sku, name, price, outOfStock, videoUrl };
    return null;
  }

  function buildProductOverrides(importedRows, products = window.CATALOG_DATA?.products || []) {
    const productIndex = buildProductSkuIndex(products);
    const overrides = {};
    const updatedProductIds = new Set();
    const changes = [];
    const unmatchedSkus = [];
    const duplicateRows = [];
    const conflictingDuplicates = [];
    const ambiguousCatalogSkus = [];
    const rowsBySku = new Map();
    let matchedRows = 0;
    let unchangedRows = 0;

    importedRows.forEach((row) => {
      const rows = rowsBySku.get(row.sku) || [];
      rows.push(row);
      rowsBySku.set(row.sku, rows);
    });

    rowsBySku.forEach((rows, sku) => {
      const signatures = new Set(rows.map((row) => JSON.stringify({
        name: row.name,
        price: row.price,
        outOfStock: row.outOfStock,
        videoUrl: row.videoUrl === null ? null : normalizeYouTubeUrl(row.videoUrl),
      })));
      if (rows.length > 1) duplicateRows.push({ sku, count: rows.length, conflicting: signatures.size > 1 });
      if (signatures.size > 1) {
        conflictingDuplicates.push({ sku, count: rows.length });
        return;
      }

      const matchedProducts = productIndex.primary.get(sku) || [];
      if (!matchedProducts.length) {
        unmatchedSkus.push(sku);
        return;
      }
      const identities = new Map();
      matchedProducts.forEach((product) => {
        const key = [normalizeHeaderCell(product.section), normalizeHeaderCell(product.name)].join("|");
        if (!identities.has(key)) identities.set(key, product.name || product.sku);
      });
      if (identities.size > 1) {
        ambiguousCatalogSkus.push({ sku, names: [...identities.values()] });
        return;
      }

      matchedRows += rows.length;
      const row = rows[rows.length - 1];
      let changedForSku = false;
      matchedProducts.forEach((product) => {
        const fields = [];
        const nextName = row.name || product.name;
        const nextPrice = row.price || product.price;
        const nextStock = row.outOfStock === null ? Boolean(product.outOfStock) : Boolean(row.outOfStock);
        const nextVideo = row.videoUrl === null ? String(product.videoUrl || "") : normalizeYouTubeUrl(row.videoUrl);

        if (nextName !== String(product.name || "")) fields.push({ field: "name", before: product.name || "", after: nextName });
        if (nextPrice !== String(product.price || "")) fields.push({ field: "price", before: product.price || "", after: nextPrice });
        if (nextStock !== Boolean(product.outOfStock)) fields.push({ field: "outOfStock", before: product.outOfStock ? "Sí" : "No", after: nextStock ? "Sí" : "No" });
        if (nextVideo !== String(product.videoUrl || "")) fields.push({ field: "videoUrl", before: product.videoUrl || "", after: nextVideo });
        if (!fields.length) return;

        changedForSku = true;
        overrides[product.id] = {
          sku: product.sku,
          name: nextName,
          category: product.category || "",
          price: nextPrice,
          videoUrl: nextVideo,
          hidden: Boolean(product.hidden),
          outOfStock: nextStock,
        };
        updatedProductIds.add(product.id);
        changes.push({ sku, name: product.name || product.sku, productId: product.id, fields });
      });
      if (!changedForSku) unchangedRows += 1;
    });

    const importedSkuSet = new Set(rowsBySku.keys());
    const catalogSkus = [...new Set(products.map((product) => normalizeSku(product.sku)).filter(Boolean))];
    const missingCatalogSkus = catalogSkus.filter((sku) => !importedSkuSet.has(sku)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    unmatchedSkus.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return {
      overrides,
      changes,
      updatedProducts: updatedProductIds.size,
      matchedRows,
      unchangedRows,
      unmatchedSkus,
      missingCatalogSkus,
      duplicateRows,
      conflictingDuplicates,
      ambiguousCatalogSkus,
    };
  }

  function buildProductSkuIndex(products = window.CATALOG_DATA?.products || []) {
    const primary = new Map();
    products.forEach((product) => {
      addSkuIndex(primary, product.sku, product);
    });
    return { primary };
  }

  function cloneCatalog(catalog) {
    if (typeof structuredClone === "function") return structuredClone(catalog);
    return JSON.parse(JSON.stringify(catalog));
  }

  function addSkuIndex(index, sku, product) {
    const key = normalizeSku(sku);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(product);
  }

  function formatImportedPrice(value) {
    const amount = parseImportedNumber(value);
    return amount ? CATALOG_STORE.formatMoney(amount) : "";
  }

  function parseImportedNumber(value) {
    if (typeof value === "number") return value;
    let text = String(value || "").trim();
    if (!text) return 0;
    text = text.replace(/[^\d,.-]/g, "");
    if (!text) return 0;

    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma > lastDot) {
      const decimals = text.length - lastComma - 1;
      text = decimals === 3 && lastDot === -1 ? text.replace(/,/g, "") : text.replace(/\./g, "").replace(",", ".");
    } else if (lastDot > lastComma) {
      const decimals = text.length - lastDot - 1;
      text = decimals === 3 ? text.replace(/\./g, "") : text.replace(/,/g, "");
    } else {
      text = text.replace(/[,.]/g, "");
    }

    const amount = Number(text);
    return Number.isFinite(amount) ? Math.round(amount) : 0;
  }

  function parseStockValue(value) {
    const text = normalizeHeaderCell(value);
    if (!text) return null;
    if (["si", "s", "yes", "y", "true", "verdadero", "1", "agotado", "sinstock"].includes(text)) return true;
    if (["no", "n", "false", "falso", "0", "disponible", "enstock"].includes(text)) return false;
    return null;
  }

  function normalizeYouTubeUrl(value) {
    const text = cleanCell(value);
    if (!text) return "";
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ? text : "";
      if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) return text;
    } catch (error) {
      return "";
    }
    return "";
  }

  function normalizeSku(value) {
    const text = cleanCell(value);
    if (!text) return "";
    return text.replace(/\.0$/, "").replace(/\s+/g, "").toUpperCase();
  }

  function normalizeHeaderCell(value) {
    return cleanCell(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  }

  function cleanCell(value) {
    return String(value ?? "").trim();
  }

  function setImportStatus(message) {
    adminEls.priceListImportStatus.textContent = message;
  }

  function setOrderView(view) {
    if (!["all", "active", "archived"].includes(view)) return;
    adminState.orderView = view;
    renderOrders();
  }

  function renderOrderViewTabs() {
    adminEls.allOrdersTab.classList.toggle("is-active", adminState.orderView === "all");
    adminEls.activeOrdersTab.classList.toggle("is-active", adminState.orderView === "active");
    adminEls.archivedOrdersTab.classList.toggle("is-active", adminState.orderView === "archived");
  }

  async function renderOrders() {
    if (adminEls.adminApp.hidden) return;

    const result = await loadAdminOrders();
    renderOrderViewTabs();
    adminState.loadedOrders = result.orders;
    adminState.source = result.source;
    adminEls.adminDataStatus.textContent = result.message;
    renderOrderClientSuggestions();
    renderOrderResults();
  }

  function renderOrderResults() {
    adminState.orders = filterOrdersByClient(adminState.loadedOrders);

    const totalValue = adminState.orders.reduce((sum, order) => sum + Number(order.totalValue || 0), 0);
    const totalItems = adminState.orders.reduce((sum, order) => sum + Number(order.totalItems || 0), 0);

    adminEls.orderSummary.innerHTML = `
      <span><strong>${adminState.orders.length}</strong> pedidos</span>
      <span><strong>${totalItems}</strong> unidades</span>
      <span><strong>${CATALOG_STORE.formatMoney(totalValue)}</strong> total</span>
    `;

    adminEls.ordersList.innerHTML =
      adminState.orders.map(renderOrderCard).join("") || `<p class="empty-state">No se encontraron pedidos${adminState.orderClientSearch ? " para este cliente" : orderViewEmptySuffix()}.</p>`;

    adminEls.ordersList.querySelectorAll("[data-order-card]").forEach((card) => {
      card.addEventListener("click", () => openOrderDialog(card.dataset.orderCard));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openOrderDialog(card.dataset.orderCard);
      });
    });

    bindOrderArchiveButtons(adminEls.ordersList);
    renderOrderClientSearchStatus();
  }

  function handleOrderClientSearch() {
    adminState.orderClientSearch = adminEls.orderClientSearch.value.trim();
    adminState.selectedOrderClientKey = "";
    adminState.selectedOrderClientLabel = "";
    adminEls.clearOrderClientSearch.hidden = !adminState.orderClientSearch;
    renderOrderClientSuggestions();
    renderOrderResults();
  }

  function clearOrderClientSearch() {
    adminState.orderClientSearch = "";
    adminState.selectedOrderClientKey = "";
    adminState.selectedOrderClientLabel = "";
    adminEls.orderClientSearch.value = "";
    adminEls.clearOrderClientSearch.hidden = true;
    adminEls.orderClientSuggestions.hidden = true;
    renderOrderResults();
    adminEls.orderClientSearch.focus();
  }

  function selectOrderClientSuggestion(event) {
    const button = event.target.closest("[data-order-client-key]");
    if (!button) return;
    const candidate = orderClientCandidates(adminState.loadedOrders)
      .find((item) => item.key === button.dataset.orderClientKey);
    if (!candidate) return;
    adminState.selectedOrderClientKey = candidate.key;
    adminState.selectedOrderClientLabel = candidate.label;
    adminState.orderClientSearch = candidate.label;
    adminEls.orderClientSearch.value = candidate.label;
    adminEls.clearOrderClientSearch.hidden = false;
    adminEls.orderClientSuggestions.hidden = true;
    renderOrderResults();
  }

  function renderOrderClientSuggestions() {
    const query = normalizeOrderSearch(adminState.orderClientSearch);
    if (query.length < 2 || adminState.selectedOrderClientKey) {
      adminEls.orderClientSuggestions.hidden = true;
      adminEls.orderClientSuggestions.innerHTML = "";
      return;
    }

    const candidates = orderClientCandidates(adminState.loadedOrders)
      .filter((item) => item.searchText.includes(query))
      .slice(0, 8);
    adminEls.orderClientSuggestions.hidden = false;
    adminEls.orderClientSuggestions.innerHTML = candidates.length
      ? candidates.map((item) => `
          <button type="button" role="option" data-order-client-key="${escapeHtml(item.key)}">
            <span><strong>${escapeHtml(item.label)}</strong>${item.code ? `<small>Código ${escapeHtml(item.code)}</small>` : ""}</span>
            <em>${item.count} pedido${item.count === 1 ? "" : "s"}</em>
          </button>
        `).join("")
      : `<p>No hay clientes que coincidan.</p>`;
  }

  function renderOrderClientSearchStatus() {
    const filtered = Boolean(adminState.orderClientSearch);
    adminEls.orderClientSearchStatus.hidden = !filtered;
    if (!filtered) return;
    const subject = adminState.selectedOrderClientLabel
      ? `de ${adminState.selectedOrderClientLabel}`
      : `que coinciden con “${adminState.orderClientSearch}”`;
    adminEls.orderClientSearchStatus.textContent = `${adminState.orders.length} pedido${adminState.orders.length === 1 ? "" : "s"} ${subject}.`;
  }

  function filterOrdersByClient(orders) {
    if (adminState.selectedOrderClientKey) {
      return orders.filter((order) => orderClientIdentity(order).key === adminState.selectedOrderClientKey);
    }
    const query = normalizeOrderSearch(adminState.orderClientSearch);
    if (!query) return orders;
    return orders.filter((order) => orderClientSearchText(order).includes(query));
  }

  function orderClientCandidates(orders) {
    const candidates = new Map();
    orders.forEach((order) => {
      const identity = orderClientIdentity(order);
      const existing = candidates.get(identity.key) || { ...identity, count: 0, totalValue: 0 };
      existing.count += 1;
      existing.totalValue += Number(order.totalValue || 0);
      candidates.set(identity.key, existing);
    });
    return [...candidates.values()].sort((first, second) => first.label.localeCompare(second.label, "es"));
  }

  function orderClientIdentity(order) {
    const customer = order.customer || {};
    const salesClient = customer.salesClient || {};
    const label = salesClient.name || salesClient.legalName || customer.name || "Cliente sin nombre";
    const code = salesClient.clientCode || customer.clientCode || "";
    const key = salesClient.id
      ? `sales-client:${salesClient.id}`
      : code
        ? `client-code:${normalizeOrderSearch(code)}`
        : order.customerId
          ? `account:${order.customerId}`
          : `name:${normalizeOrderSearch(label)}`;
    return {
      key,
      label,
      code,
      searchText: normalizeOrderSearch([
        label,
        code,
        customer.name,
        customer.phone,
        salesClient.name,
        salesClient.legalName,
        salesClient.address,
        salesClient.locality,
        customer.salesmanCode,
      ].filter(Boolean).join(" ")),
    };
  }

  function orderClientSearchText(order) {
    const identity = orderClientIdentity(order);
    return `${identity.searchText} ${normalizeOrderSearch(order.displayId || order.id)}`;
  }

  function normalizeOrderSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function orderViewEmptySuffix() {
    if (adminState.orderView === "archived") return " archivados";
    if (adminState.orderView === "active") return " activos";
    return "";
  }

  function renderOrderCard(order) {
    const buyer = orderBuyerLabel(order);
    const clientCode = order.customer?.salesClient?.clientCode || order.customer?.clientCode || "";
    const archived = isArchivedOrder(order);
    return `
      <article class="order-card order-card-compact" role="button" tabindex="0" data-order-card="${escapeHtml(order.id)}">
        <div class="order-compact-main">
          <div class="order-compact-buyer">
            <strong>${escapeHtml(buyer)}</strong>
          </div>
          <strong class="order-compact-total">${CATALOG_STORE.formatMoney(order.totalValue)}</strong>
          <button class="secondary-button compact-button ${archived ? "" : "danger-button"}" type="button" data-archive-order="${escapeHtml(order.id)}" data-action="${archived ? "restore" : "archive"}">
            ${archived ? "Restaurar" : "Archivar"}
          </button>
          <p class="order-compact-meta">${formatDate(order.createdAt)} · ${order.totalItems} unidad${order.totalItems === 1 ? "" : "es"}${clientCode ? ` · Cliente ${escapeHtml(clientCode)}` : ""}</p>
        </div>
      </article>
    `;
  }

  function openOrderDialog(orderId) {
    const order = adminState.orders.find((item) => item.id === orderId);
    if (!order) return;
    adminEls.adminOrderDialogContent.innerHTML = renderOrderDialog(order);
    bindOrderDialogActions(order);
    if (window.CATALOG_DIALOG) window.CATALOG_DIALOG.open(adminEls.adminOrderDialog);
    else if (typeof adminEls.adminOrderDialog.showModal === "function") adminEls.adminOrderDialog.showModal();
    else adminEls.adminOrderDialog.setAttribute("open", "");
  }

  function renderOrderDialog(order) {
    const buyer = orderBuyerLabel(order);
    const salesClient = order.customer?.salesClient;
    const archived = isArchivedOrder(order);
    return `
      <div class="admin-order-detail">
        <div class="admin-order-detail-header">
          <div>
            <span class="eyebrow">Pedido</span>
            <h2>${escapeHtml(order.displayId || order.id)}</h2>
            <p>${formatDate(order.createdAt)}</p>
          </div>
          <strong>${CATALOG_STORE.formatMoney(order.totalValue)}</strong>
        </div>
        <div class="admin-order-meta">
          <span><strong>Comprador</strong>${escapeHtml(buyer)}</span>
          <span><strong>Unidades</strong>${escapeHtml(order.totalItems)}</span>
          ${archived && order.archivedAt ? `<span><strong>Archivado</strong>${escapeHtml(formatDate(order.archivedAt))}</span>` : ""}
          ${order.customer?.phone ? `<span><strong>Teléfono</strong>${escapeHtml(order.customer.phone)}</span>` : ""}
          ${salesClient?.clientCode ? `<span><strong>Código cliente</strong>${escapeHtml(salesClient.clientCode)}</span>` : ""}
          ${salesClientAddress(salesClient) ? `<span><strong>Dirección</strong>${escapeHtml(salesClientAddress(salesClient))}</span>` : ""}
        </div>
        <div class="order-lines order-lines-detail">
          ${order.items.map((item) => `
            <span>
              <strong>${escapeHtml(item.qty)} x ${escapeHtml(item.sku)}</strong>
              <em>${escapeHtml(item.name)}</em>
              <b>${CATALOG_STORE.formatMoney(item.lineTotal)}</b>
            </span>
          `).join("")}
        </div>
        ${renderNotificationStatus(order)}
        ${order.customer?.notes ? `<p class="order-notes">${escapeHtml(order.customer.notes)}</p>` : ""}
        <div class="order-card-footer">
          <button class="secondary-button ${archived ? "" : "danger-button"}" type="button" data-dialog-archive-order="${escapeHtml(order.id)}" data-action="${archived ? "restore" : "archive"}">${archived ? "Restaurar" : "Archivar"}</button>
          ${order.remote ? `<button class="secondary-button" type="button" data-dialog-resend-order="${escapeHtml(order.id)}">Reenviar email</button>` : ""}
          <button class="secondary-button danger-button" type="button" data-dialog-delete-order="${escapeHtml(order.id)}" data-remote="${order.remote ? "true" : "false"}">Eliminar</button>
        </div>
      </div>
    `;
  }

  function bindOrderDialogActions(order) {
    const archiveButton = adminEls.adminOrderDialogContent.querySelector("[data-dialog-archive-order]");
    if (archiveButton) {
      archiveButton.addEventListener("click", async () => {
        try {
          archiveButton.disabled = true;
          await changeOrderArchiveState(order, archiveButton.dataset.action);
          closeOrderDialog();
          await renderOrders();
        } catch (error) {
          archiveButton.disabled = false;
          showToast(error.message || "No se pudo actualizar el pedido");
        }
      });
    }

    const resendButton = adminEls.adminOrderDialogContent.querySelector("[data-dialog-resend-order]");
    if (resendButton) {
      resendButton.addEventListener("click", async () => {
        try {
          resendButton.disabled = true;
          resendButton.textContent = "Reenviando...";
          await CATALOG_SUPABASE.resendOrderNotification(order.id);
          closeOrderDialog();
          await renderOrders();
          showToast("Email reenviado");
        } catch (error) {
          resendButton.disabled = false;
          resendButton.textContent = "Reenviar email";
          showToast(error.message || "No se pudo reenviar el email");
        }
      });
    }

    const deleteButton = adminEls.adminOrderDialogContent.querySelector("[data-dialog-delete-order]");
    if (deleteButton) {
      deleteButton.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este pedido guardado?")) return;
        try {
          if (order.remote) await CATALOG_SUPABASE.deleteOrder(order.id);
          else CATALOG_STORE.deleteOrder(order.id);
          closeOrderDialog();
          await renderOrders();
          showToast("Pedido eliminado");
        } catch (error) {
          showToast(error.message || "No se pudo eliminar el pedido");
        }
      });
    }
  }

  function bindOrderArchiveButtons(root) {
    root.querySelectorAll("[data-archive-order]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const order = adminState.orders.find((item) => item.id === button.dataset.archiveOrder);
        if (!order) return;
        try {
          button.disabled = true;
          await changeOrderArchiveState(order, button.dataset.action);
          await renderOrders();
        } catch (error) {
          button.disabled = false;
          showToast(error.message || "No se pudo actualizar el pedido");
        }
      });
    });
  }

  async function changeOrderArchiveState(order, action) {
    const archive = action !== "restore";
    if (order.remote) {
      if (archive) await CATALOG_SUPABASE.archiveOrder(order.id);
      else await CATALOG_SUPABASE.restoreOrder(order.id);
    } else if (archive) {
      CATALOG_STORE.archiveOrder(order.id);
    } else {
      CATALOG_STORE.restoreOrder(order.id);
    }
    showToast(archive ? "Pedido archivado" : "Pedido restaurado");
  }

  function isArchivedOrder(order) {
    return order.status === "sent" || Boolean(order.archivedAt);
  }

  function closeOrderDialog() {
    if (window.CATALOG_DIALOG) window.CATALOG_DIALOG.close(adminEls.adminOrderDialog);
    else if (adminEls.adminOrderDialog.open && typeof adminEls.adminOrderDialog.close === "function") adminEls.adminOrderDialog.close();
    else adminEls.adminOrderDialog.removeAttribute("open");
  }

  function orderBuyerLabel(order) {
    return order.customer?.salesClient?.name || order.customer?.name || "Cliente";
  }

  function salesClientAddress(client) {
    return [client?.address, client?.locality].filter(Boolean).join(" - ");
  }

  function renderNotificationStatus(order) {
    if (!order.remote) return "";
    const notification = order.notification;
    if (!notification) return `<p class="order-notification-status is-warning">Email: sin registro de notificación.</p>`;
    const parts = [
      `Email: ${notificationStatusLabel(notification.status)}`,
      notification.attempts ? `${notification.attempts} intento${notification.attempts === 1 ? "" : "s"}` : "",
      notification.sentAt ? `enviado ${formatDate(notification.sentAt)}` : "",
      notification.resendEmailId ? `Resend ID ${notification.resendEmailId}` : "",
      notification.resendTo ? `para ${notification.resendTo}` : "",
      notification.resendLastEvent ? `entrega: ${deliveryEventLabel(notification.resendLastEvent)}` : "",
      notification.deliveryCheckedAt ? `consultado ${formatDate(notification.deliveryCheckedAt)}` : "",
    ].filter(Boolean);
    const errors = [notification.lastError, notification.deliveryError].filter(Boolean);
    const error = errors.map((message) => `<span>${escapeHtml(message)}</span>`).join("");
    const warning = notification.status === "failed" || ["delivery_delayed", "bounced", "failed", "suppressed", "canceled", "complained"].includes(notification.resendLastEvent);
    return `<p class="order-notification-status${warning ? " is-warning" : ""}">${escapeHtml(parts.join(" - "))}${error}</p>`;
  }


  async function loadAdminOrders() {
    return loadAdminOrderSet(adminState.orderView);
  }

  async function loadAdminOrderSet(view = "all") {
    const archived = view === "archived";
    const all = view === "all";
    if (!CATALOG_SUPABASE.isAvailable()) {
      return {
        orders: all ? mergeLocalOrderHistory() : archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: all ? "Supabase no está disponible; se muestra el historial local." : archived ? "Supabase no está disponible; se muestran pedidos archivados locales." : "Supabase no está disponible; se muestran pedidos activos locales.",
      };
    }

    const user = await CATALOG_SUPABASE.getUser();
    if (!user) {
      return {
        orders: all ? mergeLocalOrderHistory() : archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: "Iniciá sesión desde el panel de perfil con tu cuenta administradora de Supabase para ver pedidos.",
      };
    }

    const profile = await CATALOG_SUPABASE.getProfile(user.id);
    if (profile?.role !== "admin") {
      return {
        orders: all ? mergeLocalOrderHistory() : archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: `Sesión iniciada como ${user.email}, pero este perfil tiene rol "${profile?.role || "faltante"}". Definí role = 'admin' en Supabase para ver pedidos.`,
      };
    }

    try {
      return {
        orders: all ? await CATALOG_SUPABASE.loadAllOrders() : archived ? await CATALOG_SUPABASE.loadArchivedOrders() : await CATALOG_SUPABASE.loadActiveOrders(),
        source: "supabase",
        message: all ? `Mostrando todo el historial de Supabase como ${user.email}.` : archived ? `Mostrando pedidos archivados de Supabase como ${user.email}.` : `Mostrando pedidos activos de Supabase como ${user.email}.`,
      };
    } catch (error) {
      return {
        orders: all ? mergeLocalOrderHistory() : archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: `No se pudieron cargar los pedidos de Supabase: ${error.message}. Se muestran solo los pedidos locales del navegador.`,
      };
    }
  }

  async function exportOrdersCsv() {
    try {
      const result = await loadAdminOrderSet(adminState.orderView);
      const orders = filterOrdersByClient(result.orders);
      const viewLabel = adminState.orderView === "all" ? "todos" : adminState.orderView === "archived" ? "archivados" : "activos";
      const filename = `lexo-pedidos-${viewLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, ordersToCsv(orders));
      showToast(`Se exportaron ${orders.length} pedidos`);
    } catch (error) {
      showToast(error.message || "No se pudieron exportar los pedidos");
    }
  }

  function clearLocalOrders() {
    if (adminState.source === "supabase") {
      showToast("Usá los botones de eliminar individuales para pedidos de Supabase.");
      return;
    }
    const archived = adminState.orderView === "archived";
    const all = adminState.orderView === "all";
    if (!confirm(`¿Borrar todos los pedidos locales ${all ? "activos y archivados" : archived ? "archivados" : "activos"} guardados en este dispositivo?`)) return;
    if (all || archived) CATALOG_STORE.clearArchivedOrders();
    if (all || !archived) CATALOG_STORE.saveOrders([]);
    renderOrders();
    showToast("Pedidos locales borrados");
  }

  function mergeLocalOrderHistory() {
    const byId = new Map();
    [...CATALOG_STORE.loadOrders(), ...CATALOG_STORE.loadArchivedOrders()].forEach((order) => byId.set(order.id, order));
    return [...byId.values()].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  }

  function ordersToCsv(orders) {
    const headers = [
      "id_pedido",
      "numero_pedido",
      "estado",
      "fecha_creacion",
      "fecha_actualizacion",
      "fecha_archivo",
      "cliente_nombre",
      "cliente_telefono",
      "notas",
      "total_unidades",
      "valor_total",
      "item_sku",
      "item_nombre",
      "item_cantidad",
      "item_precio_unitario",
      "item_total_linea",
      "item_pagina",
    ];
    const rows = orders.flatMap((order) => {
      const items = order.items.length ? order.items : [{}];
      return items.map((item) => [
        order.id,
        order.displayId || "",
        isArchivedOrder(order) ? "archivado" : "activo",
        order.createdAt || "",
        order.updatedAt || "",
        order.archivedAt || "",
        order.customer?.name || "",
        order.customer?.phone || "",
        order.customer?.notes || "",
        order.totalItems || 0,
        order.totalValue || 0,
        item.sku || "",
        item.name || "",
        item.qty || "",
        item.price || "",
        item.lineTotal || "",
        item.page || "",
      ]);
    });
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function notificationStatusLabel(status) {
    return {
      pending: "pendiente",
      processing: "procesando",
      sent: "aceptado por Resend",
      failed: "falló",
    }[status] || status || "";
  }

  function showToast(message) {
    adminEls.toast.textContent = message;
    adminEls.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => adminEls.toast.classList.remove("is-visible"), 1800);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  initAdmin();
})();
