const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sdk = fs.readFileSync(path.join(root, 'web/assets/vendor/supabase-2.118.0.min.js'), 'utf8');
const source = fs.readFileSync(process.env.CATALOG_AUTH_SOURCE || path.join(root, 'web/supabase-client.js'), 'utf8');
const apiUrl = 'https://iexpvwmtxauvzkcncqoc.supabase.co';
const user = {
  id: '11111111-1111-4111-8111-111111111111', email: 'client@example.test',
  aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
function sessionFor(account = user) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const access_token = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: account.id, role: 'authenticated', exp: expires_at })).toString('base64url'),
    Buffer.from('fixture-signature').toString('base64url'),
  ].join('.');
  return { user: account, access_token, refresh_token: 'fixture-refresh', expires_at, expires_in: 3600, token_type: 'bearer' };
}

function setup({ hash = '', account = user } = {}) {
  const session = sessionFor(account), requests = [], events = [];
  const profile = { id: account.id, name: 'Fixture client', role: 'customer', price_access_approved: true, client_code: '81038', assigned_salesman_code: '810' };
  const window = { location: { search: '', hash }, dispatchEvent: event => events.push(event.type) };
  const sandbox = {
    console, URL, URLSearchParams, Headers, Request, Response, WebSocket, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, atob, btoa, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const headers = new Headers(init.headers), authorized = headers.get('Authorization') === `Bearer ${session.access_token}`;
      requests.push({ url, method: init.method || 'GET', authorization: headers.get('Authorization'), body: init.body });
      const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/auth/v1/token') return respond(session);
      if (url.pathname === '/auth/v1/user') return respond(authorized ? account : { message: 'Missing session' }, authorized ? 200 : 401);
      if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
      if (url.pathname === '/auth/v1/recover') return respond({});
      if (url.pathname === '/rest/v1/profiles') {
        if ((init.method || 'GET') !== 'GET') {
          if (!authorized) return respond({ code: '42501', message: 'new row violates row-level security policy for table "profiles"' }, 401);
          return respond(profile);
        }
        return respond(authorized ? [profile] : []);
      }
      return respond({});
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(sdk, sandbox);
  // Run the real SDK with in-memory persistence so tests never read customer sessions.
  window.supabase = { createClient: (url, key, options) => sandbox.supabase.createClient(url, key, {
    ...options, auth: { ...options.auth, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) };
  sandbox.window = window;
  vm.runInContext(source, sandbox);
  return { api: window.CATALOG_SUPABASE, requests, session, profile, window, events };
}

test('successful password sign-in keeps profile reads authenticated when the SDK lookup returns no session', async () => {
  const x = setup();
  const signedIn = await x.api.signIn(user.email, 'fixture-password');
  assert.equal(signedIn.id, user.id);
  x.api.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  const profile = await x.api.getProfile(signedIn.id);
  assert.equal(profile?.id, user.id, 'an existing client must not appear to have a missing profile');
  assert.equal(profile.price_access_approved, true);
  assert.equal(x.requests.filter(r => r.url.pathname === '/rest/v1/profiles' && r.method !== 'GET').length, 0);
  assert.equal(x.requests.at(-1).authorization, `Bearer ${x.session.access_token}`);
});

test('profile saves preserve client permissions and carry the signed-in token', async () => {
  const x = setup();
  await x.api.signIn(user.email, 'fixture-password');
  x.api.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  const saved = await x.api.upsertProfile(user, { name: 'Updated client', assignedSalesmanCode: '810' });
  assert.equal(saved.client_code, '81038');
  const payload = JSON.parse(x.requests.at(-1).body);
  assert.equal(payload.name, 'Updated client');
  for (const field of ['role', 'salesman_code', 'client_code', 'price_access_approved']) assert.equal(field in payload, false);
});

test('password reset request and recovery link update use authenticated account requests', async () => {
  const x = setup({ hash: '#type=recovery' });
  x.window.location.hash = `#access_token=${x.session.access_token}&refresh_token=${x.session.refresh_token}&type=recovery`;
  await x.api.sendPasswordReset(user.email);
  const reset = x.requests.find(r => r.url.pathname === '/auth/v1/recover');
  assert.equal(reset.url.searchParams.get('redirect_to'), 'https://catalogolexo.com.ar/');
  assert.equal(JSON.parse(reset.body).email, user.email);
  const updated = await x.api.updatePassword('new-fixture-password');
  assert.equal(updated.id, user.id);
  x.api.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  assert.equal((await x.api.getProfile(updated.id))?.id, user.id);
  const update = x.requests.find(r => r.url.pathname === '/auth/v1/user' && r.method === 'PUT');
  assert.equal(JSON.parse(update.body).password, 'new-fixture-password');
  assert.equal(update.authorization, `Bearer ${x.session.access_token}`);
  assert.equal(x.api.isRecoveryMode(), true);
});

test('normal sign-in, anonymous access, and sign-out respect row security', async () => {
  const x = setup();
  assert.equal(await x.api.getProfile(user.id), null);
  await x.api.signIn(user.email, 'fixture-password');
  assert.equal((await x.api.getProfile(user.id))?.id, user.id);
  await x.api.signOut();
  assert.equal(await x.api.getProfile(user.id), null);
  assert.equal(x.requests.at(-1).authorization, `Bearer ${x.api.config.anonKey}`);
});

test('catalog RPC and notification requests retain the signed-in token during the same lookup failure', async () => {
  const x = setup();
  await x.api.signIn(user.email, 'fixture-password');
  x.api.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  await x.api.client.rpc('fixture_catalog_rpc', {});
  await x.api.client.functions.invoke('fixture_notification', { body: {} });
  for (const pathname of ['/rest/v1/rpc/fixture_catalog_rpc', '/functions/v1/fixture_notification']) {
    assert.equal(x.requests.find(request => request.url.pathname === pathname)?.authorization, `Bearer ${x.session.access_token}`);
  }
});

test('session token is never attached to requests outside the configured catalog API', async () => {
  const x = setup();
  await x.api.signIn(user.email, 'fixture-password');
  // Test the custom transport directly to establish that the catalog fallback
  // cannot add a token to any other service or an anonymous Auth request.
  const options = {};
  let customFetch;
  const context = {
    window: { location: { search: '', hash: '' }, supabase: { createClient: (_url, _key, config) => {
      customFetch = config.global.fetch;
      return { auth: { onAuthStateChange(callback) { callback('SIGNED_IN', x.session); } } };
    } } },
    URL, URLSearchParams, Headers, Request, Date,
    fetch: async (_url, init) => { options.headers = init.headers; },
  };
  vm.runInNewContext(source, context);
  await customFetch('https://other.example.test/rest/v1/profiles');
  assert.equal(options.headers.has('Authorization'), false);
  await customFetch(`${apiUrl}/auth/v1/recover`);
  assert.equal(options.headers.has('Authorization'), false);
});
