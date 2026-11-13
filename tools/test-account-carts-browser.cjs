const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const origin = 'http://127.0.0.1:8080';
const apiOrigin = 'https://iexpvwmtxauvzkcncqoc.supabase.co';
const web = path.resolve(__dirname, '../web');
const carts = new Map();
const accounts = [1, 2].map((n) => {
  const id = `00000000-0000-4000-8000-00000000000${n}`;
  const email = `account${n}@example.test`;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, role: 'authenticated', exp: expiresAt })}.fixture`;
  const user = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-12T00:00:00Z' };
  return { user, token, session: { user, access_token: token, refresh_token: `fixture-${n}`, expires_at: expiresAt, expires_in: 3600, token_type: 'bearer' } };
});
const [customer, otherCustomer] = accounts;
const products = JSON.parse(fs.readFileSync(path.join(web, 'data/catalog.json'), 'utf8')).products;
const [first, second, third] = ['121004-1', '121004-2', '121004-R'].map((sku) => products.find((product) => product.sku === sku && !product.hidden && !product.outOfStock));
let rejectCartWrites = false;
let releaseCartWrite;
let blockedCartWrite;

async function serveFixture(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === origin) {
    const file = path.join(web, url.pathname === '/' ? 'index.html' : url.pathname);
    const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)];
    if (type && fs.existsSync(file)) return route.fulfill({ path: file, contentType: type });
    return route.fulfill({ status: 404 });
  }
  if (url.origin !== apiOrigin) return route.abort();

  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS, PATCH',
    'access-control-allow-headers': request.headers()['access-control-request-headers'] || '*',
  };
  const reply = (json, status = 200) => route.fulfill({ json, status, headers });
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const account = accounts.find(({ token }) => request.headers().authorization === `Bearer ${token}`);
  const id = account?.user.id;
  if (url.pathname === '/auth/v1/token') {
    const { email } = request.postDataJSON();
    return reply(accounts.find(({ user }) => user.email === email).session);
  }
  if (url.pathname === '/auth/v1/user') return reply(account?.user || {}, account ? 200 : 401);
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
  if (url.pathname === '/rest/v1/profiles') {
    const profile = { id, name: 'Fixture customer', role: 'customer', price_access_approved: true };
    return reply(request.method() === 'POST' ? profile : account ? [profile] : []);
  }
  if (url.pathname === '/rest/v1/account_carts') {
    assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
    return reply(carts.has(id) ? [{ items: carts.get(id) }] : []);
  }
  if (url.pathname === '/rest/v1/rpc/update_account_cart') {
    const { p_user_id: owner, p_initial_items: initialItems, p_changes: changes } = request.postDataJSON();
    assert.equal(owner, id);
    if (rejectCartWrites) return reply({ message: 'Temporary cart write failure' }, 503);
    if (blockedCartWrite) {
      const pending = blockedCartWrite;
      blockedCartWrite = null;
      await pending;
    }
    const items = { ...(carts.get(id) || initialItems), ...changes };
    for (const [product, quantity] of Object.entries(items)) {
      if (quantity === null) delete items[product];
    }
    carts.set(id, items);
    return reply(items);
  }
  if (url.pathname === '/rest/v1/orders' && request.method() === 'POST') {
    return reply({ ...request.postDataJSON(), id: '00000000-0000-4000-8000-000000000020', order_number: 20 }, 201);
  }
  if (url.pathname.startsWith('/functions/v1/')) return reply({ ok: true });
  return reply([]);
}

async function open(browser, errors, seed = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', serveFixture);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => !state.isCheckingAuth);
  if (Object.keys(seed).length) {
    await page.evaluate((values) => {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
    }, seed);
    await page.reload();
    await page.waitForFunction(() => !state.isCheckingAuth);
  }
  return { context, page };
}

async function signIn(page, { user }) {
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('fixture-password');
  await page.locator('#signIn').click();
  await page.waitForFunction((id) => state.accountCart?.userId === id && state.accountCart.items && !state.accountCart.sync, user.id);
}

async function expectCart(page, items) {
  await page.waitForFunction(() => !state.accountCart?.sync);
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(state.cart)), items);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const { page } = await open(browser, errors, {
      catalogLastUser: customer.user,
      catalogCart: [[first.id, 2]],
    });
    await signIn(page, customer);
    await expectCart(page, { [first.id]: 2 });
    assert.deepEqual(carts.get(customer.user.id), { [first.id]: 2 });
    assert.equal(await page.evaluate(() => localStorage.getItem('catalogCart')), null);

    // The first save can still be running when a second item is added.
    blockedCartWrite = new Promise((resolve) => { releaseCartWrite = resolve; });
    const firstWrite = page.waitForRequest('**/rest/v1/rpc/update_account_cart');
    await page.evaluate((id) => updateQty(id, 1), first.id);
    await firstWrite;
    await page.evaluate((id) => addToCart(id, 4), second.id);
    releaseCartWrite();
    await expectCart(page, { [first.id]: 3, [second.id]: 4 });

    const { page: freshDevice } = await open(browser, errors);
    await signIn(freshDevice, customer);
    await expectCart(freshDevice, { [first.id]: 3, [second.id]: 4 });

    // Changes to unrelated lines survive simultaneous edits from two devices.
    await Promise.all([
      page.evaluate((id) => addToCart(id, 5), third.id),
      freshDevice.evaluate((id) => updateQty(id, 1), second.id),
    ]);
    await Promise.all([page, freshDevice].map((device) => device.waitForFunction(() => !state.accountCart.sync)));
    await freshDevice.evaluate(() => syncAccountCart());
    await expectCart(freshDevice, { [first.id]: 3, [second.id]: 5, [third.id]: 5 });

    rejectCartWrites = true;
    await freshDevice.evaluate((id) => {
      requestCartLineRemoval(id);
      requestCartLineRemoval(id);
    }, third.id);
    await freshDevice.waitForFunction(() => state.accountCart.failed && !state.accountCart.sync);
    assert.equal(await freshDevice.locator('#cartSyncMessage').textContent(), 'Hay cambios pendientes de guardar en tu cuenta.');
    await freshDevice.reload();
    await freshDevice.waitForFunction(() => !state.isCheckingAuth && state.accountCart?.failed);
    await expectCart(freshDevice, { [first.id]: 3, [second.id]: 5 });
    rejectCartWrites = false;
    await freshDevice.evaluate(() => window.dispatchEvent(new Event('online')));
    await freshDevice.waitForFunction(() => !state.accountCart.failed && !state.accountCart.sync);
    assert.deepEqual(carts.get(customer.user.id), { [first.id]: 3, [second.id]: 5 });

    await freshDevice.evaluate(() => { openAccount(); });
    await freshDevice.locator('#signOut').click();
    await freshDevice.waitForFunction(() => !state.user && state.cart.size === 0);
    await signIn(freshDevice, otherCustomer);
    await expectCart(freshDevice, {});
    await freshDevice.evaluate(() => { openAccount(); });
    await freshDevice.locator('#signOut').click();
    await freshDevice.waitForFunction(() => !state.user);
    await signIn(freshDevice, customer);
    await expectCart(freshDevice, { [first.id]: 3, [second.id]: 5 });

    const { page: staleDevice } = await open(browser, errors, {
      catalogLastUser: customer.user,
      catalogCart: [[third.id, 12]],
    });
    await signIn(staleDevice, customer);
    await expectCart(staleDevice, { [first.id]: 3, [second.id]: 5 });

    await freshDevice.evaluate(() => saveOrder());
    await expectCart(freshDevice, {});
    await page.evaluate(() => syncAccountCart());
    await expectCart(page, {});
    assert.deepEqual(carts.get(customer.user.id), {});
    assert.deepEqual(errors, []);
    console.log('Account cart passed browser tests for migration, cross-device restore, overlapping edits, retry after reload, account switching, and checkout.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
