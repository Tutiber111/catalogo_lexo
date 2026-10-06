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
console.log('Client matching, periods, purchase aggregation, exclusions, SKU remapping and catalog comparison passed.');
