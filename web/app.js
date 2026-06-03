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
  isCheckingAuth: true,
  isSavingOrder: false,
};

let pageScrollFrame = 0;

const els = {
  brandName: document.querySelector("#brandName"),
  catalogLabel: document.querySelector("#catalogLabel"),
  catalogMeta: document.querySelector("#catalogMeta"),
  searchInput: document.querySelector("#searchInput"),
  skuRecommendations: document.querySelector("#skuRecommendations"),
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
  cartClientCode: document.querySelector("#cartClientCode"),
  accountStatus: document.querySelector("#accountStatus"),
  authLoading: document.querySelector("#authLoading"),
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
  productDialog: document.querySelector("#productDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  toast: document.querySelector("#toast"),
};

async function init() {
  await loadCatalogData();

  els.brandName.textContent = state.settings.brandName;
  els.catalogLabel.textContent = state.settings.catalogLabel;
  els.cartClientName.value = localStorage.getItem("catalogCartClientName") || "";
  els.cartClientCode.value = localStorage.getItem("catalogCartClientCode") || "";
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
  els.catalogMeta.textContent = `${state.catalog.samplePageCount} páginas - ${state.catalog.products.length} productos - ${priceCount} productos en Excel`;
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
  els.signInForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    signIn();
  });
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
  els.cartClientName.addEventListener("input", () => {
    localStorage.setItem("catalogCartClientName", els.cartClientName.value);
    renderCart();
  });
  els.cartClientCode.addEventListener("input", () => {
    localStorage.setItem("catalogCartClientCode", els.cartClientCode.value);
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
    showToast("Productos del catálogo actualizados");
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
    { id: "all", label: "Todas" },
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
  renderSkuRecommendations(query);
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
          <strong>Página ${page.number}</strong>
          <p>${escapeHtml(page.section || "Catálogo")} · ${escapeHtml(displayCatalogLabel(page.title))} · ${count} producto${count === 1 ? "" : "s"}</p>
        </button>
      `;
    })
    .join("");

  els.productsPanel.innerHTML =
    products
      .map(
        (product) => `
          <button class="product-card${product.outOfStock ? " is-out-of-stock" : ""}" type="button" data-product="${product.id}">
            <strong>${escapeHtml(product.name)}</strong>
            <p>${escapeHtml(product.section || "Catálogo")} · ${escapeHtml(product.sku)} · ${escapeHtml(product.price)} · Página ${product.page}${product.outOfStock ? " · Sin stock" : ""}</p>
          </button>
        `,
      )
      .join("") || `<p>No hay productos coincidentes.</p>`;

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

function renderSkuRecommendations(query) {
  if (!els.skuRecommendations) return;

  const skuQuery = normalizeSkuQuery(query);
  const textQuery = normalizeProductSearch(query);
  if (!skuQuery && !textQuery) {
    els.skuRecommendations.hidden = true;
    els.skuRecommendations.innerHTML = "";
    return;
  }

  const matches = state.catalog.products
    .filter((product) => brandMatches(product.section) && isVisibleProduct(product))
    .map((product) => matchingProductRecommendation(product, skuQuery, textQuery))
    .filter(Boolean)
    .sort((first, second) => {
      if (first.score !== second.score) return first.score - second.score;
      return Number(first.product.page) - Number(second.product.page);
    })
    .slice(0, 8);

  if (!matches.length) {
    els.skuRecommendations.hidden = true;
    els.skuRecommendations.innerHTML = "";
    return;
  }

  els.skuRecommendations.hidden = false;
  els.skuRecommendations.innerHTML = matches
    .map(
      ({ product, sku }) => `
        <button class="sku-recommendation" type="button" role="option" data-product="${escapeAttribute(product.id)}">
          <strong>${escapeHtml(sku)}</strong>
          <span>${escapeHtml(product.name)}</span>
          <small>Página ${escapeHtml(product.page)}${product.outOfStock ? " · Sin stock" : ""}</small>
        </button>
      `,
    )
    .join("");

  els.skuRecommendations.querySelectorAll("[data-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.productsById.get(button.dataset.product);
      if (!product) return;
      const index = state.catalog.pages.findIndex((page) => page.number === product.page);
      state.brandFilter = "all";
      localStorage.setItem("catalogBrandFilter", state.brandFilter);
      els.searchInput.value = "";
      renderBrandTabs();
      renderLists();
      goToPage(index);
      scrollPageCardIntoView(product.page);
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
  const imageWidth = Number(page.image.width) || 1013;
  const imageHeight = Number(page.image.height) || 1432;

  return `
    <article class="page-frame" data-page-index="${index}" aria-label="Página ${page.number} del catálogo">
      <img src="${escapeHtml(page.image.src)}" width="${imageWidth}" height="${imageHeight}" alt="Página ${page.number} del catálogo" loading="lazy" decoding="async">
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

  els.pageTitle.textContent = `Página ${page.number} - ${page.section || "Catálogo"} - ${displayCatalogLabel(page.title)}`;
  els.pageSubtitle.textContent = `${products.length} producto${products.length === 1 ? "" : "s"} detectado${products.length === 1 ? "" : "s"} en esta página`;
  const visibleIndexes = visiblePageIndexes();
  const visiblePosition = visibleIndexes.indexOf(state.currentIndex);
  els.prevPage.disabled = visiblePosition <= 0;
  els.nextPage.disabled = visiblePosition < 0 || visiblePosition === visibleIndexes.length - 1;
}

function renderHotspot(product) {
  const spot = product.hotspot;
  const stockClass = product.outOfStock ? " is-out-of-stock" : "";
  return `
    <button
      class="hotspot${stockClass}"
      type="button"
      data-product="${product.id}"
      aria-label="Abrir ${escapeHtml(product.name)}${product.outOfStock ? " - sin stock" : ""}"
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
    overlayStyle.background ? `--price-bg:${overlayStyle.background}` : "",
  ].filter(Boolean).join(";");
  const variantClass = group.variant ? ` price-overlay--${escapeAttribute(group.variant)}` : "";
  return `
    <button
      class="price-overlay${variantClass}"
      type="button"
      data-group="${group.id}"
      aria-label="Abrir productos con precio ${escapeHtml(price)}"
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
        <span class="eyebrow">${escapeHtml(displayCatalogLabel(page.title))}</span>
        <h2>${escapeHtml(group.label)}</h2>
      </div>
      <div class="price">${escapeHtml(group.price)}</div>
      <div class="group-list">
        ${products
          .map(
            (product) => `
              <div class="group-product${product.outOfStock ? " is-out-of-stock" : ""}" data-group-product="${product.id}">
                <div>
                  <span>${escapeHtml(product.name)}</span>
                  <strong>${escapeHtml(product.sku)}</strong>
                  <em class="group-product-status" data-added-status="${product.id}" aria-live="polite"></em>
                </div>
                <div class="dialog-qty">
                  <span>Cant.</span>
                  <div class="quantity-stepper quantity-stepper-compact">
                    <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Disminuir cantidad"${product.outOfStock ? " disabled" : ""}>-</button>
                    <input type="number" min="1" step="1" value="1" inputmode="numeric" data-qty="${product.id}"${product.outOfStock ? " disabled" : ""}>
                    <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Aumentar cantidad"${product.outOfStock ? " disabled" : ""}>+</button>
                  </div>
                  <strong class="dialog-line-total" data-total-for="${product.id}">Total ${formatMoney(priceNumber(product.price))}</strong>
                </div>
                <button class="small-add-button" type="button" data-add="${product.id}"${product.outOfStock ? " disabled" : ""}>${product.outOfStock ? "Sin stock" : "Agregar"}</button>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  bindDialogQuantitySteppers();
  updateGroupCartStatuses();
  els.dialogContent.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.productsById.get(button.dataset.add);
      if (product?.outOfStock) {
        showToast("Este producto está sin stock");
        return;
      }
      const qtyInput = els.dialogContent.querySelector(`[data-qty="${cssEscape(button.dataset.add)}"]`);
      const quantity = readQuantity(qtyInput);
      addToCart(button.dataset.add, quantity);
      markGroupProductAdded(button.dataset.add, quantity);
    });
  });
  els.productDialog.showModal();
}

function markGroupProductAdded(productId, quantity) {
  const product = state.productsById.get(productId);
  const row = els.dialogContent.querySelector(`[data-group-product="${cssEscape(productId)}"]`);
  const button = els.dialogContent.querySelector(`[data-add="${cssEscape(productId)}"]`);
  if (!row || !button || !product) return;

  row.classList.add("is-added");
  button.textContent = "Agregado";
  button.classList.add("is-added");
  updateGroupCartStatuses(productId, quantity);

  clearTimeout(button.addedTimer);
  button.addedTimer = setTimeout(() => {
    button.textContent = "Agregar";
    button.classList.remove("is-added");
  }, 1400);
}

function updateGroupCartStatuses(recentProductId = "", recentQuantity = 0) {
  els.dialogContent.querySelectorAll("[data-added-status]").forEach((status) => {
    const productId = status.dataset.addedStatus;
    const product = state.productsById.get(productId);
    if (product?.outOfStock) {
      status.textContent = "Sin stock";
      return;
    }
    const cartQuantity = state.cart.get(productId) || 0;
    if (!cartQuantity) {
      status.textContent = "0 en carrito";
      return;
    }

    const recentText = productId === recentProductId && recentQuantity
      ? `${recentQuantity} agregado${recentQuantity === 1 ? "" : "s"} - `
      : "";
    status.textContent = `${recentText}${cartQuantity} en carrito`;
  });
}

function openProduct(product) {
  if (!product) return;
  const outOfStock = Boolean(product.outOfStock);
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h2>${escapeHtml(product.name)}</h2>
        ${outOfStock ? `<span class="stock-badge">Sin stock</span>` : ""}
      </div>
      <div class="product-meta">
        <span>SKU: ${escapeHtml(product.sku)}</span>
        ${product.skus.length > 1 ? `<span>SKU relacionados: ${product.skus.map(escapeHtml).join(", ")}</span>` : ""}
        ${product.ean ? `<span>EAN: ${escapeHtml(product.ean)}</span>` : ""}
      </div>
      <div class="price${outOfStock ? " is-out-of-stock" : ""}">${escapeHtml(product.price)}</div>
      <div class="dialog-qty dialog-qty-wide">
        <span>Cantidad</span>
        <div class="quantity-stepper">
          <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Disminuir cantidad"${outOfStock ? " disabled" : ""}>-</button>
          <input id="productQty" type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="Cantidad"${outOfStock ? " disabled" : ""}>
          <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Aumentar cantidad"${outOfStock ? " disabled" : ""}>+</button>
        </div>
      </div>
      <div class="dialog-total" data-total-for="${product.id}">
        <span>Total</span>
        <strong>${formatMoney(priceNumber(product.price))}</strong>
      </div>
      <button class="primary-button" type="button" data-add="${product.id}"${outOfStock ? " disabled" : ""}>${outOfStock ? "Sin stock" : "Agregar al carrito"}</button>
    </div>
  `;
  bindDialogQuantitySteppers();
  if (!outOfStock) {
    els.dialogContent.querySelector("[data-add]").addEventListener("click", () => {
      addToCart(product.id, readQuantity(els.dialogContent.querySelector("#productQty")));
      els.productDialog.close();
    });
  }
  els.productDialog.showModal();
}

function addToCart(productId, quantity = 1) {
  const product = state.productsById.get(productId);
  if (product?.outOfStock) {
    showToast("Este producto está sin stock");
    return;
  }
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);
  state.cart.set(productId, (state.cart.get(productId) || 0) + qty);
  saveCart();
  renderCart();
  showToast(`${qty} agregado${qty === 1 ? "" : "s"} al carrito`);
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
    .filter((line) => isOrderableProduct(line.product));
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
              <p>${escapeHtml(product.sku)} · ${escapeHtml(product.price)} c/u · ${formatMoney(priceNumber(product.price) * qty)} · Página ${product.page}</p>
            </div>
            <div class="qty-controls" aria-label="Controles de cantidad">
              <button type="button" data-dec="${product.id}" aria-label="Disminuir cantidad">-</button>
              <span>${qty}</span>
              <button type="button" data-inc="${product.id}" aria-label="Aumentar cantidad">+</button>
            </div>
          </div>
        `,
      )
      .join("") || `<p>El carrito está vacío.</p>`;

  els.cartItems.querySelectorAll("[data-dec]").forEach((button) => {
    button.addEventListener("click", () => updateQty(button.dataset.dec, -1));
  });
  els.cartItems.querySelectorAll("[data-inc]").forEach((button) => {
    button.addEventListener("click", () => updateQty(button.dataset.inc, 1));
  });

  els.saveOrder.disabled = state.isSavingOrder || !lines.length;
  els.saveOrder.textContent = state.isSavingOrder ? "Enviando..." : "Enviar pedido";
}

async function saveOrder() {
  if (state.isSavingOrder) return;

  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isOrderableProduct(line.product));
  if (!lines.length) {
    showToast("Agregá productos antes de enviar el pedido");
    return;
  }
  if (CATALOG_SUPABASE.isAvailable() && !state.user) {
    showToast("Iniciá sesión antes de enviar el pedido");
    openAccount();
    return;
  }

  let customer = readOrderCustomer();
  let notificationResult = { ok: true };
  state.isSavingOrder = true;
  renderCart();

  try {
    if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      customer = readOrderCustomer();
      const order = CATALOG_STORE.buildOrderFromLines(lines, customer);
      const savedOrder = await CATALOG_SUPABASE.saveOrder(order, state.user.id);
      notificationResult = savedOrder.notification || notificationResult;
      await renderCustomerOrders();
    } else {
      const order = CATALOG_STORE.buildOrderFromLines(lines, customer);
      CATALOG_STORE.addOrder(order);
    }
  } catch (error) {
    showToast(error.message || "No se pudo enviar el pedido");
    state.isSavingOrder = false;
    renderCart();
    return;
  }
  window.dispatchEvent(new CustomEvent("catalog:orders-changed"));
  state.cart.clear();
  els.cartClientName.value = "";
  els.cartClientCode.value = "";
  localStorage.removeItem("catalogCartClientName");
  localStorage.removeItem("catalogCartClientCode");
  saveCart();
  state.isSavingOrder = false;
  renderCart();
  showToast(notificationResult.ok ? "Pedido enviado" : "Pedido enviado, pero no se pudo enviar el email");
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
  const scrollToFrame = (scrollBehavior = behavior) => frame.scrollIntoView({ behavior: scrollBehavior, block: "start", inline: "nearest" });
  scrollToFrame();

  const image = frame.querySelector("img");
  if (image && !image.complete) {
    image.addEventListener("load", () => scrollToFrame("auto"), { once: true });
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollToFrame("auto"));
  });
}

function scrollPageCardIntoView(pageNumber) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const pageCard = els.pagesPanel.querySelector(`[data-page="${pageNumber}"]`);
      if (!pageCard) return;
      pageCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
  });
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
  if (!state.user) {
    openAccount();
    return;
  }

  els.accountDrawer.classList.remove("is-open");
  els.accountDrawer.setAttribute("aria-hidden", "true");
}

function applyAuthGate() {
  const requiresAuth = !state.user;
  document.body.classList.toggle("auth-required", requiresAuth);
  document.body.classList.toggle("auth-checking", state.isCheckingAuth);
  if (els.authLoading) {
    els.authLoading.hidden = !state.isCheckingAuth;
  }
  if (requiresAuth) openAccount();
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
  const clientCode = els.cartClientCode.value.trim();
  return {
    ...accountCustomer,
    name: els.cartClientName.value.trim() || accountCustomer.name,
    notes: clientCode ? `Código de cliente: ${clientCode}` : accountCustomer.notes,
  };
}

async function initAccount() {
  els.authEmail.value = localStorage.getItem("catalogLastEmail") || "";
  els.createEmail.value = els.authEmail.value;
  els.resetEmail.value = els.authEmail.value;
  state.isCheckingAuth = true;
  els.accountStatus.textContent = "Iniciando sesi\u00f3n autom\u00e1ticamente";
  applyAuthGate();

  if (!CATALOG_SUPABASE.isAvailable()) {
    state.isCheckingAuth = false;
    els.accountStatus.textContent = "Cuentas no disponibles";
    applyAuthGate();
    return;
  }

  let accountError = false;

  try {
    state.user = await CATALOG_SUPABASE.getUser();
    if (state.user) {
      state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
      applyProfileToAuthFields();
    }
  } catch (error) {
    accountError = true;
    els.accountStatus.textContent = "Falta configurar la cuenta";
  } finally {
    state.isCheckingAuth = false;
  }

  if (accountError) {
    els.authFields.classList.remove("is-hidden");
    applyAuthGate();
  } else {
    renderAccount();
    await renderCustomerOrders();
    if (state.user) closeAccount();
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
    applyAuthGate();
    closeAccount();
    showToast("Sesión iniciada");
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
    applyAuthGate();
    if (state.user) closeAccount();
    showToast("Cuenta creada. Revisá tu email si la confirmación está activada.");
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
  els.accountStatus.textContent = "Restablecé tu contraseña";
  els.authMessage.textContent = "Ingresá una nueva contraseña para terminar la recuperación.";
  els.newPassword.focus();
}

function setAuthMode(mode) {
  els.authFields.dataset.mode = mode;
}

async function sendPasswordReset() {
  try {
    clearAuthMessage();
    await CATALOG_SUPABASE.sendPasswordReset(els.resetEmail.value.trim());
    els.authMessage.textContent = "Email de recuperación enviado. Usá el enlace de ese email para guardar una nueva contraseña.";
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
    showToast("Contraseña actualizada");
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
    applyAuthGate();
    showToast("Sesión cerrada");
  } catch (error) {
    showToast(error.message || "No se pudo cerrar sesión");
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
  if (state.isCheckingAuth) {
    els.accountStatus.textContent = "Iniciando sesi\u00f3n autom\u00e1ticamente";
    els.authFields.classList.add("is-hidden");
    els.signOut.classList.add("is-hidden");
    els.openAccount.classList.remove("is-signed-in");
    applyAuthGate();
    return;
  }
  els.accountStatus.textContent = signedIn ? `Sesión iniciada como ${state.user.email}` : "Sesión no iniciada";
  els.authFields.classList.toggle("is-hidden", signedIn && !resettingPassword);
  els.signOut.classList.toggle("is-hidden", !signedIn || resettingPassword);
  els.openAccount.classList.toggle("is-signed-in", signedIn);
  applyAuthGate();
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
  const message = String(error?.message || "No se pudo completar la acción de cuenta");
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "Email o contrase\u00f1a incorrectos.";
  }
  if (message.toLowerCase().includes("email") && message.toLowerCase().includes("limit")) {
    return "Se alcanzó el límite de emails de Supabase. Para pruebas locales, desactivá Confirm email en Supabase Auth > Providers > Email, o configurá SMTP propio.";
  }
  if (message.toLowerCase().includes("email not confirmed")) {
    return "El email todavía no está confirmado. Desactivá Confirm email para pruebas locales, o usá el email de confirmación.";
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
    return "Ese enlace de recuperación no es válido o expiró. Enviá un nuevo email de recuperación y usá solo el enlace más reciente.";
  }
  return authHash.error_description?.replaceAll("+", " ") || "No se pudo usar ese enlace de recuperación. Enviá un nuevo email.";
}

async function renderCustomerOrders() {
  if (!state.user || !CATALOG_SUPABASE.isAvailable()) {
    els.customerOrders.innerHTML = "";
    collapseCustomerOrderDetail();
    return;
  }

  try {
    const orders = await CATALOG_SUPABASE.loadMyOrders(state.user.id);
    state.customerOrders = orders;
    collapseCustomerOrderDetail();
    els.customerOrders.innerHTML =
      orders
        .slice(0, 5)
        .map(
          (order) => `
            <button class="customer-order-line" type="button" data-order="${escapeHtml(order.id)}">
              <strong>${escapeHtml(order.displayId || order.id)}</strong>
              <span>${escapeHtml(orderStatusLabel(order.status))} - ${formatMoney(order.totalValue)}</span>
            </button>
          `,
        )
        .join("") || `<p>Todavía no hay pedidos anteriores.</p>`;
    els.customerOrders.querySelectorAll("[data-order]").forEach((button) => {
      button.addEventListener("click", () => showCustomerOrderDetail(button.dataset.order));
    });
  } catch (error) {
    els.customerOrders.innerHTML = `<p>Ejecutá el SQL de configuración de Supabase para habilitar el historial de pedidos.</p>`;
  }
}

function showCustomerOrderDetail(orderId) {
  const order = (state.customerOrders || []).find((item) => item.id === orderId);
  if (!order) return;

  els.customerOrders.hidden = true;
  els.customerOrderDetail.hidden = false;
  els.customerOrderDetail.innerHTML = `
    <button id="backToOrders" class="secondary-button compact-button" type="button">Volver a pedidos</button>
    <div class="customer-order-detail-header">
      <span class="eyebrow">Pedido</span>
      <h3>${escapeHtml(order.displayId || order.id)}</h3>
      <p>${escapeHtml(orderStatusLabel(order.status))} - ${new Date(order.createdAt).toLocaleString("es-AR")}</p>
    </div>
    <div class="customer-order-items">
      ${order.items
        .map(
          (item) => `
            <div class="customer-order-item">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.sku)} - Página ${escapeHtml(item.page || "")}</span>
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
  els.customerOrderDetail.querySelector("#backToOrders").addEventListener("click", collapseCustomerOrderDetail);
}

function collapseCustomerOrderDetail() {
  els.customerOrderDetail.hidden = true;
  els.customerOrderDetail.innerHTML = "";
  els.customerOrders.hidden = false;
}

function isVisibleProduct(product) {
  return Boolean(product && !product.hidden);
}

function isOrderableProduct(product) {
  return isVisibleProduct(product) && !product.outOfStock;
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

function displayCatalogLabel(value) {
  return {
    Catalog: "Catálogo",
    catalog: "catálogo",
  }[value] || value || "";
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function searchFields(product) {
  return [product.name, product.sku, product.section, product.category, product.price, String(product.page), ...(product.skus || [])];
}

function skuFields(product) {
  return [...new Set([product.sku, ...(product.skus || [])].filter(Boolean).map(String))];
}

function matchingSku(product, query) {
  const skus = skuFields(product);
  return skus.find((sku) => normalizeSkuQuery(sku).startsWith(query)) || skus.find((sku) => normalizeSkuQuery(sku).includes(query)) || "";
}

function matchingProductRecommendation(product, skuQuery, textQuery) {
  const sku = skuQuery ? matchingSku(product, skuQuery) : "";
  if (sku) {
    return {
      product,
      sku,
      score: normalizeSkuQuery(sku).startsWith(skuQuery) ? 0 : 1,
    };
  }

  const normalizedName = normalizeProductSearch(product.name);
  const compactName = compactProductSearch(normalizedName);
  const compactQuery = compactProductSearch(textQuery);
  if (textQuery && (normalizedName.includes(textQuery) || compactName.includes(compactQuery))) {
    return {
      product,
      sku: product.sku,
      score: normalizedName.startsWith(textQuery) || compactName.startsWith(compactQuery) ? 2 : 3,
    };
  }

  return null;
}

function normalizeSkuQuery(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeProductSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactProductSearch(value) {
  return String(value || "").replace(/\s+/g, "");
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
  els.catalogMeta.textContent = "No se pudieron cargar los datos del catálogo.";
});
