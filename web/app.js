const state = {
  catalog: null,
  currentIndex: 0,
  zoom: Number(localStorage.getItem("catalogZoom") || 100),
  brandFilter: "all",
  productsById: new Map(),
  productOverrides: {},
  cart: new Map(JSON.parse(localStorage.getItem("catalogCart") || "[]")),
  settings: CATALOG_STORE.loadSettings(),
  user: null,
  profile: null,
  salesClients: [],
  selectedSalesClient: null,
  isCheckingAuth: true,
  isLoadingSalesClients: false,
  isSavingOrder: false,
  isSyncingOfflineOrders: false,
  connectionLost: false,
  pendingOfflineOrders: loadPendingOfflineOrders(),
  quickOrderRows: [{ sku: "", quantity: "" }],
  pendingCartRemoval: null,
};

let pageScrollFrame = 0;

const els = {
  offlineBanner: document.querySelector("#offlineBanner"),
  offlineBannerTitle: document.querySelector("#offlineBannerTitle"),
  offlineBannerText: document.querySelector("#offlineBannerText"),
  syncOfflineOrders: document.querySelector("#syncOfflineOrders"),
  brandName: document.querySelector("#brandName"),
  catalogLabel: document.querySelector("#catalogLabel"),
  catalogMeta: document.querySelector("#catalogMeta"),
  searchInput: document.querySelector("#searchInput"),
  jumpToCatalog: document.querySelector("#jumpToCatalog"),
  jumpToFilters: document.querySelector("#jumpToFilters"),
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
  openQuickOrderToolbar: document.querySelector("#openQuickOrderToolbar"),
  closeCart: document.querySelector("#closeCart"),
  openAccount: document.querySelector("#openAccount"),
  closeAccount: document.querySelector("#closeAccount"),
  cartDrawer: document.querySelector("#cartDrawer"),
  accountDrawer: document.querySelector("#accountDrawer"),
  cartCount: document.querySelector("#cartCount"),
  quickOrderPanel: document.querySelector("#quickOrderPanel"),
  openQuickOrder: document.querySelector("#openQuickOrder"),
  quickOrderDialog: document.querySelector("#quickOrderDialog"),
  closeQuickOrder: document.querySelector("#closeQuickOrder"),
  quickOrderTable: document.querySelector("#quickOrderTable"),
  quickOrderPreview: document.querySelector("#quickOrderPreview"),
  addQuickOrder: document.querySelector("#addQuickOrder"),
  clearQuickOrder: document.querySelector("#clearQuickOrder"),
  cartItems: document.querySelector("#cartItems"),
  cartTotalItems: document.querySelector("#cartTotalItems"),
  cartTotalValue: document.querySelector("#cartTotalValue"),
  cartSalesClientPanel: document.querySelector("#cartSalesClientPanel"),
  cartSalesClientSearch: document.querySelector("#cartSalesClientSearch"),
  cartSalesClientResults: document.querySelector("#cartSalesClientResults"),
  cartSelectedSalesClient: document.querySelector("#cartSelectedSalesClient"),
  clearSalesClient: document.querySelector("#clearSalesClient"),
  cartTransportPanel: document.querySelector("#cartTransportPanel"),
  cartTransport: document.querySelector("#cartTransport"),
  otherSalesClientToggleWrap: document.querySelector("#otherSalesClientToggleWrap"),
  otherSalesClientToggle: document.querySelector("#otherSalesClientToggle"),
  otherSalesClientForm: document.querySelector("#otherSalesClientForm"),
  otherSalesClientCode: document.querySelector("#otherSalesClientCode"),
  otherSalesClientName: document.querySelector("#otherSalesClientName"),
  otherSalesClientLegalName: document.querySelector("#otherSalesClientLegalName"),
  otherSalesClientAddress: document.querySelector("#otherSalesClientAddress"),
  otherSalesClientLocality: document.querySelector("#otherSalesClientLocality"),
  createSalesClient: document.querySelector("#createSalesClient"),
  otherSalesClientMessage: document.querySelector("#otherSalesClientMessage"),
  cartAccountClientNote: document.querySelector("#cartAccountClientNote"),
  cartManualClientFields: document.querySelector("#cartManualClientFields"),
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
  createSalesmanCode: document.querySelector("#createSalesmanCode"),
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

  localStorage.removeItem("catalogBrandFilter");
  els.brandName.textContent = state.settings.brandName;
  els.catalogLabel.textContent = state.settings.catalogLabel;
  els.cartClientName.value = localStorage.getItem("catalogCartClientName") || "";
  els.cartClientCode.value = localStorage.getItem("catalogCartClientCode") || "";
  bindEvents();
  registerServiceWorker();
  renderOfflineStatus();
  renderQuickOrderTable();
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
  let loadedRemoteOverrides = false;

  if (CATALOG_SUPABASE.isAvailable()) {
    try {
      remoteOverrides = await CATALOG_SUPABASE.loadProductOverrides();
      loadedRemoteOverrides = true;
    } catch (error) {
      console.warn("Could not load remote product overrides", error);
      markConnectionLost(error);
    }
  }

  state.productOverrides = CATALOG_STORE.mergeProductOverrides(localOverrides, remoteOverrides);
  if (loadedRemoteOverrides) CATALOG_STORE.saveProductOverrides(state.productOverrides);
  state.catalog = CATALOG_STORE.applyProductOverrides(baseCatalog, state.productOverrides);
  state.productsById = new Map(state.catalog.products.map((product) => [product.id, product]));
  updateCatalogMeta();
  precacheCatalogAssets();
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
  els.jumpToCatalog.addEventListener("click", scrollCatalogIntoView);
  els.jumpToFilters.addEventListener("click", scrollFiltersIntoView);
  els.prevPage.addEventListener("click", () => goToAdjacentVisiblePage(-1));
  els.nextPage.addEventListener("click", () => goToAdjacentVisiblePage(1));
  els.pageStage.addEventListener("scroll", handlePageStageScroll, { passive: true });
  els.pageStrip.addEventListener("click", handlePageStripClick);
  els.openCart.addEventListener("click", openCart);
  els.openQuickOrderToolbar.addEventListener("click", openQuickOrder);
  els.closeCart.addEventListener("click", closeCart);
  els.openQuickOrder.addEventListener("click", openQuickOrder);
  els.quickOrderTable.addEventListener("input", handleQuickOrderInput);
  els.quickOrderTable.addEventListener("keydown", handleQuickOrderKeydown);
  els.quickOrderTable.addEventListener("paste", handleQuickOrderPaste);
  els.addQuickOrder.addEventListener("click", addQuickOrderToCart);
  els.clearQuickOrder.addEventListener("click", clearQuickOrder);
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
  els.syncOfflineOrders.addEventListener("click", handleOfflineBannerAction);
  els.productDialog.addEventListener("close", clearCatalogSelectionFocus);
  els.productDialog.addEventListener("cancel", clearCatalogSelectionFocus);
  els.cartSalesClientSearch.addEventListener("input", renderSalesClientResults);
  els.cartSalesClientSearch.addEventListener("focus", renderSalesClientResults);
  els.clearSalesClient.addEventListener("click", clearSelectedSalesClient);
  els.otherSalesClientToggle.addEventListener("change", toggleOtherSalesClientForm);
  els.createSalesClient.addEventListener("click", createAndSelectSalesClient);
  els.otherSalesClientForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    createAndSelectSalesClient();
  });
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
  window.addEventListener("resize", renderZoom);
  window.addEventListener("online", handleNetworkStatusChange);
  window.addEventListener("offline", handleNetworkStatusChange);
  document.addEventListener("click", (event) => {
    if (!els.cartSalesClientPanel || els.cartSalesClientPanel.contains(event.target)) return;
    els.cartSalesClientResults.hidden = true;
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
      renderBrandTabs();
      goToFirstVisiblePage();
    });
  });
}

function renderLists() {
  const query = els.searchInput.value.trim().toLowerCase();
  const hasQuery = Boolean(query);
  renderSkuRecommendations(query);
  const pages = (hasQuery ? state.catalog.pages : visiblePages()).filter((page) => {
    if (!query) return true;
    const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
    return [page.title, page.section, String(page.number), ...products.flatMap(searchFields)].join(" ").toLowerCase().includes(query);
  });

  const products = state.catalog.products.filter(
    (product) => (hasQuery || brandMatches(product.section)) && isVisibleProduct(product) && searchFields(product).join(" ").toLowerCase().includes(query),
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
      const page = state.catalog.pages.find((item) => item.number === Number(button.dataset.page));
      const index = page ? state.catalog.pages.indexOf(page) : -1;
      if (page && !brandMatches(page.section)) clearBrandFilter();
      goToPage(index);
    });
  });

  els.productsPanel.querySelectorAll("[data-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = state.productsById.get(button.dataset.product);
      const index = state.catalog.pages.findIndex((page) => page.number === product.page);
      if (!brandMatches(product.section)) clearBrandFilter();
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
    .filter((product) => isVisibleProduct(product))
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
      clearBrandFilter();
      els.searchInput.value = "";
      goToPage(index);
      scrollPageCardIntoView(product.page);
    });
  });
}

function clearBrandFilter() {
  if (state.brandFilter === "all") return;
  state.brandFilter = "all";
  renderBrandTabs();
  renderLists();
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
  els.pageStrip.classList.toggle("is-spread", shouldUseSpreadView());
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

function clearCatalogSelectionFocus() {
  const active = document.activeElement;
  if (active && (active.matches?.(".hotspot, .price-overlay") || els.productDialog.contains(active))) {
    active.blur();
  }
  els.pageStrip.querySelectorAll(".hotspot, .price-overlay").forEach((button) => button.blur());
}

function addToCart(productId, quantity = 1, options = {}) {
  const product = state.productsById.get(productId);
  if (product?.outOfStock) {
    if (!options.silent) showToast("Este producto está sin stock");
    return;
  }
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);
  state.cart.set(productId, (state.cart.get(productId) || 0) + qty);
  mergeDuplicateCartSkus();
  saveCart();
  renderCart();
  if (!options.silent) showToast(`${qty} agregado${qty === 1 ? "" : "s"} al carrito`);
}

function updateQty(productId, delta) {
  clearPendingCartRemoval();
  const next = (state.cart.get(productId) || 0) + delta;
  if (next <= 0) state.cart.delete(productId);
  else state.cart.set(productId, next);
  mergeDuplicateCartSkus();
  saveCart();
  renderCart();
}

function requestCartLineRemoval(productId) {
  if (state.pendingCartRemoval === productId) {
    state.cart.delete(productId);
    clearPendingCartRemoval({ render: false });
    saveCart();
    renderCart();
    showToast("Producto quitado del carrito");
    return;
  }

  state.pendingCartRemoval = productId;
  clearTimeout(requestCartLineRemoval.timer);
  requestCartLineRemoval.timer = setTimeout(() => clearPendingCartRemoval(), 3500);
  renderCart();
}

function clearPendingCartRemoval(options = {}) {
  if (!state.pendingCartRemoval) return;
  state.pendingCartRemoval = null;
  clearTimeout(requestCartLineRemoval.timer);
  if (options.render !== false) renderCart();
}

function mergeDuplicateCartSkus() {
  const bySku = new Map();
  let merged = false;
  [...state.cart.entries()].forEach(([productId, quantity]) => {
    const product = state.productsById.get(productId);
    if (!product) return;
    const skuKey = normalizeSkuQuery(product.sku || productId);
    if (!skuKey) return;
    const existing = bySku.get(skuKey);
    if (!existing) {
      bySku.set(skuKey, { productId, quantity });
      return;
    }
    existing.quantity += quantity;
    state.cart.delete(productId);
    state.cart.set(existing.productId, existing.quantity);
    merged = true;
  });
  return merged;
}

function renderQuickOrderTable(focusTarget = null) {
  ensureQuickOrderTrailingRow();
  els.quickOrderTable.innerHTML = `
    <div class="quick-order-table-head" role="row">
      <span>SKU</span>
      <span>Cant.</span>
      <span>Producto</span>
      <span>Precio</span>
      <span>Total</span>
    </div>
    <div class="quick-order-table-body">
      ${state.quickOrderRows.map(renderQuickOrderTableRow).join("")}
    </div>
  `;
  if (focusTarget) {
    requestAnimationFrame(() => {
      const input = els.quickOrderTable.querySelector(`[data-row="${focusTarget.index}"][data-field="${focusTarget.field}"]`);
      input?.focus();
      input?.select?.();
    });
  }
  renderQuickOrderPreview();
}

function renderQuickOrderTableRow(row, index) {
  const parsed = resolveQuickOrderRow(row);
  const status = quickOrderRowStatus(parsed);
  return `
    <div class="quick-order-table-row${status.isError ? " is-error" : ""}" role="row">
      <input data-row="${index}" data-field="sku" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(row.sku || "")}" aria-label="SKU fila ${index + 1}">
      <input data-row="${index}" data-field="quantity" type="number" min="1" step="1" inputmode="numeric" autocomplete="off" value="${escapeHtml(row.quantity || "")}" aria-label="Cantidad fila ${index + 1}">
      <span data-quick-order-product title="${escapeHtml(status.name)}">${escapeHtml(status.name)}</span>
      <span class="quick-order-price" data-quick-order-price>${escapeHtml(status.priceText)}</span>
      <strong data-quick-order-total>${escapeHtml(status.totalText)}</strong>
    </div>
  `;
}

function quickOrderRowStatus(row) {
  if (!row.sku && !row.quantity) return { name: "", priceText: "", totalText: "", isError: false };
  if (!row.product) return { name: "No encontrado", priceText: "", totalText: "", isError: true };
  if (row.product.outOfStock) return { name: row.product.name, priceText: row.product.price, totalText: "Sin stock", isError: true };
  if (!row.hasQuantity) return { name: row.product.name, priceText: row.product.price, totalText: "", isError: false };
  if (row.quantity <= 0) return { name: row.product.name, priceText: row.product.price, totalText: "Cant. inv\u00e1lida", isError: true };
  return {
    name: row.product.name,
    priceText: row.product.price,
    totalText: formatMoney(priceNumber(row.product.price) * row.quantity),
    isError: false,
  };
}

function handleQuickOrderInput(event) {
  const input = event.target.closest("[data-row][data-field]");
  if (!input) return;
  const rowIndex = Number(input.dataset.row);
  const field = input.dataset.field;
  if (!state.quickOrderRows[rowIndex]) return;
  state.quickOrderRows[rowIndex][field] = field === "quantity" ? normalizeQuickQuantityText(input.value) : input.value.trim();
  updateQuickOrderRenderedRow(rowIndex);
  if (rowIndex === state.quickOrderRows.length - 1 && hasQuickOrderRowValue(state.quickOrderRows[rowIndex])) {
    state.quickOrderRows.push({ sku: "", quantity: "" });
    appendQuickOrderRows(rowIndex + 1);
  }
  renderQuickOrderPreview();
}

function handleQuickOrderKeydown(event) {
  const input = event.target.closest("[data-row][data-field]");
  if (!input) return;

  if (event.key === "Enter") {
    event.preventDefault();
    const rowIndex = Number(input.dataset.row);
    focusQuickOrderCell(input.dataset.field === "sku" ? rowIndex : rowIndex + 1, input.dataset.field === "sku" ? "quantity" : "sku");
    return;
  }

  if (event.key !== "Tab" || event.shiftKey) return;
  const rowIndex = Number(input.dataset.row);
  if (input.dataset.field !== "quantity") return;
  if (rowIndex < state.quickOrderRows.length - 1) return;
  event.preventDefault();
  focusQuickOrderCell(rowIndex + 1, "sku");
}

function handleQuickOrderPaste(event) {
  const input = event.target.closest("[data-row][data-field]");
  if (!input) return;
  const pasted = event.clipboardData?.getData("text") || "";
  const parsedRows = parseQuickOrderRows(pasted).map((row) => ({
    sku: row.sku,
    quantity: row.quantity > 0 ? String(row.quantity) : "",
  }));
  const shouldHandlePaste =
    parsedRows.length > 1 ||
    pasted.includes("\n") ||
    pasted.includes("\t") ||
    (parsedRows.length === 1 && Boolean(parsedRows[0].quantity) && /[\s,;|-]/.test(pasted.trim()));
  if (!shouldHandlePaste) return;

  event.preventDefault();
  const startIndex = Number(input.dataset.row);
  state.quickOrderRows.splice(startIndex, parsedRows.length, ...parsedRows);
  ensureQuickOrderTrailingRow();
  renderQuickOrderTable({ index: Math.min(startIndex + parsedRows.length, state.quickOrderRows.length - 1), field: "sku" });
}

function focusQuickOrderCell(index, field) {
  const startIndex = state.quickOrderRows.length;
  while (state.quickOrderRows.length <= index) state.quickOrderRows.push({ sku: "", quantity: "" });
  if (state.quickOrderRows.length > startIndex) appendQuickOrderRows(startIndex);
  requestAnimationFrame(() => {
    const input = els.quickOrderTable.querySelector(`[data-row="${index}"][data-field="${field}"]`);
    input?.focus();
    input?.select?.();
  });
}

function ensureQuickOrderTrailingRow() {
  const rows = state.quickOrderRows.filter((row, index) => index === state.quickOrderRows.length - 1 || hasQuickOrderRowValue(row));
  if (!rows.length || hasQuickOrderRowValue(rows[rows.length - 1])) rows.push({ sku: "", quantity: "" });
  state.quickOrderRows = rows;
}

function appendQuickOrderRows(startIndex) {
  const body = els.quickOrderTable.querySelector(".quick-order-table-body");
  if (!body) {
    renderQuickOrderTable();
    return;
  }
  body.insertAdjacentHTML("beforeend", state.quickOrderRows.slice(startIndex).map((row, offset) => renderQuickOrderTableRow(row, startIndex + offset)).join(""));
}

function updateQuickOrderRenderedRow(index) {
  const rowElement = els.quickOrderTable.querySelector(`[data-row="${index}"]`)?.closest(".quick-order-table-row");
  if (!rowElement) return;
  const status = quickOrderRowStatus(resolveQuickOrderRow(state.quickOrderRows[index]));
  rowElement.classList.toggle("is-error", status.isError);
  const productCell = rowElement.querySelector("[data-quick-order-product]");
  const priceCell = rowElement.querySelector("[data-quick-order-price]");
  const totalCell = rowElement.querySelector("[data-quick-order-total]");
  if (productCell) {
    productCell.textContent = status.name;
    productCell.title = status.name;
  }
  if (priceCell) priceCell.textContent = status.priceText;
  if (totalCell) totalCell.textContent = status.totalText;
}

function hasQuickOrderRowValue(row) {
  return Boolean(String(row?.sku || "").trim() || String(row?.quantity || "").trim());
}

function normalizeQuickQuantityText(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function quickOrderRows() {
  return state.quickOrderRows.map(resolveQuickOrderRow).filter((row) => row.sku || row.quantity);
}

function resolveQuickOrderRow(row) {
  const sku = normalizeSkuQuery(row.sku);
  const quantityText = String(row.quantity || "").trim();
  const quantity = Number.parseInt(quantityText.replace(/[^\d-]/g, ""), 10);
  return {
    sku,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    hasQuantity: Boolean(quantityText),
    product: sku ? findProductByQuickSku(sku) : null,
  };
}

function validQuickOrderRows(rows) {
  return rows.filter((row) => row.product && !row.product.outOfStock && row.quantity > 0);
}

function mergedQuickOrderRows(rows) {
  const byProduct = new Map();
  validQuickOrderRows(rows).forEach((row) => {
    const key = row.product.id;
    const existing = byProduct.get(key);
    if (existing) existing.quantity += row.quantity;
    else byProduct.set(key, { ...row });
  });
  return [...byProduct.values()];
}

function quickOrderDuplicateCount(rows) {
  return validQuickOrderRows(rows).length - mergedQuickOrderRows(rows).length;
}

function renderQuickOrderPreview() {
  const rows = quickOrderRows();
  if (!rows.length) {
    els.quickOrderPreview.innerHTML = "";
    els.addQuickOrder.disabled = true;
    return;
  }

  const validRows = mergedQuickOrderRows(rows);
  const duplicateCount = quickOrderDuplicateCount(rows);
  const errorCount = rows.filter((row) => quickOrderRowStatus(row).isError).length;
  const totalValue = validRows.reduce((sum, row) => sum + priceNumber(row.product.price) * row.quantity, 0);
  els.addQuickOrder.disabled = !validRows.length;
  els.quickOrderPreview.innerHTML = `
    <div class="quick-order-preview-head">
      <strong>${validRows.length} fila${validRows.length === 1 ? "" : "s"} válida${validRows.length === 1 ? "" : "s"}</strong>
      <span>${formatMoney(totalValue)}</span>
      ${duplicateCount ? `<em>${duplicateCount} SKU duplicado${duplicateCount === 1 ? "" : "s"} se van a combinar</em>` : ""}
      ${errorCount ? `<em>${errorCount} con error</em>` : ""}
    </div>
  `;
}

function addQuickOrderToCart() {
  const rows = quickOrderRows();
  const duplicateCount = quickOrderDuplicateCount(rows);
  const validRows = mergedQuickOrderRows(rows);
  if (!validRows.length) {
    showToast("No hay filas válidas para agregar");
    renderQuickOrderPreview();
    return;
  }

  validRows.forEach((row) => {
    state.cart.set(row.product.id, (state.cart.get(row.product.id) || 0) + row.quantity);
  });
  mergeDuplicateCartSkus();
  saveCart();
  state.quickOrderRows = [{ sku: "", quantity: "" }];
  renderQuickOrderTable({ index: 0, field: "sku" });
  renderCart();
  showToast(`${validRows.length} SKU${validRows.length === 1 ? "" : "s"} agregado${validRows.length === 1 ? "" : "s"} al carrito${duplicateCount ? " (duplicados combinados)" : ""}`);
}

function clearQuickOrder() {
  state.quickOrderRows = [{ sku: "", quantity: "" }];
  renderQuickOrderTable({ index: 0, field: "sku" });
}

function parseQuickOrderRows(text) {
  const tokens = String(text || "")
    .replace(/[;|,]+/g, "\n")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .flatMap((token) => splitSkuQuantityToken(token));

  const rows = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const sku = String(tokens[index] || "").trim();
    if (!normalizeSkuQuery(sku)) continue;
    const quantity = Number.parseInt(String(tokens[index + 1] || "").replace(/[^\d-]/g, ""), 10);
    const product = findProductByQuickSku(sku);
    rows.push({
      sku,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      product,
    });
  }
  return rows;
}

function splitSkuQuantityToken(token) {
  const text = String(token || "").trim();
  const parts = text.split("-").filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0 && parts.every((part) => /^[a-z0-9]+$/i.test(part))) {
    return parts;
  }
  return [text];
}

function findProductByQuickSku(sku) {
  const normalized = normalizeSkuQuery(sku);
  return state.catalog.products.find((product) => isVisibleProduct(product) && skuFields(product).some((item) => normalizeSkuQuery(item) === normalized)) || null;
}

function renderCart() {
  renderCartClientControls();
  if (mergeDuplicateCartSkus()) saveCart();
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
            <div class="cart-line-actions">
              <div class="qty-controls" aria-label="Controles de cantidad">
                <button type="button" data-dec="${product.id}" aria-label="Disminuir cantidad">-</button>
                <span>${qty}</span>
                <button type="button" data-inc="${product.id}" aria-label="Aumentar cantidad">+</button>
              </div>
              <button class="cart-remove-button${state.pendingCartRemoval === product.id ? " is-confirming" : ""}" type="button" data-remove="${product.id}" aria-label="${state.pendingCartRemoval === product.id ? "Confirmar quitar producto" : "Quitar producto"}">
                ${state.pendingCartRemoval === product.id ? "Confirmar" : "Quitar"}
              </button>
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
  els.cartItems.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => requestCartLineRemoval(button.dataset.remove));
  });

  els.saveOrder.disabled = state.isSavingOrder || !lines.length;
  els.saveOrder.textContent = state.isSavingOrder ? "Enviando..." : (isOnline() ? "Enviar pedido" : "Guardar pendiente");
}

async function saveOrder() {
  if (state.isSavingOrder) return;
  mergeDuplicateCartSkus();

  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isOrderableProduct(line.product));
  if (!lines.length) {
    showToast("Agregá productos antes de enviar el pedido");
    return;
  }
  if (CATALOG_SUPABASE.isAvailable() && isOnline() && !state.user) {
    showToast("Iniciá sesión antes de enviar el pedido");
    openAccount();
    return;
  }
  if (mustSelectSalesClient() && !state.selectedSalesClient) {
    showToast("Elegí un cliente antes de enviar el pedido");
    openCart();
    els.cartSalesClientSearch.focus();
    return;
  }

  let customer = readOrderCustomer();
  let notificationResult = { ok: true };
  state.isSavingOrder = true;
  renderCart();

  try {
    const order = CATALOG_STORE.buildOrderFromLines(lines, customer);
    if (!isOnline()) {
      queueOfflineOrder(order, "Sin conexión");
      clearSubmittedCart();
      state.isSavingOrder = false;
      renderCart();
      showToast("Pedido guardado sin conexión");
      return;
    }

    if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      customer = readOrderCustomer();
      const updatedOrder = CATALOG_STORE.buildOrderFromLines(lines, customer);
      const savedOrder = await CATALOG_SUPABASE.saveOrder(updatedOrder, state.user.id);
      notificationResult = savedOrder.notification || notificationResult;
      await renderCustomerOrders();
    } else {
      CATALOG_STORE.addOrder(order);
    }
  } catch (error) {
    if (isNetworkError(error)) {
      markConnectionLost(error);
      const order = CATALOG_STORE.buildOrderFromLines(lines, readOrderCustomer());
      queueOfflineOrder(order, error.message || "Error de conexión");
      clearSubmittedCart();
      state.isSavingOrder = false;
      renderCart();
      showToast("No había conexión. Pedido guardado pendiente.");
      return;
    }
    showToast(error.message || "No se pudo enviar el pedido");
    state.isSavingOrder = false;
    renderCart();
    return;
  }
  window.dispatchEvent(new CustomEvent("catalog:orders-changed"));
  clearSubmittedCart();
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
  const centerX = stageRect.left + stageRect.width / 2;
  const frame = frames
    .map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        item,
        verticalDistance: rect.bottom >= marker && rect.top <= marker ? 0 : Math.min(Math.abs(rect.top - marker), Math.abs(rect.bottom - marker)),
        horizontalDistance: Math.abs(rect.left + rect.width / 2 - centerX),
      };
    })
    .sort((first, second) => first.verticalDistance - second.verticalDistance || first.horizontalDistance - second.horizontalDistance)[0]?.item || frames[frames.length - 1];
  setCurrentPageIndex(Number(frame.dataset.pageIndex));
}

function scrollPageIntoView(index, behavior = "smooth") {
  const frame = els.pageStrip.querySelector(`[data-page-index="${index}"]`);
  if (!frame) return;
  const scrollToFrame = (scrollBehavior = behavior) => frame.scrollIntoView({ behavior: scrollBehavior, block: "start", inline: "center" });
  scrollToFrame();

  const image = frame.querySelector("img");
  if (image && !image.complete) {
    image.addEventListener("load", () => scrollToFrame("auto"), { once: true });
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollToFrame("auto"));
  });
}

function shouldUseSpreadView() {
  const pageWidth = 760 * (state.zoom / 100);
  const availableWidth = Math.max(0, els.pageStage.clientWidth - 44);
  return state.zoom <= 65 && window.matchMedia("(min-width: 1100px)").matches && availableWidth >= pageWidth * 2 + 22;
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

function scrollFiltersIntoView() {
  document.querySelector(".sidebar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => els.searchInput.focus({ preventScroll: true }));
}

function scrollCatalogIntoView() {
  document.querySelector(".viewer")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

function openQuickOrder() {
  renderQuickOrderTable();
  els.quickOrderDialog.showModal();
  focusQuickOrderCell(0, "sku");
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
  dispatchAuthChanged();
}

function dispatchAuthChanged() {
  window.dispatchEvent(new CustomEvent("catalog:auth-changed", {
    detail: {
      user: state.user,
      profile: state.profile,
      isCheckingAuth: state.isCheckingAuth,
    },
  }));
}

function saveCart() {
  localStorage.setItem("catalogCart", JSON.stringify([...state.cart.entries()]));
}

function isOnline() {
  return navigator.onLine !== false && !state.connectionLost;
}

function loadPendingOfflineOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem("catalogPendingOfflineOrders") || "[]");
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

function savePendingOfflineOrders() {
  localStorage.setItem("catalogPendingOfflineOrders", JSON.stringify(state.pendingOfflineOrders));
}

function queueOfflineOrder(order, reason = "") {
  const queuedOrder = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    userId: state.user?.id || "",
    userEmail: state.user?.email || "",
    reason,
    order,
  };
  state.pendingOfflineOrders.push(queuedOrder);
  savePendingOfflineOrders();
  renderOfflineStatus();
  return queuedOrder;
}

function removePendingOfflineOrder(id) {
  state.pendingOfflineOrders = state.pendingOfflineOrders.filter((item) => item.id !== id);
  savePendingOfflineOrders();
  renderOfflineStatus();
}

function pendingOfflineCount() {
  return state.pendingOfflineOrders.length;
}

function renderOfflineStatus() {
  const count = pendingOfflineCount();
  const online = isOnline();
  const hasPending = count > 0;
  const showBanner = !online || hasPending || state.isSyncingOfflineOrders;

  els.offlineBanner.hidden = !showBanner;
  document.body.classList.toggle("is-offline", !online);
  document.body.classList.toggle("has-offline-banner", showBanner);
  document.body.classList.toggle("has-pending-offline-orders", hasPending);

  if (!showBanner) return;

  if (!online) {
    els.offlineBannerTitle.textContent = "Modo sin conexión";
    els.offlineBannerText.textContent = hasPending
      ? `${count} pedido${count === 1 ? "" : "s"} pendiente${count === 1 ? "" : "s"} guardado${count === 1 ? "" : "s"}. Conectate a internet para enviarlo${count === 1 ? "" : "s"}.`
      : "Estás trabajando con datos guardados. Conectate a internet antes de enviar pedidos.";
  } else if (state.isSyncingOfflineOrders) {
    els.offlineBannerTitle.textContent = "Enviando pedidos pendientes";
    els.offlineBannerText.textContent = `Quedan ${count} pedido${count === 1 ? "" : "s"} en la cola. No cierres esta pestaña.`;
  } else {
    els.offlineBannerTitle.textContent = "Pedidos pendientes";
    els.offlineBannerText.textContent = `${count} pedido${count === 1 ? "" : "s"} guardado${count === 1 ? "" : "s"} sin conexión. Enviá la cola cuando tengas internet estable.`;
  }

  els.syncOfflineOrders.hidden = online && !hasPending;
  els.syncOfflineOrders.disabled = state.isSyncingOfflineOrders;
  els.syncOfflineOrders.textContent = state.isSyncingOfflineOrders
    ? "Enviando..."
    : (online ? `Enviar pendientes (${count})` : "Reintentar conexión");
}

function handleNetworkStatusChange() {
  if (navigator.onLine !== false) state.connectionLost = false;
  renderOfflineStatus();
  renderCart();
  if (isOnline() && pendingOfflineCount()) {
    showToast("Volviste a estar online. Podés enviar los pedidos pendientes.");
  }
}

async function handleOfflineBannerAction() {
  if (isOnline()) {
    await syncPendingOfflineOrders();
    return;
  }

  els.syncOfflineOrders.disabled = true;
  els.syncOfflineOrders.textContent = "Reintentando...";
  const reachable = await canReachSupabase();
  if (reachable) {
    state.connectionLost = false;
    renderOfflineStatus();
    renderCart();
    showToast("Conexión restaurada");
    return;
  }
  renderOfflineStatus();
  showToast("Todavía no hay conexión");
}

function clearSubmittedCart() {
  state.cart.clear();
  clearSelectedSalesClient({ keepInput: false });
  els.cartClientName.value = "";
  els.cartClientCode.value = "";
  els.cartTransport.value = "";
  localStorage.removeItem("catalogCartClientName");
  localStorage.removeItem("catalogCartClientCode");
  saveCart();
}

function isNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return !isOnline() || message.includes("failed to fetch") || message.includes("network") || message.includes("fetch");
}

function markConnectionLost(error) {
  if (!isNetworkError(error)) return false;
  state.connectionLost = true;
  renderOfflineStatus();
  renderCart();
  return true;
}

async function canReachSupabase() {
  if (!CATALOG_SUPABASE.isAvailable()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    await fetch(CATALOG_SUPABASE.config.url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncPendingOfflineOrders() {
  if (state.isSyncingOfflineOrders) return;
  if (!pendingOfflineCount()) return;
  if (!isOnline()) {
    showToast("Conectate a internet para enviar pendientes");
    renderOfflineStatus();
    return;
  }
  if (!CATALOG_SUPABASE.isAvailable() || !state.user) {
    showToast("Iniciá sesión para enviar pedidos pendientes");
    openAccount();
    return;
  }
  const belongsToAnotherUser = state.pendingOfflineOrders.some((queued) => queued.userId && queued.userId !== state.user.id);
  if (belongsToAnotherUser) {
    showToast("Hay pedidos pendientes de otra cuenta. Iniciá sesión con esa cuenta para enviarlos.");
    openAccount();
    return;
  }

  state.isSyncingOfflineOrders = true;
  renderOfflineStatus();

  let sent = 0;
  let emailWarnings = 0;
  let failedMessage = "";

  for (const queued of [...state.pendingOfflineOrders]) {
    try {
      const savedOrder = await CATALOG_SUPABASE.saveOrder(queued.order, state.user.id);
      if (savedOrder.notification && !savedOrder.notification.ok) emailWarnings += 1;
      removePendingOfflineOrder(queued.id);
      sent += 1;
      await delay(800);
    } catch (error) {
      failedMessage = error.message || "No se pudo enviar un pedido pendiente";
      if (isNetworkError(error)) break;
      break;
    }
  }

  state.isSyncingOfflineOrders = false;
  renderOfflineStatus();
  await renderCustomerOrders();
  window.dispatchEvent(new CustomEvent("catalog:orders-changed"));

  if (failedMessage) {
    showToast(`${sent} enviado${sent === 1 ? "" : "s"}. Quedaron pendientes: ${failedMessage}`);
    return;
  }

  if (emailWarnings) {
    showToast(`${sent} pedido${sent === 1 ? "" : "s"} enviado${sent === 1 ? "" : "s"}, ${emailWarnings} con email pendiente`);
    return;
  }

  showToast(`${sent} pedido${sent === 1 ? "" : "s"} pendiente${sent === 1 ? "" : "s"} enviado${sent === 1 ? "" : "s"}`);
}

function rememberAccountSnapshot() {
  if (!state.user) return;
  localStorage.setItem("catalogLastUser", JSON.stringify({
    id: state.user.id,
    email: state.user.email,
  }));
  if (state.profile) {
    localStorage.setItem("catalogLastProfile", JSON.stringify(state.profile));
  }
}

function readAccountSnapshot() {
  try {
    const user = JSON.parse(localStorage.getItem("catalogLastUser") || "null");
    const profile = JSON.parse(localStorage.getItem("catalogLastProfile") || "null");
    if (!user?.id) return null;
    return { user, profile };
  } catch {
    return null;
  }
}

function rememberSalesClientsSnapshot() {
  if (!state.salesClients.length) return;
  localStorage.setItem("catalogLastSalesClients", JSON.stringify(state.salesClients));
}

function readSalesClientsSnapshot() {
  try {
    const clients = JSON.parse(localStorage.getItem("catalogLastSalesClients") || "[]");
    return Array.isArray(clients) ? clients : [];
  } catch {
    return [];
  }
}

function enterOfflineCatalog(message = "Catálogo abierto sin conexión") {
  const snapshot = readAccountSnapshot();
  if (!snapshot) return false;
  state.user = snapshot.user;
  state.profile = snapshot.profile;
  state.salesClients = readSalesClientsSnapshot();
  applyProfileToAuthFields();
  els.accountStatus.textContent = "Sesión guardada sin conexión";
  state.connectionLost = true;
  renderOfflineStatus();
  renderAccount();
  showToast(message);
  return true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("service-worker.js");
  } catch (error) {
    console.warn("No se pudo registrar el modo offline", error);
  }
}

async function precacheCatalogAssets() {
  if (!isOnline() || !("caches" in window) || !state.catalog?.pages?.length) return;
  const imageUrls = [...new Set(state.catalog.pages.map((page) => page.image?.src).filter(Boolean))];
  if (!imageUrls.length) return;

  try {
    const cache = await caches.open("lexo-catalog-pages-v20260612");
    const cachedRequests = await cache.keys();
    const cachedUrls = new Set(cachedRequests.map((request) => new URL(request.url).pathname + new URL(request.url).search));
    const pendingUrls = imageUrls.filter((url) => {
      const absolute = new URL(url, location.href);
      return !cachedUrls.has(absolute.pathname + absolute.search);
    });

    for (let index = 0; index < pendingUrls.length; index += 4) {
      if (!isOnline()) break;
      const chunk = pendingUrls.slice(index, index + 4);
      await Promise.allSettled(chunk.map(async (url) => {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      }));
      await delay(150);
    }
  } catch (error) {
    console.warn("No se pudieron guardar todas las páginas para modo offline", error);
  }
}

function readAccountCustomer() {
  const name = state.profile?.name || els.authName.value || state.user?.email || "";
  const phone = state.profile?.phone || els.authPhone.value || "";
  const clientCode = state.profile?.client_code || "";
  return {
    name,
    phone,
    clientCode,
    notes: "",
  };
}

function readOrderCustomer() {
  const accountCustomer = readAccountCustomer();
  const selectedClient = canSelectSalesClient() ? state.selectedSalesClient : null;
  if (selectedClient) {
    return {
      ...accountCustomer,
      name: selectedClient.name || selectedClient.legalName || accountCustomer.name,
      salesClient: selectedClient,
      salesmanCode: selectedClient.salesmanCode || state.profile?.salesman_code || "",
      transport: orderTransportValue(),
      notes: accountCustomer.notes,
    };
  }

  if (state.profile?.role === "customer") {
    return {
      ...accountCustomer,
      salesmanCode: state.profile.assigned_salesman_code || "",
      transport: orderTransportValue(),
    };
  }

  const clientCode = els.cartClientCode.value.trim();
  return {
    ...accountCustomer,
    name: els.cartClientName.value.trim() || accountCustomer.name,
    salesmanCode: state.profile?.salesman_code || state.profile?.assigned_salesman_code || "",
    notes: clientCode ? `Código de cliente: ${clientCode}` : accountCustomer.notes,
  };
}

function renderCartClientControls() {
  const canSelect = canSelectSalesClient();
  const signedCustomer = Boolean(state.user && state.profile?.role === "customer");
  const canEnterTransport = canEnterOrderTransport();

  els.cartSalesClientPanel.hidden = !canSelect;
  els.cartTransportPanel.hidden = !canEnterTransport;
  els.otherSalesClientToggleWrap.hidden = !canSelect || !canCreateOtherSalesClient();
  els.cartManualClientFields.hidden = CATALOG_SUPABASE.isAvailable() && Boolean(state.user);
  els.cartAccountClientNote.hidden = !signedCustomer;
  if (!canEnterTransport) els.cartTransport.value = "";

  if (!canSelect) {
    els.cartSalesClientResults.hidden = true;
    return;
  }

  els.cartSalesClientSearch.placeholder = state.isLoadingSalesClients
    ? "Cargando clientes..."
    : "Buscar por código o nombre";
  els.cartSalesClientSearch.disabled = state.isLoadingSalesClients || !state.salesClients.length;
  renderSelectedSalesClient();
}

function canSelectSalesClient() {
  return Boolean(state.profile && ["admin", "salesman"].includes(state.profile.role));
}

function canCreateOtherSalesClient() {
  return Boolean(state.profile && ["admin", "salesman"].includes(state.profile.role));
}

function mustSelectSalesClient() {
  return state.profile?.role === "salesman";
}

function canEnterOrderTransport() {
  return ["admin", "customer", "salesman"].includes(state.profile?.role);
}

function orderTransportValue() {
  return canEnterOrderTransport() ? els.cartTransport.value.trim() : "";
}

async function loadSalesClients() {
  state.salesClients = [];
  state.selectedSalesClient = null;
  if (!CATALOG_SUPABASE.isAvailable() || !state.user || !canSelectSalesClient()) {
    renderCart();
    return;
  }

  state.isLoadingSalesClients = true;
  renderCart();
  try {
    state.salesClients = await CATALOG_SUPABASE.loadSalesClients();
    rememberSalesClientsSnapshot();
    restoreSelectedSalesClient();
  } catch (error) {
    const cachedClients = readSalesClientsSnapshot();
    if (markConnectionLost(error) && cachedClients.length) {
      state.salesClients = cachedClients;
      restoreSelectedSalesClient();
    } else {
      console.warn("No se pudieron cargar los clientes del vendedor", error);
      showToast("No se pudieron cargar los clientes");
    }
  } finally {
    state.isLoadingSalesClients = false;
    renderCart();
  }
}

function restoreSelectedSalesClient() {
  const selectedId = localStorage.getItem("catalogSelectedSalesClientId");
  if (!selectedId) return;
  const client = state.salesClients.find((item) => item.id === selectedId);
  if (client) selectSalesClient(client, { silent: true });
  else localStorage.removeItem("catalogSelectedSalesClientId");
}

function renderSalesClientResults() {
  if (!canSelectSalesClient()) return;
  const query = normalizeProductSearch(els.cartSalesClientSearch.value);
  const compactQuery = compactProductSearch(query);
  const matches = state.salesClients
    .map((client) => matchingSalesClient(client, query, compactQuery))
    .filter(Boolean)
    .sort((first, second) => first.score - second.score || first.client.clientCode.localeCompare(second.client.clientCode, "es"))
    .slice(0, 10);

  if (!matches.length) {
    els.cartSalesClientResults.hidden = false;
    els.cartSalesClientResults.innerHTML = `<p>No hay clientes coincidentes.</p>`;
    return;
  }

  els.cartSalesClientResults.hidden = false;
  els.cartSalesClientResults.innerHTML = matches
    .map(({ client }) => `
      <button class="cart-client-result" type="button" role="option" data-client="${escapeAttribute(client.id)}">
        <strong>${escapeHtml(client.clientCode)}</strong>
        <span>${escapeHtml(client.name)}</span>
        <small>${escapeHtml(salesClientAddress(client) || client.legalName || "")}</small>
      </button>
    `)
    .join("");

  els.cartSalesClientResults.querySelectorAll("[data-client]").forEach((button) => {
    button.addEventListener("click", () => {
      const client = state.salesClients.find((item) => item.id === button.dataset.client);
      if (client) selectSalesClient(client);
    });
  });
}

function matchingSalesClient(client, query, compactQuery) {
  if (!query) return { client, score: 5 };
  const code = normalizeSkuQuery(client.clientCode);
  const skuQuery = normalizeSkuQuery(query);
  if (skuQuery && code.startsWith(skuQuery)) return { client, score: 0 };
  if (skuQuery && code.includes(skuQuery)) return { client, score: 1 };

  const text = normalizeProductSearch([
    client.name,
    client.legalName,
    client.address,
    client.locality,
  ].join(" "));
  const compactText = compactProductSearch(text);
  if (text.startsWith(query) || compactText.startsWith(compactQuery)) return { client, score: 2 };
  if (text.includes(query) || compactText.includes(compactQuery)) return { client, score: 3 };
  return null;
}

function selectSalesClient(client, options = {}) {
  state.selectedSalesClient = client;
  localStorage.setItem("catalogSelectedSalesClientId", client.id);
  els.cartSalesClientSearch.value = `${client.clientCode} - ${client.name}`;
  els.cartSalesClientResults.hidden = true;
  renderSelectedSalesClient();
  renderCart();
  if (!options.silent) showToast("Cliente seleccionado");
}

function clearSelectedSalesClient(options = {}) {
  state.selectedSalesClient = null;
  localStorage.removeItem("catalogSelectedSalesClientId");
  if (!options.keepInput) els.cartSalesClientSearch.value = "";
  els.cartSalesClientResults.hidden = true;
  renderSelectedSalesClient();
  renderCart();
}

function renderSelectedSalesClient() {
  const client = state.selectedSalesClient;
  els.clearSalesClient.hidden = !client;
  if (!client) {
    els.cartSelectedSalesClient.hidden = true;
    els.cartSelectedSalesClient.innerHTML = "";
    return;
  }

  els.cartSelectedSalesClient.hidden = false;
  els.cartSelectedSalesClient.innerHTML = `
    <strong>${escapeHtml(client.clientCode)} - ${escapeHtml(client.name)}</strong>
    ${client.legalName && client.legalName !== client.name ? `<span>${escapeHtml(client.legalName)}</span>` : ""}
    ${salesClientAddress(client) ? `<span>${escapeHtml(salesClientAddress(client))}</span>` : ""}
  `;
}

function toggleOtherSalesClientForm() {
  const isOpen = Boolean(els.otherSalesClientToggle.checked);
  els.otherSalesClientForm.hidden = !isOpen;
  els.otherSalesClientMessage.textContent = "";
  if (isOpen) {
    els.cartSalesClientResults.hidden = true;
    els.otherSalesClientCode.focus();
  }
}

async function createAndSelectSalesClient() {
  const client = readOtherSalesClientForm();
  if (!client.clientCode || !client.name) {
    els.otherSalesClientMessage.textContent = "Ingresá código y nombre del cliente.";
    return;
  }

  const salesmanCode = salesmanCodeForNewClient();
  if (!salesmanCode) {
    els.otherSalesClientMessage.textContent = "No hay un codigo de vendedor disponible para crear el cliente.";
    return;
  }

  if (!salesmanCode) {
    els.otherSalesClientMessage.textContent = "Tu perfil no tiene código de vendedor asignado.";
    els.otherSalesClientMessage.textContent = "No hay un cÃ³digo de vendedor disponible para crear el cliente.";
    return;
  }

  try {
    els.createSalesClient.disabled = true;
    els.createSalesClient.textContent = "Creando...";
    els.otherSalesClientMessage.textContent = "";
    const savedClient = await CATALOG_SUPABASE.createSalesClient({
      ...client,
      salesmanCode,
    });
    state.salesClients = [
      savedClient,
      ...state.salesClients.filter((item) => item.clientCode !== savedClient.clientCode),
    ].sort((first, second) => first.clientCode.localeCompare(second.clientCode, "es"));
    clearOtherSalesClientForm();
    selectSalesClient(savedClient);
    showToast("Cliente creado y seleccionado");
  } catch (error) {
    els.otherSalesClientMessage.textContent = friendlyCreateSalesClientError(error);
  } finally {
    els.createSalesClient.disabled = false;
    els.createSalesClient.textContent = "Crear y seleccionar cliente";
  }
}

function readOtherSalesClientForm() {
  return {
    clientCode: normalizeClientCode(els.otherSalesClientCode.value),
    name: els.otherSalesClientName.value.trim(),
    legalName: els.otherSalesClientLegalName.value.trim(),
    address: els.otherSalesClientAddress.value.trim(),
    locality: els.otherSalesClientLocality.value.trim(),
  };
}

function salesmanCodeForNewClient() {
  return String(
    state.profile?.salesman_code
    || state.selectedSalesClient?.salesmanCode
    || state.salesClients.find((client) => client.salesmanCode)?.salesmanCode
    || "",
  ).trim();
}

function clearOtherSalesClientForm() {
  els.otherSalesClientToggle.checked = false;
  els.otherSalesClientForm.hidden = true;
  els.otherSalesClientMessage.textContent = "";
  [
    els.otherSalesClientCode,
    els.otherSalesClientName,
    els.otherSalesClientLegalName,
    els.otherSalesClientAddress,
    els.otherSalesClientLocality,
  ].forEach((input) => {
    input.value = "";
  });
}

function normalizeClientCode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function friendlyCreateSalesClientError(error) {
  const message = String(error?.message || "No se pudo crear el cliente.");
  if (message.includes("duplicate key") || message.includes("sales_clients_client_code")) {
    return "Ese código de cliente ya existe.";
  }
  return message;
}

function salesClientAddress(client) {
  return [client.address, client.locality].filter(Boolean).join(" - ");
}

function normalizeSalesmanCode(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([^-]+)/);
  return (match ? match[1] : text).replace(/\s+/g, "").trim();
}

function readEnteredSalesmanCode() {
  return normalizeSalesmanCode(els.createSalesmanCode.value);
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
    if (!enterOfflineCatalog("Sesión guardada sin conexión")) {
      state.connectionLost = true;
      els.accountStatus.textContent = "Iniciá sesión con internet antes de usar el modo sin conexión";
      renderOfflineStatus();
      applyAuthGate();
    }
    return;
  }

  let accountError = false;

  try {
    state.user = await CATALOG_SUPABASE.getSessionUser() || await CATALOG_SUPABASE.getUser();
    if (state.user) {
      try {
        state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
      } catch (error) {
        if (!markConnectionLost(error)) throw error;
        state.profile = readAccountSnapshot()?.profile || null;
      }
      applyProfileToAuthFields();
      rememberAccountSnapshot();
      await loadSalesClients();
    } else if (navigator.onLine === false || state.connectionLost || !(await canReachSupabase())) {
      state.connectionLost = true;
      if (!enterOfflineCatalog("Sesión guardada sin conexión")) {
        accountError = true;
        state.connectionLost = true;
        els.accountStatus.textContent = "Iniciá sesión con internet antes de usar el modo sin conexión";
      }
    }
  } catch (error) {
    const snapshot = readAccountSnapshot();
    if (markConnectionLost(error) || navigator.onLine === false) {
      if (!enterOfflineCatalog(snapshot ? "Sesión guardada sin conexión" : "")) {
        accountError = true;
        state.connectionLost = true;
        els.accountStatus.textContent = "Iniciá sesión con internet antes de usar el modo sin conexión";
      }
    } else {
      accountError = true;
      els.accountStatus.textContent = "Falta configurar la cuenta";
    }
  } finally {
    state.isCheckingAuth = false;
  }

  if (accountError) {
    els.authFields.classList.remove("is-hidden");
    renderOfflineStatus();
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
    state.connectionLost = false;
    state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
    if (!state.profile) state.profile = await saveCustomerProfile();
    applyProfileToAuthFields();
    rememberAccountSnapshot();
    await loadSalesClients();
    renderAccount();
    await renderCustomerOrders();
    applyAuthGate();
    closeAccount();
    showToast("Sesión iniciada");
  } catch (error) {
    if (markConnectionLost(error) || navigator.onLine === false) {
      const snapshot = readAccountSnapshot();
      if (snapshot && snapshot.user?.email && els.authEmail.value.trim() && snapshot.user.email !== els.authEmail.value.trim()) {
        showAuthError(new Error("No se puede verificar esta cuenta sin conexión. Conectate a internet para iniciar sesión."));
        return;
      }
      clearAuthMessage();
      if (enterOfflineCatalog("Sesión guardada sin conexión")) closeAccount();
      else showAuthError(new Error("Necesitás iniciar sesión con internet antes de usar el modo sin conexión."));
      return;
    }
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
      assignedSalesmanCode: normalizeSalesmanCode(els.createSalesmanCode.value),
    });
    state.profile = state.user ? await CATALOG_SUPABASE.getProfile(state.user.id) : null;
    rememberAccountSnapshot();
    await loadSalesClients();
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
    rememberAccountSnapshot();
    await loadSalesClients();
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
    state.salesClients = [];
    state.selectedSalesClient = null;
    localStorage.removeItem("catalogLastUser");
    localStorage.removeItem("catalogLastProfile");
    localStorage.removeItem("catalogLastSalesClients");
    localStorage.removeItem("catalogSelectedSalesClientId");
    els.cartTransport.value = "";
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
    assignedSalesmanCode: state.profile?.assigned_salesman_code ? "" : readEnteredSalesmanCode(),
  });
  rememberAccountSnapshot();
  applyProfileToAuthFields();
  return state.profile;
}

function applyProfileToAuthFields() {
  if (!state.profile) return;
  els.authName.value = state.profile.name || els.authName.value;
  els.authPhone.value = state.profile.phone || els.authPhone.value;
  els.authCompany.value = state.profile.company || "";
  if (state.profile.assigned_salesman_code) {
    els.createSalesmanCode.value = state.profile.assigned_salesman_code;
  }
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
  if (message.toLowerCase().includes("assigned_salesman_code") || message.toLowerCase().includes("profiles_assigned_salesman_code_fkey")) {
    return "Código de vendedor no válido.";
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
    els.customerOrders.innerHTML = orders.length
      ? `
        <button class="secondary-button compact-button customer-repeat-last" type="button" data-repeat-order="${escapeHtml(orders[0].id)}">Repetir &uacute;ltimo pedido</button>
        ${orders
          .slice(0, 5)
          .map(
            (order) => `
              <button class="customer-order-line" type="button" data-order="${escapeHtml(order.id)}">
                <strong>${escapeHtml(order.displayId || order.id)}</strong>
                <span>${new Date(order.createdAt).toLocaleDateString("es-AR")} - ${formatMoney(order.totalValue)}</span>
              </button>
            `,
          )
          .join("")}
      `
      : `<p>Todav&iacute;a no hay pedidos anteriores.</p>`;
    els.customerOrders.querySelectorAll("[data-order]").forEach((button) => {
      button.addEventListener("click", () => showCustomerOrderDetail(button.dataset.order));
    });
    els.customerOrders.querySelectorAll("[data-repeat-order]").forEach((button) => {
      button.addEventListener("click", () => repeatPastOrder(button.dataset.repeatOrder));
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
      <p>${new Date(order.createdAt).toLocaleString("es-AR")}</p>
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
    <button id="repeatOrder" class="primary-button" type="button">Repetir este pedido</button>
  `;
  els.customerOrderDetail.querySelector("#backToOrders").addEventListener("click", collapseCustomerOrderDetail);
  els.customerOrderDetail.querySelector("#repeatOrder").addEventListener("click", () => repeatPastOrder(order.id));
}

function repeatPastOrder(orderId) {
  const order = (state.customerOrders || []).find((item) => item.id === orderId);
  if (!order) return;

  let addedLines = 0;
  let addedUnits = 0;
  let unavailable = 0;

  order.items.forEach((item) => {
    const product = productForPastOrderItem(item);
    if (!isOrderableProduct(product)) {
      unavailable += 1;
      return;
    }
    const quantity = Math.max(1, Number.parseInt(item.qty, 10) || 1);
    state.cart.set(product.id, (state.cart.get(product.id) || 0) + quantity);
    addedLines += 1;
    addedUnits += quantity;
  });

  mergeDuplicateCartSkus();
  saveCart();
  restoreOrderContext(order);
  renderCart();
  openCart();

  if (!addedLines) {
    showToast("No se pudieron repetir productos disponibles");
    return;
  }

  showToast(`${addedUnits} unidad${addedUnits === 1 ? "" : "es"} agregada${addedUnits === 1 ? "" : "s"} al carrito${unavailable ? ` - ${unavailable} no disponible${unavailable === 1 ? "" : "s"}` : ""}`);
}

function productForPastOrderItem(item) {
  const byId = state.productsById.get(item.productId);
  if (isVisibleProduct(byId)) return byId;
  return findProductByQuickSku(item.sku);
}

function restoreOrderContext(order) {
  if (canSelectSalesClient() && order.customer?.salesClient?.id) {
    const client = state.salesClients.find((item) => item.id === order.customer.salesClient.id || item.clientCode === order.customer.salesClient.clientCode);
    if (client) selectSalesClient(client);
  }
  if (canEnterOrderTransport()) {
    els.cartTransport.value = order.customer?.transport || "";
  }
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
