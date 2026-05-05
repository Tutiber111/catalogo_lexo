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
        adminEls.loginMessage.textContent = "Incorrect password.";
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
      catalogLabel: adminEls.settingCatalogLabel.value.trim() || "Interactive catalog",
      whatsappNumber: adminEls.settingWhatsapp.value.trim(),
    };

    if (adminEls.settingPassword.value) {
      nextSettings.adminPasswordHash = await CATALOG_STORE.hashString(adminEls.settingPassword.value);
    }

    adminState.settings = CATALOG_STORE.saveSettings(nextSettings);
    document.querySelector("#brandName").textContent = adminState.settings.brandName;
    document.querySelector("#catalogLabel").textContent = adminState.settings.catalogLabel;
    adminEls.settingPassword.value = "";
    showToast("Settings saved");
  }

  async function importPriceList() {
    const file = adminEls.priceListFile.files?.[0];
    if (!file) {
      setImportStatus("Choose an Excel file first.");
      return;
    }
    if (!window.XLSX) {
      setImportStatus("Excel parser is still loading. Try again in a moment.");
      return;
    }

    try {
      adminEls.importPriceList.disabled = true;
      setImportStatus("Reading Excel file...");

      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const importedRows = readPriceListRows(workbook);
      const result = buildProductOverrides(importedRows);
      if (!result.updatedProducts) {
        setImportStatus(`No SKUs from this Excel file matched the catalog. ${result.unmatched} rows were not found.`);
        return;
      }

      const mergedLocal = CATALOG_STORE.mergeProductOverrides(CATALOG_STORE.loadProductOverrides(), result.overrides);
      CATALOG_STORE.saveProductOverrides(mergedLocal);

      let remoteMessage = "Saved as a local preview on this browser.";
      if (CATALOG_SUPABASE.isAvailable()) {
        try {
          const user = await CATALOG_SUPABASE.getUser();
          const profile = user ? await CATALOG_SUPABASE.getProfile(user.id) : null;
          if (profile?.role === "admin") {
            await CATALOG_SUPABASE.upsertProductOverrides(result.overrides);
            remoteMessage = "Saved to Supabase for everyone.";
          } else if (user) {
            remoteMessage = `Saved locally only. Supabase user ${user.email} is not an admin.`;
          } else {
            remoteMessage = "Saved locally only. Sign in from the profile panel with your admin Supabase account to update everyone.";
          }
        } catch (error) {
          remoteMessage = `Saved locally only. Supabase update failed: ${error.message}`;
        }
      }

      window.dispatchEvent(new CustomEvent("catalog:products-updated"));
      setImportStatus(`Updated ${result.updatedProducts} catalog products from ${result.matchedRows} matching Excel rows. ${result.unmatched} Excel rows were not found in the catalog. ${remoteMessage}`);
      showToast("Excel import complete");
    } catch (error) {
      setImportStatus(error.message || "Could not import Excel file.");
    } finally {
      adminEls.importPriceList.disabled = false;
    }
  }

  function clearLocalProductOverrides() {
    if (!confirm("Clear local product preview changes on this device? Supabase updates will remain online.")) return;
    CATALOG_STORE.saveProductOverrides({});
    window.dispatchEvent(new CustomEvent("catalog:products-updated"));
    setImportStatus("Local product preview changes cleared.");
    showToast("Local preview cleared");
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
      <span><strong>${adminState.orders.length}</strong> orders</span>
      <span><strong>${totalItems}</strong> items</span>
      <span><strong>${CATALOG_STORE.formatMoney(totalValue)}</strong> total</span>
    `;

    adminEls.ordersList.innerHTML =
      adminState.orders.map(renderOrderCard).join("") || `<p class="empty-state">No saved orders found for this source.</p>`;

    adminEls.ordersList.querySelectorAll("[data-status]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          if (select.dataset.remote === "true") await CATALOG_SUPABASE.updateOrderStatus(select.dataset.status, select.value);
          else CATALOG_STORE.updateOrder(select.dataset.status, { status: select.value });
          await renderOrders();
          showToast(select.value === "sent" ? "Order archived" : "Order status updated");
        } catch (error) {
          showToast(error.message || "Could not update order");
        }
      });
    });

    adminEls.ordersList.querySelectorAll("[data-delete-order]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Delete this saved order?")) return;
        try {
          if (button.dataset.remote === "true") await CATALOG_SUPABASE.deleteOrder(button.dataset.deleteOrder);
          else CATALOG_STORE.deleteOrder(button.dataset.deleteOrder);
          await renderOrders();
          showToast("Order deleted");
        } catch (error) {
          showToast(error.message || "Could not delete order");
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
            ${["placed", "confirmed", "packed", "sent", "cancelled"].map((status) => `<option value="${status}"${order.status === status ? " selected" : ""}>${status}</option>`).join("")}
          </select>
        </div>
        <div class="order-lines">
          ${order.items.map((item) => `<span>${item.qty} x ${escapeHtml(item.sku)} - ${escapeHtml(item.name)} - ${CATALOG_STORE.formatMoney(item.lineTotal)}</span>`).join("")}
        </div>
        ${order.customer?.notes ? `<p class="order-notes">${escapeHtml(order.customer.notes)}</p>` : ""}
        <div class="order-card-footer">
          <strong>${order.totalItems} items - ${CATALOG_STORE.formatMoney(order.totalValue)}</strong>
          <button class="secondary-button danger-button" type="button" data-delete-order="${escapeHtml(order.id)}" data-remote="${order.remote ? "true" : "false"}">Delete</button>
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
        message: includeArchived ? "Supabase is unavailable, exporting local browser orders only." : "Supabase is unavailable, showing local browser orders only.",
      };
    }

    const user = await CATALOG_SUPABASE.getUser();
    if (!user) {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? "Sign in from the profile panel with your admin Supabase account to export all customer orders. Exporting local browser orders only."
          : "Sign in from the profile panel with your admin Supabase account to see all customer orders.",
      };
    }

    const profile = await CATALOG_SUPABASE.getProfile(user.id);
    if (profile?.role !== "admin") {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? `Signed in as ${user.email}, but this profile is role "${profile?.role || "missing"}". Set role = 'admin' in Supabase to export all orders. Exporting local browser orders only.`
          : `Signed in as ${user.email}, but this profile is role "${profile?.role || "missing"}". Set role = 'admin' in Supabase to see all orders.`,
      };
    }

    try {
      return {
        orders: includeArchived ? await CATALOG_SUPABASE.loadAllOrders() : await CATALOG_SUPABASE.loadActiveOrders(),
        source: "supabase",
        message: includeArchived ? `Exporting all Supabase orders as ${user.email}.` : `Showing active Supabase orders as ${user.email}. Sent orders are archived.`,
      };
    } catch (error) {
      return {
        orders: includeArchived ? CATALOG_STORE.loadAllOrders() : CATALOG_STORE.loadOrders(),
        source: "local",
        message: includeArchived
          ? `Could not load Supabase orders: ${error.message}. Exporting local browser orders only.`
          : `Could not load Supabase orders: ${error.message}. Showing local browser orders only.`,
      };
    }
  }

  async function exportOrdersCsv() {
    try {
      const result = await loadAdminOrderSet(false);
      const filename = `lexo-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, ordersToCsv(result.orders));
      showToast(`Exported ${result.orders.length} orders`);
    } catch (error) {
      showToast(error.message || "Could not export orders");
    }
  }

  function clearLocalOrders() {
    if (adminState.source === "supabase") {
      showToast("Use individual delete buttons for Supabase orders.");
      return;
    }
    if (!confirm("Clear all saved local orders on this device?")) return;
    CATALOG_STORE.saveOrders([]);
    renderOrders();
    showToast("Local orders cleared");
  }

  function ordersToCsv(orders) {
    const headers = [
      "order_id",
      "order_number",
      "status",
      "created_at",
      "updated_at",
      "archived_at",
      "customer_name",
      "customer_phone",
      "notes",
      "total_items",
      "total_value",
      "item_sku",
      "item_name",
      "item_quantity",
      "item_unit_price",
      "item_line_total",
      "item_page",
    ];
    const rows = orders.flatMap((order) => {
      const items = order.items.length ? order.items : [{}];
      return items.map((item) => [
        order.id,
        order.displayId || "",
        order.status || "",
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
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
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
