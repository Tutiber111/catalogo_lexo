(function () {
  const adminState = {
    catalog: CATALOG_STORE.applyProductOverrides(JSON.parse(JSON.stringify(window.CATALOG_DATA))),
    settings: CATALOG_STORE.loadSettings(),
    productOverrides: CATALOG_STORE.loadProductOverrides(),
    selectedProductId: null,
  };

  adminState.productsById = new Map(adminState.catalog.products.map((product) => [product.id, product]));

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
    orderSummary: document.querySelector("#orderSummary"),
    ordersList: document.querySelector("#ordersList"),
    exportOrders: document.querySelector("#exportOrders"),
    clearOrders: document.querySelector("#clearOrders"),
    productSearch: document.querySelector("#productSearch"),
    productSelect: document.querySelector("#productSelect"),
    productName: document.querySelector("#productName"),
    productCategory: document.querySelector("#productCategory"),
    productPrice: document.querySelector("#productPrice"),
    productHidden: document.querySelector("#productHidden"),
    saveProduct: document.querySelector("#saveProduct"),
    resetProduct: document.querySelector("#resetProduct"),
    exportAdjustments: document.querySelector("#exportAdjustments"),
    importAdjustments: document.querySelector("#importAdjustments"),
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
    adminEls.exportOrders.addEventListener("click", () => downloadJson("lexo-orders.json", CATALOG_STORE.loadOrders()));
    adminEls.clearOrders.addEventListener("click", clearOrders);
    adminEls.productSearch.addEventListener("input", renderProductOptions);
    adminEls.productSelect.addEventListener("change", () => selectProduct(adminEls.productSelect.value));
    adminEls.saveProduct.addEventListener("click", saveProduct);
    adminEls.resetProduct.addEventListener("click", resetProduct);
    adminEls.exportAdjustments.addEventListener("click", exportAdjustments);
    adminEls.importAdjustments.addEventListener("change", importAdjustments);
    window.addEventListener("catalog:orders-changed", renderOrders);
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
    renderProductOptions();
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

  function renderOrders() {
    if (adminEls.adminApp.hidden) return;

    const orders = CATALOG_STORE.loadOrders();
    const totalValue = orders.reduce((sum, order) => sum + Number(order.totalValue || 0), 0);
    const totalItems = orders.reduce((sum, order) => sum + Number(order.totalItems || 0), 0);

    adminEls.orderSummary.innerHTML = `
      <span><strong>${orders.length}</strong> orders</span>
      <span><strong>${totalItems}</strong> items</span>
      <span><strong>${CATALOG_STORE.formatMoney(totalValue)}</strong> total</span>
    `;

    adminEls.ordersList.innerHTML =
      orders
        .map(
          (order) => `
            <article class="order-card">
              <div class="order-card-header">
                <div>
                  <strong>${escapeHtml(order.id)}</strong>
                  <p>${formatDate(order.createdAt)}${order.customer?.name ? ` - ${escapeHtml(order.customer.name)}` : ""}${order.customer?.phone ? ` - ${escapeHtml(order.customer.phone)}` : ""}</p>
                </div>
                <select data-status="${escapeHtml(order.id)}">
                  ${["new", "confirmed", "packed", "sent", "cancelled"].map((status) => `<option value="${status}"${order.status === status ? " selected" : ""}>${status}</option>`).join("")}
                </select>
              </div>
              <div class="order-lines">
                ${order.items.map((item) => `<span>${item.qty} x ${escapeHtml(item.sku)} - ${escapeHtml(item.name)} - ${CATALOG_STORE.formatMoney(item.lineTotal)}</span>`).join("")}
              </div>
              ${order.customer?.notes ? `<p class="order-notes">${escapeHtml(order.customer.notes)}</p>` : ""}
              <div class="order-card-footer">
                <strong>${order.totalItems} items - ${CATALOG_STORE.formatMoney(order.totalValue)}</strong>
                <button class="secondary-button danger-button" type="button" data-delete-order="${escapeHtml(order.id)}">Delete</button>
              </div>
            </article>
          `,
        )
        .join("") || `<p class="empty-state">No saved orders yet.</p>`;

    adminEls.ordersList.querySelectorAll("[data-status]").forEach((select) => {
      select.addEventListener("change", () => {
        CATALOG_STORE.updateOrder(select.dataset.status, { status: select.value });
        showToast("Order status updated");
      });
    });

    adminEls.ordersList.querySelectorAll("[data-delete-order]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!confirm("Delete this saved order from this device?")) return;
        CATALOG_STORE.deleteOrder(button.dataset.deleteOrder);
        renderOrders();
        showToast("Order deleted");
      });
    });
  }

  function clearOrders() {
    if (!confirm("Clear all saved orders on this device?")) return;
    CATALOG_STORE.saveOrders([]);
    renderOrders();
    showToast("Orders cleared");
  }

  function renderProductOptions() {
    const query = adminEls.productSearch.value.trim().toLowerCase();
    const products = adminState.catalog.products
      .filter((product) => !query || searchFields(product).join(" ").toLowerCase().includes(query))
      .slice(0, 250);

    adminEls.productSelect.innerHTML = products
      .map((product) => `<option value="${product.id}">${escapeHtml(product.sku)} - ${escapeHtml(product.name)} - ${escapeHtml(product.price)}</option>`)
      .join("");

    if (!products.length) {
      clearProductForm();
      return;
    }

    const selectedStillVisible = products.some((product) => product.id === adminState.selectedProductId);
    selectProduct(selectedStillVisible ? adminState.selectedProductId : products[0].id);
  }

  function selectProduct(productId) {
    const product = adminState.productsById.get(productId);
    if (!product) return;

    adminState.selectedProductId = productId;
    adminEls.productSelect.value = productId;
    adminEls.productName.value = product.name;
    adminEls.productCategory.value = product.category || "";
    adminEls.productPrice.value = product.price || "";
    adminEls.productHidden.checked = Boolean(product.hidden);
  }

  function clearProductForm() {
    adminState.selectedProductId = null;
    adminEls.productName.value = "";
    adminEls.productCategory.value = "";
    adminEls.productPrice.value = "";
    adminEls.productHidden.checked = false;
  }

  function saveProduct() {
    const product = adminState.productsById.get(adminState.selectedProductId);
    if (!product) return;

    const override = {
      name: adminEls.productName.value.trim() || product.originalName,
      category: adminEls.productCategory.value.trim(),
      price: adminEls.productPrice.value.trim(),
      hidden: adminEls.productHidden.checked,
    };

    adminState.productOverrides[product.id] = override;
    CATALOG_STORE.saveProductOverrides(adminState.productOverrides);
    Object.assign(product, override);
    renderProductOptions();
    showToast("Product saved. Reload the catalog to see this adjustment.");
  }

  function resetProduct() {
    const product = adminState.productsById.get(adminState.selectedProductId);
    if (!product) return;

    delete adminState.productOverrides[product.id];
    CATALOG_STORE.saveProductOverrides(adminState.productOverrides);
    Object.assign(product, {
      name: product.originalName,
      category: product.originalCategory,
      price: product.originalPrice,
      hidden: false,
    });
    renderProductOptions();
    showToast("Product reset");
  }

  function exportAdjustments() {
    downloadJson("lexo-catalog-adjustments.json", {
      settings: CATALOG_STORE.loadSettings(),
      productOverrides: CATALOG_STORE.loadProductOverrides(),
    });
  }

  function importAdjustments(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.settings) CATALOG_STORE.saveSettings(data.settings);
        if (data.productOverrides) CATALOG_STORE.saveProductOverrides(data.productOverrides);
        location.reload();
      } catch (error) {
        showToast("Could not import that JSON file");
      }
    });
    reader.readAsText(file);
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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

  function searchFields(product) {
    return [product.name, product.sku, product.section, product.category, product.price, String(product.page), ...(product.skus || [])];
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
