const state = {
  catalog: null,
  currentIndex: 0,
  zoom: Number(localStorage.getItem("catalogZoom") || 100),
  productsById: new Map(),
  cart: new Map(JSON.parse(localStorage.getItem("catalogCart") || "[]")),
  settings: CATALOG_STORE.loadSettings(),
  user: null,
  profile: null,
};

const els = {
  brandName: document.querySelector("#brandName"),
  catalogLabel: document.querySelector("#catalogLabel"),
  catalogMeta: document.querySelector("#catalogMeta"),
  searchInput: document.querySelector("#searchInput"),
  pagesPanel: document.querySelector("#pagesPanel"),
  productsPanel: document.querySelector("#productsPanel"),
  pageTitle: document.querySelector("#pageTitle"),
  pageSubtitle: document.querySelector("#pageSubtitle"),
  pageFrame: document.querySelector("#pageFrame"),
  pageImage: document.querySelector("#pageImage"),
  hotspotLayer: document.querySelector("#hotspotLayer"),
  zoomSlider: document.querySelector("#zoomSlider"),
  zoomValue: document.querySelector("#zoomValue"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  openCart: document.querySelector("#openCart"),
  closeCart: document.querySelector("#closeCart"),
  cartDrawer: document.querySelector("#cartDrawer"),
  cartCount: document.querySelector("#cartCount"),
  cartItems: document.querySelector("#cartItems"),
  cartTotalItems: document.querySelector("#cartTotalItems"),
  cartTotalValue: document.querySelector("#cartTotalValue"),
  accountStatus: document.querySelector("#accountStatus"),
  authFields: document.querySelector("#authFields"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  authCompany: document.querySelector("#authCompany"),
  signIn: document.querySelector("#signIn"),
  createAccount: document.querySelector("#createAccount"),
  signOut: document.querySelector("#signOut"),
  customerOrders: document.querySelector("#customerOrders"),
  orderCustomerName: document.querySelector("#orderCustomerName"),
  orderCustomerPhone: document.querySelector("#orderCustomerPhone"),
  orderCustomerNotes: document.querySelector("#orderCustomerNotes"),
  saveOrder: document.querySelector("#saveOrder"),
  copyOrder: document.querySelector("#copyOrder"),
  whatsappOrder: document.querySelector("#whatsappOrder"),
  productDialog: document.querySelector("#productDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  toast: document.querySelector("#toast"),
};

async function init() {
  state.catalog = CATALOG_STORE.applyProductOverrides(window.CATALOG_DATA || (await fetchCatalog()));
  state.productsById = new Map(state.catalog.products.map((product) => [product.id, product]));

  const priceCount = state.catalog.priceList?.productCount || 0;
  els.catalogMeta.textContent = `${state.catalog.samplePageCount} pages · ${state.catalog.products.length} products · ${priceCount} Excel products`;
  els.brandName.textContent = state.settings.brandName;
  els.catalogLabel.textContent = state.settings.catalogLabel;
  loadCustomerDraft();
  bindEvents();
  await initAccount();
  renderTabs();
  renderAll();
}

async function fetchCatalog() {
  const response = await fetch("data/catalog.json");
  return response.json();
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector(`#${button.dataset.panel}`).classList.add("is-active");
    });
  });

  els.searchInput.addEventListener("input", renderLists);
  els.prevPage.addEventListener("click", () => goToPage(state.currentIndex - 1));
  els.nextPage.addEventListener("click", () => goToPage(state.currentIndex + 1));
  els.openCart.addEventListener("click", openCart);
  els.closeCart.addEventListener("click", closeCart);
  els.signIn.addEventListener("click", signIn);
  els.createAccount.addEventListener("click", createAccount);
  els.signOut.addEventListener("click", signOut);
  els.saveOrder.addEventListener("click", saveOrder);
  els.copyOrder.addEventListener("click", copyOrder);
  [els.orderCustomerName, els.orderCustomerPhone, els.orderCustomerNotes].forEach((input) => {
    input.addEventListener("input", saveCustomerDraft);
  });
  els.zoomSlider.addEventListener("input", () => {
    state.zoom = Number(els.zoomSlider.value);
    localStorage.setItem("catalogZoom", String(state.zoom));
    renderZoom();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") goToPage(state.currentIndex - 1);
    if (event.key === "ArrowRight") goToPage(state.currentIndex + 1);
  });
}

function renderTabs() {
  renderLists();
}

function renderLists() {
  const query = els.searchInput.value.trim().toLowerCase();
  const pages = state.catalog.pages.filter((page) => {
    if (!query) return true;
    const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
    return [page.title, page.section, String(page.number), ...products.flatMap(searchFields)].join(" ").toLowerCase().includes(query);
  });

  const products = state.catalog.products.filter((product) => isVisibleProduct(product) && searchFields(product).join(" ").toLowerCase().includes(query));

  els.pagesPanel.innerHTML = pages
    .map((page) => {
      const active = page.number === currentPage().number ? " is-active" : "";
      const count = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct).length;
      return `
        <button class="page-card${active}" type="button" data-page="${page.number}">
          <strong>Page ${page.number}</strong>
          <p>${escapeHtml(page.section || "Catalog")} · ${escapeHtml(page.title)} · ${count} product${count === 1 ? "" : "s"}</p>
        </button>
      `;
    })
    .join("");

  els.productsPanel.innerHTML =
    products
      .map(
        (product) => `
          <button class="product-card" type="button" data-product="${product.id}">
            <strong>${escapeHtml(product.name)}</strong>
            <p>${escapeHtml(product.section || "Catalog")} · ${escapeHtml(product.sku)} · ${escapeHtml(product.price)} · Page ${product.page}</p>
          </button>
        `,
      )
      .join("") || `<p>No matching products.</p>`;

  els.pagesPanel.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = state.catalog.pages.findIndex((page) => page.number === Number(button.dataset.page));
      goToPage(index);
    });
  });

  els.productsPanel.querySelectorAll("[data-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.productsById.get(button.dataset.product);
      const index = state.catalog.pages.findIndex((page) => page.number === product.page);
      goToPage(index);
      openProduct(product);
    });
  });
}

function renderAll() {
  renderZoom();
  renderPage();
  renderCart();
}

function renderZoom() {
  els.zoomSlider.value = String(state.zoom);
  els.zoomValue.textContent = `${state.zoom}%`;
  els.pageFrame.style.setProperty("--catalog-zoom", String(state.zoom / 100));
}

function renderPage() {
  const page = currentPage();
  const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);

  els.pageTitle.textContent = `Page ${page.number} · ${page.section || "Catalog"} · ${page.title}`;
  els.pageSubtitle.textContent = `${products.length} product${products.length === 1 ? "" : "s"} detected on this page`;
  els.pageImage.src = page.image.src;
  els.pageImage.alt = `Catalog page ${page.number}`;
  els.prevPage.disabled = state.currentIndex === 0;
  els.nextPage.disabled = state.currentIndex === state.catalog.pages.length - 1;

  els.hotspotLayer.innerHTML = products.map(renderHotspot).join("") + (page.priceGroups || []).map(renderPriceOverlay).join("");
  els.hotspotLayer.querySelectorAll(".hotspot, .price-overlay").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.product) openProduct(state.productsById.get(button.dataset.product));
      if (button.dataset.group) openPriceGroup(button.dataset.group);
    });
  });

  renderLists();
}

function renderHotspot(product) {
  const spot = product.hotspot;
  return `
    <button
      class="hotspot"
      type="button"
      data-product="${product.id}"
      aria-label="Open ${escapeHtml(product.name)}"
      style="left:${spot.x * 100}%;top:${spot.y * 100}%;width:${spot.w * 100}%;height:${spot.h * 100}%"
    >
      <span>+</span>
    </button>
  `;
}

function renderPriceOverlay(group) {
  if (!group.price || !group.position) return "";
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  if (!products.length) return "";
  const prices = [...new Set(products.map((product) => product.price).filter(Boolean))];
  const price = prices.length === 1 ? prices[0] : group.price;
  const pos = group.position;
  return `
    <button
      class="price-overlay"
      type="button"
      data-group="${group.id}"
      aria-label="Open products priced ${escapeHtml(price)}"
      style="left:${pos.x * 100}%;top:${pos.y * 100}%"
    >${escapeHtml(price)}</button>
  `;
}

function openPriceGroup(groupId) {
  const page = currentPage();
  const group = (page.priceGroups || []).find((item) => item.id === groupId);
  if (!group) return;
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  if (products.length === 1) {
    openProduct(products[0]);
    return;
  }
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">${escapeHtml(currentPage().title)}</span>
        <h2>${escapeHtml(group.label)}</h2>
      </div>
      <div class="price">${escapeHtml(group.price)}</div>
      <div class="group-list">
        ${products
          .map(
            (product) => `
              <div class="group-product">
                <div>
                  <span>${escapeHtml(product.name)}</span>
                  <strong>${escapeHtml(product.sku)}</strong>
                </div>
                <label class="dialog-qty">
                  <span>Qty</span>
                  <input type="number" min="1" step="1" value="1" inputmode="numeric" data-qty="${product.id}">
                </label>
                <button class="small-add-button" type="button" data-add="${product.id}">Add</button>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  els.dialogContent.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const qtyInput = els.dialogContent.querySelector(`[data-qty="${cssEscape(button.dataset.add)}"]`);
      addToCart(button.dataset.add, readQuantity(qtyInput));
      els.productDialog.close();
    });
  });
  els.productDialog.showModal();
}

function openProduct(product) {
  if (!product) return;
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h2>${escapeHtml(product.name)}</h2>
      </div>
      <div class="product-meta">
        <span>SKU: ${escapeHtml(product.sku)}</span>
        <span>Page ${product.page}</span>
        ${product.skus.length > 1 ? `<span>Related SKUs: ${product.skus.map(escapeHtml).join(", ")}</span>` : ""}
        ${product.ean ? `<span>EAN: ${escapeHtml(product.ean)}</span>` : ""}
        ${product.unitsPerCase ? `<span>UxC: ${escapeHtml(product.unitsPerCase)}</span>` : ""}
        <span>Price source: ${product.priceSource === "excel" ? "Excel list" : "PDF extraction"}</span>
      </div>
      <div class="price">${escapeHtml(product.price)}</div>
      <label class="dialog-qty dialog-qty-wide">
        <span>Quantity</span>
        <input id="productQty" type="number" min="1" step="1" value="1" inputmode="numeric">
      </label>
      <button class="primary-button" type="button" data-add="${product.id}">Add to cart</button>
    </div>
  `;
  els.dialogContent.querySelector("[data-add]").addEventListener("click", () => {
    addToCart(product.id, readQuantity(els.dialogContent.querySelector("#productQty")));
    els.productDialog.close();
  });
  els.productDialog.showModal();
}

function addToCart(productId, quantity = 1) {
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);
  state.cart.set(productId, (state.cart.get(productId) || 0) + qty);
  saveCart();
  renderCart();
  showToast(`${qty} added to cart`);
}

function updateQty(productId, delta) {
  const next = (state.cart.get(productId) || 0) + delta;
  if (next <= 0) state.cart.delete(productId);
  else state.cart.set(productId, next);
  saveCart();
  renderCart();
}

function renderCart() {
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isVisibleProduct(line.product));
  const total = lines.reduce((sum, line) => sum + line.qty, 0);
  const totalValue = lines.reduce((sum, line) => sum + priceNumber(line.product.price) * line.qty, 0);

  els.cartCount.textContent = total;
  els.cartTotalItems.textContent = total;
  els.cartTotalValue.textContent = formatMoney(totalValue);
  els.cartItems.innerHTML =
    lines
      .map(
        ({ product, qty }) => `
          <div class="cart-line">
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <p>${escapeHtml(product.sku)} · ${escapeHtml(product.price)} c/u · ${formatMoney(priceNumber(product.price) * qty)} · Page ${product.page}</p>
            </div>
            <div class="qty-controls" aria-label="Quantity controls">
              <button type="button" data-dec="${product.id}" aria-label="Decrease quantity">-</button>
              <span>${qty}</span>
              <button type="button" data-inc="${product.id}" aria-label="Increase quantity">+</button>
            </div>
          </div>
        `,
      )
      .join("") || `<p>Your cart is empty.</p>`;

  els.cartItems.querySelectorAll("[data-dec]").forEach((button) => {
    button.addEventListener("click", () => updateQty(button.dataset.dec, -1));
  });
  els.cartItems.querySelectorAll("[data-inc]").forEach((button) => {
    button.addEventListener("click", () => updateQty(button.dataset.inc, 1));
  });

  const orderText = buildOrderText(lines, readCustomerDraft());
  const whatsappNumber = CATALOG_STORE.normalizeWhatsAppNumber(CATALOG_STORE.loadSettings().whatsappNumber);
  els.saveOrder.disabled = !lines.length;
  els.copyOrder.disabled = !lines.length;
  els.whatsappOrder.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(orderText)}`;
}

function buildOrderText(lines, customer = {}) {
  if (!lines.length) return "Order draft is empty.";
  const totalValue = lines.reduce((sum, line) => sum + priceNumber(line.product.price) * line.qty, 0);
  return [
    "Catalog order draft",
    "",
    customer.name ? `Customer: ${customer.name}` : "",
    customer.phone ? `Phone: ${customer.phone}` : "",
    customer.notes ? `Notes: ${customer.notes}` : "",
    customer.name || customer.phone || customer.notes ? "" : "",
    ...lines.map(({ product, qty }) => `${qty} x ${product.sku} - ${product.name} - ${product.price} c/u - ${formatMoney(priceNumber(product.price) * qty)}`),
    "",
    `Total: ${formatMoney(totalValue)}`,
  ].filter((line, index, items) => line || items[index - 1]).join("\n");
}

async function saveOrder() {
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isVisibleProduct(line.product));
  if (!lines.length) {
    showToast("Add products before saving an order");
    return;
  }
  if (!readCustomerDraft().name.trim()) {
    els.orderCustomerName.focus();
    showToast("Add the customer's name before saving");
    return;
  }
  if (CATALOG_SUPABASE.isAvailable() && !state.user) {
    showToast("Sign in before saving the order");
    els.authEmail.focus();
    return;
  }

  const order = CATALOG_STORE.buildOrderFromLines(lines, readCustomerDraft());
  try {
    if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      await CATALOG_SUPABASE.saveOrder(order, state.user.id);
      await renderCustomerOrders();
    } else {
      CATALOG_STORE.addOrder(order);
    }
  } catch (error) {
    showToast(error.message || "Could not save order");
    return;
  }
  window.dispatchEvent(new CustomEvent("catalog:orders-changed"));
  state.cart.clear();
  saveCart();
  renderCart();
  showToast("Order saved");
}

async function copyOrder() {
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isVisibleProduct(line.product));
  await navigator.clipboard.writeText(buildOrderText(lines, readCustomerDraft()));
  showToast("Order copied");
}

function currentPage() {
  return state.catalog.pages[state.currentIndex];
}

function goToPage(index) {
  if (index < 0 || index >= state.catalog.pages.length) return;
  state.currentIndex = index;
  renderPage();
}

function openCart() {
  els.cartDrawer.classList.add("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  els.cartDrawer.classList.remove("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
}

function saveCart() {
  localStorage.setItem("catalogCart", JSON.stringify([...state.cart.entries()]));
}

function loadCustomerDraft() {
  const draft = JSON.parse(localStorage.getItem("catalogCustomerDraft") || "{}");
  els.orderCustomerName.value = draft.name || "";
  els.orderCustomerPhone.value = draft.phone || "";
  els.orderCustomerNotes.value = draft.notes || "";
}

function readCustomerDraft() {
  return {
    name: els.orderCustomerName.value,
    phone: els.orderCustomerPhone.value,
    notes: els.orderCustomerNotes.value,
  };
}

function saveCustomerDraft() {
  localStorage.setItem("catalogCustomerDraft", JSON.stringify(readCustomerDraft()));
}

async function initAccount() {
  if (!CATALOG_SUPABASE.isAvailable()) {
    els.accountStatus.textContent = "Accounts unavailable";
    return;
  }

  try {
    state.user = await CATALOG_SUPABASE.getUser();
    if (state.user) {
      state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
      applyProfileToCustomerFields();
    }
    renderAccount();
    await renderCustomerOrders();
  } catch (error) {
    els.accountStatus.textContent = "Account setup needed";
  }
}

async function signIn() {
  try {
    state.user = await CATALOG_SUPABASE.signIn(els.authEmail.value.trim(), els.authPassword.value);
    state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
    if (!state.profile) state.profile = await saveCustomerProfile();
    applyProfileToCustomerFields();
    renderAccount();
    await renderCustomerOrders();
    showToast("Signed in");
  } catch (error) {
    showToast(error.message || "Could not sign in");
  }
}

async function createAccount() {
  try {
    state.user = await CATALOG_SUPABASE.signUp({
      email: els.authEmail.value.trim(),
      password: els.authPassword.value,
      name: els.orderCustomerName.value,
      phone: els.orderCustomerPhone.value,
      company: els.authCompany.value,
    });
    state.profile = state.user ? await CATALOG_SUPABASE.getProfile(state.user.id) : null;
    renderAccount();
    await renderCustomerOrders();
    showToast("Account created. Check your email if confirmation is enabled.");
  } catch (error) {
    showToast(error.message || "Could not create account");
  }
}

async function signOut() {
  try {
    await CATALOG_SUPABASE.signOut();
    state.user = null;
    state.profile = null;
    renderAccount();
    await renderCustomerOrders();
    showToast("Signed out");
  } catch (error) {
    showToast(error.message || "Could not sign out");
  }
}

async function saveCustomerProfile() {
  if (!state.user) return null;
  state.profile = await CATALOG_SUPABASE.upsertProfile(state.user, {
    name: els.orderCustomerName.value,
    phone: els.orderCustomerPhone.value,
    company: els.authCompany.value,
  });
  return state.profile;
}

function applyProfileToCustomerFields() {
  if (!state.profile) return;
  els.orderCustomerName.value = state.profile.name || els.orderCustomerName.value;
  els.orderCustomerPhone.value = state.profile.phone || els.orderCustomerPhone.value;
  els.authCompany.value = state.profile.company || "";
  saveCustomerDraft();
}

function renderAccount() {
  const signedIn = Boolean(state.user);
  els.accountStatus.textContent = signedIn ? `Signed in as ${state.user.email}` : "Not signed in";
  els.authFields.hidden = signedIn;
  els.signOut.hidden = !signedIn;
}

async function renderCustomerOrders() {
  if (!state.user || !CATALOG_SUPABASE.isAvailable()) {
    els.customerOrders.innerHTML = "";
    return;
  }

  try {
    const orders = await CATALOG_SUPABASE.loadMyOrders(state.user.id);
    els.customerOrders.innerHTML =
      orders
        .slice(0, 5)
        .map(
          (order) => `
            <div class="customer-order-line">
              <strong>${escapeHtml(order.displayId || order.id)}</strong>
              <span>${escapeHtml(order.status)} - ${formatMoney(order.totalValue)}</span>
            </div>
          `,
        )
        .join("") || `<p>No previous orders yet.</p>`;
  } catch (error) {
    els.customerOrders.innerHTML = `<p>Run the Supabase setup SQL to enable order history.</p>`;
  }
}

function isVisibleProduct(product) {
  return Boolean(product && !product.hidden);
}

function readQuantity(input) {
  return Math.max(1, Number.parseInt(input?.value || "1", 10) || 1);
}

function priceNumber(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return Number(digits || 0);
}

function formatMoney(value) {
  return "$" + Math.round(value).toLocaleString("es-AR");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function searchFields(product) {
  return [product.name, product.sku, product.section, product.category, product.price, String(product.page), ...(product.skus || [])];
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  console.error(error);
  els.catalogMeta.textContent = "Could not load catalog data.";
});
