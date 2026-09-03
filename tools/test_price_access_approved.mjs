import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = stripTypeScriptTypes(readFileSync(new URL("../supabase/functions/send-price-access-approved/index.ts", import.meta.url), "utf8"));
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TABLE = "/rest/v1/price_access_approval_notifications";
const clone = (value) => JSON.parse(JSON.stringify(value));

function setup(options = {}) {
  const env = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    PRICE_ACCESS_INTERNAL_SECRET: "test-internal-secret",
    RESEND_API_KEY: "test-resend-key",
    ORDER_NOTIFICATION_FROM: "Lexo <ventas@lexo.com.ar>",
  };
  let row = options.noQueue ? null : {
    profile_id: ID, status: "pending", attempts: 0, updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(), first_attempt_at: null, email_payload: null,
    ...options.row,
  };
  const profile = { id: ID, name: "Ana <Test>", role: "customer", price_access_approved: true, ...options.profile };
  const sentRequests = [];
  const delivered = new Map();
  let remainingFailures = options.resendFailures || 0;
  let failSentSave = options.failSentSave || false;
  let handler;
  let dbCalls = 0;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const sandbox = {
    Request, Response, URLSearchParams, AbortSignal, setTimeout,
    console: { error() {} },
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      if (url === "https://api.resend.com/emails") {
        const payload = JSON.parse(init.body);
        const key = init.headers["Idempotency-Key"];
        sentRequests.push({ payload, key });
        if (remainingFailures-- > 0) return json({ message: "Temporary failure" }, 503);
        if (options.noEmailId) return json({});
        if (delivered.has(key)) {
          assert.deepEqual(payload, delivered.get(key).payload, "Retry payload must be identical");
          return json({ id: delivered.get(key).id });
        }
        const id = "test-resend-id";
        delivered.set(key, { payload, id });
        return json({ id });
      }
      dbCalls++;
      assert.equal(parsed.origin, env.SUPABASE_URL);
      assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      if (parsed.pathname === TABLE) {
        const matches = row && [...parsed.searchParams].every(([key, value]) => {
          if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
          return true;
        });
        if (init.method === "PATCH") {
          const patch = JSON.parse(init.body);
          if (failSentSave && patch.status === "sent") {
            failSentSave = false;
            return json({ message: "Temporary database failure" }, 503);
          }
          if (!matches) return json([]);
          row = { ...row, ...patch };
          return json([clone(row)]);
        }
        return json(matches ? [clone(row)] : []);
      }
      if (parsed.pathname === "/rest/v1/profiles") return json(options.noProfile ? [] : [profile]);
      if (parsed.pathname === "/auth/v1/admin/users/" + ID) {
        return json({ id: ID, email: options.email ?? "client@example.com" });
      }
      throw new Error("Unexpected request: " + url);
    },
  };
  vm.runInNewContext(source, sandbox);
  const invoke = async (body = { profile_id: ID }, secret = env.PRICE_ACCESS_INTERNAL_SECRET, method = "POST") => {
    const response = await handler(new Request("https://test/function", {
      method,
      headers: { "Content-Type": "application/json", ...(secret ? { "x-price-access-secret": secret } : {}) },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { invoke, profile, env, sentRequests, delivered, get row() { return row; }, get dbCalls() { return dbCalls; } };
}

test("requires the internal secret before reading or sending anything", async () => {
  const app = setup();
  assert.equal((await app.invoke({}, "")).status, 401);
  assert.equal((await app.invoke({}, "wrong")).status, 401);
  assert.equal(app.dbCalls, 0);
  assert.equal(app.sentRequests.length, 0);
});

test("rejects invalid requests", async () => {
  const app = setup();
  assert.equal((await app.invoke({}, undefined, "GET")).status, 405);
  assert.equal((await app.invoke({ profile_id: "invalid" })).status, 400);
  assert.equal((await app.invoke(null)).status, 400);
  assert.equal((await app.invoke([])).status, 400);
});

test("sends a personalized approval to Auth email, not caller-supplied recipients", async () => {
  const app = setup();
  const response = await app.invoke({ profile_id: ID, to: "someone-else@example.com" });
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].status, "sent");
  const { payload, key } = app.sentRequests[0];
  assert.deepEqual(payload.to, ["client@example.com"]);
  assert.equal(payload.from, "Lexo <ventas@lexo.com.ar>");
  assert.equal(payload.reply_to, "ventas@lexo.com.ar");
  assert.match(payload.subject, /fue aprobado/);
  assert.match(payload.html, /Ana &lt;Test&gt;/);
  assert.ok(!payload.html.includes("Ana <Test>"));
  assert.match(payload.text, /https:\/\/catalogolexo.com.ar\//);
  assert.match(payload.html, /href="https:\/\/catalogolexo.com.ar\/"/);
  assert.ok(!/localhost|127\.0\.0\.1/.test(payload.text + payload.html));
  assert.match(payload.text, /No necesit.s registrarte nuevamente/);
  assert.equal(key, "price-access-approved/" + ID);
  assert.equal(app.row.status, "sent");
  assert.equal(app.row.attempts, 1);
  assert.equal(app.row.resend_email_id, "test-resend-id");
  assert.ok(app.row.sent_at);
});

test("does not backfill an approved account with no queued approval event", async () => {
  const app = setup({ noQueue: true });
  assert.deepEqual((await app.invoke()).body.results, []);
  assert.equal(app.sentRequests.length, 0);
});

test("already sent notifications are never resent", async () => {
  const app = setup();
  await app.invoke();
  await app.invoke();
  assert.equal(app.sentRequests.length, 1);
});

test("overlapping trigger and retry calls claim a notification only once", async () => {
  const app = setup();
  await Promise.all([app.invoke(), app.invoke()]);
  assert.equal(app.sentRequests.length, 1);
  assert.equal(app.row.attempts, 1);
});

test("an active processing lease is not stolen", async () => {
  const app = setup({ row: { status: "processing", attempts: 1 } });
  assert.equal((await app.invoke()).body.results[0].status, "processing");
  assert.equal(app.sentRequests.length, 0);
});

test("a stale processing lease is recovered", async () => {
  const app = setup({ row: {
    status: "processing", attempts: 1,
    updated_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  } });
  assert.equal((await app.invoke()).body.results[0].status, "sent");
  assert.equal(app.row.attempts, 2);
});

test("failed delivery is recorded and can be retried", async () => {
  const app = setup({ resendFailures: 1 });
  assert.equal((await app.invoke()).body.ok, false);
  assert.equal(app.row.status, "failed");
  assert.match(app.row.last_error, /Resend failed: 503/);
  await app.invoke();
  assert.equal(app.row.status, "sent");
  assert.equal(app.row.attempts, 2);
  assert.equal(app.delivered.size, 1);
  assert.deepEqual(app.sentRequests[0], app.sentRequests[1]);
});

test("a failed database acknowledgement reuses the exact email without duplicate delivery", async () => {
  const app = setup({ failSentSave: true });
  await app.invoke();
  assert.equal(app.row.status, "failed");
  app.profile.name = "Changed name";
  app.env.ORDER_NOTIFICATION_FROM = "Other sender <ventas@lexo.com.ar>";
  await app.invoke();
  assert.equal(app.row.status, "sent");
  assert.equal(app.delivered.size, 1);
  assert.deepEqual(app.sentRequests[0], app.sentRequests[1]);
});

test("retry safety window and attempt limit prevent ambiguous late duplicates", async () => {
  for (const row of [
    { status: "failed", attempts: 5 },
    { status: "failed", attempts: 1, first_attempt_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  ]) {
    const app = setup({ row });
    await app.invoke();
    assert.equal(app.sentRequests.length, 0);
  }
});

test("revoked, deleted, and non-customer accounts are not emailed", async () => {
  for (const options of [
    { profile: { price_access_approved: false } },
    { profile: { role: "salesman" } },
    { profile: { role: "admin" } },
    { noProfile: true },
  ]) {
    const app = setup(options);
    await app.invoke();
    assert.equal(app.row.status, "cancelled");
    assert.equal(app.sentRequests.length, 0);
  }
});

test("invalid account email remains failed without sending", async () => {
  for (const email of ["", "invalid", "one@example.com,two@example.com"]) {
    const app = setup({ email });
    await app.invoke();
    assert.equal(app.row.status, "failed");
    assert.equal(app.sentRequests.length, 0);
  }
});

test("Resend response without an ID is not recorded as sent", async () => {
  const app = setup({ noEmailId: true });
  await app.invoke();
  assert.equal(app.row.status, "failed");
});

test("retry job can drain queued approvals without a profile ID", async () => {
  const app = setup();
  assert.equal((await app.invoke({})).body.results[0].status, "sent");
});
