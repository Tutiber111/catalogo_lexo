(function () {
  const adminState = {
    settings: CATALOG_STORE.loadSettings(),
    orders: [],
    source: "local",
    orderView: "active",
    isAdmin: false,
    lastStockChange: null,
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
    activeOrdersTab: document.querySelector("#activeOrdersTab"),
    archivedOrdersTab: document.querySelector("#archivedOrdersTab"),
    orderSummary: document.querySelector("#orderSummary"),
    ordersList: document.querySelector("#ordersList"),
    exportOrders: document.querySelector("#exportOrders"),
    clearOrders: document.querySelector("#clearOrders"),
    priceListFile: document.querySelector("#priceListFile"),
    downloadPriceTemplate: document.querySelector("#downloadPriceTemplate"),
    importPriceList: document.querySelector("#importPriceList"),
    clearProductOverrides: document.querySelector("#clearProductOverrides"),
    priceListImportStatus: document.querySelector("#priceListImportStatus"),
    stockUpdateForm: document.querySelector("#stockUpdateForm"),
    stockSkuInput: document.querySelector("#stockSkuInput"),
    markOutOfStock: document.querySelector("#markOutOfStock"),
    undoStockChange: document.querySelector("#undoStockChange"),
    stockUpdateStatus: document.querySelector("#stockUpdateStatus"),
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
    adminEls.activeOrdersTab.addEventListener("click", () => setOrderView("active"));
    adminEls.archivedOrdersTab.addEventListener("click", () => setOrderView("archived"));
    adminEls.exportOrders.addEventListener("click", exportOrdersCsv);
    adminEls.clearOrders.addEventListener("click", clearLocalOrders);
    adminEls.downloadPriceTemplate.addEventListener("click", downloadPriceTemplate);
    adminEls.importPriceList.addEventListener("click", importPriceList);
    adminEls.clearProductOverrides.addEventListener("click", clearLocalProductOverrides);
    adminEls.stockUpdateForm.addEventListener("submit", markSkuOutOfStock);
    adminEls.undoStockChange.addEventListener("click", undoLastStockChange);
    adminEls.adminOrderDialog.addEventListener("close", () => {
      adminEls.adminOrderDialogContent.innerHTML = "";
    });
    window.addEventListener("catalog:orders-changed", () => renderOrders());
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

  async function importPriceList() {
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
      setImportStatus("Leyendo archivo Excel...");

      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const importedRows = readPriceListRows(workbook);
      const result = buildProductOverrides(importedRows);
      if (!result.updatedProducts) {
        setImportStatus(`Ningún SKU de este archivo Excel coincide con el catálogo. ${result.unmatched} filas no se encontraron.`);
        return;
      }

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
      setImportStatus(`Se actualizaron ${result.updatedProducts} productos del catálogo desde ${result.matchedRows} filas coincidentes del Excel. ${result.unmatched} filas del Excel no se encontraron en el catálogo. ${remoteMessage}`);
      showToast("Importación de Excel completa");
    } catch (error) {
      setImportStatus(error.message || "No se pudo importar el archivo Excel.");
    } finally {
      adminEls.importPriceList.disabled = false;
    }
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
        ["Código", "Descripción", "Precio", "Categoría", "Página", "ID de catálogo", "Sin stock"],
        ...(catalog.products || []).map((product) => [
          product.sku || "",
          product.name || "",
          product.price || "",
          product.category || "",
          product.page || "",
          product.id || "",
          product.outOfStock ? "Sí" : "No",
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
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Actualización catálogo");
      XLSX.writeFile(workbook, `lexo-catalog-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setImportStatus("Plantilla descargada. Editá Código, Descripción, Precio y Sin stock, y después subila acá.");
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
    const matches = new Map();
    (productIndex.primary.get(sku) || []).forEach((product) => matches.set(product.id, product));
    (productIndex.related.get(sku) || []).forEach((product) => matches.set(product.id, product));
    return [...matches.values()];
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
        const nextHeader = detectPriceListHeader(row);
        if (nextHeader) {
          header = nextHeader;
          return;
        }
        if (!header) return;

        const sku = normalizeSku(row[header.sku]);
        const name = cleanCell(row[header.name]);
        const price = formatImportedPrice(row[header.price]);
        const outOfStock = header.outOfStock >= 0 ? parseStockValue(row[header.outOfStock]) : null;
        if (!sku || (!name && !price && outOfStock === null)) return;
        rows.push({ sku, name, price, outOfStock });
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
    if (sku >= 0 && (name >= 0 || price >= 0 || outOfStock >= 0)) return { sku, name, price, outOfStock };
    return null;
  }

  function buildProductOverrides(importedRows) {
    const productIndex = buildProductSkuIndex();
    const overrides = {};
    const updatedProductIds = new Set();
    let matchedRows = 0;
    let unmatched = 0;

    importedRows.forEach((row) => {
      const products = productIndex.primary.get(row.sku) || productIndex.related.get(row.sku);
      if (!products?.length) {
        unmatched += 1;
        return;
      }
      matchedRows += 1;

      products.forEach((product) => {
        if (overrides[product.id]) return;
        const override = {
          sku: product.sku,
          name: row.name || product.name,
          price: row.price || product.price,
        };
        if (row.outOfStock !== null) override.outOfStock = row.outOfStock;
        overrides[product.id] = override;
        updatedProductIds.add(product.id);
      });
    });

    return { overrides, updatedProducts: updatedProductIds.size, matchedRows, unmatched };
  }

  function buildProductSkuIndex(products = window.CATALOG_DATA?.products || []) {
    const primary = new Map();
    const related = new Map();
    products.forEach((product) => {
      addSkuIndex(primary, product.sku, product);
      (product.skus || []).forEach((sku) => addSkuIndex(related, sku, product));
    });
    return { primary, related };
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
    if (!["active", "archived"].includes(view)) return;
    adminState.orderView = view;
    renderOrders();
  }

  function renderOrderViewTabs() {
    const archived = adminState.orderView === "archived";
    adminEls.activeOrdersTab.classList.toggle("is-active", !archived);
    adminEls.archivedOrdersTab.classList.toggle("is-active", archived);
  }

  async function renderOrders() {
    if (adminEls.adminApp.hidden) return;

    const result = await loadAdminOrders();
    renderOrderViewTabs();
    adminState.orders = result.orders;
    adminState.source = result.source;
    adminEls.adminDataStatus.textContent = result.message;

    const totalValue = adminState.orders.reduce((sum, order) => sum + Number(order.totalValue || 0), 0);
    const totalItems = adminState.orders.reduce((sum, order) => sum + Number(order.totalItems || 0), 0);

    adminEls.orderSummary.innerHTML = `
      <span><strong>${adminState.orders.length}</strong> pedidos</span>
      <span><strong>${totalItems}</strong> unidades</span>
      <span><strong>${CATALOG_STORE.formatMoney(totalValue)}</strong> total</span>
    `;

    adminEls.ordersList.innerHTML =
      adminState.orders.map(renderOrderCard).join("") || `<p class="empty-state">No se encontraron pedidos ${adminState.orderView === "archived" ? "archivados" : "activos"}.</p>`;

    adminEls.ordersList.querySelectorAll("[data-order-card]").forEach((card) => {
      card.addEventListener("click", () => openOrderDialog(card.dataset.orderCard));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openOrderDialog(card.dataset.orderCard);
      });
    });

    bindOrderArchiveButtons(adminEls.ordersList);
  }

  function renderOrderCard(order) {
    const buyer = orderBuyerLabel(order);
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
          <p class="order-compact-meta">${formatDate(order.createdAt)} · ${order.totalItems} unidad${order.totalItems === 1 ? "" : "es"}</p>
        </div>
      </article>
    `;
  }

  function openOrderDialog(orderId) {
    const order = adminState.orders.find((item) => item.id === orderId);
    if (!order) return;
    adminEls.adminOrderDialogContent.innerHTML = renderOrderDialog(order);
    bindOrderDialogActions(order);
    if (typeof adminEls.adminOrderDialog.showModal === "function") adminEls.adminOrderDialog.showModal();
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
    if (adminEls.adminOrderDialog.open && typeof adminEls.adminOrderDialog.close === "function") adminEls.adminOrderDialog.close();
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
    ].filter(Boolean);
    const error = notification.lastError ? `<span>${escapeHtml(notification.lastError)}</span>` : "";
    return `<p class="order-notification-status${notification.status === "failed" ? " is-warning" : ""}">${escapeHtml(parts.join(" - "))}${error}</p>`;
  }


  async function loadAdminOrders() {
    return loadAdminOrderSet(adminState.orderView);
  }

  async function loadAdminOrderSet(view = "active") {
    const archived = view === "archived";
    if (!CATALOG_SUPABASE.isAvailable()) {
      return {
        orders: archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: archived ? "Supabase no está disponible; se muestran pedidos archivados locales." : "Supabase no está disponible; se muestran pedidos activos locales.",
      };
    }

    const user = await CATALOG_SUPABASE.getUser();
    if (!user) {
      return {
        orders: archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: "Iniciá sesión desde el panel de perfil con tu cuenta administradora de Supabase para ver pedidos.",
      };
    }

    const profile = await CATALOG_SUPABASE.getProfile(user.id);
    if (profile?.role !== "admin") {
      return {
        orders: archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: `Sesión iniciada como ${user.email}, pero este perfil tiene rol "${profile?.role || "faltante"}". Definí role = 'admin' en Supabase para ver pedidos.`,
      };
    }

    try {
      return {
        orders: archived ? await CATALOG_SUPABASE.loadArchivedOrders() : await CATALOG_SUPABASE.loadActiveOrders(),
        source: "supabase",
        message: archived ? `Mostrando pedidos archivados de Supabase como ${user.email}.` : `Mostrando pedidos activos de Supabase como ${user.email}.`,
      };
    } catch (error) {
      return {
        orders: archived ? CATALOG_STORE.loadArchivedOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: `No se pudieron cargar los pedidos de Supabase: ${error.message}. Se muestran solo los pedidos locales del navegador.`,
      };
    }
  }

  async function exportOrdersCsv() {
    try {
      const result = await loadAdminOrderSet(adminState.orderView);
      const filename = `lexo-pedidos-${adminState.orderView === "archived" ? "archivados" : "activos"}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, ordersToCsv(result.orders));
      showToast(`Se exportaron ${result.orders.length} pedidos`);
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
    if (!confirm(`¿Borrar todos los pedidos locales ${archived ? "archivados" : "activos"} guardados en este dispositivo?`)) return;
    if (archived) CATALOG_STORE.clearArchivedOrders();
    else CATALOG_STORE.saveOrders([]);
    renderOrders();
    showToast("Pedidos locales borrados");
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
