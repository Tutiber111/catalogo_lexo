const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
async function main(){const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><body><main id="dashboard"></main></body></html>');await page.addStyleTag({path:path.resolve('web/sales-bi.css')});
 for(const file of ['sales-product-brands.js','sales-bi-model.js','sales-bi.js','dashboard-client-groups.js'])await page.addScriptTag({path:path.resolve('web/'+file)});
 await page.evaluate(()=>{
  window.state={user:{id:'admin'},profile:{role:'admin'}};window.groups=[];window.chosen=null;
  window.clients=[{id:'one',clientCode:'1',name:'First location',locality:'North',salesmanCode:'810'},{id:'two',clientCode:'2',name:'Second location',locality:'South',salesmanCode:'800'},{id:'three',clientCode:'3',name:'Third location',locality:'West',salesmanCode:'810'}];
  const lines=[['a','2026-10-01','1',10],['b','2026-10-03','2',20],['c','2026-10-05','1',30],['tina','2026-10-14','80605',5]].map(([id,day,code,qty])=>({line_key:id,order_key:id,order_date:day,client_code:code,sku:'A',ordered_qty:qty,invoiced_qty:qty,ordered_net:qty*100,invoiced_net:qty*100,returned_qty:0}));
  window.CATALOG_SUPABASE={loadDashboardGroupCandidates:async()=>structuredClone([...clients,{id:'',clientCode:'80605',name:'TINA COMPANY S.R.L.',searchAliases:'TINA & CO',historicalOnly:true}]),saveDashboardClientGroup:async(id,name,clientCodes)=>{const group={id:id||'fixture',name,clientCodes};groups=groups.filter(g=>g.id!==group.id).concat(group);},deleteDashboardClientGroup:async id=>{groups=groups.filter(g=>g.id!==id);}};
  window.draw=()=>SALES_BI.mount(document.querySelector('#dashboard'),{owner:'admin',clients,clientGroups:groups,lines,orders:[],catalog:[{id:'A',sku:'A',section:'OXO',name:'Product'}],batches:[{from_date:'2024-09-02',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],available:true,admin:true,simple:false,live:false,salesmen:[{code:'*',name:'Todos'},{code:'810',name:'Diana'},{code:'800',name:'Other'}],salesmanCode:'*',analysisSalesmanCode:'*',onManageGroups:()=>DASHBOARD_CLIENT_GROUPS.open({available:true,groups,onSaved:()=>{SALES_BI.reset();draw();}}),onRefresh:()=>{},onClient:client=>{chosen=client;}});draw();
 });
 await page.locator('[data-bi-groups]').click();
 for(const query of ['tina','Tina & co','80605']){await page.locator('[data-group-search]').fill(query);assert.equal(await page.locator('[data-group-options] input[value="80605"]').count(),1,'historical client found by '+query);}
 await page.locator('[data-group-search]').fill('');await page.locator('[name=groupName]').fill('Joined client');await page.locator('[data-group-options] input[value="1"]').check();
 await page.locator('[data-group-search]').fill('Second');await page.locator('[data-group-options] input[value="2"]').check();assert.match(await page.locator('[data-group-selected]').textContent(),/2 códigos/);
 await page.locator('[data-group-form] [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.bi-client-groups-dialog'));
 assert.match(await page.locator('[name=client]').textContent(),/1 \+ 2 · Joined client/);assert.equal(await page.locator('[name=client] option').count(),4);
 await page.locator('[name=client]').selectOption('group:fixture');assert.match(await page.locator('[data-bi-detail]').textContent(),/Joined client/);
 await page.locator('[data-bi-order]').click();await page.locator('[data-group-branch="1"]').click();assert.equal(await page.evaluate(()=>chosen.clientCode),'2','checkout receives real location identity');
 await page.locator('[data-bi-groups]').click();await page.locator('[data-group-edit]').click();await page.locator('[name=groupName]').fill('Renamed client');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.bi-client-groups-dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
 await page.screenshot({path:'tmp/sales-dashboard/owner-release/client-groups-mobile.png'});
 await page.locator('[data-group-form] [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.bi-client-groups-dialog'));assert.match(await page.locator('[name=client]').textContent(),/Renamed client/);
 await page.locator('[data-bi-groups]').click();page.once('dialog',d=>d.accept());await page.locator('[data-group-delete]').click();await page.waitForFunction(()=>!document.querySelector('.bi-client-groups-dialog'));assert.equal(await page.locator('[name=client] option').count(),5,'ungroup restores individual source clients');
 await page.locator('[data-bi-groups]').click();await page.locator('[name=groupName]').fill('Tina group');await page.locator('[data-group-search]').fill('80605');await page.locator('[data-group-options] input[value="80605"]').check();await page.locator('[data-group-search]').fill('First');await page.locator('[data-group-options] input[value="1"]').check();await page.locator('[data-group-form] [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.bi-client-groups-dialog'));
 await page.locator('[name=client]').selectOption('group:fixture');assert.match(await page.locator('[data-bi-detail]').textContent(),/Tina group/);await page.locator('[data-bi-order]').click();assert.equal(await page.locator('[data-group-branch]').count(),1,'historical-only code cannot be selected for checkout');await page.locator('[data-group-close]').click();
 await page.evaluate(()=>{state.profile={role:'salesman'};DASHBOARD_CLIENT_GROUPS.open({available:true,groups:[],onSaved:()=>{}});});assert.equal(await page.locator('.bi-client-groups-dialog').count(),0,'salespeople cannot open the manager');
 assert.deepEqual(errors,[]);console.log('Client-group UI: admin entry, searchable persistent selection, saved grouping, grouped filters, real checkout branch selection, rename, undo, mobile layout and salesperson denial passed.');
}finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
