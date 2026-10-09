const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = {};
const panel = { innerHTML: '', hidden: true, addEventListener(type, listener) { events[type] = listener; }, querySelectorAll: () => [] };
const entry = { hidden: true, addEventListener() {} };
const adminEntry = { addEventListener() {} };
const title = { textContent: '' };
const dialog = { open: false };
const state = { user: { id: 'seller-a' }, profile: { role: 'salesman', salesman_code: '845' } };
const context = { window: { addEventListener() {} }, document: { querySelector: selector => ({ '#salesDashboard': panel, '#openSalesDashboard': entry, '#openAdminSalesDashboard': adminEntry, '#salesDashboardTitle': title, '#salesDashboardDialog': dialog })[selector] }, state, closeCatalogDialog() { dialog.open = false; }, showCatalogDialog() { dialog.open = true; } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/sales-dashboard-model.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('web/sales-dashboard.js', 'utf8'), context);
const dashboard = context.window.SALES_DASHBOARD;
const now = Date.parse('2026-10-06T12:00:00Z');
const clients = [{ id: 'a', clientCode: '001' }, { id: 'b', clientCode: '002' }, { id: 'c', clientCode: '003' }];
const order = (code, days, totalValue, status = 'placed') => ({ customer: { clientCode: code }, createdAt: new Date(now - days * 86400000).toISOString(), totalValue, status });
const result = dashboard.summarize(clients, [order('001', 1, 200), order('002', 31, 300), order('003', 0, 900, 'cancelled'), order('003', 0, 800, 'draft')], now);
assert.equal(result.count, 1);
assert.equal(result.total, 200);
assert.equal(result.followup, 2);
assert.equal(result.rows[2].last, undefined);
assert.equal(dashboard.summarize(clients, [order('001', 30, 50)], now).followup, 2);
assert.equal(dashboard.summarize([], [], now).total, 0);

async function test() {
  const nodes = {
    '[data-search]': { value: '', focus() {} }, '[data-filter]': { value: 'all' },
    '[data-period]': { focus() {} }, '[data-date-range] button': { focus() {} },
    '[data-count]': {}, '[data-clients]': {},
  };
  panel.querySelector = selector => nodes[selector];
  context.escapeHtml = value => String(value);
  context.formatMoney = value => `$${value}`;
  context.console = console;
  state.profile.salesman_code = null;
  context.CATALOG_SUPABASE = {
    loadDashboardClients: () => { throw new Error('Client query must not run without an assignment'); },
    loadDashboardOrders: async () => [],
  };
  await dashboard.refresh();
  assert.match(panel.innerHTML, /código de vendedor asignado/);
  assert.match(panel.innerHTML, /Últimos pedidos visibles/);
  assert.doesNotMatch(panel.innerHTML, /No se pudo actualizar/);
  state.profile.salesman_code = '845';
  context.CATALOG_SUPABASE = {
    loadDashboardClients: async () => clients,
    loadDashboardOrders: async () => [{ ...order('001', 0, 200), createdAt: new Date().toISOString() }],
  };
  await dashboard.refresh();
  assert.equal(nodes['[data-count]'].textContent, '2 clientes encontrados', 'inactive clients are the default view');
  assert.equal(entry.hidden, false, 'salesperson gets a dashboard entry');
  assert.match(panel.innerHTML, /Fechas personalizadas/);
  assert.match(panel.innerHTML, /Compras por marca/);
  events.change({ target: { value: 'custom', matches: selector => selector === '[data-period]' } });
  assert.match(panel.innerHTML, /type="date"/);
  const rangeError = { textContent: '' };
  const form = { elements: { from: { value: '2026-09-30' }, to: { value: '2026-09-01' } }, dataset: { dateRange: 'summary' }, querySelector: () => rangeError };
  let prevented = false;
  events.submit({ preventDefault() { prevented = true; }, target: { closest: () => form } });
  assert.equal(prevented, true);
  assert.match(rangeError.textContent, /Elegí fechas válidas/);
  form.elements.from.value = '2026-01-01';
  // Produce an ISO date independently of platform locale formatting.
  const today = new Date();
  form.elements.to.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  events.submit({ preventDefault() {}, target: { closest: () => form } });
  assert.match(panel.innerHTML, /value="2026-01-01"/);
  assert.match(panel.innerHTML, /Evolución de pedidos/);
  events.change({ target: { value: '30', matches: selector => selector === '[data-period]' } });
  state.profile.role = 'admin';
  dashboard.sync();
  assert.equal(entry.hidden, true, 'admin retains the separate Admin entry');
  context.CATALOG_SUPABASE = {
    loadDashboardSalesmen: async () => [{ code: '845', name: 'Seller A' }, { code: '900', name: 'Seller B' }],
    loadDashboardClients: async code => code === '845' ? clients : [{ id: 'other', clientCode: '900' }],
    loadDashboardOrders: async () => [order('001', 1, 100), order('900', 1, 250)],
  };
  await dashboard.openAdminView();
  assert.equal(title.textContent, 'Panel de vendedores');
  assert.match(panel.innerHTML, /Vendedor/);
  assert.match(panel.innerHTML, /Seller A/);
  assert.equal(nodes['[data-count]'].textContent, '3 clientes encontrados', 'admin sees selected seller clients');
  assert.doesNotMatch(panel.innerHTML, /\$350/, 'admin totals exclude other seller orders');
  state.profile.role = 'customer';
  await dashboard.openAdminView();
  assert.equal(title.textContent, 'Panel de vendedores', 'customer cannot reopen admin view');
  state.profile.role = 'salesman';
  dashboard.sync();
  assert.equal(entry.hidden, false);
  dialog.open = true;
  let resolveClients;
  context.CATALOG_SUPABASE = {
    loadDashboardClients: () => new Promise(resolve => { resolveClients = resolve; }),
    loadDashboardOrders: async () => [],
  };
  const pending = dashboard.refresh();
  state.user = null;
  dashboard.sync();
  resolveClients(clients);
  await pending;
  assert.equal(panel.hidden, true, 'sign-out hides dashboard');
  assert.equal(dialog.open, false, 'sign-out closes the modal');
  assert.equal(panel.innerHTML, '', 'late response must not expose previous account data');

  const calls = [];
  const api = { auth: { onAuthStateChange() {} }, from(table) {
    const query = { select() { return this; }, eq(field, value) { calls.push([table, field, value]); return this; }, order() { return this; },
      async range(start, end) { calls.push([start, end]); return { data: Array.from({ length: start === 0 ? 500 : 2 }, (_, i) => ({ id: `${start + i}`, client_code: `${start + i}` })), error: null }; } };
    return query;
  } };
  const apiContext = { window: { location: { search: '', hash: '' }, supabase: { createClient: () => api } }, URLSearchParams };
  vm.createContext(apiContext);
  vm.runInContext(fs.readFileSync('web/supabase-client.js', 'utf8'), apiContext);
  const rows = await apiContext.window.CATALOG_SUPABASE.loadDashboardClients('845');
  assert.equal(rows.length, 502, 'fetches beyond first page');
  assert.deepEqual(calls[0], ['sales_clients', 'salesman_code', '845']);
  assert.deepEqual(calls.at(-1), [500, 999]);
  calls.length = 0;
  await apiContext.window.CATALOG_SUPABASE.loadDashboardOrders('seller-a');
  assert.equal(calls.some(call => call[1] === 'customer_id'), false, 'RLS includes assigned client orders regardless of author');
  await assert.rejects(() => apiContext.window.CATALOG_SUPABASE.loadDashboardClients(''));
  console.log('Dashboard totals, follow-up boundaries, cancellation exclusions, empty data, account isolation, and API pagination passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
