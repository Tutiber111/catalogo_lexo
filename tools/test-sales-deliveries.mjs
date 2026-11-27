import assert from 'node:assert/strict';
import {catalogContext,familyStock,lineStock,reconcileDelivery,warehouseDeliveries,warehouseSnapshot} from '../supabase/functions/_shared/sales-delivery-reader.mjs';
const item=(id,sku,quantity)=>({id,sku,quantity});
const orders=[{id:'order1',order_items:[item('item1','A',10),item('item2','B',4)]},{id:'order2',order_items:[item('item3','A',8)]}];
const wh=[{id:'wh1',external_id:'order1',source:'catalogolexo',company:'lexo',invoice_number:'FC1',remito_number:'R1'},
  {id:'wh2',external_id:'order2',source:'catalogolexo',company:'lexo',finalized:true,status:'ready'}];
const lines=[{id:'line1',order_id:'wh1',sku:'A',qty_ordered:10,qty_picked:6,status:'partial'},{id:'line2',order_id:'wh1',sku:'B',qty_ordered:4,qty_picked:0,status:'pending'},
  {id:'line3',order_id:'wh2',sku:'A',qty_ordered:8,qty_picked:8,status:'picked'}];
// Owner rule: what the warehouse marks "con stock" is what was invoiced; no paperwork needed.
const result=reconcileDelivery(orders,wh,lines);
assert.equal(result[0].deliveredQty,6);assert.equal(result[0].pendingQty,4);assert.equal(result[0].confirmed,false);
assert.equal(result[1].deliveredQty,0);assert.equal(result[1].pendingQty,4,'an unmarked line is pending, not invoiced and not lost');
assert.equal(result[2].deliveredQty,8,'marked with stock counts as invoiced without an invoice number');
assert.equal(result[2].pendingQty,0);assert.equal(result[2].confirmed,true);
const flagged=reconcileDelivery(orders,wh,[{...lines[1],status:'nostock'}]);
assert.equal(flagged[0].outOfStockQty,4,'explicit nostock marker is preserved');
assert.equal(flagged[0].deliveredQty,0);assert.equal(flagged[0].pendingQty,0);
assert.equal(flagged[0].lineStatus,'nostock');
assert.equal(reconcileDelivery(orders,wh,[{...lines[1],status:'pending'}])[0].outOfStockQty,0,'pending is not stock loss');
const split=reconcileDelivery(orders,wh,lines,new Map([['wh1',[{id:'rest',order_id:'child',sku:'A',qty_ordered:4,qty_picked:3,status:'partial'},{id:'rest-b',order_id:'child',sku:'B',qty_ordered:4,qty_picked:0,status:'nostock'}]]]));
assert.deepEqual([split[0].deliveredQty,split[0].outOfStockQty,split[0].pendingQty],[9,0,1],'split remainder adds to the original line');
assert.deepEqual([split[1].deliveredQty,split[1].outOfStockQty,split[1].pendingQty],[0,4,0]);
assert.deepEqual(familyStock([{sku:'A',qty_ordered:5,qty_picked:5,status:'picked'}],[{sku:'A',qty_ordered:5,qty_picked:5,status:'picked'}])[0],{ordered:5,withStock:5,noStock:0,pending:0},'never above the ordered quantity');
assert.equal(lineStock({qty_ordered:3,qty_picked:0,status:'pending',committed:true}).withStock,0);
assert.equal(lineStock({qty_ordered:3,qty_picked:2}).withStock,2,'legacy rows without a status use the picked quantity');
assert.equal(reconcileDelivery(orders,[{...wh[0],company:'bm'}],lines).length,0,'never cross brands');
assert.equal(reconcileDelivery(orders,[{...wh[0],cancelled_at:'2026-10-16'}],lines).length,0);
assert.equal(reconcileDelivery(orders,[wh[0],{...wh[0],id:'duplicate'}],lines).length,0,'duplicate roots unresolved');
assert.equal(reconcileDelivery([{...orders[0],order_items:[...orders[0].order_items,item('duplicate-sku','A',1)]}],wh,lines).length,1,'duplicate SKU cannot be guessed');
assert.equal(reconcileDelivery(orders,wh,[{...lines[0],qty_picked:20}]).length,0,'over-picking rejected');
assert.equal(reconcileDelivery(orders,wh,[{...lines[0],qty_ordered:9}]).length,0,'different order quantities unresolved');
await assert.rejects(()=>catalogContext({url:'https://catalog.example',key:'public',token:''}),e=>e.status===401);
let privateReads=0;
const fetcher=async url=>{
 const data=url.includes('/auth/v1/user')?{id:'other-admin'}:url.includes('/profiles?')?[{id:'other-admin',role:'admin'}]
  :url.includes('/sales_clients?')?(privateReads++,[{id:'client1',client_code:'001',salesman_code:'845'}])
  :[{id:'allowed',sales_client_id:'client1',status:'placed'},{id:'cancelled',sales_client_id:'client1',status:'cancelled'}];
 return new Response(JSON.stringify(data),{status:200});
};
const context=await catalogContext({url:'https://catalog.example',key:'public',token:'Bearer valid-test',fetcher});
assert.deepEqual(context.orders.map(o=>o.id),['allowed'],'admins may read authorized catalog orders');
for(const role of ['salesman','customer']){
 const unauthorized=async url=>new Response(JSON.stringify(url.includes('/auth/v1/user')?{id:'user1'}:[{id:'user1',role}]),{status:200});
 await assert.rejects(()=>catalogContext({url:'https://catalog.example',key:'public',token:'Bearer valid-test',fetcher:unauthorized}),e=>e.status===403);
}
const mismatch=async url=>new Response(JSON.stringify(url.includes('/auth/v1/user')?{id:'user1'}:[{id:'other',role:'admin'}]),{status:200});
await assert.rejects(()=>catalogContext({url:'https://catalog.example',key:'public',token:'Bearer valid-test',fetcher:mismatch}),e=>e.status===403);
const seen=[];
const warehouse={url:'https://warehouse.example',key:'publishable-fixture',readerKey:'reader-fixture'};
function checkWarehouseRequest(url,options) {
 const headers=new Headers(options.headers);
 assert.equal(headers.get('apikey'),warehouse.key);
 assert.equal(headers.get('x-reader-key'),warehouse.readerKey);
 assert.equal(headers.has('Authorization'),false);
 assert.equal(options.redirect,'error');
 assert.match(new URL(url).pathname,/^\/rest\/v1\/rpc\/lexo_(?:orders|order_lines|invoice_lines)_feed$/);
}
const whFetch=async (url,options)=>{
 checkWarehouseRequest(url,options);
 seen.push(url);
 return Response.json(url.includes('/lexo_order_lines_feed?')?lines:url.includes('&parent_id=in.')?[]:wh);
};
const response=await warehouseDeliveries(orders,warehouse,whFetch);
assert.equal(response.lines.length,3);assert.ok(seen[0].includes('external_id=in.(order1,order2)'));
assert.equal(new URL(seen[0]).searchParams.get('source'),'eq.catalogolexo');
assert.equal(new URL(seen[0]).searchParams.get('order'),'id');
assert.ok(seen.some(url=>url.includes('parent_id=in.')),'split orders use the order feed as well');
assert.ok(seen.some(url=>url.includes('lexo_order_lines_feed?')&&url.includes('order_id=in.')));
const snapshotFetch=async (url,options)=>{
 checkWarehouseRequest(url,options);
 if(url.includes('/lexo_invoice_lines_feed?'))return new Response('{}',{status:404});
 return new Response(JSON.stringify(url.includes('/lexo_order_lines_feed?')?
 [...lines,{id:'manual-line',order_id:'manual',sku:'C',qty_ordered:5,qty_picked:2,name:'Manual product'}]:
 url.includes('&parent_id=in.')?[]:[...wh.map(o=>({...o,client_code:'001',created_at:'2026-10-16'})),
 {id:'manual',company:'lexo',client_code:'001',customer:'Assigned customer',created_at:'2026-10-16'},
 {id:'forbidden',company:'lexo',client_code:'002',created_at:'2026-10-16'},
 {id:'wrong-company',company:'bm',client_code:'001',created_at:'2026-10-16'}]),{status:200});
};
const portfolio={profile:{role:'salesman'},clients:[{id:'client1',client_code:'001'}],orders};
const snapshot=await warehouseSnapshot(portfolio,warehouse,snapshotFetch);
assert.deepEqual(snapshot.orders.map(o=>o.id),['wh1','wh2','manual'],'standalone warehouse orders included without expanding customer scope');
assert.equal(snapshot.orders.find(o=>o.id==='manual').items[0].orderedNet,null,'missing warehouse price is not zero or current catalog price');
assert.equal(snapshot.orders.find(o=>o.id==='manual').items[0].qty,5);
assert.equal(snapshot.orders.find(o=>o.id==='manual').direct,true);
assert.equal(snapshot.orders.find(o=>o.id==='wh1').direct,false);
assert.equal(snapshot.invoiceFacts.available,false,'the invoice feed can fail independently of orders and fulfillment');
// Invoiced by invoice date: each document contributes what it marked con stock, dated by
// its own invoice. Placeholder invoice numbers still count; unmarked lines never do.
const invoiceOrders=[
 {id:'wh1',external_id:'order1',source:'catalogolexo',number:'4536',company:'lexo',client_code:'001',created_at:'2026-10-31',invoice_number:'6570',invoiced_at:'2026-11-01T16:00:00Z'},
 {id:'child',parent_id:'wh1',number:'4536-F',company:'lexo',client_code:'001',invoice_number:'6608',invoiced_at:'2026-11-03T12:00:00Z'},
 {id:'incorrect-child',parent_id:'wh1',company:'lexo',client_code:'002',invoice_number:'FC3',invoiced_at:'2026-11-03T12:00:00Z'},
 {id:'direct',number:'4560',company:'lexo',client_code:'001',invoice_number:'1',created_at:'2026-10-30',invoiced_at:'2026-11-01T12:00:00Z'},
 {id:'ks',number:'KS - 24/11',company:'lexo',client_code:'001',invoice_number:'1',created_at:'2026-11-23',invoiced_at:'2026-11-24T12:00:00Z'},
 {id:'not-invoiced',number:'L-0012',company:'lexo',client_code:'001',created_at:'2026-11-19'},
 {id:'test',number:'TEST-7679',customer:'Pedido de prueba',company:'lexo',client_code:'001',created_at:'2026-11-19',invoiced_at:'2026-11-20T12:00:00Z'},
 {id:'other-direct',company:'lexo',client_code:'002',invoice_number:'FC5',invoiced_at:'2026-11-01T12:00:00Z'},
];
const invoiceLines=[
 {id:'r1',order_id:'wh1',sku:'A',qty_ordered:10,qty_picked:6,status:'partial'},
 {id:'r2',order_id:'wh1',sku:'B',qty_ordered:4,qty_picked:0,status:'nostock'},
 {id:'c1',order_id:'child',sku:'A',qty_ordered:4,qty_picked:4,status:'picked'},
 {id:'x1',order_id:'incorrect-child',sku:'A',qty_ordered:4,qty_picked:4,status:'picked'},
 {id:'d1',order_id:'direct',sku:'M',qty_ordered:3,qty_picked:3,status:'picked',unit_price:100,price_adj:0},
 {id:'k1',order_id:'ks',sku:'M',qty_ordered:2,qty_picked:2,status:'picked'},
 {id:'n1',order_id:'not-invoiced',sku:'A',qty_ordered:5,qty_picked:5,status:'picked'},
 {id:'n2',order_id:'not-invoiced',sku:'B',qty_ordered:5,qty_picked:0,status:'pending'},
 {id:'t1',order_id:'test',sku:'A',qty_ordered:5,qty_picked:5,status:'picked'},
];
const billingLines=[
 {id:'r1',order_id:'wh1',sku:'A',qty:6,net_amount:601},
 {id:'c1',order_id:'child',sku:'A',qty:4,net_amount:399},
 {id:'x1',order_id:'incorrect-child',sku:'A',qty:4,net_amount:400},
 {id:'d1',order_id:'direct',sku:'M',qty:3,net_amount:280},
 {id:'k1',order_id:'ks',sku:'M',qty:2,net_amount:null},
];
function billingFixture(path) {
 const ids=path.searchParams.get('p_order_ids');
 return Response.json(billingLines.filter(l=>ids.includes(l.order_id)));
}
const invoiceFetch=async (url,options)=>{
 checkWarehouseRequest(url,options);
 const path=new URL(url);
 if(path.pathname.endsWith('/lexo_invoice_lines_feed'))return billingFixture(path);
 if(path.pathname.endsWith('/lexo_order_lines_feed')){const ids=path.searchParams.get('order_id');return Response.json(invoiceLines.filter(l=>ids.includes(l.order_id)));}
 const parents=path.searchParams.get('parent_id');
 return Response.json(parents?invoiceOrders.filter(o=>o.parent_id&&parents.includes(o.parent_id)):invoiceOrders);
};
const invoiceSnapshot=await warehouseSnapshot({...portfolio,orders:[{id:'order1',order_items:[{id:'i1',sku:'A',quantity:10,line_total:1000},{id:'i2',sku:'B',quantity:4,line_total:800}]}]},warehouse,invoiceFetch);
const facts=invoiceSnapshot.invoiceFacts;
assert.equal(facts.available,true);
assert.deepEqual(facts.lines.map(f=>[f.documentId,f.orderId,f.invoiceDate.slice(0,10),f.qty,f.net]).sort((x,y)=>x[2].localeCompare(y[2])||x[0].localeCompare(y[0])),[
 ['direct','direct','2026-11-01',3,280],['wh1','wh1','2026-11-01',6,601],['child','wh1','2026-11-03',4,399],['ks','ks','2026-11-24',2,null],
],'each document uses its own date and the invoice feed value, including direct orders');
assert.equal(facts.lines.find(f=>f.documentId==='ks').kitchenSpot,true);
assert.equal(facts.lines.find(f=>f.documentId==='direct').fromCatalog,false);
assert.equal(facts.undated,0,'picked orders without invoice or remito documents are kept out of invoices');
assert.equal(facts.estimated,undefined,'an available invoice feed uses the amounts on the documents');
const estimatedFetch=(url,options)=>url.includes('/lexo_invoice_lines_feed?')?new Response('{}',{status:404}):invoiceFetch(url,options);
const estimate=await warehouseSnapshot({...portfolio,orders:[{id:'order1',order_items:[{id:'i1',sku:'A',quantity:10,line_total:1000}]}]},warehouse,estimatedFetch);
assert.equal(estimate.invoiceFacts.available,true);
assert.equal(estimate.invoiceFacts.estimated,true);
assert.deepEqual(estimate.invoiceFacts.lines.map(row=>[row.documentId,row.qty,row.net]).sort(),[
 ['child',4,400],['direct',3,300],['ks',2,null],['wh1',6,600],
],'fallback retains invoice dates and separates documented partial shipments and direct orders');
assert.ok(!invoiceSnapshot.orders.some(o=>o.id==='test'),'test orders are not sales');
assert.equal(invoiceSnapshot.orders.find(o=>o.id==='ks').kitchenSpot,true);
const unassignedCase=invoiceOrders.map(doc=>doc.id==='wh1'?{...doc,client_code:''}:doc);
const unassignedReader=async (url,options)=>{
 checkWarehouseRequest(url,options);
 const path=new URL(url);
 if(path.pathname.endsWith('/lexo_invoice_lines_feed'))return billingFixture(path);
 if(path.pathname.endsWith('/lexo_order_lines_feed')){const ids=path.searchParams.get('order_id');return Response.json(invoiceLines.filter(l=>ids.includes(l.order_id)));}
 const parentIds=path.searchParams.get('parent_id');
 return Response.json(parentIds?unassignedCase.filter(doc=>doc.parent_id&&parentIds.includes(doc.parent_id)):unassignedCase);
};
const companyInvoice=await warehouseSnapshot({...portfolio,fullDashboard:true},warehouse,unassignedReader);
assert.ok(companyInvoice.invoiceFacts.lines.some(f=>f.documentId==='child'&&f.catalogOrderId==='order1'),'a known split of an unassigned parent is still company revenue');
const scopedInvoice=await warehouseSnapshot(portfolio,warehouse,unassignedReader);
assert.ok(!scopedInvoice.invoiceFacts.lines.some(f=>f.documentId==='child'||f.documentId==='incorrect-child'),'a remainder with an unverified client stays outside a scoped portfolio');
await assert.rejects(()=>warehouseSnapshot(portfolio,{...warehouse,readerKey:''},()=>{
 throw Error('No request should be made without a reader key');
}),error=>error.status===403);
await assert.rejects(()=>warehouseSnapshot(portfolio,warehouse,async(url,options)=>{
 checkWarehouseRequest(url,options);
 return new Response('{}',{status:403});
}),error=>error.status===403);
await assert.rejects(()=>warehouseSnapshot(portfolio,warehouse,(url,options)=>
 url.includes('/lexo_order_lines_feed?')?new Response('{}',{status:404}):snapshotFetch(url,options)
),error=>error.code==='warehouse_lines_unavailable');
const priceOrders=[{id:'manual-priced',company:'lexo',client_code:'001',customer:'Assigned customer',created_at:'2026-11-02',erp_header:{E5:'5'}},
 {id:'catalog-split',company:'lexo',client_code:'001',source:'catalogolexo',external_id:'order1',created_at:'2026-11-02'},
 {id:'catalog-split-rest',parent_id:'catalog-split',company:'lexo',client_code:'001',created_at:'2026-11-03'}];
const priceLines=[{id:'p1',order_id:'manual-priced',sku:'M',name:'Manual',qty_ordered:5,qty_picked:3,status:'partial',unit_price:100,special_price:null,price_adj:10},
 {id:'p2',order_id:'manual-priced',sku:'N',name:'Missing',qty_ordered:2,qty_picked:0,status:'nostock',unit_price:50,price_adj:0},
 {id:'s1',order_id:'catalog-split',sku:'A',qty_ordered:10,qty_picked:6,status:'partial'},
 {id:'s2',order_id:'catalog-split-rest',sku:'A',qty_ordered:4,qty_picked:4,status:'picked'}];
const priced=async (url,options)=>{
 checkWarehouseRequest(url,options);
 const path=new URL(url);
 if(path.pathname.endsWith('/lexo_order_lines_feed')){const ids=path.searchParams.get('order_id');return Response.json(priceLines.filter(l=>ids.includes(l.order_id)));}
 const parents=path.searchParams.get('parent_id');
 return Response.json(parents?priceOrders.filter(o=>o.parent_id&&parents.includes(o.parent_id)):priceOrders);
};
const pricedSnapshot=await warehouseSnapshot(portfolio,warehouse,priced);
assert.deepEqual(pricedSnapshot.orders.map(o=>o.id).sort(),['catalog-split','manual-priced'],'a split remainder is not another order');
const manualItems=pricedSnapshot.orders.find(o=>o.id==='manual-priced').items;
assert.equal(manualItems[0].orderedNet,5*104.5,'manual order valued at the WarehousePick price, adjustment and order discount');
assert.equal(manualItems[0].deliveredNet,3*104.5);assert.equal(manualItems[0].pendingQty,2);
assert.deepEqual([manualItems[1].deliveredQty,manualItems[1].outOfStockQty,manualItems[1].deliveredNet],[0,2,0]);
const splitItem=pricedSnapshot.orders.find(o=>o.id==='catalog-split').items[0];
assert.deepEqual([splitItem.qty,splitItem.deliveredQty,splitItem.pendingQty],[10,10,0],'remainder shipped later completes the line');
assert.equal(splitItem.orderedNet,null,'no catalog total and no warehouse price: unknown amount');
const oldColumns=await warehouseSnapshot(portfolio,warehouse,async(url,options)=>/erp_header|unit_price/.test(decodeURIComponent(url))?new Response('{}',{status:400}):priced(url,options));
assert.equal(oldColumns.pricesAvailable,false);
assert.equal(oldColumns.orders.find(o=>o.id==='manual-priced').items[0].orderedNet,null,'without readable prices the amount stays unknown');
assert.equal(oldColumns.orders.find(o=>o.id==='manual-priced').items[0].deliveredQty,3);
console.log('Delivery bridge: partial quantities, invoice/remito confirmation, no ready inference, cross-brand safety, ambiguous lines, invalid quantities, and exact customer authorization passed.');

const scopeRequests=[];
const sellerFetch=async(url,options)=>{
 if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:'seller'}));
 if(url.includes('/profiles?'))return new Response(JSON.stringify([{id:'seller',role:'salesman',salesman_code:'810'}]));
 if(url.includes('/rpc/sales_dashboard_scope')){scopeRequests.push(JSON.parse(options.body));return new Response(JSON.stringify({clients:[{id:'own',client_code:'81001'}],orders:[{id:'own-order'}]}));}
 throw new Error('Salesperson bridge must not read company-wide clients or orders');
};
const sellerContext=await catalogContext({url:'https://catalog.example',key:'public',token:'Bearer seller',fetcher:sellerFetch});
assert.equal(sellerContext.orders[0].id,'own-order');assert.equal(scopeRequests[0].p_include_history,false);
const rejectedFetch=async(url,options)=>url.includes('/rpc/')?new Response('{}',{status:403}):sellerFetch(url,options);
await assert.rejects(()=>catalogContext({url:'https://catalog.example',key:'public',token:'Bearer seller',salesmanCode:'800',fetcher:rejectedFetch}),e=>e.status===403);

const fullRequests=[];
const fullFetch=async(url,options)=>{
 fullRequests.push(url);
 if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:'viewer',user_metadata:{role:'admin'}}));
 if(url.includes('/profiles?'))return new Response(JSON.stringify([{id:'viewer',role:'salesman',salesman_code:'805',dashboard_full_access:true}]));
 if(url.includes('/rpc/sales_dashboard_full_context'))return new Response(JSON.stringify({available:true,clients:[{id:'own',client_code:'1'},{id:'other',client_code:'2'}],orders:[{id:'all-order'}]}));
 if(url.includes('/rpc/sales_dashboard_scope'))return new Response(JSON.stringify({clients:[{id:'other',client_code:'2'}],orders:[{id:'other-order'}]}));
 throw Error('Viewer must use reporting APIs, not operational company reads');
};
const fullContext=await catalogContext({url:'https://catalog.example',key:'public',token:'Bearer viewer',fetcher:fullFetch});
assert.equal(fullContext.profile.role,'salesman');assert.equal(fullContext.fullDashboard,true);assert.equal(fullContext.clients.length,2);
const fullPreview=await catalogContext({url:'https://catalog.example',key:'public',token:'Bearer viewer',salesmanCode:'855',fetcher:fullFetch});assert.equal(fullPreview.fullDashboard,false);assert.equal(fullPreview.orders[0].id,'other-order');
const revokedFetch=async(url,options)=>url.includes('/rpc/sales_dashboard_full_context')?new Response('{}',{status:403}):fullFetch(url,options);
await assert.rejects(()=>catalogContext({url:'https://catalog.example',key:'public',token:'Bearer viewer',fetcher:revokedFetch}),e=>e.status===403,'RPC revalidates capability after profile read');
assert.ok(fullRequests.some(url=>url.includes('dashboard_full_access')),'capability is read from the authenticated DB profile');
const fullWarehouse=await warehouseSnapshot(fullContext,warehouse,snapshotFetch);assert.ok(fullWarehouse.orders.some(o=>o.id==='forbidden'),'company warehouse snapshot follows verified dashboard capability');assert.ok(!fullWarehouse.orders.some(o=>o.id==='wrong-company'),'full dashboard access is still Lexo only');
console.log('Dashboard viewer delivery bridge: actual-profile capability, read-only reporting API, restricted preview, revocation and Lexo-only company snapshot passed.');
