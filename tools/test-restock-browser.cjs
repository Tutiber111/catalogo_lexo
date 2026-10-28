const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
async function main(){const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><body><button id="openSalesDashboard">Dashboard</button><main>Catalog</main></body></html>');
 await page.addStyleTag({path:path.resolve('web/sales-bi.css')});
 await page.evaluate(()=>{
   window.state={user:{id:'seller'},profile:{role:'salesman',salesman_code:'855'}};
   const item={productId:'p1',sku:'A',name:'Relevant product',brand:'OXO',clientCode:'1',clientName:'Own client',purchases:3,frequency:30,usualQty:12,lastPurchase:'2026-07-01',missedQty:6};
   window.fixtureNotices={seller:[{id:'batch1',title:'Container 1',receivedAt:'2026-10-28T10:00:00Z',seenAt:null,products:[item]},{id:'batch2',title:'Container 2',receivedAt:'2026-10-28T11:00:00Z',seenAt:null,products:[item]}],customer:[{id:'client-batch',title:'Client arrival',receivedAt:'2026-10-28T12:00:00Z',seenAt:null,products:[{...item,clientName:'Personal customer'}]}]};
   window.acknowledgments=[];
   window.CATALOG_SUPABASE={
     loadRestockInbox:async()=>({available:true,items:structuredClone(fixtureNotices[state.user.id]||[])}),
     acknowledgeRestock:async(id,done)=>{acknowledgments.push({user:state.user.id,id,done});const rows=fixtureNotices[state.user.id]||[];if(done)fixtureNotices[state.user.id]=rows.filter(b=>b.id!==id);else rows.forEach(b=>{if(b.id===id)b.seenAt=new Date().toISOString();});}
   };
 });
 await page.addScriptTag({path:path.resolve('web/restock-notices.js')});
 await page.waitForSelector('.restock-dialog[open]');
 assert.match(await page.locator('.restock-dialog').textContent(),/Container 1/);assert.match(await page.locator('.restock-dialog').textContent(),/Container 2/);
 assert.equal((await page.evaluate(()=>acknowledgments.filter(a=>!a.done))).length,2,'one seen receipt per incoming batch');
 await page.locator('[data-restock-close]').click();
 await page.locator('[data-restock-entry]').click();
 assert.equal(await page.locator('[data-restock-done]').count(),2,'closing the popup does not complete pending tasks');
 await page.locator('[data-restock-done="batch1"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-restock-done]').length===1);
 assert.doesNotMatch(await page.locator('.restock-dialog').textContent(),/Container 1/);
 await page.locator('[data-restock-close]').click();await page.evaluate(()=>RESTOCK_NOTICES.refresh());assert.equal(await page.locator('.restock-dialog[open]').count(),0,'seen arrivals do not reopen every refresh');
 await page.evaluate(()=>{state.user={id:'customer'};state.profile={role:'customer',client_code:'2'};RESTOCK_NOTICES.sync();});await page.waitForSelector('.restock-dialog[open]');
 assert.match(await page.locator('.restock-dialog').textContent(),/Personal customer/);assert.doesNotMatch(await page.locator('.restock-dialog').textContent(),/Own client|Container 2/);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.restock-dialog').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1));
 await page.screenshot({path:'tmp/sales-dashboard/owner-release/restock-popup-mobile.png'});
 await page.evaluate(()=>{state.user=null;state.profile=null;RESTOCK_NOTICES.sync();});assert.equal(await page.locator('.restock-dialog').count(),0);assert.equal(await page.locator('[data-restock-entry]').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Restock UI: per-container popups, seen versus pending, completed tasks, no repeat popups, account switching, sign-out clearing and mobile layout passed.');
}finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1});
