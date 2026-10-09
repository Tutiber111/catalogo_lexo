const assert = require('node:assert/strict');
const model = require('../web/sales-dashboard-model.js');
const now = Date.parse('2026-10-06T12:00:00Z');
const client = { id: 'a', clientCode: '001' };
const catalog = [
  { id: 'new-a', sku: 'A', name: 'Bottle', section: 'Lexo' },
  { id: 'b', sku: 'B', name: 'Cup', section: 'Lexo' },
  { id: 'hidden', sku: 'H', hidden: true },
  { id: 'dup-a', sku: 'A', name: 'Bottle', section: 'Lexo' },
];
const make = (days, sku, quantity, extra = {}) => ({
  id: `order-${days}`, status: 'placed', createdAt: new Date(now - days * 86400000).toISOString(),
  customer: { clientCode: '001' }, totalValue: quantity * 10,
  items: [{ productId: `old-${sku}`, sku, name: sku, qty: quantity, lineTotal: quantity * 10 }], ...extra,
});
const orders = [make(5, 'A', 2), make(50, 'B', 3), make(60, 'A', 1),
  make(1, 'H', 7, { status: 'cancelled' }), make(2, 'X', 1),
  make(1, 'A', 99, { customer: { clientCode: '999' } })];
assert.equal(model.history(client, orders, 0, now).length, 5, 'all client orders including cancellations');
assert.equal(model.history(client, orders, 30, now).length, 3);
assert.equal(model.history(client, orders, 7, now).length, 3);
assert.equal(model.matches(client, { customer: { salesClient: { id: 'b', clientCode: '001' } } }), false, 'ID wins over conflicting code');
assert.equal(model.matches(client, { customer: { salesClient: { clientCode: ' 001 ' } } }), true);
assert.equal(model.matches({ id: 'missing', clientCode: '' }, { customer: {} }), false);
let result = model.products(client, orders, catalog, 30, now);
assert.deepEqual(result.missing.map(p => p.sku), ['B'], 'missing excludes hidden products and deduplicates catalog');
assert.equal(result.bought.find(p => p.sku === 'A').qty, 2);
assert.equal(result.bought.find(p => p.sku === 'X').qty, 1, 'discontinued products retained');
result = model.products(client, orders, catalog, 0, now);
assert.equal(result.missing.length, 0);
assert.equal(result.bought.find(p => p.sku === 'A').qty, 3);
assert.equal(result.bought.find(p => p.sku === 'A').total, 30);
assert.equal(result.bought.find(p => p.sku === 'A').last, orders[0].createdAt);
assert.equal(model.summarize([client], [make(50, 'A', 1)], now, 30).followup, 1);
assert.equal(model.summarize([client], [make(50, 'A', 1)], now, 60).followup, 0);
assert.equal(model.summarize([client], [make(500, 'A', 1)], now, 0).followup, 0);
assert.equal(model.inPeriod(make(-1, 'A', 1), 30, now), false, 'future orders excluded');
assert.equal(model.inPeriod(make(30, 'A', 1), 30, now), true, 'inclusive lower boundary');
assert.equal(model.products(client, [make(1, 'B', 1, { items: [{ productId: 'new-a', sku: 'B', qty: 1 }] })], catalog, 0, now).bought[0].sku, 'B', 'reused page ID cannot turn B into A');
const range = { from: '2026-09-01', to: '2026-09-30' };
const timed = (createdAt, overrides = {}) => ({ ...make(1, 'A', 2), createdAt, ...overrides });
const rangedOrders = [timed('2026-08-31T23:59:59'), timed('2026-09-01T00:00:00'), timed('2026-09-30T23:59:59.999'), timed('2026-10-01T00:00:00')];
assert.equal(model.history(client, rangedOrders, range, now).length, 2, 'both custom boundary days included');
assert.equal(model.summarize([client], rangedOrders, now, range).followup, 0, 'newer last order must not hide an in-range purchase');
assert.equal(model.products(client, rangedOrders, catalog, range, now).bought[0].qty, 4);
assert.equal(model.inPeriod(rangedOrders[0], { from: '2026-09-30', to: '2026-09-01' }, now), false);
assert.equal(model.inPeriod(rangedOrders[0], { from: '2026-02-30', to: '2026-09-01' }, now), false);
const c2 = { id: 'b', clientCode: '002' };
const brandsCatalog = [...catalog, { id: 'pan', sku: 'P', name: 'Pan', section: 'Magefesa' }, { id: 'oxo', sku: 'O', name: 'Peeler', section: 'OXO' }];
const analyticsOrders = [
  timed('2026-09-05T12:00:00', { totalValue: 40, items: [{ productId: 'old-A', sku: 'A', qty: 2, lineTotal: 20 }, { productId: 'pan', sku: 'P', qty: 1, lineTotal: 20 }] }),
  timed('2026-09-07T12:00:00', { totalValue: 10, items: [{ sku: 'A', qty: 1, lineTotal: 10 }] }),
  timed('2026-09-10T12:00:00', { customer: { clientCode: '002' }, totalValue: 50, items: [{ sku: 'P', qty: 2, lineTotal: 40 }, { sku: 'X', qty: 1, lineTotal: 10 }] }),
  timed('2026-09-15T12:00:00', { status: 'cancelled', totalValue: 999 }),
  timed('2026-10-01T12:00:00', { totalValue: 999 }),
  timed('2026-09-18T12:00:00', { totalValue: 5, items: [] }),
];
const analysis = model.analytics([client, c2], analyticsOrders, brandsCatalog, range, now);
assert.equal(analysis.count, 4);
assert.equal(analysis.total, 105);
assert.equal(analysis.lineTotal, 100);
assert.equal(analysis.averageOrder, 26.25);
assert.equal(analysis.units, 7);
assert.equal(analysis.activeClients, 2);
assert.equal(analysis.repeatClients, 1);
assert.equal(analysis.unattributedOrders, 1);
assert.equal(analysis.brands.find(b => b.name === 'Magefesa').share, 0.6);
assert.equal(analysis.brands.find(b => b.name === 'Magefesa').clients, 2);
assert.equal(analysis.brands.find(b => b.name === 'Lexo').catalogProducts, 2, 'duplicate catalog entries counted once');
assert.equal(analysis.brands.find(b => b.name === 'Lexo').missingProducts, 1);
assert.equal(analysis.brands.find(b => b.name === 'OXO').orders, 0, 'unbought brands remain available as opportunities');
assert.equal(analysis.brands.find(b => b.name === 'Sin marca identificada').total, 10, 'discontinued products are not guessed into a brand');
assert.equal(analysis.trend.length, 30, 'zero-purchase days are shown');
assert.equal(analysis.trend.reduce((sum, bucket) => sum + bucket.total, 0), analysis.total);
assert.equal(analysis.trend.reduce((sum, bucket) => sum + bucket.count, 0), analysis.count);
assert.equal(analysis.topProducts[0].sku, 'P');
assert.equal(model.analytics([], [], [], range, now).averageOrder, 0);
for (const period of [180, 365, 0]) {
  const grouped = model.analytics([client, c2], analyticsOrders, brandsCatalog, period, now);
  assert.equal(grouped.trend.reduce((sum, bucket) => sum + bucket.total, 0), grouped.total, 'weekly/monthly/all-history buckets retain totals');
}
console.log('Client matching, custom date boundaries, activity, purchases, brand attribution, coverage and trend totals passed.');
