(function () {
  const adminState = {
    settings: CATALOG_STORE.loadSettings(),
    orders: [],
    source: "local",
  };

  const adminEls = {
    openAdmin: document.querySelector("#openAdmin"),
    adminDrawer: document.querySelector("#adminDrawer"),
    adminLogin: document.querySelector("#adminLogin"),
    adminApp: document.querySelector("#adminApp"),
    loginForm: document.querySelector("#loginForm"),
    adminPassword: document.querySelector("#adminPassword"),
    loginMessage: document.querySelector("#loginMessage"),
    closeAdminLogin: document.querySelector("#closeAdminLogin"),
    closeAdmin: document.querySelector("#closeAdmin"),
    lockAdmin: document.querySelector("#lockAdmin"),
    settingBrandName: document.querySelector("#settingBrandName"),
    settingCatalogLabel: document.querySelector("#settingCatalogLabel"),
    settingWhatsapp: document.querySelector("#settingWhatsapp"),
    settingPassword: document.querySelector("#settingPassword"),
    saveSettings: document.querySelector("#saveSettings"),
    adminDataStatus: document.querySelector("#adminDataStatus"),
    orderSummary: document.querySelector("#orderSummary"),
    ordersList: document.querySelector("#ordersList"),
    exportOrders: document.querySelector("#exportOrders"),
    clearOrders: document.querySelector("#clearOrders"),
    priceListFile: document.querySelector("#priceListFile"),
    downloadPriceTemplate: document.querySelector("#downloadPriceTemplate"),
    importPriceList: document.querySelector("#importPriceList"),
    clearProductOverrides: document.querySelector("#clearProductOverrides"),
    priceListImportStatus: document.querySelector("#priceListImportStatus"),
    toast: document.querySelector("#toast"),
  };

  function initAdmin() {
    bindAdminEvents();
    if (location.hash === "#admin") openAdmin();
  }

  function bindAdminEvents() {
    adminEls.openAdmin.addEventListener("click", openAdmin);
    adminEls.closeAdminLogin.addEventListener("click", closeAdmin);
    adminEls.closeAdmin.addEventListener("click", closeAdmin);
    adminEls.loginForm.addEventListener("submit", unlockAdmin);
    adminEls.lockAdmin.addEventListener("click", lockAdmin);
    adminEls.saveSettings.addEventListener("click", saveSettings);
    adminEls.exportOrders.addEventListener("click", exportOrdersCsv);
    adminEls.clearOrders.addEventListener("click", clearLocalOrders);
    adminEls.downloadPriceTemplate.addEventListener("click", downloadPriceTemplate);
    adminEls.importPriceList.addEventListener("click", importPriceList);
    adminEls.clearProductOverrides.addEventListener("click", clearLocalProductOverrides);
    window.addEventListener("catalog:orders-changed", () => renderOrders());
  }

  function openAdmin() {
    adminEls.adminDrawer.classList.add("is-open");
    adminEls.adminDrawer.setAttribute("aria-hidden", "false");
    if (sessionStorage.getItem("catalogAdminUnlocked") === "true") showAdmin();
    else {
      adminEls.adminLogin.hidden = false;
      adminEls.adminApp.hidden = true;
      adminEls.adminPassword.focus();
    }
  }

  function closeAdmin() {
    adminEls.adminDrawer.classList.remove("is-open");
    adminEls.adminDrawer.setAttribute("aria-hidden", "true");
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
  }

  async function unlockAdmin(event) {
    event.preventDefault();
    try {
      const hash = await CATALOG_STORE.hashString(adminEls.adminPassword.value);
      if (hash !== adminState.settings.adminPasswordHash) {
        adminEls.loginMessage.textContent = "Contraseña incorrecta.";
        return;
      }

      sessionStorage.setItem("catalogAdminUnlocked", "true");
      adminEls.adminPassword.value = "";
      adminEls.loginMessage.textContent = "";
      showAdmin();
    } catch (error) {
      adminEls.loginMessage.textContent = error.message;
    }
  }

  function showAdmin() {
    adminEls.adminLogin.hidden = true;
    adminEls.adminApp.hidden = false;
    fillSettings();
    renderOrders();
  }

  function lockAdmin() {
    sessionStorage.removeItem("catalogAdminUnlocked");
    adminEls.adminApp.hidden = true;
    adminEls.adminLogin.hidden = false;
    adminEls.adminPassword.focus();
  }

  function fillSettings() {
    adminState.settings = CATALOG_STORE.loadSettings();
    adminEls.settingBrandName.value = adminState.settings.brandName;
    adminEls.settingCatalogLabel.value = adminState.settings.catalogLabel;
    adminEls.settingWhatsapp.value = adminState.settings.whatsappNumber;
    adminEls.settingPassword.value = "";
  }

  async function saveSettings() {
    const nextSettings = {
      brandName: adminEls.settingBrandName.value.trim() || "LEXO",
      catalogLabel: adminEls.settingCatalogLabel.value.trim() || "Catálogo interactivo",
      whatsappNumber: adminEls.settingWhatsapp.value.trim(),
    };

    if (adminEls.settingPassword.value) {
      nextSettings.adminPasswordHash = await CATALOG_STORE.hashString(adminEls.settingPassword.value);
    }

    adminState.settings = CATALOG_STORE.saveSettings(nextSettings);
    document.querySelector("#brandName").textContent = adminState.settings.brandName;
    document.querySelector("#catalogLabel").textContent = adminState.settings.catalogLabel;
    adminEls.settingPassword.value = "";
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

  function downloadPriceTemplate() {
    if (!window.XLSX) {
      setImportStatus("La herramienta de plantilla Excel todavía está cargando. Probá de nuevo en un momento.");
      return;
    }

    const rows = [
      ["Código", "Descripción", "Precio", "Categoría", "Página", "ID de catálogo"],
      ...(window.CATALOG_DATA?.products || []).map((product) => [
        product.sku || "",
        product.name || "",
        product.price || "",
        product.category || "",
        product.page || "",
        product.id || "",
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
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Actualización catálogo");
    XLSX.writeFile(workbook, `lexo-catalog-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setImportStatus("Plantilla descargada. Editá Código, Descripción y Precio, y después subila acá.");
  }

  function clearLocalProductOverrides() {
    if (!confirm("¿Borrar los cambios de vista previa local de productos en este dispositivo? Las actualizaciones de Supabase seguirán online.")) return;
    CATALOG_STORE.saveProductOverrides({});
    window.dispatchEvent(new CustomEvent("catalog:products-updated"));
    setImportStatus("Cambios de vista previa local borrados.");
    showToast("Vista previa local borrada");
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
        if (!sku || (!name && !price)) return;
        rows.push({ sku, name, price });
      });
    });
    return rows;
  }

  function detectPriceListHeader(row) {
    const cells = row.map(normalizeHeaderCell);
    const sku = cells.findIndex((cell) => ["sku", "cod", "codigo", "articulo", "item"].includes(cell) || cell.includes("codigo"));
    const name = cells.findIndex((cell) => cell.includes("descripcion") || cell.includes("producto") || cell.includes("nombre") || cell.includes("detalle"));
    const price = cells.findIndex((cell) => cell.includes("precio") || cell === "pvp" || cell.includes("lista"));
    if (sku >= 0 && (name >= 0 || price >= 0)) return { sku, name, price };
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
        overrides[product.id] = override;
        updatedProductIds.add(product.id);
      });
    });

    return { overrides, updatedProducts: updatedProductIds.size, matchedRows, unmatched };
  }

  function buildProductSkuIndex() {
    const primary = new Map();
    const related = new Map();
    (window.CATALOG_DATA?.products || []).forEach((product) => {
      addSkuIndex(primary, product.sku, product);
      (product.skus || []).forEach((sku) => addSkuIndex(related, sku, product));
    });
    return { primary, related };
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

  async function renderOrders() {
    if (adminEls.adminApp.hidden) return;

    const result = await loadAdminOrders();
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
      adminState.orders.map(renderOrderCard).join("") || `<p class="empty-state">No se encontraron pedidos guardados para esta fuente.</p>`;

    adminEls.ordersList.querySelectorAll("[data-status]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          if (select.dataset.remote === "true") await CATALOG_SUPABASE.updateOrderStatus(select.dataset.status, select.value);
          else CATALOG_STORE.updateOrder(select.dataset.status, { status: select.value });
          await renderOrders();
          showToast(select.value === "sent" ? "Pedido archivado" : "Estado del pedido actualizado");
        } catch (error) {
          showToast(error.message || "No se pudo actualizar el pedido");
        }
      });
    });

    adminEls.ordersList.querySelectorAll("[data-delete-order]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este pedido guardado?")) return;
        try {
          if (button.dataset.remote === "true") await CATALOG_SUPABASE.deleteOrder(button.dataset.deleteOrder);
          else CATALOG_STORE.deleteOrder(button.dataset.deleteOrder);
          await renderOrders();
          showToast("Pedido eliminado");
        } catch (error) {
          showToast(error.message || "No se pudo eliminar el pedido");
        }
      });
    });
  }

  function renderOrderCard(order) {
    return `
      <article class="order-card">
        <div class="order-card-header">
          <div>
            <strong>${escapeHtml(order.displayId || order.id)}</strong>
            <p>${formatDate(order.createdAt)}${order.customer?.name ? ` - ${escapeHtml(order.customer.name)}` : ""}${order.customer?.phone ? ` - ${escapeHtml(order.customer.phone)}` : ""}</p>
          </div>
          <select data-status="${escapeHtml(order.id)}" data-remote="${order.remote ? "true" : "false"}">
            ${["placed", "confirmed", "packed", "sent", "cancelled"].map((status) => `<option value="${status}"${order.status === status ? " selected" : ""}>${orderStatusLabel(status)}</option>`).join("")}
          </select>
        </div>
        <div class="order-lines">
          ${order.items.map((item) => `<span>${item.qty} x ${escapeHtml(item.sku)} - ${escapeHtml(item.name)} - ${CATALOG_STORE.formatMoney(item.lineTotal)}</span>`).join("")}
        </div>
        ${order.customer?.notes ? `<p class="order-notes">${escapeHtml(order.customer.notes)}</p>` : ""}
        <div class="order-card-footer">
          <strong>${order.totalItems} unidades - ${CATALOG_STORE.formatMoney(order.totalValue)}</strong>
          <button class="secondary-button danger-button" type="button" data-delete-order="${escapeHtml(order.id)}" data-remote="${order.remote ? "true" : "false"}">Eliminar</button>
        </div>
      </article>
    `;
  }

  async function loadAdminOrders() {
    return loadAdminOrderSet(false);
  }

  async function loadAdminOrderSet(includeArchived) {
    if (!CATALOG_SUPABASE.isAvailable()) {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived ? "Supabase no está disponible; se exportan solo los pedidos locales del navegador." : "Supabase no está disponible; se muestran solo los pedidos locales del navegador.",
      };
    }

    const user = await CATALOG_SUPABASE.getUser();
    if (!user) {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? "Iniciá sesión desde el panel de perfil con tu cuenta administradora de Supabase para exportar todos los pedidos. Se exportan solo los pedidos locales del navegador."
          : "Iniciá sesión desde el panel de perfil con tu cuenta administradora de Supabase para ver todos los pedidos.",
      };
    }

    const profile = await CATALOG_SUPABASE.getProfile(user.id);
    if (profile?.role !== "admin") {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? `Sesión iniciada como ${user.email}, pero este perfil tiene rol "${profile?.role || "faltante"}". Definí role = 'admin' en Supabase para exportar todos los pedidos. Se exportan solo los pedidos locales del navegador.`
          : `Sesión iniciada como ${user.email}, pero este perfil tiene rol "${profile?.role || "faltante"}". Definí role = 'admin' en Supabase para ver todos los pedidos.`,
      };
    }

    try {
      return {
        orders: includeArchived ? await CATALOG_SUPABASE.loadAllOrders() : await CATALOG_SUPABASE.loadActiveOrders(),
        source: "supabase",
        message: includeArchived ? `Exportando todos los pedidos de Supabase como ${user.email}.` : `Mostrando pedidos activos de Supabase como ${user.email}. Los pedidos enviados se archivan.`,
      };
    } catch (error) {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? `No se pudieron cargar los pedidos de Supabase: ${error.message}. Se exportan solo los pedidos locales del navegador.`
          : `No se pudieron cargar los pedidos de Supabase: ${error.message}. Se muestran solo los pedidos locales del navegador.`,
      };
    }
  }

  async function exportOrdersCsv() {
    try {
      const result = await loadAdminOrderSet(false);
      const filename = `lexo-pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
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
    if (!confirm("¿Borrar todos los pedidos locales guardados en este dispositivo?")) return;
    CATALOG_STORE.saveOrders([]);
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
        orderStatusLabel(order.status || ""),
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

  function orderStatusLabel(status) {
    return {
      new: "nuevo",
      placed: "recibido",
      confirmed: "confirmado",
      packed: "preparado",
      sent: "enviado",
      cancelled: "cancelado",
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
