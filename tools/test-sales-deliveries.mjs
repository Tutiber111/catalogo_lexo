import assert from 'node:assert/strict';
import {catalogContext,reconcileDelivery,warehouseDeliveries,warehouseSnapshot} from '../supabase/functions/_shared/sales-delivery-reader.mjs';
const item=(id,sku,quantity)=>({id,sku,quantity});
const orders=[{id:'order1',order_items:[item('item1','A',10),item('item2','B',4)]},{id:'order2',order_items:[item('item3','A',8)]}];
const wh=[{id:'wh1',external_id:'order1',source:'catalogolexo',company:'lexo',invoice_number:'FC1',remito_number:'R1'},
  {id:'wh2',external_id:'order2',source:'catalogolexo',company:'lexo',finalized:true,status:'ready'}];
const lines=[{id:'line1',order_id:'wh1',sku:'A',qty_ordered:10,qty_picked:6},{id:'line2',order_id:'wh1',sku:'B',qty_ordered:4,qty_picked:0},
  {id:'line3',order_id:'wh2',sku:'A',qty_ordered:8,qty_picked:8}];
const result=reconcileDelivery(orders,wh,lines);
assert.equal(result[0].deliveredQty,6);assert.equal(result[0].pendingQty,4);
assert.equal(result[1].deliveredQty,0);assert.equal(result[2].pickedQty,8);assert.equal(result[2].deliveredQty,0,'ready and picked is not confirmation');
assert.equal(result[2].pendingQty,8);
const flagged=reconcileDelivery(orders,wh,[{...lines[1],status:'nostock'}]);
assert.equal(flagged[0].outOfStockQty,4,'explicit nostock marker is preserved');
assert.equal(flagged[0].lineStatus,'nostock');
assert.equal(reconcileDelivery(orders,wh,[{...lines[1],status:'pending'}])[0].outOfStockQty,0,'pending is not stock loss');
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
const whFetch=async url=>{seen.push(url);return new Response(JSON.stringify(url.includes('/order_lines?')?lines:wh),{status:200})};
const response=await warehouseDeliveries(orders,{url:'https://warehouse.example',key:'public'},whFetch);
assert.equal(response.lines.length,3);assert.ok(seen[0].includes('external_id=in.(order1,order2)'));
const snapshotFetch=async url=>new Response(JSON.stringify(url.includes('/order_lines?')?
 [...lines,{id:'manual-line',order_id:'manual',sku:'C',qty_ordered:5,qty_picked:2,name:'Manual product'}]:
 url.includes('&parent_id=in.')?[]:[...wh.map(o=>({...o,client_code:'001',created_at:'2026-10-16'})),
 {id:'manual',company:'lexo',client_code:'001',customer:'Assigned customer',created_at:'2026-10-16'},
 {id:'forbidden',company:'lexo',client_code:'002',created_at:'2026-10-16'},
 {id:'wrong-company',company:'bm',client_code:'001',created_at:'2026-10-16'}]),{status:200});
const snapshot=await warehouseSnapshot({profile:{role:'salesman'},clients:[{id:'client1',client_code:'001'}],orders}, {url:'https://warehouse.example',key:'public'},snapshotFetch);
assert.deepEqual(snapshot.orders.map(o=>o.id),['wh1','wh2','manual'],'standalone warehouse orders included without expanding customer scope');
assert.equal(snapshot.orders.find(o=>o.id==='manual').items[0].orderedNet,null,'missing warehouse price is not zero or current catalog price');
assert.equal(snapshot.orders.find(o=>o.id==='manual').items[0].qty,5);
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
