const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.SALES_PREVIEW_BASE||'http://127.0.0.1:8080';
const owner=require('../web/sales-dashboard-access.js').ownerId;
const clients=[{id:'c1',client_code:'85501',name:'Own customer',salesman_code:'855'},{id:'c2',client_code:'80001',name:'Other portfolio secret',salesman_code:'800'}];
const orders=clients.map((c,i)=>({id:'o'+i,order_number:100+i,created_at:'2026-10-20T14:00:00Z',status:'placed',sales_client_id:c.id,sales_client_code:c.client_code,customer_name:c.name,order_items:[{id:'i'+i,sku:'32480',name:'Own product',quantity:10,line_total:1000+i*4000,unit_price:100}]}));
const lines=clients.map((c,i)=>({line_key:'h'+i,order_key:'h'+i,order_date:'2025-10-01',client_code:c.client_code,client_name:c.name,sku:'32480',product_name:'Product',ordered_qty:2,invoiced_qty:2,ordered_net:200,invoiced_net:200,returned_qty:0}));
const batches=[{id:'batch',from_date:'2024-09-02',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}];
const delivery={available:true,orders:[],lines:[{orderId:'o0',itemId:'i0',pickedQty:8,deliveredQty:8,pendingQty:2,confirmed:true,outOfStockQty:2,lineStatus:'nostock'}]};
const scope={available:true,salesmanCode:'855',clients:[clients[0]],orders:[orders[0]],lines:[lines[0]],batches};
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 async function open(role){
  const page=await browser.newPage({viewport:{width:1500,height:1080}}),errors=[],reads=[];
  page.on('pageerror',e=>errors.push(e.message));
  const id=role==='admin'?owner:'salesperson-fixture';
  const user={id,email:role+'@example.invalid',role:'authenticated',aud:'authenticated'};
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})+'.fixture';
  const session={access_token:token,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
  await page.addInitScript(s=>localStorage.setItem('sb-iexpvwmtxauvzkcncqoc-auth-token',JSON.stringify(s)),session);
  await page.route('https://iexpvwmtxauvzkcncqoc.supabase.co/**',async route=>{
   const url=new URL(route.request().url());let data=[];
   if(url.pathname.endsWith('/user'))data=user;
   if(url.pathname.endsWith('/profiles'))data={id,role,salesman_code:role==='salesman'?'855':null,price_access_approved:true};
   if(url.pathname.endsWith('/salesmen'))data=[{code:'855',name:'Romina Naharro'},{code:'800',name:'Other seller'}];
   if(url.pathname.endsWith('/sales_clients')){data=clients;if(role==='salesman')data=[clients[0]];}
   if(url.pathname.endsWith('/orders'))data=role==='admin'?orders:[orders[0]];
   if(url.pathname.endsWith('/rpc/sales_dashboard_scope')){reads.push(JSON.parse(route.request().postData()));data=scope;}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.route('**/__live-scope*',r=>{reads.push({p_salesman_code:new URL(r.request().url()).searchParams.get('salesman')});return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(scope)});});
  await page.route('**/__live-history',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,batches,lines})}));
  await page.route('**/__live-deliveries*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(delivery)}));
  await page.goto(base+'/catalog?dashboard=ventas');await page.waitForSelector('.sales-bi');
  return {page,errors,reads};
 }
 const seller=await open('salesman'),page=seller.page;
 assert.equal(await page.locator('[name=source],.bi-source-cards,.bi-handover,.bi-section-tabs,[data-bi-salesman]').count(),0);
 assert.equal(seller.reads[0].p_salesman_code,null);
 const ownHeadline=await page.locator('[data-bi-headlines]').textContent();
 const assertPrivate=async()=>{
  const text=await page.locator('.sales-bi').textContent();
  assert.doesNotMatch(text,/Excel|WarehousePick|\bERP\b|Other portfolio secret|Other seller/);
  const hints=await page.locator('[data-bi-info]').evaluateAll(els=>els.map(e=>e.dataset.biInfo).join(' '));
  assert.doesNotMatch(hints,/Excel|WarehousePick|\bERP\b/);
 };
 await assertPrivate();
 for(const tab of ['orders','products','opportunities','customers']){await page.locator(`[data-bi-tab=${tab}]`).first().click();await assertPrivate();}
 const font=await page.locator('.bi-headline-grid small').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 const currentFont=await page.locator('.bi-headline-grid strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 assert.ok(font>=13&&font<currentFont);
 await page.screenshot({path:'tmp/sales-dashboard/owner-release/salesman-dashboard.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.sales-bi').evaluate(el=>el.scrollWidth<=innerWidth+1),true);
 const admin=await open('admin');
 assert.ok(await admin.page.locator('.bi-source-cards').count());
 await admin.page.locator('[data-bi-salesman]').selectOption('855');await admin.page.waitForSelector('[data-bi-preview]:not([disabled])');
 await admin.page.locator('[data-bi-preview]').click();await admin.page.waitForSelector('.bi-preview-toolbar');
 assert.equal(admin.reads.at(-1).p_salesman_code,'855');
 assert.equal(await admin.page.locator('[data-bi-headlines]').textContent(),ownHeadline,'preview and real salesperson show identical KPI dates and values');
 assert.equal(await admin.page.locator('[name=source],.bi-source-cards,[data-bi-salesman]').count(),0);
 assert.doesNotMatch(await admin.page.locator('.bi-main').textContent(),/Other portfolio secret/);
 await admin.page.locator('[data-bi-return-admin]').click();await admin.page.waitForSelector('.bi-source-cards');
 assert.equal(await admin.page.locator('[data-bi-salesman]').count(),1);
 assert.deepEqual(seller.errors,[]);assert.deepEqual(admin.errors,[]);
 console.log('Salesperson UI and admin preview: identical KPIs, private portfolio, source-free tabs and help, admin return, comparison sizing and mobile layout passed.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
