const state = {
  catalog: null,
  currentIndex: 0,
  zoom: Number(localStorage.getItem("catalogZoom") || 100),
  brandFilter: localStorage.getItem("catalogBrandFilter") || "all",
  productsById: new Map(),
  productOverrides: {},
  cart: new Map(JSON.parse(localStorage.getItem("catalogCart") || "[]")),
  settings: CATALOG_STORE.loadSettings(),
  user: null,
  profile: null,
};

let pageScrollFrame = 0;

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
  pageStage: document.querySelector(".page-stage"),
  pageStrip: document.querySelector("#pageStrip"),
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
  cartClientName: document.querySelector("#cartClientName"),
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
  await loadCatalogData();

  els.brandName.textContent = state.settings.brandName;
  els.catalogLabel.textContent = state.settings.catalogLabel;
  els.cartClientName.value = localStorage.getItem("catalogCartClientName") || "";
  bindEvents();
  renderBrandTabs();
  ensureCurrentPageMatchesBrand();
  await initAccount();
  renderTabs();
  renderAll();
}

async function fetchCatalog() {
  const response = await fetch("data/catalog.json", { cache: "no-store" });
  return response.json();
}

async function loadCatalogData() {
  const rawCatalog = window.CATALOG_DATA || (await fetchCatalog());
  const baseCatalog = cloneCatalog(rawCatalog);
  const localOverrides = CATALOG_STORE.loadProductOverrides();
  let remoteOverrides = {};

  if (CATALOG_SUPABASE.isAvailable()) {
    try {
      remoteOverrides = await CATALOG_SUPABASE.loadProductOverrides();
    } catch (error) {
      console.warn("Could not load remote product overrides", error);
    }
  }

  state.productOverrides = CATALOG_STORE.mergeProductOverrides(localOverrides, remoteOverrides);
  state.catalog = CATALOG_STORE.applyProductOverrides(baseCatalog, state.productOverrides);
  state.productsById = new Map(state.catalog.products.map((product) => [product.id, product]));
  updateCatalogMeta();
}

function cloneCatalog(catalog) {
  if (typeof structuredClone === "function") return structuredClone(catalog);
  return JSON.parse(JSON.stringify(catalog));
}

function updateCatalogMeta() {
  const priceCount = state.catalog.priceList?.productCount || 0;
  els.catalogMeta.textContent = `${state.catalog.samplePageCount} pages - ${state.catalog.products.length} products - ${priceCount} Excel products`;
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
  els.pageStage.addEventListener("scroll", handlePageStageScroll, { passive: true });
  els.pageStrip.addEventListener("click", handlePageStripClick);
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
  els.cartClientName.addEventListener("input", () => {
    localStorage.setItem("catalogCartClientName", els.cartClientName.value);
    renderCart();
  });
  window.addEventListener("catalog:password-recovery", () => {
    openAccount();
    showNewPassword();
  });
  window.addEventListener("catalog:products-updated", async () => {
    await loadCatalogData();
    renderBrandTabs();
    ensureCurrentPageMatchesBrand();
    renderAll();
    showToast("Catalog products updated");
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

function handlePageStageScroll() {
  if (pageScrollFrame) return;

  pageScrollFrame = requestAnimationFrame(() => {
    pageScrollFrame = 0;
    updateCurrentPageFromScroll();
  });
}

function handlePageStripClick(event) {
  const button = event.target.closest(".hotspot, .price-overlay");
  if (!button || !els.pageStrip.contains(button)) return;

  const frame = button.closest("[data-page-index]");
  const pageIndex = frame ? Number(frame.dataset.pageIndex) : state.currentIndex;
  setCurrentPageIndex(pageIndex);

  if (button.dataset.product) openProduct(state.productsById.get(button.dataset.product));
  if (button.dataset.group) openPriceGroup(button.dataset.group, pageIndex);
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
  els.pageStage.style.setProperty("--catalog-zoom", String(state.zoom / 100));
}

function renderPage() {
  renderViewerPages();
  renderCurrentPageDetails();
  renderLists();
  scrollPageIntoView(state.currentIndex, "auto");
}

function renderViewerPages() {
  els.pageStrip.innerHTML = visiblePageIndexes()
    .map((index) => renderPageFrame(state.catalog.pages[index], index))
    .join("");
}

function renderPageFrame(page, index) {
  const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);

  return `
    <article class="page-frame" data-page-index="${index}" aria-label="Catalog page ${page.number}">
      <img src="${escapeHtml(page.image.src)}" alt="Catalog page ${page.number}" loading="lazy" decoding="async">
      <div class="hotspot-layer">
        ${products.map(renderHotspot).join("")}
        ${(page.priceGroups || []).map(renderPriceOverlay).join("")}
      </div>
    </article>
  `;
}

function renderCurrentPageDetails() {
  const page = currentPage();
  const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);

  els.pageTitle.textContent = `Page ${page.number} - ${page.section || "Catalog"} - ${page.title}`;
  els.pageSubtitle.textContent = `${products.length} product${products.length === 1 ? "" : "s"} detected on this page`;
  const visibleIndexes = visiblePageIndexes();
  const visiblePosition = visibleIndexes.indexOf(state.currentIndex);
  els.prevPage.disabled = visiblePosition <= 0;
  els.nextPage.disabled = visiblePosition < 0 || visiblePosition === visibleIndexes.length - 1;
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
  const cover = group.cover || {};
  const overlayStyle = group.style || {};
  const coverStyle = [
    `left:${pos.x * 100}%`,
    `top:${pos.y * 100}%`,
    cover.w ? `--cover-w:${cover.w * 100}%` : "",
    cover.h ? `--cover-h:${cover.h * 100}%` : "",
    overlayStyle.fontSize ? `--price-font-size:${overlayStyle.fontSize}px` : "",
    overlayStyle.minWidth ? `--price-min-width:${overlayStyle.minWidth}px` : "",
    overlayStyle.minHeight ? `--price-min-height:${overlayStyle.minHeight}px` : "",
    overlayStyle.padX !== undefined ? `--price-pad-x:${overlayStyle.padX}px` : "",
    overlayStyle.padY !== undefined ? `--price-pad-y:${overlayStyle.padY}px` : "",
    overlayStyle.radius !== undefined ? `--price-radius:${overlayStyle.radius}px` : "",
    overlayStyle.shadow ? `--price-shadow:${overlayStyle.shadow}` : "",
    overlayStyle.color ? `--price-color:${overlayStyle.color}` : "",
  ].filter(Boolean).join(";");
  const variantClass = group.variant ? ` price-overlay--${escapeAttribute(group.variant)}` : "";
  return `
    <button
      class="price-overlay${variantClass}"
      type="button"
      data-group="${group.id}"
      aria-label="Open products priced ${escapeHtml(price)}"
      style="${coverStyle}"
    >${escapeHtml(price)}</button>
  `;
}

function openPriceGroup(groupId, pageIndex = state.currentIndex) {
  const page = state.catalog.pages[pageIndex] || currentPage();
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
        <span class="eyebrow">${escapeHtml(page.title)}</span>
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
                  <strong class="dialog-line-total" data-total-for="${product.id}">Total ${formatMoney(priceNumber(product.price))}</strong>
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
      <div class="dialog-total" data-total-for="${product.id}">
        <span>Total</span>
        <strong>${formatMoney(priceNumber(product.price))}</strong>
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

  const orderText = buildOrderText(lines, readOrderCustomer());
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

  let customer = readOrderCustomer();
  try {
    if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      customer = readOrderCustomer();
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
  els.cartClientName.value = "";
  localStorage.removeItem("catalogCartClientName");
  saveCart();
  renderCart();
  showToast("Order saved");
}

async function copyOrder() {
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isVisibleProduct(line.product));
  await navigator.clipboard.writeText(buildOrderText(lines, readOrderCustomer()));
  showToast("Order copied");
}

function currentPage() {
  return state.catalog.pages[state.currentIndex];
}

function goToPage(index) {
  if (index < 0 || index >= state.catalog.pages.length) return;
  const needsRender = !els.pageStrip.querySelector(`[data-page-index="${index}"]`);
  setCurrentPageIndex(index);

  if (needsRender) renderPage();
  else scrollPageIntoView(index);
}

function goToFirstVisiblePage() {
  const index = state.catalog.pages.findIndex((page) => brandMatches(page.section));
  if (index >= 0) {
    state.currentIndex = index;
    renderPage();
  }
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

function setCurrentPageIndex(index) {
  if (index < 0 || index >= state.catalog.pages.length || index === state.currentIndex) return;
  state.currentIndex = index;
  renderCurrentPageDetails();
  renderLists();
}

function updateCurrentPageFromScroll() {
  const frames = [...els.pageStrip.querySelectorAll("[data-page-index]")];
  if (!frames.length) return;

  const stageRect = els.pageStage.getBoundingClientRect();
  const marker = stageRect.top + Math.min(140, stageRect.height * 0.28);
  const frame = frames.find((item) => item.getBoundingClientRect().bottom >= marker) || frames[frames.length - 1];
  setCurrentPageIndex(Number(frame.dataset.pageIndex));
}

function scrollPageIntoView(index, behavior = "smooth") {
  const frame = els.pageStrip.querySelector(`[data-page-index="${index}"]`);
  if (!frame) return;
  frame.scrollIntoView({ behavior, block: "start", inline: "nearest" });
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

function readOrderCustomer() {
  const accountCustomer = readAccountCustomer();
  return {
    ...accountCustomer,
    name: els.cartClientName.value.trim() || accountCustomer.name,
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
  } else if (
    CATALOG_SUPABASE.isRecoveryMode() ||
    location.hash === "#reset-password" ||
    authHash.type === "recovery" ||
    authHash.access_token ||
    authHash.code
  ) {
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
  CATALOG_SUPABASE.clearRecoveryMode();
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
    CATALOG_SUPABASE.clearRecoveryMode();
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
      updateDialogTotals();
    });
  });
  els.dialogContent.querySelectorAll("input[type='number']").forEach((input) => {
    input.addEventListener("input", updateDialogTotals);
    input.addEventListener("change", () => {
      input.value = String(readQuantity(input));
      updateDialogTotals();
    });
  });
  updateDialogTotals();
}

function updateDialogTotals() {
  els.dialogContent.querySelectorAll("[data-total-for]").forEach((total) => {
    const product = state.productsById.get(total.dataset.totalFor);
    if (!product) return;
    const qtyInput = els.dialogContent.querySelector(`[data-qty="${cssEscape(product.id)}"]`) || els.dialogContent.querySelector("#productQty");
    const value = formatMoney(priceNumber(product.price) * readQuantity(qtyInput));
    const amount = total.querySelector("strong");
    if (amount) amount.textContent = value;
    else total.textContent = `Total ${value}`;
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

function escapeAttribute(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

init().catch((error) => {
  console.error(error);
  els.catalogMeta.textContent = "Could not load catalog data.";
});
