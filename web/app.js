const state = {
  catalog: null,
  currentIndex: 0,
  zoom: Number(localStorage.getItem("catalogZoom") || 100),
  productsById: new Map(),
  cart: new Map(JSON.parse(localStorage.getItem("catalogCart") || "[]")),
};

const els = {
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
  copyOrder: document.querySelector("#copyOrder"),
  whatsappOrder: document.querySelector("#whatsappOrder"),
  productDialog: document.querySelector("#productDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  toast: document.querySelector("#toast"),
};

async function init() {
  state.catalog = window.CATALOG_DATA || (await fetchCatalog());
  state.productsById = new Map(state.catalog.products.map((product) => [product.id, product]));

  const priceCount = state.catalog.priceList?.productCount || 0;
  els.catalogMeta.textContent = `${state.catalog.samplePageCount} sample pages from ${state.catalog.totalPagesInPdf} PDF pages · ${priceCount} Excel products`;
  bindEvents();
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
  els.copyOrder.addEventListener("click", copyOrder);
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
    const products = page.products.map((id) => state.productsById.get(id)).filter(Boolean);
    return [page.title, String(page.number), ...products.flatMap(searchFields)].join(" ").toLowerCase().includes(query);
  });

  const products = state.catalog.products.filter((product) => searchFields(product).join(" ").toLowerCase().includes(query));

  els.pagesPanel.innerHTML = pages
    .map((page) => {
      const active = page.number === currentPage().number ? " is-active" : "";
      const count = page.products.length;
      return `
        <button class="page-card${active}" type="button" data-page="${page.number}">
          <strong>Page ${page.number}</strong>
          <p>${escapeHtml(page.title)} · ${count} product${count === 1 ? "" : "s"}</p>
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
            <p>${escapeHtml(product.sku)} · ${escapeHtml(product.price)} · Page ${product.page}</p>
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
  const products = page.products.map((id) => state.productsById.get(id)).filter(Boolean);

  els.pageTitle.textContent = `Page ${page.number} · ${page.title}`;
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
  const pos = group.position;
  return `
    <button
      class="price-overlay"
      type="button"
      data-group="${group.id}"
      aria-label="Open products priced ${escapeHtml(group.price)}"
      style="left:${pos.x * 100}%;top:${pos.y * 100}%"
    >${escapeHtml(group.price)}</button>
  `;
}

function openPriceGroup(groupId) {
  const page = currentPage();
  const group = (page.priceGroups || []).find((item) => item.id === groupId);
  if (!group) return;
  if (group.productIds.length === 1) {
    openProduct(state.productsById.get(group.productIds[0]));
    return;
  }
  const products = group.productIds.map((id) => state.productsById.get(id)).filter(Boolean);
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
              <button class="group-product" type="button" data-add="${product.id}">
                <span>${escapeHtml(product.name)}</span>
                <strong>${escapeHtml(product.sku)}</strong>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  els.dialogContent.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.add);
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
      <button class="primary-button" type="button" data-add="${product.id}">Add to cart</button>
    </div>
  `;
  els.dialogContent.querySelector("[data-add]").addEventListener("click", () => {
    addToCart(product.id);
    els.productDialog.close();
  });
  els.productDialog.showModal();
}

function addToCart(productId) {
  state.cart.set(productId, (state.cart.get(productId) || 0) + 1);
  saveCart();
  renderCart();
  showToast("Added to cart");
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
    .filter((line) => line.product);
  const total = lines.reduce((sum, line) => sum + line.qty, 0);

  els.cartCount.textContent = total;
  els.cartTotalItems.textContent = total;
  els.cartItems.innerHTML =
    lines
      .map(
        ({ product, qty }) => `
          <div class="cart-line">
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <p>${escapeHtml(product.sku)} · ${escapeHtml(product.price)} · Page ${product.page}</p>
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

  const orderText = buildOrderText(lines);
  els.whatsappOrder.href = `https://wa.me/?text=${encodeURIComponent(orderText)}`;
}

function buildOrderText(lines) {
  if (!lines.length) return "Order draft is empty.";
  return [
    "Catalog order draft",
    "",
    ...lines.map(({ product, qty }) => `${qty} x ${product.sku} - ${product.name} - ${product.price}`),
  ].join("\n");
}

async function copyOrder() {
  const lines = [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.productsById.get(id), qty }))
    .filter((line) => line.product);
  await navigator.clipboard.writeText(buildOrderText(lines));
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

function searchFields(product) {
  return [product.name, product.sku, product.category, product.price, String(product.page), ...(product.skus || [])];
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
