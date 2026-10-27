const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
  const root = path.resolve(__dirname, '../web');
  const overlay = process.env.CATALOG_AUTH_WEB_ROOT ? path.resolve(process.env.CATALOG_AUTH_WEB_ROOT) : null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const relative = '.' + (url.pathname === '/' ? '/index.html' : url.pathname);
    const localFile = path.resolve(root, relative), overlayFile = overlay ? path.resolve(overlay, relative) : null;
    if (!localFile.startsWith(root + path.sep) || (overlayFile && !overlayFile.startsWith(overlay + path.sep))) { res.writeHead(404); res.end(); return; }
    const filename = overlayFile && fs.existsSync(overlayFile) ? overlayFile : localFile;
    if (!fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(filename)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [];
      const user = { id: '11111111-1111-4111-8111-111111111111', email: 'client@example.test', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp })).toString('base64url'), Buffer.from('fixture-signature').toString('base64url')].join('.');
      const session = { user, access_token: token, refresh_token: 'fixture-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer' };
      const profile = { id: user.id, role: 'customer', name: 'Fixture client', company: 'Fixture company', price_access_approved: true, client_code: '81038', assigned_salesman_code: '810' };
      await context.addInitScript(({ session, profile }) => {
        const nativeFetch = window.fetch.bind(window);
        window.authFixtureRequests = [];
        window.fetch = async (input, init = {}) => {
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          if (url.hostname !== 'iexpvwmtxauvzkcncqoc.supabase.co') return nativeFetch(input, init);
          const authorized = new Headers(init.headers).get('Authorization') === `Bearer ${session.access_token}`;
          const method = init.method || 'GET';
          window.authFixtureRequests.push({ path: url.pathname, method, authorized });
          const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
          if (url.pathname === '/auth/v1/token') return reply(session);
          if (url.pathname === '/auth/v1/user') return reply(authorized ? session.user : { message: 'Missing session' }, authorized ? 200 : 401);
          if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
          if (url.pathname === '/rest/v1/profiles') return reply(authorized ? [profile] : []);
          return reply([]);
        };
      }, { session, profile });
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const origin = `http://127.0.0.1:${server.address().port}`;
      await page.goto(origin);
      await page.waitForFunction(() => !state.isCheckingAuth);
      // Reproduce the production symptom with the real SDK: Auth succeeds,
      // but its subsequent session lookup supplies no token to database requests.
      await page.evaluate(() => { CATALOG_SUPABASE.client.auth.getSession = async () => ({ data: { session: null }, error: null }); });
      await page.locator('#authEmail').fill(user.email);
      await page.locator('#authPassword').fill('fixture-password');
      await page.locator('#signIn').click();
      try {
        await page.waitForFunction(() => state.profile?.client_code === '81038' && !document.body.classList.contains('auth-required'), null, { timeout: 10000 });
      } catch (error) {
        console.error({ state: await page.evaluate(() => ({ user: state.user?.id, profile: state.profile, message: document.querySelector('#authMessage').textContent, requests: window.authFixtureRequests })), errors });
        throw error;
      }
      const apiRequests = await page.evaluate(() => window.authFixtureRequests);
      assert.equal(await page.locator('#authMessage').textContent(), '');
      assert.equal(await page.locator('#accountDrawer').getAttribute('aria-hidden'), 'true');
      assert.equal(apiRequests.filter(r => r.path === '/rest/v1/profiles' && r.method !== 'GET').length, 0);
      assert.ok(apiRequests.some(r => r.path === '/rest/v1/profiles' && r.authorized));

      // Finish the recovery UI while the same simulated session lookup failure
      // remains active. No real account or email is used by these route fixtures.
      await page.evaluate(() => { openAccount(); showNewPassword(); });
      await page.locator('#newPassword').fill('new-fixture-password');
      await page.locator('#updatePassword').click();
      await page.waitForFunction(() => !state.isPasswordRecovery && state.profile?.client_code === '81038');
      assert.ok((await page.evaluate(() => window.authFixtureRequests)).some(r => r.path === '/auth/v1/user' && r.method === 'PUT' && r.authorized));
      assert.equal(await page.locator('#authMessage').textContent(), '');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Desktop and mobile: sign-in and recovery complete with the real SDK despite an empty session lookup; no profile insert, permission loss, or page errors.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
