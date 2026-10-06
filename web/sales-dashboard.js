/* Sales dashboard; all data is fetched with the signed-in user's permissions. */
(function () {
  const panel = document.querySelector('#salesDashboard');
  const dialog = document.querySelector('#salesDashboardDialog');
  const entry = document.querySelector('#openSalesDashboard');
  const adminEntry = document.querySelector('#openAdminSalesDashboard');
  const title = document.querySelector('#salesDashboardTitle');
  let adminSalesmen = [];
  let adminSelectedCode = '';
  let currentFilter = 'followup';
  let search = '';
  let period = 30;
  let selectedClientId = '';
  let clientPeriod = 0;
  let clientTab = 'orders';
  let productSearch = '';
  let generation = 0;
  let snapshot = null;
  const isAdminView = () => state.profile?.role === 'admin';
  const salesmanCode = () => isAdminView() ? adminSelectedCode : state.profile?.salesman_code || '';
  const key = () => state.user && !state.isPasswordRecovery && (
    state.profile?.role === 'salesman' || (isAdminView() && adminSelectedCode)
  ) ? `${state.user.id}:${state.profile.role}:${salesmanCode()}` : '';
  const safe = (value) => escapeHtml(String(value ?? ''));
  const date = (value) => new Date(value).toLocaleDateString('es-AR');
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const model = window.SALES_DASHBOARD_MODEL;
  const periodLabel = days => days ? `${days} días` : 'Todo el historial';
  const periodOptions = days => [7, 15, 30, 60, 90, 180, 365, 0].map(value => `<option value="${value}" ${value === days ? 'selected' : ''}>${periodLabel(value)}</option>`).join('');
  const statusLabel = status => ({ placed: 'Recibido', confirmed: 'Confirmado', packed: 'Preparado', sent: 'Enviado', cancelled: 'Cancelado', draft: 'Borrador' })[status] || status;

  const summarize = model.summarize;

  function reset() {
    generation++;
    snapshot = null;
    panel.hidden = true;
    panel.innerHTML = '';
    currentFilter = 'followup';
    search = '';
    period = 30;
    selectedClientId = '';
    clientPeriod = 0;
    clientTab = 'orders';
    productSearch = '';
    adminSelectedCode = '';
    adminSalesmen = [];
    closeCatalogDialog(dialog);
  }

  function open() {
    if (state.profile?.role !== 'salesman' || !key()) return;
    title.textContent = 'Mi gestión comercial';
    closeAccount();
    closeCart();
    closeCatalogMenu();
    showCatalogDialog(dialog);
    refresh();
  }

  async function openAdminView() {
    if (!state.user || !isAdminView()) return;
    const userId = state.user.id;
    currentFilter = 'all';
    title.textContent = 'Panel de vendedores';
    panel.hidden = false;
    panel.innerHTML = '<p role="status">Cargando vendedores…</p>';
    showCatalogDialog(dialog);
    try {
      adminSalesmen = await CATALOG_SUPABASE.loadDashboardSalesmen();
      if (state.user?.id !== userId || !isAdminView()) { reset(); return; }
      if (!adminSalesmen.length) {
        panel.innerHTML = '<p>No hay vendedores configurados.</p>';
        return;
      }
      if (!adminSalesmen.some(seller => seller.code === adminSelectedCode)) adminSelectedCode = adminSalesmen[0].code;
      await refresh();
    } catch (error) {
      if (state.user?.id !== userId || !isAdminView()) return;
      console.error('Could not load salespeople', error);
      panel.innerHTML = '<p role="alert">No se pudieron cargar los vendedores.</p><button type="button" class="secondary-button" data-retry-admin>Reintentar</button>';
    }
  }

  function sync() {
    entry.hidden = state.profile?.role !== 'salesman' || !key();
    if (!state.user || (!key() && !isAdminView())) { reset(); return; }
    if (snapshot && snapshot.owner !== key()) reset();
  }

  async function refresh() {
    const owner = key();
    if (!owner) { reset(); return; }
    const request = ++generation;
    snapshot = null;
    panel.hidden = false;
    panel.innerHTML = '<h3>Mi gestión comercial</h3><p role="status">Cargando clientes y pedidos…</p>';
    try {
      const [clients, orders] = await Promise.all([
        salesmanCode()
          ? CATALOG_SUPABASE.loadDashboardClients(salesmanCode())
          : Promise.resolve([]),
        CATALOG_SUPABASE.loadDashboardOrders(state.user.id),
      ]);
      if (request !== generation || key() !== owner) return;
      const selectedOrders = salesmanCode()
        ? orders.filter(order => clients.some(client => model.matches(client, order)))
        : orders;
      snapshot = { owner, clients, orders: selectedOrders, summary: summarize(clients, selectedOrders, Date.now(), period) };
      render();
    } catch (error) {
      if (request !== generation || key() !== owner) return;
      console.error('Sales dashboard could not load', error);
      panel.innerHTML = '<h3>Mi gestión comercial</h3><p role="alert">No se pudo actualizar el panel. Revisá tu conexión e intentá nuevamente.</p><button type="button" class="secondary-button" data-refresh>Reintentar</button>';
    }
  }

  function render() {
    if (selectedClientId && snapshot.clients.some(client => client.id === selectedClientId)) { renderClientDetail(); return; }
    const { summary } = snapshot;
    const assigned = Boolean(salesmanCode());
    panel.innerHTML = `
      <div class="sales-dashboard-heading"><div><span class="eyebrow">${isAdminView() ? 'Administración · Vendedores' : assigned ? `Vendedor ${safe(salesmanCode())}` : 'Cuenta de vendedor'}</span><h3>Resumen comercial</h3></div><button type="button" class="secondary-button compact-button" data-refresh>Actualizar</button></div>
      ${isAdminView() ? `<label class="sales-dashboard-field sales-seller-select"><span>Vendedor</span><select data-salesman-select>${adminSalesmen.map(seller => `<option value="${safe(seller.code)}" ${seller.code === adminSelectedCode ? 'selected' : ''}>${safe(seller.code)} · ${safe(seller.name)}</option>`).join('')}</select></label>` : ''}
      ${assigned ? '' : '<p class="sales-dashboard-note" role="status">Tu cuenta todavía no tiene un código de vendedor asignado. Pedile al administrador que lo configure para ver tus clientes. Tus pedidos registrados se muestran abajo.</p>'}
      <p class="sales-dashboard-note">Pedidos de los clientes asignados al vendedor seleccionado registrados en el catálogo. Los totales excluyen borradores y cancelados. No incluye compras externas sin importar.</p>
      <label class="sales-dashboard-field sales-period"><span>Período de actividad</span><select data-period>${periodOptions(period)}</select></label>
      <div class="sales-metrics">
        <div><strong>${assigned ? summary.rows.length : '—'}</strong><span>Clientes asignados</span></div>
        <div><strong>${summary.count}</strong><span>Pedidos · ${periodLabel(period)}</span></div>
        <div><strong>${formatMoney(summary.total)}</strong><span>Importe · ${periodLabel(period)}</span></div>
        <div><strong>${assigned ? summary.followup : '—'}</strong><span>Sin actividad · ${periodLabel(period)}</span></div>
      </div>
      <div class="sales-workspace"><section class="sales-clients-section" aria-label="Seguimiento de clientes">
      <h3>Seguimiento de clientes</h3>
      <div class="sales-filter-buttons" role="group" aria-label="Actividad del cliente">
        <button type="button" data-filter="followup">Sin pedidos · ${periodLabel(period)} <b>${assigned ? summary.followup : '—'}</b></button>
        <button type="button" data-filter="all">Todos los clientes</button>
        <button type="button" data-filter="active">Con pedidos en el período</button>
        <button type="button" data-filter="none">Sin pedidos registrados</button>
      </div>
      <label class="sales-dashboard-field"><span>Buscar cliente</span><input type="search" data-search placeholder="Nombre, código o localidad" autocomplete="off" value="${safe(search)}"></label>
      <p data-count role="status" class="sales-dashboard-note"></p><div data-clients class="sales-client-list"></div>
      </section><section class="sales-orders-section"><h3>Últimos pedidos visibles</h3><div class="sales-recent-orders">${snapshot.orders.slice(0, 8).map(order => `<button type="button" class="sales-order-row" data-sales-order="${safe(order.id)}"><span><strong>${safe(order.displayId)}</strong> · ${safe(order.customer?.salesClient?.name || order.customer?.name)}<small>${date(order.createdAt)} · ${safe(({ placed: 'Recibido', confirmed: 'Confirmado', packed: 'Preparado', sent: 'Enviado', cancelled: 'Cancelado', draft: 'Borrador' })[order.status] || order.status)}</small></span><strong>${formatMoney(order.totalValue)}</strong></button>`).join('') || '<p class="sales-dashboard-note">Todavía no registraste pedidos.</p>'}</div></section></div>`;
    renderClients();
  }

  function renderClients() {
    if (!snapshot || snapshot.owner !== key()) return;
    const query = normalize(panel.querySelector('[data-search]').value);
    const filter = currentFilter;
    panel.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
    const rows = snapshot.summary.rows.filter(row => {
      const client = row.client;
      return normalize(`${client.name} ${client.legalName} ${client.clientCode} ${client.locality}`).includes(query)
        && (filter === 'all' || (filter === 'followup' && row.followup) || (filter === 'active' && !row.followup) || (filter === 'none' && !row.last));
    }).sort((a, b) => (a.last ? Date.parse(a.last.createdAt) : 0) - (b.last ? Date.parse(b.last.createdAt) : 0));
    panel.querySelector('[data-count]').textContent = `${rows.length} clientes encontrados`;
    panel.querySelector('[data-clients]').innerHTML = rows.map(({ client, last, followup }) => `
      <article class="sales-client-card"><div><button class="sales-client-link" type="button" data-view-client="${safe(client.id)}">${safe(client.legalName || client.name)}</button><small>${safe(client.clientCode)}${client.locality ? ` · ${safe(client.locality)}` : ''}</small><span class="sales-activity ${followup ? 'needs-followup' : ''}">${last ? `${Math.floor((Date.now() - Date.parse(last.createdAt)) / 86400000)} días sin pedidos · Último: ${date(last.createdAt)}` : 'Sin pedidos registrados'}</span></div><button type="button" class="secondary-button compact-button" data-sales-client="${safe(client.id)}">Crear pedido</button></article>`).join('') || '<p class="sales-dashboard-note">No hay clientes para este filtro.</p>';
  }

  function renderClientDetail() {
    const client = snapshot.clients.find(item => item.id === selectedClientId);
    if (!client) return;
    const orders = model.history(client, snapshot.orders, clientPeriod);
    const purchases = orders.filter(order => !['draft', 'cancelled'].includes(order.status));
    const products = model.products(client, snapshot.orders, state.catalog?.products || [], clientPeriod);
    panel.innerHTML = `
      <button type="button" class="secondary-button" data-back-clients>← Volver a clientes</button>
      <div class="sales-client-heading"><div><span class="eyebrow">Cliente ${safe(client.clientCode)}</span><h2>${safe(client.legalName || client.name)}</h2><p>${safe([client.address, client.locality].filter(Boolean).join(' · '))}</p></div><button class="primary-button" type="button" data-sales-client="${safe(client.id)}">Crear pedido</button></div>
      <p class="sales-dashboard-note">Historial registrado en el catálogo, sin importar quién cargó el pedido. No incluye compras externas sin importar. Borradores y cancelados aparecen en el historial, pero no cuentan como compras.</p>
      <label class="sales-dashboard-field sales-period"><span>Período del cliente</span><select data-client-period>${periodOptions(clientPeriod)}</select></label>
      <div class="sales-metrics"><div><strong>${purchases.length}</strong><span>Pedidos válidos</span></div><div><strong>${formatMoney(purchases.reduce((sum, order) => sum + Number(order.totalValue || 0), 0))}</strong><span>Importe de pedidos</span></div><div><strong>${products.bought.length}</strong><span>Productos comprados</span></div><div><strong>${products.missing.length}</strong><span>Sin comprar · catálogo actual</span></div></div>
      <div class="sales-filter-buttons" role="group" aria-label="Información del cliente">
        <button type="button" data-client-tab="orders" aria-pressed="${clientTab === 'orders'}">Pedidos (${orders.length})</button>
        <button type="button" data-client-tab="bought" aria-pressed="${clientTab === 'bought'}">Productos comprados (${products.bought.length})</button>
        <button type="button" data-client-tab="missing" aria-pressed="${clientTab === 'missing'}">Productos sin comprar (${products.missing.length})</button>
      </div>
      ${clientTab === 'orders' ? `<section class="sales-client-history"><h3>Pedidos · ${periodLabel(clientPeriod)}</h3>${orders.map(order => `<details class="sales-order-detail"><summary><strong>${safe(order.displayId || order.id)}</strong><span>${date(order.createdAt)} · ${safe(statusLabel(order.status))}</span><strong>${formatMoney(order.totalValue)}</strong></summary><div class="sales-table-wrap"><table><caption>Productos del pedido ${safe(order.displayId || order.id)}</caption><thead><tr><th>Producto</th><th>SKU</th><th>Cantidad</th><th>Importe</th></tr></thead><tbody>${(order.items || []).map(item => `<tr><td>${safe(item.name)}</td><td>${safe(item.sku)}</td><td>${safe(item.qty)}</td><td>${formatMoney(item.lineTotal)}</td></tr>`).join('')}</tbody></table>${order.items?.length ? '' : '<p>Este pedido no tiene productos registrados.</p>'}</div></details>`).join('') || '<p>No hay pedidos en este período.</p>'}</section>` : `
        <p class="sales-dashboard-note">${clientTab === 'bought' ? 'Productos incluidos en pedidos válidos del período seleccionado.' : 'Productos visibles del catálogo actual sin compras registradas en el período seleccionado. Elegí Todo el historial para ver los que no tienen ninguna compra registrada.'}</p>
        <label class="sales-dashboard-field"><span>Buscar producto</span><input type="search" data-product-search value="${safe(productSearch)}" placeholder="SKU, producto o marca"></label><p data-product-count role="status" class="sales-dashboard-note"></p><div data-product-results></div>`}`;
    if (clientTab !== 'orders') renderProductResults(products);
  }

  function renderProductResults(result) {
    const client = snapshot.clients.find(item => item.id === selectedClientId);
    if (!client) return;
    const products = result || model.products(client, snapshot.orders, state.catalog?.products || [], clientPeriod);
    const rows = (clientTab === 'bought' ? products.bought : products.missing).filter(product => normalize(`${product.sku} ${product.name} ${product.section || ''}`).includes(normalize(productSearch)));
    panel.querySelector('[data-product-count]').textContent = `${rows.length} productos encontrados`;
    panel.querySelector('[data-product-results]').innerHTML = rows.length ? `<div class="sales-table-wrap"><table><caption>${clientTab === 'bought' ? 'Productos comprados' : 'Productos sin comprar'} · ${periodLabel(clientPeriod)}</caption><thead><tr><th>Producto</th><th>SKU / Marca</th>${clientTab === 'bought' ? '<th>Unidades</th><th>Importe</th><th>Último pedido</th>' : '<th>Disponibilidad</th>'}</tr></thead><tbody>${rows.map(product => `<tr><td>${safe(product.name)}</td><td>${safe(product.sku)}<small>${safe(product.section)}</small></td>${clientTab === 'bought' ? `<td>${product.qty}</td><td>${formatMoney(product.total)}</td><td>${date(product.last)}</td>` : `<td>${product.outOfStock ? 'Sin stock' : 'Disponible'}</td>`}</tr>`).join('')}</tbody></table></div>` : '<p>No hay productos para este filtro.</p>';
  }

  entry.addEventListener('click', open);
  adminEntry.addEventListener('click', openAdminView);
  panel.addEventListener('input', event => {
    if (event.target.matches('[data-search]')) { search = event.target.value; renderClients(); }
    if (event.target.matches('[data-product-search]')) { productSearch = event.target.value; renderProductResults(); }
  });
  panel.addEventListener('change', event => {
    if (!snapshot || snapshot.owner !== key()) return;
    if (event.target.matches('[data-salesman-select]')) {
      const selected = event.target.value;
      if (!adminSalesmen.some(seller => seller.code === selected)) return;
      adminSelectedCode = selected;
      selectedClientId = '';
      search = '';
      currentFilter = 'all';
      refresh();
      return;
    }
    if (event.target.matches('[data-period]')) {
      period = Number(event.target.value);
      snapshot.summary = summarize(snapshot.clients, snapshot.orders, Date.now(), period);
      render();
      panel.querySelector('[data-period]').focus();
    }
    if (event.target.matches('[data-client-period]')) {
      clientPeriod = Number(event.target.value);
      renderClientDetail();
      panel.querySelector('[data-client-period]').focus();
    }
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('[data-retry-admin]')) { openAdminView(); return; }
    if (!key()) { reset(); return; }
    if (event.target.closest('[data-refresh]')) { refresh(); return; }
    if (!snapshot || snapshot.owner !== key()) return;
    if (event.target.closest('[data-back-clients]')) {
      selectedClientId = '';
      render();
      panel.querySelector('[data-search]').focus();
      return;
    }
    const viewClient = event.target.closest('[data-view-client]');
    if (viewClient) {
      selectedClientId = viewClient.dataset.viewClient;
      clientPeriod = 0;
      clientTab = 'orders';
      productSearch = '';
      renderClientDetail();
      panel.querySelector('[data-back-clients]').focus();
      return;
    }
    const tabButton = event.target.closest('[data-client-tab]');
    if (tabButton) {
      clientTab = tabButton.dataset.clientTab;
      renderClientDetail();
      panel.querySelector(`[data-client-tab="${clientTab}"]`).focus();
      return;
    }
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) { currentFilter = filterButton.dataset.filter; renderClients(); return; }
    const clientButton = event.target.closest('[data-sales-client]');
    if (clientButton) {
      const client = snapshot.clients.find(item => item.id === clientButton.dataset.salesClient);
      if (!client) return;
      if (state.cart.size && state.selectedSalesClient?.id !== client.id) {
        showToast('Terminá o vaciá el carrito actual antes de cambiar de cliente.');
        return;
      }
      selectSalesClient(client);
      closeCatalogDialog(dialog);
      closeAccount();
      openCart();
    }
    const orderButton = event.target.closest('[data-sales-order]');
    if (orderButton) {
      closeCatalogDialog(dialog);
      openAccount();
      state.customerOrders = snapshot.orders;
      showCustomerOrderDetail(orderButton.dataset.salesOrder);
      els.customerOrderDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  window.SALES_DASHBOARD = { refresh, summarize, sync, open, openAdminView };
  window.addEventListener('catalog:orders-changed', () => { if (key() && isCatalogDialogOpen(dialog)) refresh(); });
  sync();
})();
