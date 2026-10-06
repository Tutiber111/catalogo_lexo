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
    return Number.isFinite(timestamp) && timestamp <= now && (!days || timestamp >= now - days * 86400000);
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
      return { client, last, followup: !last || !inPeriod(last, days, now) };
    });
    return { rows, count: recent.length, total: recent.reduce((sum, order) => sum + Number(order.totalValue || 0), 0),
      followup: rows.filter(row => row.followup).length };
  }
  function products(client, orders, catalog, days = 0, now = Date.now()) {
    const byId = new Map(catalog.map(product => [product.id, product]));
    const bySku = new Map();
    const productKey = product => `${product.section || ''}:${sku(product.sku) || product.id}`;
    for (const product of catalog) {
      const code = sku(product.sku);
      if (!code) continue;
      if (!bySku.has(code)) bySku.set(code, new Map());
      bySku.get(code).set(productKey(product), product);
    }
    const bought = new Map();
    for (const order of history(client, orders, days, now).filter(valid)) {
      for (const item of order.items || []) {
        // Catalog page IDs can be reused. Check SKU too before matching an ID.
        let current = byId.get(item.productId);
        if (current && sku(item.sku) && sku(current.sku) !== sku(item.sku)) current = null;
        const candidates = bySku.get(sku(item.sku));
        if (!current && candidates?.size === 1) current = candidates.values().next().value;
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
  const model = { matches, inPeriod, history, summarize, products };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else window.SALES_DASHBOARD_MODEL = model;
})();
