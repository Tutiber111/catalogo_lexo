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
  quickOrderSuggestionIndex: -1,
  quickOrderSuggestionTarget: null,
  quickOrderSuggestionItems: [],
  barcodeScanBuffer: "",
  barcodeScanStartedAt: 0,
  barcodeScanLastAt: 0,
  barcodeScanGaps: [],
  barcodeScanTimer: null,
  barcodeScanLikely: false,
  barcodeScanTarget: null,
  barcodeScanInitialValue: "",
  barcodeScanInitialStart: null,
  barcodeScanInitialEnd: null,
  pendingCartRemoval: null,
  priceAccessActive: null,
  cartView: "products",
  guestAccess: null,
  guestLinkToken: "",
  isRedeemingGuestAccess: false,
  isCreatingGuestLink: false,
  isLoadingGuestLinks: false,
  guestLinksLoaded: false,
  guestLinks: [],
  isPasswordRecovery: false,
  isExportingCatalogPdf: false,
  lastOrderReceipt: loadLastOrderReceipt(),
  pageObserver: null,
  catalogCachePromise: null,
  catalogCacheQueue: [],
  catalogCachedSections: new Set(),
};

const BARCODE_SCAN_MIN_LENGTH = 8;
const BARCODE_SCAN_SETTLE_MS = 480;
const BARCODE_SCAN_RESET_GAP_MS = 500;
const BARCODE_SCAN_MAX_AVERAGE_GAP_MS = 90;
const BARCODE_SCAN_MAX_TOTAL_MS = 3500;
const VIEWER_HYDRATE_RADIUS = 3;
const VIEWER_RETAIN_RADIUS = 5;
const PENDING_PRICE_COVERS = new Map([
  [348, [{ x: 0.5, y: 0.217, w: 0.31, h: 0.065, background: "#f7f7f7" }]],
]);

let pageScrollFrame = 0;
let viewportUpdateFrame = 0;

const els = {
  offlineBanner: document.querySelector("#offlineBanner"),
  offlineBannerTitle: document.querySelector("#offlineBannerTitle"),
  offlineBannerText: document.querySelector("#offlineBannerText"),
  syncOfflineOrders: document.querySelector("#syncOfflineOrders"),
  priceAccessNotice: document.querySelector("#priceAccessNotice"),
  checkPriceAccess: document.querySelector("#checkPriceAccess"),
  guestAccessGate: document.querySelector("#guestAccessGate"),
  guestAccessIntro: document.querySelector("#guestAccessIntro"),
  guestAccessCode: document.querySelector("#guestAccessCode"),
  redeemGuestAccess: document.querySelector("#redeemGuestAccess"),
  cancelGuestAccess: document.querySelector("#cancelGuestAccess"),
  guestAccessMessage: document.querySelector("#guestAccessMessage"),
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
  mobileOpenCatalog: document.querySelector("#mobileOpenCatalog"),
  mobileOpenQuickOrder: document.querySelector("#mobileOpenQuickOrder"),
  mobileOpenCart: document.querySelector("#mobileOpenCart"),
  mobileCartCount: document.querySelector("#mobileCartCount"),
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
  quickOrderSuggestions: document.querySelector("#quickOrderSuggestions"),
  quickOrderPreview: document.querySelector("#quickOrderPreview"),
  addQuickOrder: document.querySelector("#addQuickOrder"),
  clearQuickOrder: document.querySelector("#clearQuickOrder"),
  cartItems: document.querySelector("#cartItems"),
  cartTotalItems: document.querySelector("#cartTotalItems"),
  cartTotalValue: document.querySelector("#cartTotalValue"),
  cartDetailsTotalItems: document.querySelector("#cartDetailsTotalItems"),
  cartDetailsTotalValue: document.querySelector("#cartDetailsTotalValue"),
  cartProductsTab: document.querySelector("#cartProductsTab"),
  cartDetailsTab: document.querySelector("#cartDetailsTab"),
  cartProductsView: document.querySelector("#cartProductsView"),
  cartDetailsView: document.querySelector("#cartDetailsView"),
  continueCart: document.querySelector("#continueCart"),
  backToCartProducts: document.querySelector("#backToCartProducts"),
  cartSalesClientPanel: document.querySelector("#cartSalesClientPanel"),
  cartSalesClientSearch: document.querySelector("#cartSalesClientSearch"),
  cartSalesClientResults: document.querySelector("#cartSalesClientResults"),
  cartSelectedSalesClient: document.querySelector("#cartSelectedSalesClient"),
  clearSalesClient: document.querySelector("#clearSalesClient"),
  cartTransportPanel: document.querySelector("#cartTransportPanel"),
  cartTransport: document.querySelector("#cartTransport"),
  cartObservations: document.querySelector("#cartObservations"),
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
  salesmanCatalogTools: document.querySelector("#salesmanCatalogTools"),
  createGuestLink: document.querySelector("#createGuestLink"),
  guestLinkResult: document.querySelector("#guestLinkResult"),
  guestLinkUrl: document.querySelector("#guestLinkUrl"),
  guestLinkPassword: document.querySelector("#guestLinkPassword"),
  guestLinkExpiry: document.querySelector("#guestLinkExpiry"),
  guestLinkMessage: document.querySelector("#guestLinkMessage"),
  copyGuestLink: document.querySelector("#copyGuestLink"),
  copyGuestPassword: document.querySelector("#copyGuestPassword"),
  refreshGuestLinks: document.querySelector("#refreshGuestLinks"),
  guestLinksStatus: document.querySelector("#guestLinksStatus"),
  guestLinksList: document.querySelector("#guestLinksList"),
  pdfBrandSelect: document.querySelector("#pdfBrandSelect"),
  exportCatalogPdf: document.querySelector("#exportCatalogPdf"),
  pdfExportStatus: document.querySelector("#pdfExportStatus"),
  saveOrder: document.querySelector("#saveOrder"),
  openLastReceipt: document.querySelector("#openLastReceipt"),
  orderReceiptDialog: document.querySelector("#orderReceiptDialog"),
  orderReceiptContent: document.querySelector("#orderReceiptContent"),
  downloadOrderReceipt: document.querySelector("#downloadOrderReceipt"),
  productDialog: document.querySelector("#productDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  videoDialog: document.querySelector("#videoDialog"),
  videoDialogTitle: document.querySelector("#videoDialogTitle"),
  videoFrame: document.querySelector("#videoFrame"),
  toast: document.querySelector("#toast"),
};

async function init() {
  updateViewportMetrics();
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
  renderPdfBrandOptions();
  renderLastOrderReceiptAvailability();
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
  scheduleCatalogAssetCache();
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
  els.mobileOpenCatalog.addEventListener("click", () => scrollFiltersIntoView({ focusSearch: false }));
  els.mobileOpenQuickOrder.addEventListener("click", openQuickOrder);
  els.mobileOpenCart.addEventListener("click", openCart);
  els.closeCart.addEventListener("click", closeCart);
  els.cartProductsTab.addEventListener("click", () => setCartView("products"));
  els.cartDetailsTab.addEventListener("click", () => setCartView("details"));
  els.continueCart.addEventListener("click", () => setCartView("details", { focus: true }));
  els.backToCartProducts.addEventListener("click", () => setCartView("products", { focus: true }));
  els.openQuickOrder.addEventListener("click", openQuickOrder);
  els.quickOrderTable.addEventListener("input", handleQuickOrderInput);
  els.quickOrderTable.addEventListener("keydown", handleQuickOrderKeydown);
  els.quickOrderTable.addEventListener("paste", handleQuickOrderPaste);
  els.quickOrderTable.addEventListener("focusin", handleQuickOrderFocus);
  els.quickOrderTable.addEventListener("focusout", handleQuickOrderBlur);
  els.quickOrderSuggestions.addEventListener("pointerdown", handleQuickOrderSuggestionPointer);
  els.quickOrderSuggestions.addEventListener("click", handleQuickOrderSuggestionClick);
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
  els.openLastReceipt.addEventListener("click", openLastOrderReceipt);
  els.downloadOrderReceipt.addEventListener("click", downloadLastOrderReceipt);
  els.syncOfflineOrders.addEventListener("click", handleOfflineBannerAction);
  els.checkPriceAccess.addEventListener("click", refreshCurrentPriceAccess);
  els.redeemGuestAccess.addEventListener("click", redeemGuestAccess);
  els.cancelGuestAccess.addEventListener("click", cancelGuestAccess);
  els.guestAccessCode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    redeemGuestAccess();
  });
  els.guestAccessCode.addEventListener("input", () => {
    els.guestAccessCode.value = els.guestAccessCode.value.replace(/\D/g, "").slice(0, 6);
  });
  els.createGuestLink.addEventListener("click", createGuestLink);
  els.copyGuestLink.addEventListener("click", () => copyGuestValue(els.guestLinkUrl.value, "Enlace copiado"));
  els.copyGuestPassword.addEventListener("click", () => copyGuestValue(els.guestLinkPassword.value, "Clave copiada"));
  els.refreshGuestLinks.addEventListener("click", loadGuestLinks);
  els.guestLinksList.addEventListener("click", handleGuestLinkAction);
  els.exportCatalogPdf.addEventListener("click", exportCatalogPdf);
  els.productDialog.addEventListener("close", clearCatalogSelectionFocus);
  els.productDialog.addEventListener("cancel", clearCatalogSelectionFocus);
  els.videoDialog.addEventListener("close", closeProductVideo);
  els.videoDialog.addEventListener("cancel", closeProductVideo);
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
    state.isPasswordRecovery = true;
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
  window.addEventListener("resize", scheduleViewportLayoutRefresh);
  window.visualViewport?.addEventListener("resize", scheduleViewportLayoutRefresh);
  window.addEventListener("orientationchange", () => {
    scheduleViewportLayoutRefresh();
    window.setTimeout(scheduleViewportLayoutRefresh, 120);
    window.setTimeout(scheduleViewportLayoutRefresh, 420);
  });
  window.addEventListener("online", handleNetworkStatusChange);
  window.addEventListener("offline", handleNetworkStatusChange);
  window.addEventListener("keydown", handleBarcodeScannerKeydown, true);
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
      prioritizeCatalogSectionCache(currentPage()?.section);
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
            <p>${escapeHtml(product.section || "Catálogo")} · ${escapeHtml(product.sku)}${hasPriceAccess() ? ` · ${product.outOfStock ? "Sin stock" : escapeHtml(product.price)}` : ""} · Página ${product.page}</p>
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
  if (state.pageObserver) state.pageObserver.disconnect();
  const visibleIndexes = visiblePageIndexes();
  const currentPosition = visibleIndexes.indexOf(state.currentIndex);
  els.pageStrip.innerHTML = visibleIndexes
    .map((index, position) => renderPageFrame(
      state.catalog.pages[index],
      index,
      Math.abs(position - currentPosition) <= VIEWER_HYDRATE_RADIUS,
    ))
    .join("");
  observeViewerPages();
}

function renderPageFrame(page, index, hydrated = false) {
  const imageWidth = Number(page.image.width) || 1013;
  const imageHeight = Number(page.image.height) || 1432;

  return `
    <article class="page-frame${hydrated ? " is-hydrated" : ""}" data-page-index="${index}" data-hydrated="${hydrated ? "true" : "false"}" aria-label="Página ${page.number} del catálogo" style="aspect-ratio:${imageWidth}/${imageHeight}">
      ${hydrated ? renderPageFrameContent(page, index) : renderPagePlaceholder()}
    </article>
  `;
}

function renderPageFrameContent(page, index) {
  const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  const imageWidth = Number(page.image.width) || 1013;
  const imageHeight = Number(page.image.height) || 1432;
  return `
    <img src="${escapeHtml(page.image.src)}" width="${imageWidth}" height="${imageHeight}" alt="Página ${page.number} del catálogo" loading="${index === state.currentIndex ? "eager" : "lazy"}" decoding="async">
    <div class="hotspot-layer">
      ${products.map(renderHotspot).join("")}
      ${(page.priceGroups || []).map(renderPriceOverlay).join("")}
      ${renderPendingPriceCovers(page)}
    </div>
  `;
}

function renderPagePlaceholder() {
  return '<span class="page-frame-placeholder" aria-hidden="true"></span>';
}

function observeViewerPages() {
  if (!("IntersectionObserver" in window)) return;
  state.pageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.dataset.inView = entry.isIntersecting ? "true" : "false";
      if (entry.isIntersecting) hydratePageFrame(Number(entry.target.dataset.pageIndex));
    });
    trimHydratedViewerPages();
  }, {
    root: els.pageStage,
    rootMargin: "120% 0px",
    threshold: 0.01,
  });
  els.pageStrip.querySelectorAll("[data-page-index]").forEach((frame) => state.pageObserver.observe(frame));
}

function hydratePageFrame(index) {
  const frame = els.pageStrip.querySelector(`[data-page-index="${index}"]`);
  const page = state.catalog.pages[index];
  if (!frame || !page || frame.dataset.hydrated === "true") return frame;
  frame.innerHTML = renderPageFrameContent(page, index);
  frame.dataset.hydrated = "true";
  frame.classList.add("is-hydrated");
  return frame;
}

function dehydratePageFrame(frame) {
  if (!frame || frame.dataset.hydrated !== "true") return;
  frame.innerHTML = renderPagePlaceholder();
  frame.dataset.hydrated = "false";
  frame.classList.remove("is-hydrated");
}

function hydrateViewerWindow() {
  const visibleIndexes = visiblePageIndexes();
  const currentPosition = visibleIndexes.indexOf(state.currentIndex);
  if (currentPosition < 0) return;
  visibleIndexes.slice(
    Math.max(0, currentPosition - VIEWER_HYDRATE_RADIUS),
    currentPosition + VIEWER_HYDRATE_RADIUS + 1,
  ).forEach(hydratePageFrame);
  trimHydratedViewerPages();
}

function trimHydratedViewerPages() {
  const visibleIndexes = visiblePageIndexes();
  const currentPosition = visibleIndexes.indexOf(state.currentIndex);
  if (currentPosition < 0) return;
  const positions = new Map(visibleIndexes.map((index, position) => [index, position]));
  els.pageStrip.querySelectorAll('[data-hydrated="true"]').forEach((frame) => {
    const index = Number(frame.dataset.pageIndex);
    const distance = Math.abs((positions.get(index) ?? currentPosition) - currentPosition);
    if (distance > VIEWER_RETAIN_RADIUS && frame.dataset.inView !== "true") dehydratePageFrame(frame);
  });
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
  const brandClass = product.section === "Lexo" ? " hotspot--lexo" : "";
  const hotspotStyle = product.hotspotStyle || {};
  const borderStyle = hotspotStyle.borderColor ? `;--hotspot-border-color:${hotspotStyle.borderColor}` : "";
  return `
    <button
      class="hotspot${brandClass}${stockClass}"
      type="button"
      data-product="${product.id}"
      aria-label="Abrir ${escapeHtml(product.name)}${product.outOfStock ? " - sin stock" : ""}"
      style="left:${spot.x * 100}%;top:${spot.y * 100}%;width:${spot.w * 100}%;height:${spot.h * 100}%${borderStyle}"
    >
      <span>+</span>
    </button>
  `;
}

function renderPriceOverlay(group) {
  if (!group.price || !group.position) return "";
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  if (!products.length) return "";
  const pricesVisible = hasPriceAccess();
  const allOutOfStock = products.every((product) => product.outOfStock);
  const prices = [...new Set(products.map((product) => product.price).filter(Boolean))];
  const price = pricesVisible ? (allOutOfStock ? "Sin stock" : (prices.length === 1 ? prices[0] : group.price)) : "";
  const pos = group.position;
  const cover = group.cover || {};
  const overlayStyle = group.style || {};
  const coverStyle = [
    `left:${pos.x * 100}%`,
    `top:${pos.y * 100}%`,
    cover.w ? `--cover-w:${cover.w * 100}%` : "",
    cover.h ? `--cover-h:${cover.h * 100}%` : "",
    overlayStyle.fontSize ? `--price-font-size:${overlayStyle.fontSize}${overlayStyle.fontSizeUnit || "px"}` : "",
    overlayStyle.minWidth !== undefined ? `--price-min-width:${overlayStyle.minWidth}px` : "",
    overlayStyle.minHeight !== undefined ? `--price-min-height:${overlayStyle.minHeight}px` : "",
    overlayStyle.padX !== undefined ? `--price-pad-x:${overlayStyle.padX}px` : "",
    overlayStyle.padY !== undefined ? `--price-pad-y:${overlayStyle.padY}px` : "",
    overlayStyle.radius !== undefined ? `--price-radius:${overlayStyle.radius}px` : "",
    overlayStyle.shadow ? `--price-shadow:${overlayStyle.shadow}` : "",
    overlayStyle.color ? `--price-color:${overlayStyle.color}` : "",
    overlayStyle.background ? `--price-bg:${overlayStyle.background}` : "",
    overlayStyle.borderColor ? `--price-border-color:${overlayStyle.borderColor}` : "",
    overlayStyle.fontWeight ? `--price-font-weight:${overlayStyle.fontWeight}` : "",
  ].filter(Boolean).join(";");
  const variantClass = group.variant ? ` price-overlay--${escapeAttribute(group.variant)}` : "";
  const stockClass = pricesVisible && allOutOfStock ? " is-out-of-stock" : "";
  const hiddenClass = pricesVisible ? "" : " is-price-hidden";
  return `
    <button
      class="price-overlay${variantClass}${stockClass}${hiddenClass}"
      type="button"
      ${pricesVisible ? `data-group="${group.id}"` : 'aria-hidden="true" tabindex="-1"'}
      ${pricesVisible ? `aria-label="${allOutOfStock ? "Abrir productos sin stock" : `Abrir productos con precio ${escapeHtml(price)}`}"` : ""}
      style="${coverStyle}"
    >${pricesVisible ? escapeHtml(price) : "&nbsp;"}</button>
  `;
}

function renderPendingPriceCovers(page) {
  if (hasPriceAccess()) return "";
  return (PENDING_PRICE_COVERS.get(page.number) || []).map((cover) => `
    <span
      class="price-overlay is-price-hidden pending-price-cover"
      aria-hidden="true"
      style="left:${cover.x * 100}%;top:${cover.y * 100}%;--cover-w:${cover.w * 100}%;--cover-h:${cover.h * 100}%;--price-bg:${cover.background};--price-border-color:transparent"
    >&nbsp;</span>
  `).join("");
}

function openPriceGroup(groupId, pageIndex = state.currentIndex) {
  const page = state.catalog.pages[pageIndex] || currentPage();
  const group = (page.priceGroups || []).find((item) => item.id === groupId);
  if (!group) return;
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  if (!hasPriceAccess()) {
    renderReadOnlyProductGroup(page, group, products);
    return;
  }
  const allOutOfStock = products.length > 0 && products.every((product) => product.outOfStock);
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
      <div class="price${allOutOfStock ? " is-out-of-stock" : ""}">${allOutOfStock ? "Sin stock" : escapeHtml(group.price)}</div>
      <div class="group-list">
        ${products
          .map(
            (product) => `
              <div class="group-product${product.outOfStock ? " is-out-of-stock" : ""}" data-group-product="${product.id}">
                <div>
                  <span>${escapeHtml(product.name)}</span>
                  <strong>${escapeHtml(product.sku)}</strong>
                  <em class="group-product-status" data-added-status="${product.id}" aria-live="polite"></em>
                  ${product.videoUrl ? `<button class="group-video-button" type="button" data-video-product="${product.id}"><span aria-hidden="true">&#9654;</span> Ver video</button>` : ""}
                </div>
                <div class="dialog-qty">
                  <span>Cant.</span>
                  <div class="quantity-stepper quantity-stepper-compact">
                    <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Disminuir cantidad"${product.outOfStock ? " disabled" : ""}>-</button>
                    <input type="number" min="1" step="1" value="1" inputmode="numeric" data-qty="${product.id}"${product.outOfStock ? " disabled" : ""}>
                    <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Aumentar cantidad"${product.outOfStock ? " disabled" : ""}>+</button>
                  </div>
                  <strong class="dialog-line-total" data-total-for="${product.id}">${product.outOfStock ? "Sin stock" : `Total ${formatMoney(priceNumber(product.price))}`}</strong>
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
  bindProductVideoButtons();
  showCatalogDialog(els.productDialog);
}

function renderReadOnlyProductGroup(page, group, products) {
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">${escapeHtml(displayCatalogLabel(page.title))}</span>
        <h2>${escapeHtml(group.label)}</h2>
      </div>
      <p class="price-access-dialog-message">Los precios y pedidos se habilitar&aacute;n cuando un administrador apruebe tu cuenta.</p>
      <div class="group-list">
        ${products.map((product) => `
          <div class="group-product${product.outOfStock ? " is-out-of-stock" : ""}">
            <div>
              <span>${escapeHtml(product.name)}</span>
              <strong>${escapeHtml(product.sku)}</strong>
              ${product.videoUrl ? `<button class="group-video-button" type="button" data-video-product="${product.id}"><span aria-hidden="true">&#9654;</span> Ver video</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  bindProductVideoButtons();
  showCatalogDialog(els.productDialog);
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
  if (isCatalogDialogOpen(els.productDialog)) closeCatalogDialog(els.productDialog);
  const outOfStock = Boolean(product.outOfStock);
  const pricesVisible = hasPriceAccess();
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h2>${escapeHtml(product.name)}</h2>
      </div>
      ${product.videoUrl ? `<button class="product-video-button" type="button" data-video-product="${product.id}"><span aria-hidden="true">&#9654;</span> Ver video</button>` : ""}
      <div class="product-meta">
        <span>SKU: ${escapeHtml(product.sku)}</span>
        ${product.ean ? `<span>EAN: ${escapeHtml(product.ean)}</span>` : ""}
      </div>
      ${pricesVisible ? `<div class="price${outOfStock ? " is-out-of-stock" : ""}">${outOfStock ? "Sin stock" : escapeHtml(product.price)}</div>` : `
        <p class="price-access-dialog-message">Los precios y pedidos se habilitar&aacute;n cuando un administrador apruebe tu cuenta.</p>
      `}
      ${outOfStock || !pricesVisible ? "" : `
        <div class="dialog-qty dialog-qty-wide">
          <span>Cantidad</span>
          <div class="quantity-stepper">
            <button class="quantity-step-button" type="button" data-qty-step="-1" aria-label="Disminuir cantidad">-</button>
            <input id="productQty" type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="Cantidad">
            <button class="quantity-step-button" type="button" data-qty-step="1" aria-label="Aumentar cantidad">+</button>
          </div>
        </div>
        <div class="dialog-total" data-total-for="${product.id}">
          <span>Total</span>
          <strong>${formatMoney(priceNumber(product.price))}</strong>
        </div>
      `}
      ${pricesVisible ? `<button class="primary-button" type="button" data-add="${product.id}"${outOfStock ? " disabled" : ""}>${outOfStock ? "Sin stock" : "Agregar al carrito"}</button>` : ""}
    </div>
  `;
  bindDialogQuantitySteppers();
  bindProductVideoButtons();
  if (!outOfStock && pricesVisible) {
    els.dialogContent.querySelector("[data-add]").addEventListener("click", () => {
      addToCart(product.id, readQuantity(els.dialogContent.querySelector("#productQty")));
      closeCatalogDialog(els.productDialog);
    });
  }
  showCatalogDialog(els.productDialog);
}

function bindProductVideoButtons() {
  els.dialogContent.querySelectorAll("[data-video-product]").forEach((button) => {
    button.addEventListener("click", () => openProductVideo(state.productsById.get(button.dataset.videoProduct)));
  });
}

function openProductVideo(product) {
  const videoId = youtubeVideoId(product?.videoUrl);
  if (!videoId) {
    showToast("El enlace de video no es valido");
    return;
  }

  els.videoDialogTitle.textContent = product.name;
  els.videoFrame.title = `Video de ${product.name}`;
  els.videoFrame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
  showCatalogDialog(els.videoDialog);
}

function showCatalogDialog(dialog) {
  if (window.CATALOG_DIALOG) {
    window.CATALOG_DIALOG.open(dialog);
    return;
  }
  if (!dialog.open) dialog.showModal();
}

function closeCatalogDialog(dialog) {
  if (window.CATALOG_DIALOG) {
    window.CATALOG_DIALOG.close(dialog);
    return;
  }
  if (dialog.open) dialog.close();
}

function isCatalogDialogOpen(dialog) {
  return window.CATALOG_DIALOG ? window.CATALOG_DIALOG.isOpen(dialog) : Boolean(dialog?.open);
}

function closeProductVideo() {
  els.videoFrame.src = "";
  els.videoFrame.title = "Video del producto";
  els.videoDialogTitle.textContent = "";
}

function youtubeVideoId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      if (!videoId) videoId = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] || "";
    }
    return /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? videoId : "";
  } catch (error) {
    return "";
  }
}

function clearCatalogSelectionFocus() {
  const active = document.activeElement;
  if (active && (active.matches?.(".hotspot, .price-overlay") || els.productDialog.contains(active))) {
    active.blur();
  }
  els.pageStrip.querySelectorAll(".hotspot, .price-overlay").forEach((button) => button.blur());
}

function handleBarcodeScannerKeydown(event) {
  if (!barcodeScannerCanListen() || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return;

  const now = performance.now();
  if (event.key === "Enter" || event.key === "Tab") {
    if (!state.barcodeScanBuffer) return;
    if (state.barcodeScanLikely) {
      event.preventDefault();
      event.stopPropagation();
    }
    finishBarcodeScan();
    return;
  }

  if (!isBarcodeScannerCharacter(event.key)) return;

  const gap = state.barcodeScanLastAt ? now - state.barcodeScanLastAt : 0;
  if (!state.barcodeScanBuffer || gap > BARCODE_SCAN_RESET_GAP_MS) {
    startBarcodeScan(event.key, now, event.target);
  } else {
    state.barcodeScanBuffer += event.key;
    state.barcodeScanGaps.push(gap);
    state.barcodeScanLastAt = now;
  }

  updateBarcodeScanLikelihood();
  if (state.barcodeScanLikely) {
    event.preventDefault();
    event.stopPropagation();
  }

  clearTimeout(state.barcodeScanTimer);
  state.barcodeScanTimer = setTimeout(finishBarcodeScan, BARCODE_SCAN_SETTLE_MS);
}

function barcodeScannerCanListen() {
  return Boolean(state.catalog?.products?.length && !document.body.classList.contains("auth-required"));
}

function isBarcodeScannerCharacter(key) {
  return typeof key === "string" && key.length === 1 && /^[a-z0-9]$/i.test(key);
}

function startBarcodeScan(character, now, target) {
  clearTimeout(state.barcodeScanTimer);
  state.barcodeScanBuffer = character;
  state.barcodeScanStartedAt = now;
  state.barcodeScanLastAt = now;
  state.barcodeScanGaps = [];
  state.barcodeScanLikely = false;
  state.barcodeScanTarget = editableBarcodeTarget(target) ? target : null;
  state.barcodeScanInitialValue = state.barcodeScanTarget?.value || "";
  state.barcodeScanInitialStart = state.barcodeScanTarget?.selectionStart ?? null;
  state.barcodeScanInitialEnd = state.barcodeScanTarget?.selectionEnd ?? null;
}

function updateBarcodeScanLikelihood() {
  if (state.barcodeScanBuffer.length < 3) return;
  state.barcodeScanLikely = barcodeTimingLooksLikeScanner();
}

function barcodeTimingLooksLikeScanner() {
  if (state.barcodeScanBuffer.length < 3 || !state.barcodeScanGaps.length) return false;
  const sortedGaps = [...state.barcodeScanGaps].sort((first, second) => first - second);
  if (sortedGaps.length >= 5) sortedGaps.pop();
  const averageGap = sortedGaps.reduce((sum, gap) => sum + gap, 0) / sortedGaps.length;
  return averageGap <= BARCODE_SCAN_MAX_AVERAGE_GAP_MS;
}

function finishBarcodeScan() {
  clearTimeout(state.barcodeScanTimer);
  const rawCode = state.barcodeScanBuffer;
  const elapsed = state.barcodeScanLastAt - state.barcodeScanStartedAt;
  const shouldHandle = rawCode.length >= BARCODE_SCAN_MIN_LENGTH
    && barcodeTimingLooksLikeScanner()
    && elapsed <= BARCODE_SCAN_MAX_TOTAL_MS;
  const target = state.barcodeScanTarget;
  const initialValue = state.barcodeScanInitialValue;
  const initialStart = state.barcodeScanInitialStart;
  const initialEnd = state.barcodeScanInitialEnd;

  resetBarcodeScan();
  if (!shouldHandle) return;

  restoreBarcodeTarget(target, initialValue, initialStart, initialEnd);
  const products = findProductsByBarcode(rawCode);
  if (!products.length) {
    showToast(`Código de barras ${normalizeBarcode(rawCode) || rawCode} no encontrado`);
    return;
  }

  const productsBySku = uniqueProductsBySku(products);
  if (productsBySku.length > 1) {
    openBarcodeProductChoice(productsBySku, rawCode);
    showToast("Este código está asignado a más de un producto");
    return;
  }

  const product = productsBySku[0];
  openProduct(product);
  showToast(`Producto encontrado: ${product.sku}`);
}

function resetBarcodeScan() {
  clearTimeout(state.barcodeScanTimer);
  state.barcodeScanBuffer = "";
  state.barcodeScanStartedAt = 0;
  state.barcodeScanLastAt = 0;
  state.barcodeScanGaps = [];
  state.barcodeScanTimer = null;
  state.barcodeScanLikely = false;
  state.barcodeScanTarget = null;
  state.barcodeScanInitialValue = "";
  state.barcodeScanInitialStart = null;
  state.barcodeScanInitialEnd = null;
}

function editableBarcodeTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  if (target.matches("input, textarea")) return target;
  return null;
}

function restoreBarcodeTarget(target, value, selectionStart, selectionEnd) {
  if (!target || !("value" in target)) return;
  target.value = value;
  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd) && typeof target.setSelectionRange === "function") {
    try {
      target.setSelectionRange(selectionStart, selectionEnd);
    } catch (error) {
      // Some input types, such as number, do not allow selection ranges.
    }
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function findProductsByBarcode(code) {
  const aliases = new Set(barcodeAliases(code));
  if (![...aliases].some((barcode) => barcode.length >= BARCODE_SCAN_MIN_LENGTH)) return [];

  const byEan = state.catalog.products.filter((product) => (
    isVisibleProduct(product)
    && barcodeFields(product).some((item) => barcodeAliases(item).some((alias) => aliases.has(alias)))
  ));
  if (byEan.length) return byEan;

  const skuCode = normalizeSkuQuery(code);
  return state.catalog.products.filter((product) => (
    isVisibleProduct(product)
    && skuFields(product).some((item) => {
      const sku = normalizeSkuQuery(item);
      return sku.length >= BARCODE_SCAN_MIN_LENGTH && sku === skuCode;
    })
  ));
}

function uniqueProductsBySku(products) {
  const bySku = new Map();
  products.forEach((product) => {
    const sku = normalizeSkuQuery(product.sku || product.id);
    if (!bySku.has(sku)) bySku.set(sku, product);
  });
  return [...bySku.values()];
}

function openBarcodeProductChoice(products, rawCode) {
  els.dialogContent.innerHTML = `
    <div class="dialog-body">
      <div>
        <span class="eyebrow">Código duplicado</span>
        <h2>Elegí el producto correcto</h2>
      </div>
      <p class="barcode-choice-message">El código ${escapeHtml(normalizeBarcode(rawCode) || rawCode)} figura en más de un producto.</p>
      <div class="group-list">
        ${products.map((product) => `
          <button class="group-product barcode-product-choice" type="button" data-barcode-product="${escapeHtml(product.id)}">
            <span>${escapeHtml(product.name)}</span>
            <strong>SKU ${escapeHtml(product.sku)} · Página ${escapeHtml(product.page)}</strong>
          </button>
        `).join("")}
      </div>
    </div>
  `;
  els.dialogContent.querySelectorAll("[data-barcode-product]").forEach((button) => {
    button.addEventListener("click", () => openProduct(state.productsById.get(button.dataset.barcodeProduct)));
  });
  showCatalogDialog(els.productDialog);
}

function addToCart(productId, quantity = 1, options = {}) {
  if (!hasPriceAccess()) {
    if (!options.silent) showToast("Tu cuenta todavía no tiene acceso a precios y pedidos");
    return;
  }
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
  if (!hasPriceAccess()) {
    hideQuickOrderSuggestions();
    els.quickOrderTable.innerHTML = `<p class="quick-order-locked">La carga r&aacute;pida se habilitar&aacute; cuando un administrador apruebe tu cuenta.</p>`;
    els.quickOrderPreview.innerHTML = "";
    els.addQuickOrder.disabled = true;
    return;
  }
  ensureQuickOrderTrailingRow();
  hideQuickOrderSuggestions();
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
      if (input?.dataset.field === "sku") renderQuickOrderSuggestionsForInput(input);
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
  if (row.product.outOfStock) return { name: row.product.name, priceText: "Sin stock", totalText: "", isError: true };
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
  if (field === "sku") renderQuickOrderSuggestionsForInput(input);
  else hideQuickOrderSuggestions();
  if (rowIndex === state.quickOrderRows.length - 1 && hasQuickOrderRowValue(state.quickOrderRows[rowIndex])) {
    state.quickOrderRows.push({ sku: "", quantity: "" });
    appendQuickOrderRows(rowIndex + 1);
  }
  renderQuickOrderPreview();
}

function handleQuickOrderKeydown(event) {
  const input = event.target.closest("[data-row][data-field]");
  if (!input) return;

  if (input.dataset.field === "sku" && handleQuickOrderSuggestionKeydown(event, input)) return;

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
  hideQuickOrderSuggestions();
  const startIndex = Number(input.dataset.row);
  state.quickOrderRows.splice(startIndex, parsedRows.length, ...parsedRows);
  ensureQuickOrderTrailingRow();
  renderQuickOrderTable({ index: Math.min(startIndex + parsedRows.length, state.quickOrderRows.length - 1), field: "sku" });
}

function handleQuickOrderFocus(event) {
  const input = event.target.closest("[data-row][data-field]");
  if (!input) return;
  if (input.dataset.field === "sku") renderQuickOrderSuggestionsForInput(input);
  else hideQuickOrderSuggestions();
}

function handleQuickOrderBlur() {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!els.quickOrderTable.contains(active) && !els.quickOrderSuggestions.contains(active)) {
      hideQuickOrderSuggestions();
    }
  });
}

function handleQuickOrderSuggestionPointer(event) {
  if (event.target.closest("[data-quick-order-suggestion]")) event.preventDefault();
}

function handleQuickOrderSuggestionClick(event) {
  const button = event.target.closest("[data-quick-order-suggestion]");
  if (!button) return;
  selectQuickOrderSuggestion(Number(button.dataset.index));
}

function handleQuickOrderSuggestionKeydown(event, input) {
  const isOpen = !els.quickOrderSuggestions.hidden && state.quickOrderSuggestionItems.length;
  if (event.key === "Escape" && isOpen) {
    event.preventDefault();
    hideQuickOrderSuggestions();
    return true;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!isOpen) renderQuickOrderSuggestionsForInput(input);
    if (els.quickOrderSuggestions.hidden || !state.quickOrderSuggestionItems.length) return false;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const count = state.quickOrderSuggestionItems.length;
    const next = state.quickOrderSuggestionIndex < 0
      ? (direction > 0 ? 0 : count - 1)
      : (state.quickOrderSuggestionIndex + direction + count) % count;
    setQuickOrderSuggestionIndex(next);
    return true;
  }

  if (event.key === "Enter" && isOpen && state.quickOrderSuggestionIndex >= 0) {
    event.preventDefault();
    selectQuickOrderSuggestion(state.quickOrderSuggestionIndex);
    return true;
  }

  return false;
}

function renderQuickOrderSuggestionsForInput(input) {
  const rowIndex = Number(input.dataset.row);
  const query = input.value.trim();
  const matches = quickOrderSuggestions(query);
  if (!matches.length) {
    hideQuickOrderSuggestions();
    return;
  }

  state.quickOrderSuggestionTarget = { rowIndex };
  state.quickOrderSuggestionItems = matches;
  state.quickOrderSuggestionIndex = -1;
  els.quickOrderSuggestions.innerHTML = matches
    .map(({ product, sku }, index) => `
      <button class="quick-order-suggestion" type="button" role="option" data-quick-order-suggestion data-index="${index}">
        <strong>${escapeHtml(sku)}</strong>
        <span>${escapeHtml(product.name)}</span>
        <small>${product.outOfStock ? "Sin stock" : escapeHtml(product.price || "")}</small>
      </button>
    `)
    .join("");
  positionQuickOrderSuggestions(input);
  els.quickOrderSuggestions.hidden = false;
}

function positionQuickOrderSuggestions(input) {
  const body = els.quickOrderDialog.querySelector(".quick-order-dialog-body");
  if (!body) return;
  const inputRect = input.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  els.quickOrderSuggestions.style.left = `${Math.max(0, inputRect.left - bodyRect.left + body.scrollLeft)}px`;
  els.quickOrderSuggestions.style.top = `${inputRect.bottom - bodyRect.top + body.scrollTop + 4}px`;
  els.quickOrderSuggestions.style.width = `${Math.max(inputRect.width, 320)}px`;
}

function setQuickOrderSuggestionIndex(index) {
  state.quickOrderSuggestionIndex = index;
  els.quickOrderSuggestions.querySelectorAll("[data-quick-order-suggestion]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.index) === index);
  });
}

function selectQuickOrderSuggestion(index) {
  const suggestion = state.quickOrderSuggestionItems[index];
  const rowIndex = state.quickOrderSuggestionTarget?.rowIndex;
  if (!suggestion || !Number.isInteger(rowIndex) || !state.quickOrderRows[rowIndex]) return;

  state.quickOrderRows[rowIndex].sku = suggestion.sku;
  const input = els.quickOrderTable.querySelector(`[data-row="${rowIndex}"][data-field="sku"]`);
  if (input) input.value = suggestion.sku;
  updateQuickOrderRenderedRow(rowIndex);
  if (rowIndex === state.quickOrderRows.length - 1 && hasQuickOrderRowValue(state.quickOrderRows[rowIndex])) {
    state.quickOrderRows.push({ sku: "", quantity: "" });
    appendQuickOrderRows(rowIndex + 1);
  }
  renderQuickOrderPreview();
  hideQuickOrderSuggestions();
  focusQuickOrderCell(rowIndex, "quantity");
}

function hideQuickOrderSuggestions() {
  if (!els.quickOrderSuggestions) return;
  els.quickOrderSuggestions.hidden = true;
  els.quickOrderSuggestions.innerHTML = "";
  state.quickOrderSuggestionIndex = -1;
  state.quickOrderSuggestionTarget = null;
  state.quickOrderSuggestionItems = [];
}

function quickOrderSuggestions(query) {
  const skuQuery = normalizeSkuQuery(query);
  const textQuery = normalizeProductSearch(query);
  if (skuQuery.length < 3 && textQuery.length < 3) return [];

  return state.catalog.products
    .map((product) => matchingQuickOrderSuggestion(product, skuQuery, textQuery))
    .filter(Boolean)
    .sort((first, second) => first.score - second.score || first.sku.localeCompare(second.sku, "es"))
    .slice(0, 8);
}

function matchingQuickOrderSuggestion(product, skuQuery, textQuery) {
  if (!isVisibleProduct(product)) return null;
  const skus = skuFields(product)
    .map((sku) => ({ raw: sku, normalized: normalizeSkuQuery(sku) }))
    .filter((sku) => sku.normalized.length >= 4);

  if (skuQuery.length >= 3) {
    const startsWith = skus.find((sku) => sku.normalized.startsWith(skuQuery));
    if (startsWith) return { product, sku: startsWith.raw, score: 0 };
    const includes = skus.find((sku) => sku.normalized.includes(skuQuery));
    if (includes) return { product, sku: includes.raw, score: 1 };
  }

  const normalizedName = normalizeProductSearch(product.name);
  const compactName = compactProductSearch(normalizedName);
  const compactQuery = compactProductSearch(textQuery);
  if (textQuery.length >= 3 && (normalizedName.includes(textQuery) || compactName.includes(compactQuery))) {
    return { product, sku: skus[0]?.raw || product.sku || "", score: normalizedName.startsWith(textQuery) ? 2 : 3 };
  }

  return null;
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
  if (normalized.length < 4) return null;
  return state.catalog.products.find((product) => isVisibleProduct(product) && skuFields(product).some((item) => {
    const productSku = normalizeSkuQuery(item);
    return productSku.length >= 4 && productSku === normalized;
  })) || null;
}

function renderCart() {
  renderCartClientControls();
  if (!hasPriceAccess()) {
    els.cartCount.textContent = "0";
    els.mobileCartCount.textContent = "0";
    els.cartTotalItems.textContent = "0";
    els.cartTotalValue.textContent = "—";
    els.cartDetailsTotalItems.textContent = "0";
    els.cartDetailsTotalValue.textContent = "—";
    els.cartItems.innerHTML = `<p class="cart-access-message">El carrito y los pedidos se habilitar&aacute;n cuando un administrador apruebe tu cuenta.</p>`;
    els.continueCart.disabled = true;
    els.saveOrder.disabled = true;
    els.saveOrder.textContent = "Pendiente de aprobación";
    return;
  }
  if (mergeDuplicateCartSkus()) saveCart();
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isOrderableProduct(line.product));
  const total = lines.reduce((sum, line) => sum + line.qty, 0);
  const totalValue = lines.reduce((sum, line) => sum + priceNumber(line.product.price) * line.qty, 0);

  els.cartCount.textContent = total;
  els.mobileCartCount.textContent = total;
  els.cartTotalItems.textContent = total;
  els.cartTotalValue.textContent = formatMoney(totalValue);
  els.cartDetailsTotalItems.textContent = total;
  els.cartDetailsTotalValue.textContent = formatMoney(totalValue);
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
  els.continueCart.disabled = state.isSavingOrder || !lines.length;
  els.saveOrder.textContent = state.isSavingOrder ? "Enviando..." : (isOnline() ? "Enviar pedido" : "Guardar pendiente");
}

async function saveOrder() {
  if (state.isSavingOrder) return;
  if (state.guestAccess && !hasGuestAccess()) {
    clearGuestAccess();
    applyAuthGate();
    showToast("El acceso temporal venció. Pedile un enlace nuevo a tu vendedor.");
    return;
  }
  if (!hasPriceAccess()) {
    showToast("Tu cuenta todavía no tiene acceso a precios y pedidos");
    return;
  }
  mergeDuplicateCartSkus();

  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => isOrderableProduct(line.product));
  if (!lines.length) {
    showToast("Agregá productos antes de enviar el pedido");
    return;
  }
  if (CATALOG_SUPABASE.isAvailable() && isOnline() && !state.user && !hasGuestAccess()) {
    showToast("Iniciá sesión antes de enviar el pedido");
    openAccount();
    return;
  }
  if (mustSelectSalesClient() && !state.selectedSalesClient) {
    showToast("Elegí un cliente antes de enviar el pedido");
    openCart();
    setCartView("details");
    els.cartSalesClientSearch.focus();
    return;
  }
  if (hasGuestAccess() && !state.guestAccess.client && !els.cartClientName.value.trim()) {
    showToast("Ingresá el nombre del cliente antes de enviar el pedido");
    openCart();
    setCartView("details");
    els.cartClientName.focus();
    return;
  }

  let customer = readOrderCustomer();
  let submittedOrder = CATALOG_STORE.buildOrderFromLines(lines, customer);
  let savedOrder = null;
  let notificationResult = { ok: true };
  state.isSavingOrder = true;
  renderCart();

  try {
    if (!isOnline()) {
      if (hasGuestAccess()) {
        throw new Error("El acceso temporal necesita conexión para enviar pedidos.");
      }
      const queued = queueOfflineOrder(submittedOrder, "Sin conexión");
      rememberOrderReceipt(createOrderReceipt(submittedOrder, {
        queueId: queued.id,
        deliveryStatus: "pending",
      }));
      clearSubmittedCart();
      state.isSavingOrder = false;
      renderCart();
      openLastOrderReceipt();
      return;
    }

    if (CATALOG_SUPABASE.isAvailable() && hasGuestAccess()) {
      savedOrder = await CATALOG_SUPABASE.saveGuestOrder(submittedOrder, state.guestAccess.sessionToken);
      notificationResult = savedOrder.notification || notificationResult;
    } else if (CATALOG_SUPABASE.isAvailable() && state.user) {
      await saveCustomerProfile();
      customer = readOrderCustomer();
      submittedOrder = CATALOG_STORE.buildOrderFromLines(lines, customer);
      savedOrder = await CATALOG_SUPABASE.saveOrder(submittedOrder, state.user.id);
      notificationResult = savedOrder.notification || notificationResult;
      await renderCustomerOrders();
    } else {
      CATALOG_STORE.addOrder(submittedOrder);
      savedOrder = submittedOrder;
    }
  } catch (error) {
    if (isNetworkError(error) && !hasGuestAccess()) {
      markConnectionLost(error);
      const queued = queueOfflineOrder(submittedOrder, error.message || "Error de conexión");
      rememberOrderReceipt(createOrderReceipt(submittedOrder, {
        queueId: queued.id,
        deliveryStatus: "pending",
      }));
      clearSubmittedCart();
      state.isSavingOrder = false;
      renderCart();
      openLastOrderReceipt();
      return;
    }
    showToast(error.message || "No se pudo enviar el pedido");
    state.isSavingOrder = false;
    renderCart();
    return;
  }
  window.dispatchEvent(new CustomEvent("catalog:orders-changed"));
  rememberOrderReceipt(createOrderReceipt(savedOrder || submittedOrder, {
    fallbackOrder: submittedOrder,
    notification: notificationResult,
    deliveryStatus: notificationResult.ok ? "sent" : "warning",
  }));
  clearSubmittedCart();
  state.isSavingOrder = false;
  renderCart();
  openLastOrderReceipt();
}

function loadLastOrderReceipt() {
  try {
    const receipt = JSON.parse(localStorage.getItem("catalogLastOrderReceipt") || "null");
    return receipt && typeof receipt === "object" ? receipt : null;
  } catch {
    return null;
  }
}

function createOrderReceipt(order, options = {}) {
  const fallback = options.fallbackOrder || order || {};
  const customer = order?.customer?.name || order?.customer?.clientCode ? order.customer : (fallback.customer || {});
  const items = Array.isArray(order?.items) && order.items.length ? order.items : (fallback.items || []);
  const deliveryStatus = options.deliveryStatus || "sent";
  const notificationError = options.notification?.error || "";
  return {
    id: order?.displayId || (order?.order_number ? `#${order.order_number}` : "") || order?.id || order?.order_id || fallback.displayId || fallback.id || "Pedido",
    createdAt: order?.createdAt || fallback.createdAt || new Date().toISOString(),
    customerName: customer.salesClient?.legalName || customer.salesClient?.name || customer.name || "Sin especificar",
    clientCode: customer.salesClient?.clientCode || customer.clientCode || "",
    totalItems: Number(order?.totalItems ?? order?.total_items ?? fallback.totalItems ?? items.reduce((sum, item) => sum + Number(item.qty || 0), 0)),
    totalValue: Number(order?.totalValue ?? order?.total_value ?? fallback.totalValue ?? items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)),
    items: items.map((item) => ({
      sku: String(item.sku || ""),
      name: String(item.name || ""),
      qty: Number(item.qty || 0),
      lineTotal: Number(item.lineTotal || 0),
    })),
    deliveryStatus,
    notificationError,
    queueId: options.queueId || "",
  };
}

function rememberOrderReceipt(receipt) {
  state.lastOrderReceipt = receipt;
  localStorage.setItem("catalogLastOrderReceipt", JSON.stringify(receipt));
  renderLastOrderReceiptAvailability();
}

function renderLastOrderReceiptAvailability() {
  if (!els.openLastReceipt) return;
  els.openLastReceipt.hidden = !state.lastOrderReceipt;
}

function openLastOrderReceipt() {
  const receipt = state.lastOrderReceipt;
  if (!receipt) return;
  closeCart();
  const status = receipt.deliveryStatus === "pending"
    ? { label: "Pendiente de envío", detail: "El pedido está guardado en este dispositivo y se enviará cuando vuelva la conexión.", className: "is-pending" }
    : receipt.deliveryStatus === "warning"
      ? { label: "Pedido recibido", detail: receipt.notificationError || "El pedido quedó registrado, pero el email de aviso está pendiente.", className: "is-warning" }
      : { label: "Pedido recibido", detail: "El pedido quedó registrado y la notificación por email fue solicitada.", className: "is-sent" };

  els.orderReceiptContent.innerHTML = `
    <div class="order-receipt-heading">
      <span class="eyebrow">Comprobante de pedido</span>
      <h2>${escapeHtml(String(receipt.id))}</h2>
      <p>${escapeHtml(formatReceiptDate(receipt.createdAt))}</p>
    </div>
    <div class="order-receipt-status ${status.className}">
      <strong>${escapeHtml(status.label)}</strong>
      <span>${escapeHtml(status.detail)}</span>
    </div>
    <dl class="order-receipt-summary">
      <div><dt>Cliente</dt><dd>${escapeHtml(receipt.customerName)}</dd></div>
      ${receipt.clientCode ? `<div><dt>Código</dt><dd>${escapeHtml(receipt.clientCode)}</dd></div>` : ""}
      <div><dt>Unidades</dt><dd>${receipt.totalItems}</dd></div>
      <div><dt>Total</dt><dd>${formatMoney(receipt.totalValue)}</dd></div>
    </dl>
    <div class="order-receipt-lines">
      ${receipt.items.map((item) => `
        <div>
          <span><strong>${escapeHtml(item.sku)}</strong>${escapeHtml(item.name)}</span>
          <b>${item.qty} × ${formatMoney(item.lineTotal)}</b>
        </div>
      `).join("")}
    </div>
  `;
  showCatalogDialog(els.orderReceiptDialog);
}

function formatReceiptDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeStyle: "short" }).format(date);
}

function downloadLastOrderReceipt() {
  const receipt = state.lastOrderReceipt;
  const JsPdf = window.jspdf?.jsPDF;
  if (!receipt || !JsPdf) {
    showToast("No se pudo preparar el comprobante");
    return;
  }

  const pdf = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 18;
  const maxWidth = 174;
  let y = 20;
  const write = (text, size = 11, weight = "normal", gap = 6) => {
    pdf.setFont("helvetica", weight);
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(text || ""), maxWidth);
    if (y + lines.length * gap > 282) {
      pdf.addPage();
      y = 20;
    }
    pdf.text(lines, margin, y);
    y += lines.length * gap;
  };

  pdf.setTextColor(215, 25, 32);
  write("LEXO", 18, "bold", 8);
  pdf.setTextColor(22, 22, 26);
  write(`Comprobante ${receipt.id}`, 16, "bold", 8);
  write(formatReceiptDate(receipt.createdAt), 10, "normal", 6);
  y += 3;
  write(`Cliente: ${receipt.customerName}`, 11, "bold");
  if (receipt.clientCode) write(`Código: ${receipt.clientCode}`, 10);
  write(`Unidades: ${receipt.totalItems}`, 10);
  write(`Total: ${formatMoney(receipt.totalValue)}`, 13, "bold", 8);
  y += 2;
  receipt.items.forEach((item) => {
    write(`${item.sku} - ${item.name}`, 10, "bold", 5);
    write(`${item.qty} unidad${item.qty === 1 ? "" : "es"} - ${formatMoney(item.lineTotal)}`, 9, "normal", 6);
  });
  const safeId = String(receipt.id).replace(/[^a-z0-9_-]+/gi, "-");
  downloadBlob(pdf.output("blob"), `comprobante-${safeId}.pdf`);
  showToast("Comprobante descargado");
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
  hydrateViewerWindow();
  prioritizeCatalogSectionCache(state.catalog.pages[index]?.section);
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
  const frame = hydratePageFrame(index) || els.pageStrip.querySelector(`[data-page-index="${index}"]`);
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

function scrollFiltersIntoView(options = {}) {
  document.querySelector(".sidebar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (options.focusSearch !== false) {
    requestAnimationFrame(() => els.searchInput.focus({ preventScroll: true }));
  }
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
  if (!hasPriceAccess()) {
    showToast("El carrito se habilitará cuando aprueben tu cuenta");
    return;
  }
  closeAccount();
  els.cartDrawer.classList.add("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("cart-drawer-open");
  document.body.classList.remove("account-drawer-open");
}

function setCartView(view, options = {}) {
  const nextView = view === "details" ? "details" : "products";
  state.cartView = nextView;
  const showingProducts = nextView === "products";
  els.cartProductsView.hidden = !showingProducts;
  els.cartDetailsView.hidden = showingProducts;
  els.cartProductsTab.classList.toggle("is-active", showingProducts);
  els.cartDetailsTab.classList.toggle("is-active", !showingProducts);
  els.cartProductsTab.setAttribute("aria-selected", String(showingProducts));
  els.cartDetailsTab.setAttribute("aria-selected", String(!showingProducts));
  if (options.focus) {
    (showingProducts ? els.cartProductsTab : els.cartDetailsTab).focus();
  }
}

function openQuickOrder() {
  if (!hasPriceAccess()) {
    showToast("La carga rápida se habilitará cuando aprueben tu cuenta");
    return;
  }
  renderQuickOrderTable();
  showCatalogDialog(els.quickOrderDialog);
  focusQuickOrderCell(0, "sku");
}

function closeCart() {
  els.cartDrawer.classList.remove("is-open");
  els.cartDrawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cart-drawer-open");
  setCartView("products");
}

function openAccount() {
  closeCart();
  els.accountDrawer.classList.add("is-open");
  els.accountDrawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("account-drawer-open");
  document.body.classList.remove("cart-drawer-open");
  if (!state.user && !hasGuestAccess()) els.authEmail.focus();
}

function closeAccount() {
  if (document.body.classList.contains("auth-required")) {
    openAccount();
    return;
  }

  els.accountDrawer.classList.remove("is-open");
  els.accountDrawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("account-drawer-open");
}

function applyAuthGate() {
  const requiresAuth = !state.user && !hasGuestAccess();
  document.body.classList.toggle("auth-required", requiresAuth);
  document.body.classList.toggle("auth-checking", state.isCheckingAuth);
  document.body.classList.toggle("guest-catalog-session", hasGuestAccess());
  if (els.authLoading) {
    els.authLoading.hidden = !state.isCheckingAuth;
  }
  if (requiresAuth && !state.guestLinkToken) openAccount();
  applyPriceAccessState();
  dispatchAuthChanged();
}

function hasPriceAccess() {
  if (hasGuestAccess()) return true;
  const role = state.profile?.role;
  if (role === "admin" || role === "salesman") return true;
  return role === "customer" && state.profile?.price_access_approved === true;
}

function isPriceAccessPending() {
  return Boolean(state.user && state.profile?.role === "customer" && !hasPriceAccess());
}

function applyPriceAccessState() {
  const access = hasPriceAccess();
  const pending = isPriceAccessPending();
  const changed = state.priceAccessActive !== access;
  state.priceAccessActive = access;

  document.body.classList.toggle("catalog-prices-pending", pending);
  els.priceAccessNotice.hidden = !pending;
  els.openCart.hidden = !access;
  els.openQuickOrderToolbar.hidden = !access;
  els.mobileOpenCart.hidden = !access;
  els.mobileOpenQuickOrder.hidden = !access;
  els.quickOrderPanel.hidden = !access;

  if (!access) {
    closeCart();
    if (isCatalogDialogOpen(els.quickOrderDialog)) closeCatalogDialog(els.quickOrderDialog);
    if (isCatalogDialogOpen(els.productDialog)) closeCatalogDialog(els.productDialog);
  }

  if (changed && state.catalog && !state.isCheckingAuth) {
    renderViewerPages();
    renderLists();
    renderQuickOrderTable();
    renderCart();
  }
}

async function refreshCurrentPriceAccess() {
  if (!state.user || !CATALOG_SUPABASE.isAvailable() || !isOnline()) {
    showToast("Conectate a internet para comprobar el acceso");
    return;
  }

  els.checkPriceAccess.disabled = true;
  els.checkPriceAccess.textContent = "Comprobando...";
  try {
    state.profile = await CATALOG_SUPABASE.getProfile(state.user.id);
    rememberAccountSnapshot();
    applyProfileToAuthFields();
    renderAccount();
    await renderCustomerOrders();
    showToast(hasPriceAccess() ? "Precios habilitados" : "Tu cuenta todavía está pendiente de aprobación");
  } catch (error) {
    showToast(error.message || "No se pudo comprobar el acceso");
  } finally {
    els.checkPriceAccess.disabled = false;
    els.checkPriceAccess.textContent = "Comprobar acceso";
  }
}

function dispatchAuthChanged() {
  window.dispatchEvent(new CustomEvent("catalog:auth-changed", {
    detail: {
      user: state.user,
      profile: state.profile,
      guestAccess: state.guestAccess,
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

  if (!showBanner) {
    updateOfflineBannerHeight();
    return;
  }

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
  updateOfflineBannerHeight();
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
  els.cartObservations.value = "";
  localStorage.removeItem("catalogCartClientName");
  localStorage.removeItem("catalogCartClientCode");
  saveCart();
  setCartView("products");
}

function updateOfflineBannerHeight() {
  if (els.offlineBanner.hidden) {
    document.body.style.removeProperty("--offline-banner-height");
    return;
  }
  const height = Math.ceil(els.offlineBanner.getBoundingClientRect().height);
  if (height > 0) document.body.style.setProperty("--offline-banner-height", `${height}px`);
}

function updateViewportMetrics() {
  const measuredHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
  const height = Math.max(320, Math.round(measuredHeight));
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

function scheduleViewportLayoutRefresh() {
  if (viewportUpdateFrame) cancelAnimationFrame(viewportUpdateFrame);
  viewportUpdateFrame = requestAnimationFrame(() => {
    viewportUpdateFrame = 0;
    updateViewportMetrics();
    if (state.catalog) renderZoom();
    updateOfflineBannerHeight();
  });
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
      if (state.lastOrderReceipt?.queueId === queued.id) {
        rememberOrderReceipt(createOrderReceipt(savedOrder, {
          fallbackOrder: queued.order,
          notification: savedOrder.notification,
          deliveryStatus: savedOrder.notification?.ok === false ? "warning" : "sent",
        }));
      }
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

function scheduleCatalogAssetCache() {
  if (!isOnline() || !("caches" in window) || !state.catalog?.pages?.length) return;
  const currentSection = currentPage()?.section;
  const sections = [...new Set(state.catalog.pages.map((page) => page.section).filter(Boolean))];
  if (currentSection) queueCatalogSectionCache(currentSection, true);
  if (!navigator.connection?.saveData) sections.forEach((section) => queueCatalogSectionCache(section));
  startCatalogAssetCache();
}

function prioritizeCatalogSectionCache(section) {
  if (!section || state.catalogCachedSections.has(section) || navigator.connection?.saveData) return;
  queueCatalogSectionCache(section, true);
  startCatalogAssetCache();
}

function queueCatalogSectionCache(section, first = false) {
  if (!section || state.catalogCachedSections.has(section)) return;
  state.catalogCacheQueue = state.catalogCacheQueue.filter((item) => item !== section);
  if (first) state.catalogCacheQueue.unshift(section);
  else state.catalogCacheQueue.push(section);
}

function startCatalogAssetCache() {
  if (state.catalogCachePromise || !state.catalogCacheQueue.length) return;
  state.catalogCachePromise = runCatalogAssetCache().finally(() => {
    state.catalogCachePromise = null;
    if (state.catalogCacheQueue.length && isOnline()) startCatalogAssetCache();
  });
}

async function runCatalogAssetCache() {
  try {
    const nearbyIndexes = visiblePageIndexes();
    const currentPosition = nearbyIndexes.indexOf(state.currentIndex);
    const nearbyPages = nearbyIndexes
      .slice(Math.max(0, currentPosition - 2), currentPosition + 3)
      .map((index) => state.catalog.pages[index]);
    await cacheCatalogPages(nearbyPages, { idle: false });

    while (state.catalogCacheQueue.length && isOnline()) {
      const section = state.catalogCacheQueue.shift();
      if (!section || state.catalogCachedSections.has(section)) continue;
      await waitForCatalogIdle();
      const pages = state.catalog.pages.filter((page) => page.section === section);
      const completed = await cacheCatalogPages(pages, { idle: true });
      if (completed) state.catalogCachedSections.add(section);
    }
  } catch (error) {
    console.warn("No se pudieron guardar las páginas para modo offline", error);
  }
}

async function cacheCatalogPages(pages, options = {}) {
  const imageUrls = [...new Set((pages || []).map((page) => page?.image?.src).filter(Boolean))];
  if (!imageUrls.length || !isOnline()) return false;
  const cache = await caches.open("lexo-catalog-pages-v20260805");
  const cachedRequests = await cache.keys();
  const cachedUrls = new Set(cachedRequests.map((request) => {
    const url = new URL(request.url);
    return url.pathname + url.search;
  }));
  const pendingUrls = imageUrls.filter((url) => {
    const absolute = new URL(url, location.href);
    return !cachedUrls.has(absolute.pathname + absolute.search);
  });

  for (let index = 0; index < pendingUrls.length; index += 2) {
    if (!isOnline()) return false;
    if (options.idle) await waitForCatalogIdle();
    const chunk = pendingUrls.slice(index, index + 2);
    await Promise.allSettled(chunk.map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url, response);
    }));
  }
  return true;
}

function waitForCatalogIdle() {
  if (!("requestIdleCallback" in window)) return delay(220);
  return new Promise((resolve) => requestIdleCallback(resolve, { timeout: 1400 }));
}

function readAccountCustomer() {
  if (hasGuestAccess()) {
    const client = state.guestAccess.client;
    return {
      name: client?.legalName || client?.name || els.cartClientName.value.trim(),
      phone: "",
      clientCode: client?.clientCode || els.cartClientCode.value.trim(),
      notes: "",
    };
  }
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
  const observations = orderObservationsValue();
  if (hasGuestAccess()) {
    const client = state.guestAccess.client;
    return {
      ...accountCustomer,
      salesClient: client || null,
      salesmanCode: client?.salesmanCode || state.guestAccess.salesmanCode || "",
      transport: orderTransportValue(),
      notes: observations,
    };
  }
  const selectedClient = canSelectSalesClient() ? state.selectedSalesClient : null;
  if (selectedClient) {
    return {
      ...accountCustomer,
      name: selectedClient.name || selectedClient.legalName || accountCustomer.name,
      salesClient: selectedClient,
      salesmanCode: selectedClient.salesmanCode || state.profile?.salesman_code || "",
      transport: orderTransportValue(),
      notes: observations,
    };
  }

  if (state.profile?.role === "customer") {
    return {
      ...accountCustomer,
      salesmanCode: state.profile.assigned_salesman_code || "",
      transport: orderTransportValue(),
      notes: observations,
    };
  }

  const clientCode = els.cartClientCode.value.trim();
  return {
    ...accountCustomer,
    name: els.cartClientName.value.trim() || accountCustomer.name,
    clientCode,
    salesmanCode: state.profile?.salesman_code || state.profile?.assigned_salesman_code || "",
    notes: observations,
  };
}

function renderCartClientControls() {
  const canSelect = canSelectSalesClient();
  const guestClient = hasGuestAccess() ? state.guestAccess.client : null;
  const signedCustomer = Boolean((state.user && state.profile?.role === "customer") || guestClient);
  const canEnterTransport = canEnterOrderTransport();

  els.cartSalesClientPanel.hidden = !canSelect;
  els.cartTransportPanel.hidden = !canEnterTransport;
  els.otherSalesClientToggleWrap.hidden = !canSelect || !canCreateOtherSalesClient();
  els.cartManualClientFields.hidden = CATALOG_SUPABASE.isAvailable() && Boolean(state.user || guestClient);
  els.cartAccountClientNote.hidden = !signedCustomer;
  if (guestClient) {
    els.cartAccountClientNote.textContent = `El pedido se enviará para ${guestClient.clientCode} - ${guestClient.legalName || guestClient.name}.`;
  } else if (signedCustomer) {
    els.cartAccountClientNote.textContent = "El pedido se enviará con los datos de tu cuenta.";
  }
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
  return hasGuestAccess() || ["admin", "customer", "salesman"].includes(state.profile?.role);
}

function orderTransportValue() {
  return canEnterOrderTransport() ? els.cartTransport.value.trim() : "";
}

function orderObservationsValue() {
  return els.cartObservations.value.trim();
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
    renderSalesmanCatalogTools();
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

function hasGuestAccess() {
  return Boolean(
    state.guestAccess?.sessionToken
    && new Date(state.guestAccess.expiresAt).getTime() > Date.now(),
  );
}

function guestLinkTokenFromUrl() {
  return new URLSearchParams(location.search).get("catalog_access")?.trim() || "";
}

function readGuestAccessSnapshot() {
  try {
    const value = JSON.parse(localStorage.getItem("catalogGuestAccess") || "null");
    if (!value?.sessionToken || !value?.expiresAt) return null;
    if (new Date(value.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem("catalogGuestAccess");
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function rememberGuestAccess() {
  if (!hasGuestAccess()) return;
  localStorage.setItem("catalogGuestAccess", JSON.stringify(state.guestAccess));
}

function clearGuestAccess() {
  state.guestAccess = null;
  state.guestLinkToken = "";
  localStorage.removeItem("catalogGuestAccess");
  document.body.classList.remove("guest-access-pending", "guest-catalog-session");
  els.guestAccessGate.hidden = true;
}

function showGuestAccessGate(message = "") {
  document.body.classList.add("guest-access-pending");
  els.guestAccessGate.hidden = false;
  els.guestAccessMessage.textContent = message;
  els.guestAccessCode.disabled = state.isRedeemingGuestAccess;
  els.redeemGuestAccess.disabled = state.isRedeemingGuestAccess;
  els.redeemGuestAccess.textContent = state.isRedeemingGuestAccess ? "Verificando..." : "Abrir catálogo";
  if (!state.isRedeemingGuestAccess) requestAnimationFrame(() => els.guestAccessCode.focus());
}

function hideGuestAccessGate() {
  document.body.classList.remove("guest-access-pending");
  els.guestAccessGate.hidden = true;
  els.guestAccessMessage.textContent = "";
  els.guestAccessCode.value = "";
}

function activateGuestAccess(result) {
  state.guestAccess = {
    sessionToken: result.session_token,
    expiresAt: result.expires_at,
    client: result.client || null,
    salesmanCode: result.salesman_code || result.client?.salesmanCode || "",
  };
  state.user = null;
  state.profile = null;
  state.connectionLost = false;
  rememberGuestAccess();
  hideGuestAccessGate();
  removeGuestLinkFromUrl();
  applyAuthGate();
  renderAccount();
  renderAll();
}

function removeGuestLinkFromUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("catalog_access");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  state.guestLinkToken = "";
}

async function redeemGuestAccess() {
  if (state.isRedeemingGuestAccess) return;
  const password = els.guestAccessCode.value.trim();
  if (!/^\d{6}$/.test(password)) {
    els.guestAccessMessage.textContent = "Ingresá la clave de seis dígitos.";
    return;
  }
  if (!isOnline()) {
    els.guestAccessMessage.textContent = "Conectate a internet para usar este acceso.";
    return;
  }
  state.isRedeemingGuestAccess = true;
  showGuestAccessGate();
  try {
    const result = await CATALOG_SUPABASE.redeemCatalogGuestLink(state.guestLinkToken, password);
    activateGuestAccess(result);
    showToast(result.client?.name ? `Catálogo habilitado para ${result.client.name}` : "Catálogo habilitado");
  } catch (error) {
    els.guestAccessMessage.textContent = friendlyGuestAccessError(error);
  } finally {
    state.isRedeemingGuestAccess = false;
    if (!hasGuestAccess()) showGuestAccessGate(els.guestAccessMessage.textContent);
  }
}

async function cancelGuestAccess() {
  clearGuestAccess();
  removeGuestLinkFromUrl();
  state.isCheckingAuth = true;
  await initAccount();
  renderAll();
}

function friendlyGuestAccessError(error) {
  const message = String(error?.message || "No se pudo abrir el catálogo.");
  if (message.includes("not found")) return "El enlace no es válido. Pedile uno nuevo a tu vendedor.";
  if (message.includes("already been used")) return "Este enlace ya fue utilizado. Pedile uno nuevo a tu vendedor.";
  if (message.includes("expired") || message.includes("replaced")) return "Este enlace venció o fue reemplazado. Pedile uno nuevo a tu vendedor.";
  if (message.includes("Incorrect")) return "La clave ingresada no es correcta.";
  if (message.includes("blocked")) return "El enlace fue bloqueado. Pedile uno nuevo a tu vendedor.";
  return message;
}

async function initAccount() {
  els.authEmail.value = localStorage.getItem("catalogLastEmail") || "";
  els.createEmail.value = els.authEmail.value;
  els.resetEmail.value = els.authEmail.value;
  const initialAuthHash = readAuthHash();
  state.isPasswordRecovery = isPasswordRecoveryRequest(initialAuthHash);
  state.isCheckingAuth = true;
  els.accountStatus.textContent = "Iniciando sesi\u00f3n autom\u00e1ticamente";
  applyAuthGate();

  state.guestLinkToken = guestLinkTokenFromUrl();
  if (state.guestLinkToken) {
    state.isCheckingAuth = false;
    showGuestAccessGate();
    applyAuthGate();
    return;
  }

  const guestSnapshot = readGuestAccessSnapshot();
  if (guestSnapshot && CATALOG_SUPABASE.isAvailable() && isOnline()) {
    try {
      const result = await CATALOG_SUPABASE.validateCatalogGuestSession(guestSnapshot.sessionToken);
      state.isCheckingAuth = false;
      activateGuestAccess(result);
      closeAccount();
      return;
    } catch {
      clearGuestAccess();
    }
  }

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
    if (state.user && !state.isPasswordRecovery) closeAccount();
  }

  const authHash = readAuthHash();
  if (authHash.error) {
    state.isPasswordRecovery = false;
    openAccount();
    showForgotPassword();
    els.authMessage.textContent = friendlyRecoveryError(authHash);
  } else if (state.isPasswordRecovery || isPasswordRecoveryRequest(authHash)) {
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
    showToast(state.user
      ? "Cuenta creada. Podés navegar el catálogo mientras aprobamos tus precios."
      : "Cuenta creada. Revisá tu email para confirmar el acceso.");
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
  state.isPasswordRecovery = false;
  CATALOG_SUPABASE.clearRecoveryMode();
  history.replaceState(null, "", location.pathname);
  setAuthMode("signin");
  renderAccount();
  renderCustomerOrders();
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
  state.isPasswordRecovery = true;
  setAuthMode("new-password");
  els.authFields.classList.remove("is-hidden");
  els.signOut.classList.add("is-hidden");
  els.salesmanCatalogTools.hidden = true;
  els.customerOrders.hidden = true;
  els.customerOrderDetail.hidden = true;
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
    if (els.newPassword.value.length < 8) {
      els.authMessage.textContent = "La nueva contraseña debe tener al menos 8 caracteres.";
      els.newPassword.focus();
      return;
    }
    state.user = await CATALOG_SUPABASE.updatePassword(els.newPassword.value);
    state.profile = state.user ? await CATALOG_SUPABASE.getProfile(state.user.id) : null;
    rememberAccountSnapshot();
    await loadSalesClients();
    els.newPassword.value = "";
    state.isPasswordRecovery = false;
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
  if (hasGuestAccess()) {
    clearGuestAccess();
    els.cartTransport.value = "";
    els.cartObservations.value = "";
    state.isCheckingAuth = true;
    await initAccount();
    renderAll();
    showToast("Acceso temporal cerrado");
    return;
  }
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
    els.cartObservations.value = "";
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
  const guest = hasGuestAccess();
  const signedIn = Boolean(state.user || guest);
  const resettingPassword = state.isPasswordRecovery || els.authFields.dataset.mode === "new-password";
  if (state.isCheckingAuth) {
    els.accountStatus.textContent = "Iniciando sesi\u00f3n autom\u00e1ticamente";
    els.authFields.classList.add("is-hidden");
    els.signOut.classList.add("is-hidden");
    els.openAccount.classList.remove("is-signed-in");
    applyAuthGate();
    return;
  }
  els.accountStatus.textContent = guest
    ? (state.guestAccess.client
      ? `Acceso temporal para ${state.guestAccess.client.clientCode} - ${state.guestAccess.client.legalName || state.guestAccess.client.name}`
      : "Acceso temporal al catálogo")
    : signedIn
      ? (isPriceAccessPending()
      ? `Sesión iniciada como ${state.user.email}. Precios pendientes de aprobación.`
      : `Sesión iniciada como ${state.user.email}`)
      : "Sesión no iniciada";
  els.authFields.classList.toggle("is-hidden", signedIn && !resettingPassword);
  els.signOut.classList.toggle("is-hidden", !signedIn || resettingPassword);
  els.openAccount.classList.toggle("is-signed-in", signedIn);
  renderSalesmanCatalogTools();
  applyAuthGate();
}

function renderSalesmanCatalogTools() {
  const visible = Boolean(state.user && canSelectSalesClient() && !state.isPasswordRecovery);
  els.salesmanCatalogTools.hidden = !visible;
  if (!visible) {
    state.guestLinksLoaded = false;
    state.guestLinks = [];
    if (els.guestLinksList) els.guestLinksList.innerHTML = "";
    return;
  }

  els.createGuestLink.disabled = state.isCreatingGuestLink;
  els.createGuestLink.textContent = state.isCreatingGuestLink ? "Creando..." : "Crear enlace de 7 días";
  els.refreshGuestLinks.disabled = state.isLoadingGuestLinks;
  if (!state.guestLinksLoaded && !state.isLoadingGuestLinks && isOnline()) loadGuestLinks();
}

async function createGuestLink() {
  if (state.isCreatingGuestLink) return;
  els.guestLinkMessage.textContent = "";
  els.guestLinkResult.hidden = true;
  if (!isOnline()) {
    els.guestLinkMessage.textContent = "Conectate a internet para crear el enlace.";
    return;
  }

  state.isCreatingGuestLink = true;
  renderSalesmanCatalogTools();
  try {
    const baseUrl = `${location.origin}${location.pathname}`;
    const result = await CATALOG_SUPABASE.createCatalogGuestLink(baseUrl);
    els.guestLinkUrl.value = result.access_url;
    els.guestLinkPassword.value = result.one_time_password;
    els.guestLinkExpiry.textContent = `Vence el ${new Date(result.expires_at).toLocaleString("es-AR")}. La clave funciona una sola vez.`;
    els.guestLinkResult.hidden = false;
    els.guestLinkMessage.textContent = "Enlace creado.";
    state.guestLinksLoaded = false;
    await loadGuestLinks();
  } catch (error) {
    els.guestLinkMessage.textContent = error.message || "No se pudo crear el enlace.";
  } finally {
    state.isCreatingGuestLink = false;
    renderSalesmanCatalogTools();
  }
}

async function loadGuestLinks() {
  if (state.isLoadingGuestLinks || !state.user || !canSelectSalesClient()) return;
  if (!isOnline()) {
    els.guestLinksStatus.textContent = "Conectate a internet para consultar los enlaces.";
    return;
  }
  state.isLoadingGuestLinks = true;
  els.refreshGuestLinks.disabled = true;
  els.guestLinksStatus.textContent = "Cargando enlaces...";
  try {
    const baseUrl = `${location.origin}${location.pathname}`;
    const result = await CATALOG_SUPABASE.listCatalogGuestLinks(baseUrl);
    state.guestLinks = Array.isArray(result.links) ? result.links : [];
    state.guestLinksLoaded = true;
    renderGuestLinks();
  } catch (error) {
    els.guestLinksStatus.textContent = error.message || "No se pudieron cargar los enlaces.";
  } finally {
    state.isLoadingGuestLinks = false;
    els.refreshGuestLinks.disabled = false;
  }
}

function renderGuestLinks() {
  const links = state.guestLinks;
  const activeCount = links.filter((link) => guestLinkStatus(link).key === "active").length;
  els.guestLinksStatus.textContent = links.length
    ? `${links.length} enlace${links.length === 1 ? "" : "s"}; ${activeCount} activo${activeCount === 1 ? "" : "s"}.`
    : "Todavía no creaste enlaces temporales.";
  els.guestLinksList.innerHTML = links.map((link) => {
    const status = guestLinkStatus(link);
    return `
      <article class="guest-link-row">
        <div class="guest-link-main">
          <div class="guest-link-heading">
            <strong>Creado ${escapeHtml(formatGuestLinkDate(link.created_at))}</strong>
            <span class="guest-link-status is-${status.key}">${escapeHtml(status.label)}</span>
          </div>
          <p>Vence ${escapeHtml(formatGuestLinkDate(link.expires_at))}${link.salesman_code ? ` · Vendedor ${escapeHtml(link.salesman_code)}` : ""}</p>
        </div>
        <div class="guest-link-actions">
          ${link.access_url ? `<button class="secondary-button compact-button" type="button" data-copy-managed-link="${escapeAttribute(link.id)}">Copiar</button>` : ""}
          ${status.key === "active" ? `<button class="secondary-button compact-button danger-button" type="button" data-revoke-guest-link="${escapeAttribute(link.id)}">Revocar</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function guestLinkStatus(link) {
  if (link.revoked_at) return { key: "revoked", label: "Revocado" };
  if (link.redeemed_at) return { key: "used", label: "Usado" };
  if (Date.parse(link.expires_at || "") <= Date.now()) return { key: "expired", label: "Vencido" };
  return { key: "active", label: "Activo" };
}

function formatGuestLinkDate(value) {
  if (!value) return "sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

async function handleGuestLinkAction(event) {
  const copyButton = event.target.closest("[data-copy-managed-link]");
  if (copyButton) {
    const link = state.guestLinks.find((item) => item.id === copyButton.dataset.copyManagedLink);
    if (link?.access_url) await copyGuestValue(link.access_url, "Enlace copiado");
    return;
  }
  const revokeButton = event.target.closest("[data-revoke-guest-link]");
  if (!revokeButton) return;
  if (!confirm("¿Revocar este enlace? Ya no podrá usarse para entrar al catálogo.")) return;
  try {
    revokeButton.disabled = true;
    revokeButton.textContent = "Revocando...";
    await CATALOG_SUPABASE.revokeCatalogGuestLink(revokeButton.dataset.revokeGuestLink);
    state.guestLinksLoaded = false;
    await loadGuestLinks();
    showToast("Enlace revocado");
  } catch (error) {
    revokeButton.disabled = false;
    revokeButton.textContent = "Revocar";
    showToast(error.message || "No se pudo revocar el enlace");
  }
}

async function copyGuestValue(value, confirmation) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(confirmation);
  } catch {
    showToast("No se pudo copiar automáticamente");
  }
}

function renderPdfBrandOptions() {
  if (!els.pdfBrandSelect || !state.catalog) return;
  const selected = els.pdfBrandSelect.value;
  const brands = [...new Set(state.catalog.pages.map((page) => page.section).filter(Boolean))];
  els.pdfBrandSelect.innerHTML = [
    '<option value="all">Catálogo completo</option>',
    ...brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`),
  ].join("");
  els.pdfBrandSelect.value = brands.includes(selected) || selected === "all" ? selected : (state.brandFilter !== "all" ? state.brandFilter : "all");
}

async function exportCatalogPdf() {
  if (state.isExportingCatalogPdf) return;
  if (!state.user || !canSelectSalesClient()) {
    els.pdfExportStatus.textContent = "Esta herramienta está disponible para vendedores y administradores.";
    return;
  }
  const brand = els.pdfBrandSelect.value || "all";
  const pages = state.catalog.pages.filter((page) => brand === "all" || page.section === brand);
  if (!pages.length) {
    els.pdfExportStatus.textContent = "No hay páginas para exportar.";
    return;
  }
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) {
    els.pdfExportStatus.textContent = "No se pudo cargar el generador de PDF. Revisá tu conexión e intentá nuevamente.";
    return;
  }

  state.isExportingCatalogPdf = true;
  els.exportCatalogPdf.disabled = true;
  els.exportCatalogPdf.textContent = "Preparando...";
  const title = brand === "all" ? "Catálogo Lexo" : `Catálogo Lexo - ${brand}`;
  try {
    const pdf = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) pdf.addPage("a4", "portrait");
      els.pdfExportStatus.textContent = `Preparando página ${index + 1} de ${pages.length}...`;
      await addCatalogPageToPdf(pdf, pages[index]);
      if (index % 5 === 4) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const safeTitle = title.replace(/[\\/:*?"<>|]+/g, "-");
    downloadBlob(pdf.output("blob"), `${safeTitle}.pdf`);
    els.pdfExportStatus.textContent = `PDF descargado con ${pages.length} páginas y precios actuales.`;
  } catch (error) {
    console.error("Catalog PDF export failed", error);
    els.pdfExportStatus.textContent = `No se pudo crear el PDF: ${error.message || "error inesperado"}.`;
  } finally {
    state.isExportingCatalogPdf = false;
    els.exportCatalogPdf.disabled = false;
    els.exportCatalogPdf.textContent = "Descargar PDF con precios actuales";
  }
}

async function addCatalogPageToPdf(pdf, page) {
  const pageWidth = 210;
  const pageHeight = 297;
  const imageUrl = new URL(page.image.src, location.href);
  const response = await fetch(imageUrl.href);
  if (!response.ok) throw new Error(`no se pudo cargar la página ${page.number}`);
  const imageBytes = new Uint8Array(await response.arrayBuffer());
  const imageType = imageUrl.pathname.toLowerCase().endsWith(".png") ? "PNG" : "JPEG";
  pdf.addImage(imageBytes, imageType, 0, 0, pageWidth, pageHeight, undefined, "FAST");

  const products = page.products.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  products.forEach((product) => drawPdfSkuHotspot(pdf, product, pageWidth, pageHeight));
  (page.priceGroups || []).forEach((group) => drawPdfPriceOverlay(pdf, group, pageWidth, pageHeight));
}

function drawPdfSkuHotspot(pdf, product, pageWidth, pageHeight) {
  const spot = product.hotspot;
  if (!spot) return;
  const x = spot.x * pageWidth;
  const y = spot.y * pageHeight;
  const width = spot.w * pageWidth;
  const height = spot.h * pageHeight;
  const border = parsePdfColor(product.hotspotStyle?.borderColor || (product.section === "Lexo" ? "rgba(0,0,0,.3)" : "rgba(215,25,32,.3)"));
  withPdfOpacity(pdf, border.a, () => {
    pdf.setDrawColor(border.r, border.g, border.b);
    pdf.setLineWidth(cssPxToMm(1));
    pdf.roundedRect(x, y, width, height, cssPxToMm(4), cssPxToMm(4), "S");
  });
  if (!product.outOfStock) return;

  const angle = -10 * Math.PI / 180;
  const halfLength = (width + cssPxToMm(4)) / 2;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  pdf.setDrawColor(101, 113, 132);
  pdf.setLineWidth(cssPxToMm(2));
  pdf.line(
    centerX - halfLength * Math.cos(angle),
    centerY - halfLength * Math.sin(angle),
    centerX + halfLength * Math.cos(angle),
    centerY + halfLength * Math.sin(angle),
  );
}

function drawPdfPriceOverlay(pdf, group, pageWidth, pageHeight) {
  if (!group.price || !group.position) return;
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(isVisibleProduct);
  if (!products.length) return;

  const allOutOfStock = products.every((product) => product.outOfStock);
  const prices = [...new Set(products.map((product) => product.price).filter(Boolean))];
  const price = allOutOfStock ? "Sin stock" : (prices.length === 1 ? prices[0] : group.price);
  const cover = group.cover || {};
  const style = group.style || {};
  const boxWidth = Math.max(
    (cover.w ? cover.w * pageWidth : cssPxToMm(58)) + cssPxToMm(4),
    cssPxToMm((style.minWidth ?? 58) + 4),
  );
  const boxHeight = Math.max(
    (cover.h ? cover.h * pageHeight : cssPxToMm(21)) + cssPxToMm(3),
    cssPxToMm((style.minHeight ?? 21) + 3),
  );
  const x = group.position.x * pageWidth - boxWidth / 2;
  const y = group.position.y * pageHeight;
  const radius = cssPxToMm(style.radius ?? 3);
  const background = parsePdfColor(style.background || "#ffffff");
  const border = parsePdfColor(style.borderColor || "rgba(215,25,32,.16)");
  const color = parsePdfColor(allOutOfStock ? "#657184" : (style.color || "#ad1018"));

  if (background.a > 0) {
    withPdfOpacity(pdf, background.a, () => {
      pdf.setFillColor(background.r, background.g, background.b);
      pdf.roundedRect(x, y, boxWidth, boxHeight, radius, radius, "F");
    });
  }
  withPdfOpacity(pdf, border.a, () => {
    pdf.setDrawColor(border.r, border.g, border.b);
    pdf.setLineWidth(cssPxToMm(1));
    pdf.roundedRect(x, y, boxWidth, boxHeight, radius, radius, "S");
  });

  let fontSize = style.fontSizeUnit === "cqw"
    ? mmToPoints((Number(style.fontSize) || 1.75) * pageWidth / 100)
    : (Number(style.fontSize) || 14) * 0.75;
  if (allOutOfStock) fontSize = Math.min(fontSize, 9);
  pdf.setTextColor(color.r, color.g, color.b);
  pdf.setFont("helvetica", Number(style.fontWeight || 950) >= 600 ? "bold" : "normal");
  pdf.setFontSize(fontSize);
  pdf.text(price, group.position.x * pageWidth, y + boxHeight / 2, { align: "center", baseline: "middle" });
}

function parsePdfColor(value) {
  const color = String(value || "").trim();
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  return { r: 255, g: 255, b: 255, a: color === "transparent" ? 0 : 1 };
}

function withPdfOpacity(pdf, opacity, draw) {
  const value = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  let opacityApplied = false;
  try {
    pdf.setGState(new pdf.GState({ opacity: value, "stroke-opacity": value }));
    opacityApplied = true;
  } catch {
    // Alpha is a visual refinement; drawing still works on older jsPDF builds.
  }
  draw();
  if (opacityApplied) {
    try {
      pdf.setGState(new pdf.GState({ opacity: 1, "stroke-opacity": 1 }));
    } catch {
      // The next opaque drawing operation will reset the visible result.
    }
  }
}

function cssPxToMm(value) {
  return Number(value || 0) * 25.4 / 96;
}

function mmToPoints(value) {
  return Number(value || 0) * 72 / 25.4;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

function isPasswordRecoveryRequest(authHash = readAuthHash()) {
  return Boolean(
    CATALOG_SUPABASE.isRecoveryMode() ||
    location.hash === "#reset-password" ||
    authHash.type === "recovery" ||
    authHash.access_token ||
    authHash.code
  );
}

function friendlyRecoveryError(authHash) {
  if (authHash.error_code === "otp_expired") {
    return "Ese enlace de recuperación no es válido o expiró. Enviá un nuevo email de recuperación y usá solo el enlace más reciente.";
  }
  return authHash.error_description?.replaceAll("+", " ") || "No se pudo usar ese enlace de recuperación. Enviá un nuevo email.";
}

async function renderCustomerOrders() {
  if (state.isPasswordRecovery) {
    els.customerOrders.hidden = true;
    els.customerOrderDetail.hidden = true;
    return;
  }
  els.customerOrders.hidden = false;
  if (!state.user || !CATALOG_SUPABASE.isAvailable()) {
    els.customerOrders.innerHTML = "";
    collapseCustomerOrderDetail();
    return;
  }
  if (!hasPriceAccess()) {
    state.customerOrders = [];
    els.customerOrders.innerHTML = `<p>El historial de pedidos se habilitar&aacute; junto con el acceso a precios.</p>`;
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
  if (!hasPriceAccess()) {
    showToast("Tu cuenta todavía no tiene acceso a pedidos");
    return;
  }
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
  els.cartObservations.value = order.customer?.notes || "";
}

function collapseCustomerOrderDetail() {
  els.customerOrderDetail.hidden = true;
  els.customerOrderDetail.innerHTML = "";
  els.customerOrders.hidden = state.isPasswordRecovery;
}

function isVisibleProduct(product) {
  return Boolean(product && !product.hidden);
}

function isOrderableProduct(product) {
  return hasPriceAccess() && isVisibleProduct(product) && !product.outOfStock;
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
  return [product.name, product.sku, product.section, product.category, product.price, String(product.page)];
}

function skuFields(product) {
  return [String(product.sku || "")].filter(Boolean);
}

function barcodeFields(product) {
  return [...new Set([
    product.ean,
    product.barcode,
    product.codigoBarras,
    product.codigo_barra,
    ...(product.eans || []),
    ...(product.barcodes || []),
  ].filter(Boolean).map(String))];
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

function normalizeBarcode(value) {
  const text = String(value || "").trim().replace(/^\]?[a-z]\d(?=\d{8,}$)/i, "");
  return text.replace(/[^\d]/g, "");
}

function barcodeAliases(value) {
  const barcode = normalizeBarcode(value);
  if (!barcode) return [];
  const aliases = new Set([barcode]);
  if (barcode.length === 11 || barcode.length === 12) aliases.add(`0${barcode}`);
  if ((barcode.length === 12 || barcode.length === 13) && barcode.startsWith("0")) aliases.add(barcode.slice(1));
  return [...aliases];
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
