const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const fflate = require(process.env.FFLATE_MODULE || path.join(root, 'outputs/email-qa/package/lib/node.cjs'));
const templateSource = fs.readFileSync(path.join(root, 'supabase/functions/send-order-notifications/order-template-base64.ts'), 'utf8');
const template = vm.runInNewContext(templateSource.replace('export const', 'const') + '\nORDER_TEMPLATE_BASE64');
function load(filename) {
  const selectedTemplate = filename.endsWith('original.ts')
    ? fs.readFileSync(path.join(root, 'supabase/functions/send-order-notifications/order-template.xlsx')).toString('base64') : template;
  const context = vm.createContext({ ...fflate, ORDER_TEMPLATE_BASE64: selectedTemplate,
    URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Buffer, atob, btoa, crypto,
    console, fetch, Deno: { serve() {}, env: { get: () => 'test-secret' } } });
  const zipSource = fs.readFileSync(path.join(root, 'supabase/functions/send-order-notifications/workbook-zip.ts'), 'utf8');
  vm.runInContext(stripTypeScriptTypes(zipSource.replace('export function', 'function')), context);
  let source = fs.readFileSync(filename, 'utf8').replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(stripTypeScriptTypes(source), context);
  return context;
}
const current = load(path.join(root, 'supabase/functions/send-order-notifications/index.ts'));
function fixture(count) {
  return { id: 'f16ac3a2-a685-4fc6-ae58-d0b17161ab75', order_number: 269,
    customer_name: 'QA Buyer', customer_company: 'QA Company', sales_client_name: 'QA Buyer',
    customer_client_code: '00123', notes: 'QA & <test>', order_transport: 'QA',
    created_at: '2026-10-13T15:00:15Z', sales_client_address: 'QA Street',
    sales_client_locality: 'QA City', email_delivery_key: 'qa-key',
    order_items: Array.from({ length: count }, (_, i) => ({
      sku: i % 2 ? `SKU-${i}` : `${1000 + i}`, quantity: i + 1,
      name: `QA product ${i} & <test>`, unit_price: 123.45 + i })) };
}
async function main() {
  const originalPath = path.join(root, 'outputs/email-qa/original.ts');
  const original = fs.existsSync(originalPath) ? load(originalPath) : null;
  for (const count of [14, 49, 255, 300]) {
    const order = fixture(count);
    const start = process.cpuUsage();
    const attachment = await current.buildOrderWorkbookAttachment(order);
    const cpu = process.cpuUsage(start);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    assert(cpuMs < 1000, `Workbook CPU budget exceeded: ${cpuMs}ms`);
    const files = fflate.unzipSync(Buffer.from(attachment.content, 'base64'));
    const sheet = fflate.strFromU8(files['xl/worksheets/sheet3.xml']);
    assert(sheet.includes('QA product 0 &amp; &lt;test&gt;'));
    assert(sheet.includes(`QA product ${count - 1} &amp; &lt;test&gt;`));
    assert(!files['xl/calcChain.xml']);
    assert(fflate.strFromU8(files['xl/workbook.xml']).includes('forceFullCalc="1"'));
    for (const [name, bytes] of Object.entries(files)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        const xml = fflate.strFromU8(bytes);
        const formulas = xml.match(/<c\b[^>]*>[\s\S]*?<\/c>/g) || [];
        assert(formulas.filter(cell => cell.includes('<f')).every(cell => !/<v[>\/]/.test(cell)));
      }
    }
    const second = await current.buildOrderWorkbookAttachment(order);
    assert.equal(second.content, attachment.content, 'Retry attachment bytes changed');
    if (original) {
      const oldStart = process.cpuUsage();
      const oldAttachment = await original.buildOrderWorkbookAttachment(order);
      const oldCpu = process.cpuUsage(oldStart);
      const oldFiles = fflate.unzipSync(Buffer.from(oldAttachment.content, 'base64'));
      assert.deepEqual(Object.keys(files).sort(), Object.keys(oldFiles).sort());
      for (const name of Object.keys(files)) assert.deepEqual(Buffer.from(files[name]), Buffer.from(oldFiles[name]), name);
      console.log(`${count} lines: original ${(oldCpu.user + oldCpu.system) / 1000}ms CPU; fixed ${cpuMs}ms CPU; workbook contents identical`);
    } else console.log(`${count} lines: ${cpuMs}ms CPU; workbook checks passed`);
  }
  const noRows = '<worksheet><sheetData><row r="1"/><row r="8"><c r="A8" s="4"><v>999</v></c><c r="B8"><v>999</v></c></row></sheetData></worksheet>';
  const result = current.applyOrderCellEdits(noRows, new Map([
    ['B1', {value: 'header', type: 'string'}], ['A9', {value: '0001', type: 'string'}],
  ]), 2);
  assert(result.includes('<c r="A8" s="4"/>'));
  assert(result.includes('<row r="9"><c r="A9" t="inlineStr">'));
  assert(result.includes('header'));

  let requested;
  current.supabaseFetch = async (url, options) => { requested = { url, options }; return { json: async () => [] }; };
  await current.loadPendingNotifications();
  const query = new URLSearchParams(requested.url.split('?')[1]);
  assert.equal(query.get('limit'), '1');
  assert.equal(query.get('attempts'), 'lt.5');
  assert(query.get('or').includes('status.eq.processing'));
  assert(query.get('or').includes('first_attempt_at.gte.'));
  const notification = { id: 'n1', status: 'processing', updated_at: '2026-10-13T15:00:00Z',
    attempts: 1, first_attempt_at: '2026-10-13T15:00:00Z', delivery_key: 'same-key' };
  assert.equal(await current.lockNotification(notification), false, 'Lost lock must not send');
  const lockQuery = new URLSearchParams(requested.url.split('?')[1]);
  assert.equal(lockQuery.get('status'), 'eq.processing');
  assert.equal(lockQuery.get('updated_at'), 'eq.2026-10-13T15:00:00Z');
  assert.equal(JSON.parse(requested.options.body).first_attempt_at, notification.first_attempt_at);

  current.fetch = async (_url, options) => { requested = options; return { ok: true, json: async () => ({id: 'resend-qa'}) }; };
  assert.equal(await current.sendResendEmail('test', {subject: 'QA'}, 'same-key'), 'resend-qa');
  assert.equal(requested.headers['Idempotency-Key'], 'order-email/same-key');
  await assert.rejects(() => current.sendResendEmail('test', {}), /Missing email delivery key/);
  await assert.rejects(() => current.sendPendingOrderNotifications(undefined, {context: {isAdmin: false}}), /Only internal workers/);

  // Forced retry inside the safe window must preserve the original provider key.
  const first = new Date(Date.now() - 600_000).toISOString();
  current.supabaseFetch = async (_url, options) => {
    if (!options) return {json: async () => [{id:'n1',status:'processing',updated_at:first,first_attempt_at:first,delivery_key:'original-key'}]};
    requested = options;
    return {json: async () => [{id:'n1'}]};
  };
  assert.equal(await current.ensureNotification('order-id', true), true);
  assert.equal(JSON.parse(requested.body).delivery_key, 'original-key');
  assert.equal(JSON.parse(requested.body).first_attempt_at, first);
  current.supabaseFetch = async () => ({json: async () => [{status:'processing', updated_at:new Date().toISOString()}]});
  assert.equal(await current.ensureNotification('order-id', true), false, 'Active worker must remain locked');
  current.canonicalNotificationOrderId = async id => id;
  current.ensureNotification = async () => true;
  current.loadPendingNotifications = async () => [];
  current.supabaseFetch = async () => ({json: async () => [{status:'sent',last_error:''}]});
  const alreadySent = await current.sendPendingOrderNotifications('f16ac3a2-a685-4fc6-ae58-d0b17161ab75', {context:{isAdmin:true}});
  assert.equal(alreadySent.results[0].status, 'sent', 'Already-sent order must still confirm success');
  const templateBytes = Buffer.from(template, 'base64');
  const oneSheet = fflate.zipSync({'xl/worksheets/sheet3.xml':new Uint8Array([1,2,3])});
  assert.throws(() => current.replaceZipEntry(new Uint8Array([1,2,3]), oneSheet, 'xl/worksheets/sheet3.xml'));
  assert.throws(() => current.replaceZipEntry(templateBytes, oneSheet, 'missing.xml'), /missing/);

  let notificationResponse;
  const client = {auth:{onAuthStateChange(){}},from(){return {insert:async()=>({error:null})};},
    functions:{invoke:async()=>({data:notificationResponse,error:null})}};
  const browser = vm.createContext({URLSearchParams, console:{warn(){}},
    window:{location:{search:'',hash:''},supabase:{createClient:()=>client}}});
  vm.runInContext(fs.readFileSync(path.join(root,'web/supabase-client.js'),'utf8'), browser);
  for (const status of ['pending','processing','failed']) {
    notificationResponse = {results:[{status}]};
    assert.equal((await browser.window.CATALOG_SUPABASE.requestOrderNotification('qa')).ok, false, status);
  }
  notificationResponse = {results:[]};
  assert.equal((await browser.window.CATALOG_SUPABASE.requestOrderNotification('qa')).ok, false);
  notificationResponse = {results:[{status:'sent'}]};
  assert.equal((await browser.window.CATALOG_SUPABASE.requestOrderNotification('qa')).ok, true);
  console.log('Recovery, locking, deterministic attachments, and provider deduplication checks passed. No emails sent.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
