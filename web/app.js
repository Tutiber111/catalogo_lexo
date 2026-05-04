const state = {
  catalog: null,
  currentIndex: 0,
  zoom: Number(localStorage.getItem("catalogZoom") || 100),
  brandFilter: localStorage.getItem("catalogBrandFilter") || "all",
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
  brandTabs: document.querySelector("#brandTabs"),
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
  openAccount: document.querySelector("#openAccount"),
  closeAccount: document.querySelector("#closeAccount"),
  cartDrawer: document.querySelector("#cartDrawer"),
  accountDrawer: document.querySelector("#accountDrawer"),
  cartCount: document.querySelector("#cartCount"),
  cartItems: document.querySelector("#cartItems"),
  cartTotalItems: document.querySelector("#cartTotalItems"),
  cartTotalValue: document.querySelector("#cartTotalValue"),
  accountStatus: document.querySelector("#accountStatus"),
  authFields: document.querySelector("#authFields"),
  signInForm: document.querySelector("#signInForm"),
  createAccountForm: document.querySelector("#createAccountForm"),
  forgotPasswordForm: document.querySelector("#forgotPasswordForm"),
  newPasswordForm: document.querySelector("#newPasswordForm"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  createEmail: document.querySelector("#createEmail"),
  createPassword: document.querySelector("#createPassword"),
  resetEmail: document.querySelector("#resetEmail"),
  newPassword: document.querySelector("#newPassword"),
  authName: document.querySelector("#authName"),
  authPhone: document.querySelector("#authPhone"),
  authCompany: document.querySelector("#authCompany"),
  authMessage: document.querySelector("#authMessage"),
  signIn: document.querySelector("#signIn"),
  showCreateAccount: document.querySelector("#showCreateAccount"),
  showSignIn: document.querySelector("#showSignIn"),
  showForgotPassword: document.querySelector("#showForgotPassword"),
  showSignInFromReset: document.querySelector("#showSignInFromReset"),
  showSignInFromNewPassword: document.querySelector("#showSignInFromNewPassword"),
  createAccount: document.querySelector("#createAccount"),
  sendPasswordReset: document.querySelector("#sendPasswordReset"),
  updatePassword: document.querySelector("#updatePassword"),
  signOut: document.querySelector("#signOut"),
  customerOrders: document.querySelector("#customerOrders"),
  customerOrderDetail: document.querySelector("#customerOrderDetail"),
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
  bindEvents();
  renderBrandTabs();
  ensureCurrentPageMatchesBrand();
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
  els.prevPage.addEventListener("click", () => goToAdjacentVisiblePage(-1));
  els.nextPage.addEventListener("click", () => goToAdjacentVisiblePage(1));
  els.openCart.addEventListener("click", openCart);
  els.closeCart.addEventListener("click", closeCart);
  els.openAccount.addEventListener("click", openAccount);
  els.closeAccount.addEventListener("click", closeAccount);
  els.signIn.addEventListener("click", signIn);
  els.showCreateAccount.addEventListener("click", showCreateAccount);
  els.showSignIn.addEventListener("click", showSignIn);
  els.showForgotPassword.addEventListener("click", showForgotPassword);
  els.showSignInFromReset.addEventListener("click", showSignIn);
  els.showSignInFromNewPassword.addEventListener("click", showSignIn);
  els.createAccount.addEventListener("click", createAccount);
  els.sendPasswordReset.addEventListener("click", sendPasswordReset);
  els.updatePassword.addEventListener("click", updatePassword);
  els.signOut.addEventListener("click", signOut);
  els.saveOrder.addEventListener("click", saveOrder);
  els.copyOrder.addEventListener("click", copyOrder);
  window.addEventListener("catalog:password-recovery", () => {
    openAccount();
    showNewPassword();
  });
  els.zoomSlider.addEventListener("input", () => {
    state.zoom = Number(els.zoomSlider.value);
    localStorage.setItem("catalogZoom", String(state.zoom));
    renderZoom();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") goToAdjacentVisiblePage(-1);
    if (event.key === "ArrowRight") goToAdjacentVisiblePage(1);
  });
}

function renderTabs() {
  renderLists();
}

function renderBrandTabs() {
  const brands = [...new Set(state.catalog.pages.map((page) => page.section).filter(Boolean))];
  els.brandTabs.innerHTML = [
    { id: "all", label: "All" },
    ...brands.map((brand) => ({ id: brand, label: brand })),
  ]
    .map(
      (brand) => `
        <button class="brand-tab${state.brandFilter === brand.id ? " is-active" : ""}" type="button" data-brand="${escapeHtml(brand.id)}">
          ${escapeHtml(brand.label)}
        </button>
      `,
    )
    .join("");

  els.brandTabs.querySelectorAll("[data-brand]").forEach((button) => {
    button.addEventListener("click", () => {
      state.brandFilter = button.dataset.brand;
      localStorage.setItem("catalogBrandFilter", state.brandFilter);
      renderBrandTabs();
      goToFirstVisiblePage();
    });
  });
}

function renderLists() {
  const query = els.searchInput.value.trim().toLowerCase();
  const pages = visiblePages().filter((page) => {
    if (!query) return true;
    const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
    return [page.title, page.section, String(page.number), ...products.flatMap(searchFields)].join(" ").toLowerCase().includes(query);
  });

  const products = state.catalog.products.filter(
    (product) => brandMatches(product.section) && isVisibleProduct(product) && searchFields(product).join(" ").toLowerCase().includes(query),
  );

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
  const visibleIndexes = visiblePageIndexes();
  const visiblePosition = visibleIndexes.indexOf(state.currentIndex);
  els.prevPage.disabled = visiblePosition <= 0;
  els.nextPage.disabled = visiblePosition < 0 || visiblePosition === visibleIndexes.length - 1;

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
                <div class="dialog-qty">
                  <span>Qty</span>
                  <div class="quantity-stepper quantity-stepper-compact">
                    <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Decrease quantity">-</button>
                    <input type="number" min="1" step="1" value="1" inputmode="numeric" data-qty="${product.id}">
                    <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Increase quantity">+</button>
                  </div>
                </div>
                <button class="small-add-button" type="button" data-add="${product.id}">Add</button>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  bindDialogQuantitySteppers();
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
      <div class="dialog-qty dialog-qty-wide">
        <span>Quantity</span>
        <div class="quantity-stepper">
          <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Decrease quantity">-</button>
          <input id="productQty" type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="Quantity">
          <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <button class="primary-button" type="button" data-add="${product.id}">Add to cart</button>
    </div>
  `;
  bindDialogQuantitySteppers();
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

  const orderText = buildOrderText(lines, readAccountCustomer());
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
  if (CATALOG_SUPABASE.isAvailable() && !state.user) {
    showToast("Sign in before saving the order");
    openAccount();
    return;
  }

  let customer = readAccountCustomer();
  try {
    if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      customer = readAccountCustomer();
      const order = CATALOG_STORE.buildOrderFromLines(lines, customer);
      await CATALOG_SUPABASE.saveOrder(order, state.user.id);
      await renderCustomerOrders();
    } else {
      const order = CATALOG_STORE.buildOrderFromLines(lines, customer);
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
  await navigator.clipboard.writeText(buildOrderText(lines, readAccountCustomer()));
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

function goToFirstVisiblePage() {
  const index = state.catalog.pages.findIndex((page) => brandMatches(page.section));
  if (index >= 0) goToPage(index);
  else renderLists();
}

function ensureCurrentPageMatchesBrand() {
  if (!brandMatches(currentPage().section)) goToFirstVisiblePage();
}

function goToAdjacentVisiblePage(delta) {
  const visibleIndexes = visiblePageIndexes();
  const visiblePosition = visibleIndexes.indexOf(state.currentIndex);
  const nextPosition = visiblePosition + delta;
  if (nextPosition < 0 || nextPosition >= visibleIndexes.length) return;
  goToPage(visibleIndexes[nextPosition]);
}

function visiblePages() {
  return state.catalog.pages.filter((page) => brandMatches(page.section));
}

function visiblePageIndexes() {
  return state.catalog.pages.map((page, index) => (brandMatches(page.section) ? index : -1)).filter((index) => index >= 0);
}

function brandMatches(brand) {
  return state.brandFilter === "all" || brand === state.brandFilter;
}

function openCart() {
  closeAccount();
  els.cartDrawer.classList.add("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  els.cartDrawer.classList.remove("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
}

function openAccount() {
  closeCart();
  els.accountDrawer.classList.add("is-open");
  els.accountDrawer.setAttribute("aria-hidden", "false");
  if (!state.user) els.authEmail.focus();
}

function closeAccount() {
  els.accountDrawer.classList.remove("is-open");
  els.accountDrawer.setAttribute("aria-hidden", "true");
}

function saveCart() {
  localStorage.setItem("catalogCart", JSON.stringify([...state.cart.entries()]));
}

function readAccountCustomer() {
  const name = state.profile?.name || els.authName.value || state.user?.email || "";
  const phone = state.profile?.phone || els.authPhone.value || "";
  return {
    name,
    phone,
    notes: "",
  };
}

async function initAccount() {
  els.authEmail.value = localStorage.getItem("catalogLastEmail") || "";
  els.createEmail.value = els.authEmail.value;
  els.resetEmail.value = els.authEmail.value;
  if (!CATALOG_SUPABASE.isAvailable()) {
    els.accountStatus.textContent = "Accounts unavailable";
    return;
  }

  try {
    state.user = await CATALOG_SUPABASE.getUser();
    if (state.user) {
      state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
      applyProfileToAuthFields();
    }
    renderAccount();
    await renderCustomerOrders();
  } catch (error) {
    els.accountStatus.textContent = "Account setup needed";
  }

  const authHash = readAuthHash();
  if (authHash.error) {
    openAccount();
    showForgotPassword();
    els.authMessage.textContent = friendlyRecoveryError(authHash);
  } else if (location.hash === "#reset-password" || authHash.type === "recovery" || authHash.access_token || authHash.code) {
    openAccount();
    showNewPassword();
  }
}

async function signIn() {
  try {
    clearAuthMessage();
    rememberAuthEmail();
    state.user = await CATALOG_SUPABASE.signIn(els.authEmail.value.trim(), els.authPassword.value);
    state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
    if (!state.profile) state.profile = await saveCustomerProfile();
    applyProfileToAuthFields();
    renderAccount();
    await renderCustomerOrders();
    showToast("Signed in");
  } catch (error) {
    showAuthError(error);
  }
}

async function createAccount() {
  try {
    clearAuthMessage();
    els.authEmail.value = els.createEmail.value.trim();
    rememberAuthEmail();
    state.user = await CATALOG_SUPABASE.signUp({
      email: els.createEmail.value.trim(),
      password: els.createPassword.value,
      name: els.authName.value,
      phone: els.authPhone.value,
      company: els.authCompany.value,
    });
    state.profile = state.user ? await CATALOG_SUPABASE.getProfile(state.user.id) : null;
    renderAccount();
    await renderCustomerOrders();
    showToast("Account created. Check your email if confirmation is enabled.");
  } catch (error) {
    showAuthError(error);
  }
}

function rememberAuthEmail() {
  localStorage.setItem("catalogLastEmail", els.authEmail.value.trim());
}

function showCreateAccount() {
  clearAuthMessage();
  els.createEmail.value = els.authEmail.value.trim();
  els.createPassword.value = els.authPassword.value;
  setAuthMode("creating");
  els.createEmail.focus();
}

function showSignIn() {
  clearAuthMessage();
  els.authEmail.value = els.createEmail.value.trim() || els.authEmail.value;
  els.authPassword.value = "";
  els.createPassword.value = "";
  els.newPassword.value = "";
  history.replaceState(null, "", location.pathname);
  setAuthMode("signin");
  els.authEmail.focus();
}

function showForgotPassword() {
  clearAuthMessage();
  els.resetEmail.value = els.authEmail.value.trim();
  setAuthMode("forgot");
  els.resetEmail.focus();
}

function showNewPassword() {
  clearAuthMessage();
  setAuthMode("new-password");
  els.authFields.classList.remove("is-hidden");
  els.signOut.classList.add("is-hidden");
  els.accountStatus.textContent = "Reset your password";
  els.authMessage.textContent = "Enter a new password to finish the reset.";
  els.newPassword.focus();
}

function setAuthMode(mode) {
  els.authFields.dataset.mode = mode;
}

async function sendPasswordReset() {
  try {
    clearAuthMessage();
    await CATALOG_SUPABASE.sendPasswordReset(els.resetEmail.value.trim());
    els.authMessage.textContent = "Password reset email sent. Use the link in that email to set a new password.";
    els.authEmail.value = els.resetEmail.value.trim();
    rememberAuthEmail();
  } catch (error) {
    showAuthError(error);
  }
}

async function updatePassword() {
  try {
    clearAuthMessage();
    state.user = await CATALOG_SUPABASE.updatePassword(els.newPassword.value);
    state.profile = state.user ? await CATALOG_SUPABASE.getProfile(state.user.id) : null;
    els.newPassword.value = "";
    setAuthMode("signin");
    renderAccount();
    await renderCustomerOrders();
    history.replaceState(null, "", location.pathname + location.search);
    showToast("Password updated");
  } catch (error) {
    showAuthError(error);
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
    name: els.authName.value,
    phone: els.authPhone.value,
    company: els.authCompany.value,
  });
  applyProfileToAuthFields();
  return state.profile;
}

function applyProfileToAuthFields() {
  if (!state.profile) return;
  els.authName.value = state.profile.name || els.authName.value;
  els.authPhone.value = state.profile.phone || els.authPhone.value;
  els.authCompany.value = state.profile.company || "";
}

function renderAccount() {
  const signedIn = Boolean(state.user);
  const resettingPassword = els.authFields.dataset.mode === "new-password";
  els.accountStatus.textContent = signedIn ? `Signed in as ${state.user.email}` : "Not signed in";
  els.authFields.classList.toggle("is-hidden", signedIn && !resettingPassword);
  els.signOut.classList.toggle("is-hidden", !signedIn || resettingPassword);
  els.openAccount.classList.toggle("is-signed-in", signedIn);
}

function clearAuthMessage() {
  els.authMessage.textContent = "";
}

function showAuthError(error) {
  const message = friendlyAuthError(error);
  els.authMessage.textContent = message;
  showToast(message);
}

function friendlyAuthError(error) {
  const message = String(error?.message || "Could not complete account action");
  if (message.toLowerCase().includes("email") && message.toLowerCase().includes("limit")) {
    return "Supabase email limit reached. For local testing, disable Confirm email in Supabase Auth > Providers > Email, or configure custom SMTP.";
  }
  if (message.toLowerCase().includes("email not confirmed")) {
    return "Email is not confirmed yet. Disable Confirm email for local testing, or use the confirmation email.";
  }
  return message;
}

function readAuthHash() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  return {
    access_token: params.get("access_token"),
    code: params.get("code") || new URLSearchParams(location.search).get("code"),
    error: params.get("error"),
    error_code: params.get("error_code"),
    error_description: params.get("error_description"),
    type: params.get("type"),
  };
}

function friendlyRecoveryError(authHash) {
  if (authHash.error_code === "otp_expired") {
    return "That reset link is invalid or expired. Send a new reset email and use the newest link only once.";
  }
  return authHash.error_description?.replaceAll("+", " ") || "Could not use that reset link. Send a new reset email.";
}

async function renderCustomerOrders() {
  if (!state.user || !CATALOG_SUPABASE.isAvailable()) {
    els.customerOrders.innerHTML = "";
    els.customerOrderDetail.hidden = true;
    return;
  }

  try {
    const orders = await CATALOG_SUPABASE.loadMyOrders(state.user.id);
    state.customerOrders = orders;
    els.customerOrderDetail.hidden = true;
    els.customerOrders.hidden = false;
    els.customerOrders.innerHTML =
      orders
        .slice(0, 5)
        .map(
          (order) => `
            <button class="customer-order-line" type="button" data-order="${escapeHtml(order.id)}">
              <strong>${escapeHtml(order.displayId || order.id)}</strong>
              <span>${escapeHtml(order.status)} - ${formatMoney(order.totalValue)}</span>
            </button>
          `,
        )
        .join("") || `<p>No previous orders yet.</p>`;
    els.customerOrders.querySelectorAll("[data-order]").forEach((button) => {
      button.addEventListener("click", () => showCustomerOrderDetail(button.dataset.order));
    });
  } catch (error) {
    els.customerOrders.innerHTML = `<p>Run the Supabase setup SQL to enable order history.</p>`;
  }
}

function showCustomerOrderDetail(orderId) {
  const order = (state.customerOrders || []).find((item) => item.id === orderId);
  if (!order) return;

  els.customerOrders.hidden = true;
  els.customerOrderDetail.hidden = false;
  els.customerOrderDetail.innerHTML = `
    <button id="backToOrders" class="secondary-button compact-button" type="button">Back to orders</button>
    <div class="customer-order-detail-header">
      <span class="eyebrow">Order</span>
      <h3>${escapeHtml(order.displayId || order.id)}</h3>
      <p>${escapeHtml(order.status)} - ${new Date(order.createdAt).toLocaleString()}</p>
    </div>
    <div class="customer-order-items">
      ${order.items
        .map(
          (item) => `
            <div class="customer-order-item">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.sku)} - Page ${escapeHtml(item.page || "")}</span>
              </div>
              <span>${item.qty} x ${escapeHtml(item.price)} = ${formatMoney(item.lineTotal)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="cart-total cart-total-value">
      <span>Total</span>
      <strong>${formatMoney(order.totalValue)}</strong>
    </div>
  `;
  els.customerOrderDetail.querySelector("#backToOrders").addEventListener("click", () => {
    els.customerOrderDetail.hidden = true;
    els.customerOrders.hidden = false;
  });
}

function isVisibleProduct(product) {
  return Boolean(product && !product.hidden);
}

function readQuantity(input) {
  return Math.max(1, Number.parseInt(input?.value || "1", 10) || 1);
}

function bindDialogQuantitySteppers() {
  els.dialogContent.querySelectorAll("[data-qty-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.closest(".quantity-stepper")?.querySelector("input");
      if (!input) return;
      const step = Number(button.dataset.qtyStep);
      const current = Number.parseInt(input.value, 10);
      const next = (Number.isNaN(current) ? (step > 0 ? 0 : 1) : current) + step;
      input.value = String(Math.max(1, next));
      input.focus();
    });
  });
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
