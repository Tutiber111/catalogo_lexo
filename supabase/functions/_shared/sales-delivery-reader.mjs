/* Read-only bridge. Every result is restricted to catalog-authorized order UUIDs. */
export const warehouseDefaults={url:'https://wjokaaqfwjsvxcuhtbzm.supabase.co',key:'sb_publishable_4LDFyO2Hx-yDOO08nZ0WIA_6hvYu6mZ'};
const text=v=>String(v??'').trim();
export class ReadError extends Error {
  constructor(message,status=502,code=null){super(message);this.status=status;this.code=code;}
}
const warehouseFeeds={orders:'rpc/lexo_orders_feed',lines:'rpc/lexo_order_lines_feed',invoices:'rpc/lexo_invoice_lines_feed'};
const warehouseOrderFields='id,number,customer,status,created_at,source,company,client_code,external_id,parent_id,cancelled_at,invoiced_at,invoice_number,remito_number';
export async function readJson(url,headers,fetcher=fetch) {
  const response=await fetcher(url,{headers,signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new ReadError(response.status===401||response.status===403?'Authentication or data access denied.':'Could not refresh data.',response.status===401||response.status===403?response.status:502);
  return response.json();
}
export async function readPages(base,path,headers,fetcher=fetch) {
  const rows=[];
  for(let start=0;;start+=500) {
    const page=await readJson(`${base}/rest/v1/${path}`,{...headers,Range:`${start}-${start+499}`,'Range-Unit':'items'},fetcher);
    if(!Array.isArray(page)) throw new ReadError('Unexpected data response.');
    rows.push(...page); if(page.length<500) return rows;
  }
}

function warehouseFeed({url=warehouseDefaults.url,key=warehouseDefaults.key,readerKey}={},fetcher) {
  if(!text(readerKey))throw new ReadError('WarehousePick reader key is missing.',403);
  const headers={apikey:key,'x-reader-key':text(readerKey)};
  return (feed,query)=>readPages(url,warehouseFeeds[feed]+'?'+query,headers,async (requestUrl,options)=>{
    const response=await fetcher(requestUrl,{...options,redirect:'error'});
    if(feed==='lines'&&response.status===404) {
      throw new ReadError('WarehousePick order line feed is unavailable.',502,'warehouse_lines_unavailable');
    }
    return response;
  });
}
export async function catalogContext({url,key,token,fetcher=fetch,includeOrders=true,salesmanCode=null,includeDetails=false,includeHistory=false}) {
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(token||'')) throw new ReadError('Sign in with your catalog account.',401);
  const headers={apikey:key,Authorization:token};
  const user=await readJson(`${url}/auth/v1/user`,headers,fetcher);
  if(!user?.id) throw new ReadError('Sign in with your catalog account.',401);
  const profiles=await readJson(`${url}/rest/v1/profiles?select=id,role,salesman_code,dashboard_full_access&id=eq.${encodeURIComponent(user.id)}`,headers,fetcher);
  const profile=profiles[0];
  if(!profile||profile.id!==user.id||!['admin','salesman'].includes(profile.role)) throw new ReadError('Dashboard access denied.',403);
  const fullDashboard=profile.role==='admin'||profile.role==='salesman'&&profile.dashboard_full_access===true;
  if(!fullDashboard&&profile.role==='salesman'&&!text(profile.salesman_code))throw new ReadError('Salesperson code required.',403);
  if(!fullDashboard||salesmanCode){
    const response=await fetcher(`${url}/rest/v1/rpc/sales_dashboard_scope`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_salesman_code:salesmanCode||null,p_include_history:includeHistory})});
    if(!response.ok)throw new ReadError('Portfolio access denied.',403);
    const scope=await response.json();
    if(!Array.isArray(scope.clients)||!Array.isArray(scope.orders))throw new ReadError('Invalid portfolio response.');
    return {profile:{...profile,role:'salesman'},fullDashboard:false,clients:scope.clients,orders:includeOrders?scope.orders:[],scope};
  }
  if(profile.role!=='admin'){
    const response=await fetcher(`${url}/rest/v1/rpc/sales_dashboard_full_context`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
    if(!response.ok)throw new ReadError('Full dashboard access denied.',403);
    const data=await response.json();
    if(data?.available!==true||!Array.isArray(data.clients)||!Array.isArray(data.orders))throw new ReadError('Invalid full dashboard response.');
    return {profile,fullDashboard:true,clients:data.clients,orders:includeOrders?data.orders:[]};
  }
  const clientFields=includeDetails?'id,client_code,name,legal_name,address,locality,salesman_code,source_salesman_label':'id,client_code,salesman_code';
  const clients=await readPages(url,'sales_clients?select='+clientFields+'&order=id',headers,fetcher);
  const scoped=profile.role==='admin'?clients:clients.filter(c=>profile.salesman_code&&c.salesman_code===profile.salesman_code);
  let orders=[];
  if(includeOrders) {
    const visible=await readPages(url,'orders?select='+(includeDetails?'order_number,customer_id,customer_name,':'')+'id,created_at,sales_client_id,sales_client_code,customer_client_code,salesman_code,status,order_items(id,sku,name,quantity,line_total,unit_price)&order=id',headers,fetcher);
    const ids=new Set(scoped.map(c=>c.id)),codes=new Set(scoped.map(c=>text(c.client_code)));
    orders=visible.filter(o=>!['draft','cancelled'].includes(o.status)&&(profile.role==='admin'||(o.sales_client_id?ids.has(o.sales_client_id):codes.has(text(o.sales_client_code)||text(o.customer_client_code)))));
  }
  return {profile,clients:scoped,orders};
}
const group=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;};
const skuKey=line=>text(line.sku).toUpperCase();
// Business rule confirmed by the owner (Nov 27, 2026): what the warehouse marks
// "con stock" on each order line is what was invoiced. "Sin stock" is never
// invoiced, and a line nobody has marked yet is still pending.
const withStockStatuses=new Set(['picked','partial']);
export function lineStock(line) {
  const ordered=Number(line?.qty_ordered),picked=Number(line?.qty_picked);
  if(!Number.isFinite(ordered)||ordered<0||!Number.isFinite(picked)||picked<0||picked>ordered)return null;
  const status=text(line.status).toLowerCase();
  const marked=withStockStatuses.has(status)||line.committed===true||(!status&&picked>0);
  const withStock=status==='nostock'||marked?picked:0;
  const noStock=status==='nostock'?ordered-picked:0;
  return {ordered,withStock,noStock,pending:ordered-withStock-noStock};
}
// A split moves the unresolved remainder of a root line into a child order.
// The child is not a new purchase: its marks complete the original line.
export function familyStock(rootLines,remainderLines=[]) {
  const remainders=group(remainderLines,skuKey),counts=group(rootLines,skuKey);
  return rootLines.map(line=>{
    const own=lineStock(line);
    if(!own)return null;
    let withStock=own.withStock,noStock=own.noStock;
    if(counts.get(skuKey(line)).length===1) {
      for(const child of remainders.get(skuKey(line))||[]) {
        const part=lineStock(child);
        if(part){withStock+=part.withStock;noStock+=part.noStock;}
      }
    }
    withStock=Math.min(withStock,own.ordered);
    noStock=Math.min(noStock,own.ordered-withStock);
    return {ordered:own.ordered,withStock,noStock,pending:own.ordered-withStock-noStock};
  });
}
export function reconcileDelivery(catalogOrders,warehouseOrders,warehouseLines,remaindersByRoot=new Map()) {
  const out=[],whByExternal=group(warehouseOrders.filter(o=>o.source==='catalogolexo'&&o.company==='lexo'),o=>o.external_id);
  const linesByOrder=group(warehouseLines,l=>l.order_id);
  for(const order of catalogOrders) {
    const matches=whByExternal.get(order.id)||[];
    // More than one root match is unresolved, not summed twice.
    const roots=matches.filter(o=>!o.parent_id);
    if(roots.length!==1) continue;
    const warehouse=roots[0];
    if(warehouse.cancelled_at||warehouse.status==='cancelled') continue;
    const source=linesByOrder.get(warehouse.id)||[],stock=familyStock(source,remaindersByRoot.get(warehouse.id)||[]);
    const bySku=group(source.map((line,i)=>({line,stock:stock[i]})),entry=>skuKey(entry.line));
    const catalogBySku=group(order.order_items||[],l=>text(l.sku).toUpperCase());
    for(const [sku,items] of catalogBySku) {
      const target=bySku.get(sku)||[];
      // Repeated SKU lines cannot be assigned safely without line IDs from WarehousePick.
      if(items.length!==1||target.length!==1) continue;
      const item=items[0],{line,stock:fact}=target[0],quantity=Number(item.quantity);
      if(!fact||!Number.isFinite(quantity)||quantity<0||fact.ordered!==quantity) continue;
      out.push({orderId:order.id,itemId:item.id,sku,warehouseOrderId:warehouse.id,pickedQty:fact.withStock,
        deliveredQty:fact.withStock,pendingQty:fact.pending,outOfStockQty:fact.noStock,lineStatus:line.status||null,
        confirmed:fact.pending===0,invoiceNumber:text(warehouse.invoice_number),remitoNumber:text(warehouse.remito_number),confirmedAt:warehouse.invoiced_at||null});
    }
  }
  return out;
}
export async function warehouseDeliveries(orders,settings,fetcher=fetch) {
  const read=warehouseFeed(settings,fetcher);
  const results=[];
  for(let start=0;start<orders.length;start+=60) {
    const allowed=orders.slice(start,start+60),ids=allowed.map(o=>o.id);
    if(!ids.length)continue;
    const os=await read('orders',`select=id,external_id,source,company,status,parent_id,cancelled_at,invoiced_at,invoice_number,remito_number&source=eq.catalogolexo&company=eq.lexo&external_id=in.(${ids.map(encodeURIComponent).join(',')})&order=id`);
    if(!os.length)continue;
    const children=await read('orders',`select=id,parent_id,company,status,cancelled_at&parent_id=in.(${os.map(o=>encodeURIComponent(o.id)).join(',')})&order=id`);
    const live=children.filter(o=>o.company==='lexo'&&!o.cancelled_at&&o.status!=='cancelled');
    const ids2=[...os,...live].map(o=>encodeURIComponent(o.id)).join(',');
    const ls=await read('lines',`select=id,order_id,sku,qty_ordered,qty_picked,status&order_id=in.(${ids2})&order=id`);
    const parentOf=new Map(live.map(o=>[o.id,o.parent_id]));
    const remainders=group(ls.filter(l=>parentOf.has(l.order_id)),l=>parentOf.get(l.order_id));
    results.push(...reconcileDelivery(allowed,os,ls.filter(l=>!parentOf.has(l.order_id)),remainders));
  }
  return {available:true,lines:results,updatedAt:new Date().toISOString()};
}

// Prices live on WarehousePick lines for orders entered directly in the warehouse.
// They are used only when the order-level discount can be read too; otherwise the
// amount stays unknown rather than overstated.
const linePriceFields=',committed,unit_price,special_price,price_adj';
function warehouseRate(line,order) {
  const price=line.special_price??line.unit_price;
  if(price==null)return null;
  const base=Number(price);
  if(!Number.isFinite(base)||base<0)return null;
  const adjust=Number(line.price_adj||0),raw=text(order?.erp_header?.E5);
  if(!Number.isFinite(adjust))return null;
  const discount=/^[0-9]+([.][0-9]+)?$/.test(raw)?Number(raw):0;
  return Math.round(base*(1+adjust/100)*100)/100*(1-(discount>=1?discount/100:discount));
}
async function optionalRead(read,feed,extended,basic) {
  try {return {rows:await read(feed,extended),extended:true};}
  catch(error) {
    // Older WarehousePick feeds may not expose price columns; access errors still fail.
    if(!(error instanceof ReadError)||error.status===401||error.status===403||error.code)throw error;
    return {rows:await read(feed,basic),extended:false};
  }
}
async function familyLinks(read,roots,heads,visible,fullDashboard) {
  const links=new Map(roots.map((root,i)=>[root.id,{document:root,order:heads[i]}]));
  let parents=roots.map(root=>root.id);
  // Full company reads already include children. Scoped reads follow only authorized roots.
  const byParent=fullDashboard?group([...visible.values()],row=>row.parent_id):null;
  while(parents.length) {
    const children=[];
    if(byParent) {
      for(const id of parents)children.push(...(byParent.get(id)||[]));
    } else {
      for(let start=0;start<parents.length;start+=60) {
        const ids=parents.slice(start,start+60).map(encodeURIComponent).join(',');
        children.push(...await read('orders',`select=${warehouseOrderFields}&parent_id=in.(${ids})&order=id`));
      }
    }
    parents=[];
    for(const child of children) {
      const parent=links.get(child.parent_id);
      if(!parent||links.has(child.id)||child.company!=='lexo'||child.cancelled_at||child.status==='cancelled')continue;
      const rootClient=text(parent.order.clientCode)||text(parent.document.client_code);
      const childClient=text(child.client_code);
      // Earlier catalog orders can have no client code on the parent. Company
      // readers can still see their remainder; scoped readers need a matching identity.
      if(childClient&&childClient!==rootClient&&(rootClient||!fullDashboard))continue;
      const externalId=text(parent.order.externalId)||text(parent.document.external_id);
      if(text(child.external_id)&&text(child.external_id)!==externalId)continue;
      links.set(child.id,{document:child,order:parent.order});
      parents.push(child.id);
    }
  }
  return links;
}

// Kitchen Spot sales are loaded by hand with "KS" order numbers (for example "KS - 24/11").
const isTestOrder=order=>order?.is_test===true||/^\s*test\b/i.test(text(order?.number))||/^\s*pedido de prueba\s*$/i.test(text(order?.customer));
export const isKitchenSpot=order=>/^\s*KS\b/i.test(text(order?.number))||/kitchen\s*spot/i.test(text(order?.customer));

export async function warehouseSnapshot(context,settings,fetcher=fetch) {
  const read=warehouseFeed(settings,fetcher);
  const fullDashboard=context.profile.role==='admin'||context.fullDashboard===true;
  const byId=new Map();
  const add=rows=>{for(const row of rows)byId.set(row.id,row);};
  let orderPrices=null;
  const readOrders=async filter=>{
    const basic=`select=${warehouseOrderFields}&company=eq.lexo&order=id${filter}`;
    if(orderPrices===false)return read('orders',basic);
    const result=await optionalRead(read,'orders',`select=${warehouseOrderFields},erp_header&company=eq.lexo&order=id${filter}`,basic);
    if(orderPrices===null)orderPrices=result.extended;
    return result.rows;
  };
  if(fullDashboard) add(await readOrders(''));
  else {
    for(const [field,values] of [['client_code',context.clients.map(c=>c.client_code)],['external_id',context.orders.map(o=>o.id)]]) {
      for(let start=0;start<values.length;start+=60) {
        const quoted=values.slice(start,start+60).map(v=>'"'+text(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"').join(',');
        add(await readOrders(`&${field}=in.(${encodeURIComponent(quoted)})`));
      }
    }
  }
  const codes=new Set(context.clients.map(c=>text(c.client_code))),authorized=new Map(context.orders.map(o=>[o.id,o]));
  // Every Lexo root counts: orders sent from the catalog and orders loaded by hand in WarehousePick.
  const roots=[...byId.values()].filter(o=>o.company==='lexo'&&!o.parent_id&&!o.cancelled_at&&o.status!=='cancelled'&&!isTestOrder(o)&&
    (fullDashboard||(o.source==='catalogolexo'&&o.external_id?authorized.has(o.external_id):codes.has(text(o.client_code)))));
  const heads=roots.map(order=>{
    const original=order.source==='catalogolexo'?authorized.get(order.external_id):null;
    const canonical=original?.sales_client_id?context.clients.find(c=>c.id===original.sales_client_id):null;
    return {id:order.id,number:order.number,createdAt:order.created_at,
      clientCode:canonical?.client_code||(original?(text(original.sales_client_code)||text(original.customer_client_code)):text(order.client_code)),
      direct:order.source!=='catalogolexo'&&!authorized.has(order.external_id),kitchenSpot:isKitchenSpot(order),
      clientId:original?.sales_client_id||null,clientName:order.customer,externalId:original?.id||null,source:order.source||'manual',salesmanCode:text(original?.salesman_code),
      invoiceNumber:text(order.invoice_number),remitoNumber:text(order.remito_number),confirmedAt:order.invoiced_at||null,original};
  });
  const links=await familyLinks(read,roots,heads,byId,fullDashboard);
  const documents=[...links.keys()],lines=[];
  let linePrices=null;
  for(let start=0;start<documents.length;start+=60) {
    const ids=documents.slice(start,start+60).map(encodeURIComponent).join(',');
    const basic=`select=id,order_id,sku,name,qty_ordered,qty_picked,status&order_id=in.(${ids})&order=id`;
    if(linePrices===false||orderPrices===false){lines.push(...await read('lines',basic));continue;}
    const result=await optionalRead(read,'lines',`select=id,order_id,sku,name,qty_ordered,qty_picked,status${linePriceFields}&order_id=in.(${ids})&order=id`,basic);
    if(linePrices===null)linePrices=result.extended;
    lines.push(...result.rows);
  }
  const pricesAvailable=Boolean(linePrices&&orderPrices);
  const lineGroups=group(lines,l=>l.order_id);
  const remainders=new Map(),splits=new Set();
  for(const [id,link] of links) {
    if(id===link.order.id)continue;
    splits.add(link.order.id);
    if(!remainders.has(link.order.id))remainders.set(link.order.id,[]);
    remainders.get(link.order.id).push(...(lineGroups.get(id)||[]));
  }
  // Price per unit, before VAT: the catalog order's own price, then the WarehousePick price.
  // Lines with neither are valued later from the current catalog list price, in the browser.
  const rootById=new Map(roots.map((root,i)=>[root.id,{root,head:heads[i]}]));
  const catalogRates=new Map();
  for(const {root,head} of rootById.values()) {
    const items=group(head.original?.order_items||[],l=>text(l.sku).toUpperCase()),own=group(lineGroups.get(root.id)||[],skuKey),rates=new Map();
    for(const [sku,matches] of items) {
      const item=matches[0];
      if(matches.length!==1||(own.get(sku)?.length||0)>1||item.line_total===null||item.line_total===undefined||!(Number(item.quantity)>0))continue;
      const rate=Number(item.line_total)/Number(item.quantity);
      if(Number.isFinite(rate))rates.set(sku,rate);
    }
    catalogRates.set(root.id,rates);
  }
  const priceOf=(rootId,line)=>{
    const catalog=catalogRates.get(rootId)?.get(skuKey(line));
    if(Number.isFinite(catalog))return {rate:catalog,source:'catalog'};
    const warehouse=pricesAvailable?warehouseRate(line,rootById.get(rootId)?.root):null;
    return Number.isFinite(warehouse)?{rate:warehouse,source:'warehouse'}:{rate:null,source:null};
  };
  const orders=heads.map(head=>{
    const {original,...order}=head;
    const own=lineGroups.get(order.id)||[],stock=familyStock(own,remainders.get(order.id)||[]);
    const bySku=group(original?.order_items||[],l=>text(l.sku).toUpperCase()),warehouseSku=group(own,skuKey);
    return {...order,split:splits.has(order.id),items:own.map((line,i)=>{
      const matches=bySku.get(skuKey(line))||[],catalogLine=matches.length===1&&warehouseSku.get(skuKey(line))?.length===1?matches[0]:null;
      const {rate,source}=priceOf(order.id,line),fact=stock[i],valid=Boolean(fact);
      return {id:line.id,sku:line.sku,name:line.name,qty:valid?fact.ordered:null,pickedQty:valid?fact.withStock:null,
        withStockQty:valid?fact.withStock:null,deliveredQty:valid?fact.withStock:null,pendingQty:valid?fact.pending:null,
        lineStatus:line.status||null,outOfStockQty:valid?fact.noStock:null,confirmed:valid?fact.pending===0:null,
        orderedNet:valid&&rate!==null?fact.ordered*rate:null,deliveredNet:valid&&rate!==null?fact.withStock*rate:null,
        priceSource:valid&&rate!==null?source:null,catalogItemId:catalogLine?.id||null};
    })};
  });
  const rootLines=lines.filter(l=>links.get(l.order_id)?.order.id===l.order_id);
  return {available:true,rule:'with-stock',pricesAvailable,orders,invoiceFacts:await readInvoiceFacts(read,links,lineGroups,priceOf),
    lines:reconcileDelivery(context.orders,roots,rootLines,remainders),updatedAt:new Date().toISOString()};
}

// The invoice feed applies the warehouse's invoice-line rules and saved prices.
// Fulfillment and current price lists cannot establish a document's billed value.
async function readInvoiceFacts(read,links,lineGroups,priceOf) {
  const dated=[];
  let undated=0;
  for(const [id,{document}] of links) {
    if(text(document.invoice_number)||text(document.remito_number)) {
      if(Number.isFinite(Date.parse(document.invoiced_at)))dated.push(id);
      else if((lineGroups.get(id)||[]).some(line=>lineStock(line)?.withStock>0))undated++;
    }
  }
  const makeFact=(id,line,qty,net,priceSource)=>{
    const {document,order}=links.get(id);
    return {id:line.id,orderId:order.id,documentId:id,number:text(document.number)||text(order.number),
      catalogOrderId:order.externalId,fromCatalog:order.source==='catalogolexo'||Boolean(order.externalId),kitchenSpot:order.kitchenSpot,
      clientId:order.clientId,clientCode:order.clientCode,clientName:order.clientName,salesmanCode:order.salesmanCode,
      invoiceNumber:text(document.invoice_number),remitoNumber:text(document.remito_number),
      invoiceDate:document.invoiced_at,sku:line.sku,name:line.name,qty,net,priceSource};
  };
  const lines=[],seen=new Set();
  try {
    if(!dated.length)await read('invoices','select=id&p_order_ids=%7B00000000-0000-0000-0000-000000000000%7D');
    for(let start=0;start<dated.length;start+=60) {
      const batch=new Set(dated.slice(start,start+60));
      const ids=encodeURIComponent('{'+[...batch].join(',')+'}');
      const rows=await read('invoices',`select=id,order_id,sku,name,qty,net_amount&p_order_ids=${ids}&order=id`);
      for(const line of rows) {
        const qty=Number(line.qty);
        if(!batch.has(line.order_id)||!line.id||seen.has(line.id)||!Number.isFinite(qty)||qty<=0)continue;
        seen.add(line.id);
        const net=line.net_amount==null?null:Number(line.net_amount);
        lines.push(makeFact(line.order_id,line,qty,Number.isFinite(net)?net:null,Number.isFinite(net)?'warehouse-invoice':null));
      }
    }
    return {available:true,undated,lines};
  } catch {
    const estimated=[];
    for(const id of dated) {
      const {order}=links.get(id);
      for(const line of lineGroups.get(id)||[]) {
        const qty=lineStock(line)?.withStock||0;
        if(!line.id||!qty||line.status==='nostock'||line.no_invoice===true)continue;
        const {rate,source}=priceOf(order.id,line);
        estimated.push(makeFact(id,line,qty,rate===null?null:qty*rate,source));
      }
    }
    return {available:estimated.length>0,estimated:true,undated,lines:estimated};
  }
}
