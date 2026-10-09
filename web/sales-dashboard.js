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
  const periodLabel = days => typeof days === 'object' ? `${date(`${days.from}T00:00:00`)} – ${date(`${days.to}T00:00:00`)}` : days ? `${days} días` : 'Todo el historial';
  const periodOptions = days => [7, 15, 30, 45, 60, 90, 180, 365, 0].map(value => `<option value="${value}" ${value === days ? 'selected' : ''}>${periodLabel(value)}</option>`).join('') + `<option value="custom" ${typeof days === 'object' ? 'selected' : ''}>Fechas personalizadas</option>`;
  const isoDate = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const defaultRange = () => ({ from: isoDate(Date.now() - 29 * 86400000), to: isoDate(Date.now()) });
  const percent = value => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value * 100)}%`;
  const number = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);
  function periodControls(value, client = false) {
    return `<div class="sales-period-controls"><label class="sales-dashboard-field sales-period"><span>${client ? 'Período del cliente' : 'Período de actividad'}</span><select ${client ? 'data-client-period' : 'data-period'}>${periodOptions(value)}</select></label>
      ${typeof value === 'object' ? `<form class="sales-date-range" data-date-range="${client ? 'client' : 'summary'}"><label class="sales-dashboard-field"><span>Desde</span><input type="date" name="from" value="${safe(value.from)}" max="${isoDate(Date.now())}" required></label><label class="sales-dashboard-field"><span>Hasta (inclusive)</span><input type="date" name="to" value="${safe(value.to)}" max="${isoDate(Date.now())}" required></label><button type="submit" class="primary-button">Aplicar fechas</button><p class="sales-range-error" data-range-error role="alert"></p></form>` : ''}</div>`;
  }
  const statusLabel = status => ({ placed: 'Recibido', confirmed: 'Confirmado', packed: 'Preparado', sent: 'Enviado', cancelled: 'Cancelado', draft: 'Borrador' })[status] || status;

  const summarize = model.summarize;

  function trendHtml(result, selectedPeriod) {
    if (!result.count) return '<p class="sales-chart-empty">No hay compras registradas en este período.</p>';
    const max = Math.max(1, ...result.trend.map(bucket => bucket.total));
    const x = index => 56 + (result.trend.length > 1 ? index / (result.trend.length - 1) : 0.5) * 540;
    const y = value => 172 - value / max * 136;
    const points = result.trend.map((bucket, index) => `${x(index)},${y(bucket.total)}`).join(' ');
    return `<svg class="sales-trend-chart" viewBox="0 0 620 215" role="img" aria-label="Evolución del importe de pedidos"><title>Evolución del importe de pedidos</title><desc>${safe(periodLabel(selectedPeriod))}: ${result.count} pedidos por ${safe(formatMoney(result.total))}. El detalle está debajo del gráfico.</desc>
      ${[0, 0.5, 1].map(fraction => `<line x1="56" x2="596" y1="${y(fraction * max)}" y2="${y(fraction * max)}" class="sales-chart-grid"/><text x="48" y="${y(fraction * max) + 4}" text-anchor="end">${safe(new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(fraction * max))}</text>`).join('')}
      <polygon points="${x(0)},172 ${points} ${x(result.trend.length - 1)},172" class="sales-chart-area"/><polyline points="${points}" class="sales-chart-line"/>
      ${result.trend.map((bucket, index) => `<circle cx="${x(index)}" cy="${y(bucket.total)}" r="3" class="sales-chart-point"><title>${date(bucket.date)}: ${safe(formatMoney(bucket.total))} · ${bucket.count} pedidos</title></circle>`).join('')}
      <text x="56" y="200">${date(result.trend[0].date)}</text><text x="596" y="200" text-anchor="end">${date(result.trend.at(-1).date)}</text></svg>`;
  }

  function analyticsHtml(clients, orders, selectedPeriod) {
    const result = model.analytics(clients, orders, state.catalog?.products || [], selectedPeriod);
    const leading = result.brands.find(brand => brand.total > 0 && brand.name !== 'Sin marca identificada');
    const untouched = result.brands.filter(brand => brand.catalogProducts && !brand.orders);
    const maxBrand = Math.max(1, ...result.brands.map(brand => brand.total));
    const cadence = result.stepYears > 1 ? `${result.stepYears} años` : ({ day: 'día', week: 'semana', month: 'mes', year: 'año' })[result.cadence];
    return `<section class="sales-analysis" aria-label="Análisis de compras">
      <div class="sales-analysis-heading"><div><span class="eyebrow">Análisis de compras</span><h3>Qué compran tus clientes</h3></div><span class="sales-dashboard-note">${safe(periodLabel(selectedPeriod))}</span></div>
      <div class="sales-analysis-stats"><div><span>Ticket promedio</span><strong>${formatMoney(result.averageOrder)}</strong></div><div><span>Unidades pedidas</span><strong>${number(result.units)}</strong></div><div><span>Clientes con compras</span><strong>${result.activeClients} / ${clients.length}</strong><small>${percent(clients.length ? result.activeClients / clients.length : 0)} de la cartera</small></div><div><span>Clientes que repiten</span><strong>${result.repeatClients}</strong><small>Con 2 o más pedidos en el período</small></div></div>
      <div class="sales-charts"><article class="sales-chart-card"><h4>Evolución de pedidos</h4><p class="sales-dashboard-note">Importe por ${cadence} · incluye intervalos sin pedidos</p>${trendHtml(result, selectedPeriod)}<details class="sales-chart-data"><summary>Ver datos del gráfico</summary><div class="sales-table-wrap"><table><caption>Importe de pedidos por ${cadence}</caption><thead><tr><th>Inicio del intervalo</th><th>Pedidos</th><th>Importe</th></tr></thead><tbody>${result.trend.map(bucket => `<tr><td>${date(bucket.date)}</td><td>${bucket.count}</td><td>${formatMoney(bucket.total)}</td></tr>`).join('')}</tbody></table></div></details></article>
      <article class="sales-chart-card"><h4>Compras por marca</h4><p class="sales-dashboard-note">Participación del importe de productos pedidos</p><div class="sales-brand-bars">${result.brands.filter(brand => brand.orders).map(brand => `<div class="sales-brand-bar"><div><strong>${safe(brand.name)}</strong><span>${formatMoney(brand.total)} · ${percent(brand.share)}</span></div><div class="sales-bar-track"><span style="width:${Math.max(0, brand.total / maxBrand * 100)}%"></span></div><small>Unidades: ${number(brand.qty)} · Clientes: ${brand.clients} · Pedidos: ${brand.orders}</small></div>`).join('') || '<p class="sales-chart-empty">Sin productos comprados en el período.</p>'}</div></article></div>
      <div class="sales-insights"><article><strong>Participación de marcas</strong><p>${leading ? `${safe(leading.name)} representa ${percent(leading.share)} del importe de productos. Llegó a ${leading.clients} de ${clients.length} clientes.` : 'Todavía no hay compras con una marca identificada en este período.'}</p></article><article><strong>Oportunidades de ampliación</strong><p>${untouched.length ? `${safe(untouched.map(brand => brand.name).join(', '))}: marcas del catálogo sin compras registradas en este período.` : result.count ? 'Todas las marcas visibles del catálogo tienen compras en este período. Revisá su alcance por cliente para ampliar la cartera.' : 'Elegí otro período o registrá pedidos para analizar oportunidades.'}</p></article></div>
      <details class="sales-brand-details"><summary>Alcance de marcas y cobertura del catálogo</summary><div class="sales-table-wrap"><table><caption>Marca, clientes compradores y productos visibles comprados en el período</caption><thead><tr><th>Marca</th><th>Importe</th><th>Unidades</th><th>Clientes compradores</th><th>Productos comprados</th><th>Sin comprar</th></tr></thead><tbody>${result.brands.map(brand => `<tr><td>${safe(brand.name)}</td><td>${formatMoney(brand.total)}</td><td>${number(brand.qty)}</td><td>${brand.clients} / ${clients.length}</td><td>${brand.boughtProducts} / ${brand.catalogProducts}</td><td>${brand.missingProducts}</td></tr>`).join('')}</tbody></table></div><p class="sales-dashboard-note">Cobertura de productos visibles del catálogo actual, agrupados por SKU y marca. Los productos históricos que no se pueden vincular al catálogo aparecen como “Sin marca identificada”.</p></details>
      ${result.topProducts.length ? `<div class="sales-table-wrap sales-top-products"><table><caption>Productos con mayor importe de compra</caption><thead><tr><th>Producto</th><th>Marca / SKU</th><th>Unidades</th><th>Importe</th></tr></thead><tbody>${result.topProducts.map(product => `<tr><td>${safe(product.name)}</td><td>${safe(product.brand)}<small>${safe(product.sku)}</small></td><td>${number(product.qty)}</td><td>${formatMoney(product.total)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="sales-dashboard-note">Importes de pedidos, sin representar cobros. Borradores y cancelados excluidos.${result.unattributedOrders ? ` ${result.unattributedOrders} pedidos sin líneas de productos no se pueden repartir por marca.` : ''} ${Math.abs(result.total - result.lineTotal) > 0.01 ? 'La suma de productos difiere del total de pedidos; la participación por marca usa los importes de las líneas.' : ''}</p>
    </section>`;
  }

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
      ${periodControls(period)}
      <div class="sales-metrics">
        <div><strong>${assigned ? summary.rows.length : '—'}</strong><span>Clientes asignados</span></div>
        <div><strong>${summary.count}</strong><span>Pedidos · ${periodLabel(period)}</span></div>
        <div><strong>${formatMoney(summary.total)}</strong><span>Importe · ${periodLabel(period)}</span></div>
        <div><strong>${assigned ? summary.followup : '—'}</strong><span>Sin actividad · ${periodLabel(period)}</span></div>
      </div>
      ${analyticsHtml(snapshot.clients, snapshot.orders, period)}
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
      </section><section class="sales-orders-section"><h3>Últimos pedidos visibles</h3><div class="sales-recent-orders">${snapshot.orders.filter(order => model.inPeriod(order, period)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8).map(order => `<button type="button" class="sales-order-row" data-sales-order="${safe(order.id)}"><span><strong>${safe(order.displayId)}</strong> · ${safe(order.customer?.salesClient?.name || order.customer?.name)}<small>${date(order.createdAt)} · ${safe(({ placed: 'Recibido', confirmed: 'Confirmado', packed: 'Preparado', sent: 'Enviado', cancelled: 'Cancelado', draft: 'Borrador' })[order.status] || order.status)}</small></span><strong>${formatMoney(order.totalValue)}</strong></button>`).join('') || '<p class="sales-dashboard-note">No hay pedidos en este período.</p>'}</div></section></div>`;
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
      ${periodControls(clientPeriod, true)}
      <div class="sales-metrics"><div><strong>${purchases.length}</strong><span>Pedidos válidos</span></div><div><strong>${formatMoney(purchases.reduce((sum, order) => sum + Number(order.totalValue || 0), 0))}</strong><span>Importe de pedidos</span></div><div><strong>${products.bought.length}</strong><span>Productos comprados</span></div><div><strong>${products.missing.length}</strong><span>Sin comprar · catálogo actual</span></div></div>
      ${analyticsHtml([client], orders, clientPeriod)}
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
  panel.addEventListener('submit', event => {
    const form = event.target.closest('[data-date-range]');
    if (!form) return;
    event.preventDefault();
    if (!snapshot || snapshot.owner !== key()) return;
    const range = { from: form.elements.from.value, to: form.elements.to.value };
    if (!Number.isFinite(model.dateRange(range).start) || range.to > isoDate(Date.now())) {
      form.querySelector('[data-range-error]').textContent = 'Elegí fechas válidas: desde debe ser anterior o igual a hasta, y hasta no puede ser futura.';
      return;
    }
    if (form.dataset.dateRange === 'client') {
      clientPeriod = range;
      renderClientDetail();
    } else {
      period = range;
      snapshot.summary = summarize(snapshot.clients, snapshot.orders, Date.now(), period);
      render();
    }
    panel.querySelector('[data-date-range] button').focus();
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
      period = event.target.value === 'custom' ? defaultRange() : Number(event.target.value);
      snapshot.summary = summarize(snapshot.clients, snapshot.orders, Date.now(), period);
      render();
      panel.querySelector('[data-period]').focus();
    }
    if (event.target.matches('[data-client-period]')) {
      clientPeriod = event.target.value === 'custom' ? defaultRange() : Number(event.target.value);
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
