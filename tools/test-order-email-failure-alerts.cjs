const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');
const source = fs.readFileSync(path.resolve(__dirname,
  '../supabase/functions/send-order-email-failure-alerts/index.ts'), 'utf8');
let handler;
const context = vm.createContext({console,Request,Response,URLSearchParams,AbortSignal,
  Deno:{serve(fn){handler=fn;},env:{get(name){return name==='ORDER_NOTIFICATION_FROM'
    ? 'Lexo <ventas@lexo.com.ar>' : 'test-secret';}}}});
vm.runInContext(stripTypeScriptTypes(source),context);
const now = new Date(Date.now()-600_000).toISOString();
const row = {id:'qa-alert',order_number:269,recipient_email:'ventas@lexo.com.ar',
  failure_reason:'CPU Time exceeded',created_at:now,status:'pending',attempts:0,
  first_attempt_at:null,updated_at:now,email_payload:null};
async function main() {
  let requests=[];
  let providerRequests=[];
  context.serviceFetch = async (url,init) => {requests.push({url,init});return {json:async()=>[{id:row.id}]};};
  context.fetch = async (_url,init) => {providerRequests.push(init);return {ok:true,json:async()=>({id:'resend-alert-qa'})};};
  assert.equal((await context.processAlert(row)).status,'sent');
  const lock = JSON.parse(requests[0].init.body);
  assert.equal(lock.attempts,1);
  assert.equal(lock.email_payload.to[0],'ventas@lexo.com.ar');
  assert.deepEqual(JSON.parse(providerRequests[0].body),lock.email_payload);
  assert(!('attachments' in lock.email_payload), 'Alert must never generate a workbook');
  assert(lock.email_payload.text.includes('CPU Time exceeded'));
  assert(lock.email_payload.subject.includes('#269'));
  assert.equal(providerRequests[0].headers['Idempotency-Key'],'order-email-failure/qa-alert');
  assert.equal(JSON.parse(requests[1].init.body).status,'sent');

  requests=[];
  const retry = {...row,status:'processing',attempts:1,first_attempt_at:now,email_payload:lock.email_payload};
  assert.equal((await context.processAlert(retry)).status,'sent');
  assert.equal(providerRequests[1].body,providerRequests[0].body,'Retry payload must be frozen');
  assert.equal(providerRequests[1].headers['Idempotency-Key'],providerRequests[0].headers['Idempotency-Key']);
  for (const [sample,expected] of [
    [{...row,status:'sent'},'sent'],
    [{...row,status:'processing',updated_at:new Date().toISOString()},'processing'],
    [{...row,attempts:5},'retry_limit'],
    [{...row,first_attempt_at:new Date(Date.now()-24*3600_000).toISOString()},'retry_expired'],
  ]) {
    requests=[];
    assert.equal((await context.processAlert(sample)).status,expected);
    assert.equal(requests.length,0);
  }
  context.serviceFetch = async () => ({json:async()=>[]});
  const count=providerRequests.length;
  assert.equal((await context.processAlert(row)).status,'processing');
  assert.equal(providerRequests.length,count,'Lost lock must not send');

  requests=[];
  context.serviceFetch = async (url,init) => {requests.push({url,init});return {json:async()=>[{id:row.id}]};};
  context.fetch = async () => ({ok:false,status:429,text:async()=>'rate limited'});
  assert.equal((await context.processAlert(row)).status,'failed');
  assert.equal(JSON.parse(requests[1].init.body).status,'failed');
  assert(JSON.parse(requests[1].init.body).last_error.includes('429'));

  const denied=await handler(new Request('https://test.invalid',{method:'POST'}));
  assert.equal(denied.status,401);
  assert.equal((await handler(new Request('https://test.invalid'))).status,405);
  assert.equal(context.secretMatches('',''),false);
  console.log('Failure alerts: recipient, no attachment work, deduplication, frozen retries, resource-crash recovery, lease limits, and internal-only access passed. No emails sent.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
