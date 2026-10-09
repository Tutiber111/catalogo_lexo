/* Pure calculations shared by the dashboard and its regression tests. */
(function () {
  const text = value => String(value || '').trim();
  const sku = value => text(value).toUpperCase();
  const valid = order => !['cancelled', 'draft'].includes(order.status);
  function matches(client, order) {
    const customer = order.customer || {};
    const linked = customer.salesClient || {};
    // A stored client ID takes precedence over potentially stale text codes.
    if (linked.id) return linked.id === client.id;
    return Boolean(text(client.clientCode)) && text(client.clientCode) === (text(linked.clientCode) || text(customer.clientCode));
  }
  function inPeriod(order, days, now = Date.now()) {
    const timestamp = Date.parse(order.createdAt);
    if (days && typeof days === 'object') {
      const range = dateRange(days);
      return Number.isFinite(timestamp) && timestamp <= now && timestamp >= range.start && timestamp < range.end;
    }
    return Number.isFinite(timestamp) && timestamp <= now && (!days || timestamp >= now - days * 86400000);
  }
  function dateRange(range) {
    const parse = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return new Date(NaN);
      const result = new Date(`${value}T00:00:00`);
      if (result.getFullYear() !== Number(value.slice(0, 4)) || result.getMonth() + 1 !== Number(value.slice(5, 7)) || result.getDate() !== Number(value.slice(8, 10))) return new Date(NaN);
      return result;
    };
    const start = parse(range.from);
    const end = parse(range.to);
    const validRange = Number.isFinite(+start) && Number.isFinite(+end) && start <= end;
    end.setDate(end.getDate() + 1);
    return { start: validRange ? +start : NaN, end: validRange ? +end : NaN };
  }
  function history(client, orders, days = 0, now = Date.now()) {
    return orders.filter(order => matches(client, order) && inPeriod(order, days, now))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  function summarize(clients, orders, now = Date.now(), days = 30) {
    const purchases = orders.filter(valid);
    const recent = purchases.filter(order => inPeriod(order, days, now));
    const rows = clients.map(client => {
      const last = history(client, purchases, 0, now)[0];
      return { client, last, followup: !recent.some(order => matches(client, order)) };
    });
    return { rows, count: recent.length, total: recent.reduce((sum, order) => sum + Number(order.totalValue || 0), 0),
      followup: rows.filter(row => row.followup).length };
  }
  function catalogResolver(catalog) {
    const byId = new Map(catalog.map(product => [product.id, product]));
    const bySku = new Map();
    const productKey = product => `${product.section || ''}:${sku(product.sku) || product.id}`;
    for (const product of catalog) {
      const code = sku(product.sku);
      if (!code) continue;
      if (!bySku.has(code)) bySku.set(code, new Map());
      bySku.get(code).set(productKey(product), product);
    }
    return { productKey, resolve(item) {
      // Catalog page IDs can be reused. Check SKU too before matching an ID.
      let current = byId.get(item.productId);
      if (current && sku(item.sku) && sku(current.sku) !== sku(item.sku)) current = null;
      const candidates = bySku.get(sku(item.sku));
      if (!current && candidates?.size === 1) current = candidates.values().next().value;
      return current;
    } };
  }
  function products(client, orders, catalog, days = 0, now = Date.now()) {
    const { productKey, resolve } = catalogResolver(catalog);
    const bought = new Map();
    for (const order of history(client, orders, days, now).filter(valid)) {
      for (const item of order.items || []) {
        const current = resolve(item);
        const identity = current ? productKey(current) : `history:${sku(item.sku) || item.productId || item.name}`;
        if (!bought.has(identity)) bought.set(identity, {
          id: identity, name: current?.name || item.name, sku: item.sku || current?.sku,
          section: current?.section || '', qty: 0, total: 0, last: order.createdAt,
        });
        const row = bought.get(identity);
        row.qty += Number(item.qty || 0);
        row.total += Number(item.lineTotal || 0);
      }
    }
    const available = new Map(catalog.filter(product => !product.hidden).map(product => [productKey(product), product]));
    return {
      bought: [...bought.values()].sort((a, b) => b.qty - a.qty),
      missing: [...available].filter(([identity]) => !bought.has(identity)).map(([, product]) => product)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  }
  function analytics(clients, orders, catalog, period = 30, now = Date.now()) {
    const purchases = orders.filter(order => valid(order) && inPeriod(order, period, now));
    const { productKey, resolve } = catalogResolver(catalog);
    const brands = new Map();
    const topProducts = new Map();
    const buyers = new Set();
    const brandRow = name => {
      if (!brands.has(name)) brands.set(name, { name, total: 0, qty: 0, orders: new Set(), clients: new Set(), catalog: new Set(), bought: new Set() });
      return brands.get(name);
    };
    for (const product of catalog.filter(product => !product.hidden)) brandRow(text(product.section) || 'Sin marca identificada').catalog.add(productKey(product));
    let units = 0;
    let lineTotal = 0;
    let unattributedOrders = 0;
    for (const order of purchases) {
      const client = clients.find(client => matches(client, order));
      if (client) buyers.add(client.id);
      if (!(order.items || []).length) unattributedOrders++;
      for (const item of order.items || []) {
        const product = resolve(item);
        const brand = brandRow(text(product?.section) || 'Sin marca identificada');
        const identity = product ? productKey(product) : `history:${sku(item.sku) || item.productId || item.name}`;
        const qty = Number(item.qty || 0);
        const amount = Number(item.lineTotal || 0);
        brand.total += amount;
        brand.qty += qty;
        brand.orders.add(order);
        if (client) brand.clients.add(client.id);
        brand.bought.add(identity);
        units += qty;
        lineTotal += amount;
        if (!topProducts.has(identity)) topProducts.set(identity, { name: product?.name || item.name || item.sku, sku: item.sku || product?.sku, brand: brand.name, qty: 0, total: 0 });
        topProducts.get(identity).qty += qty;
        topProducts.get(identity).total += amount;
      }
    }
    const total = purchases.reduce((sum, order) => sum + Number(order.totalValue || 0), 0);
    const range = period && typeof period === 'object' ? dateRange(period) : { start: period ? now - period * 86400000 : purchases.reduce((first, order) => Math.min(first, Date.parse(order.createdAt)), now), end: now + 1 };
    const end = Math.min(range.end - 1, now);
    const span = Math.max(1, (end - range.start) / 86400000);
    const cadence = span <= 31 ? 'day' : span <= 180 ? 'week' : span <= 3650 ? 'month' : 'year';
    const stepYears = cadence === 'year' ? Math.max(1, Math.ceil(span / (365.25 * 200))) : 1;
    const bucketDate = timestamp => {
      const d = new Date(timestamp);
      d.setHours(0, 0, 0, 0);
      if (cadence === 'week') d.setDate(d.getDate() - (d.getDay() + 6) % 7);
      if (cadence === 'month' || cadence === 'year') d.setDate(1);
      if (cadence === 'year') { d.setMonth(0); d.setFullYear(Math.floor(d.getFullYear() / stepYears) * stepYears); }
      return +d;
    };
    const buckets = new Map();
    if (Number.isFinite(range.start) && range.start <= end) {
      const cursor = new Date(bucketDate(range.start));
      for (let n = 0; +cursor <= end && n < 400; n++) {
        buckets.set(+cursor, { date: cursor.toISOString(), total: 0, count: 0 });
        if (cadence === 'month') cursor.setMonth(cursor.getMonth() + 1);
        else if (cadence === 'year') cursor.setFullYear(cursor.getFullYear() + stepYears);
        else cursor.setDate(cursor.getDate() + (cadence === 'week' ? 7 : 1));
      }
    }
    for (const order of purchases) {
      const bucket = buckets.get(bucketDate(Date.parse(order.createdAt)));
      if (bucket) { bucket.total += Number(order.totalValue || 0); bucket.count++; }
    }
    return {
      count: purchases.length, total, units, averageOrder: purchases.length ? total / purchases.length : 0,
      activeClients: buyers.size, repeatClients: clients.filter(client => purchases.filter(order => matches(client, order)).length > 1).length,
      lineTotal, unattributedOrders, cadence, stepYears, trend: [...buckets.values()],
      brands: [...brands.values()].map(brand => ({ name: brand.name, total: brand.total, qty: brand.qty, orders: brand.orders.size, clients: brand.clients.size,
        share: lineTotal > 0 ? brand.total / lineTotal : 0, catalogProducts: brand.catalog.size,
        boughtProducts: [...brand.catalog].filter(identity => brand.bought.has(identity)).length,
        missingProducts: [...brand.catalog].filter(identity => !brand.bought.has(identity)).length,
      })).sort((a, b) => b.total - a.total || b.qty - a.qty || a.name.localeCompare(b.name)),
      topProducts: [...topProducts.values()].sort((a, b) => b.total - a.total || b.qty - a.qty).slice(0, 5),
    };
  }
  const model = { matches, dateRange, inPeriod, history, summarize, products, analytics };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else window.SALES_DASHBOARD_MODEL = model;
})();
