/* Read-only bridge. Every result is restricted to catalog-authorized order UUIDs. */
export const warehouseDefaults={url:'https://wjokaaqfwjsvxcuhtbzm.supabase.co',key:'sb_publishable_4LDFyO2Hx-yDOO08nZ0WIA_6hvYu6mZ'};
const text=v=>String(v??'').trim();
export class ReadError extends Error { constructor(message,status=502){super(message);this.status=status;} }
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
export async function catalogContext({url,key,token,fetcher=fetch,includeOrders=true}) {
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(token||'')) throw new ReadError('Sign in with your catalog account.',401);
  const headers={apikey:key,Authorization:token};
  const user=await readJson(`${url}/auth/v1/user`,headers,fetcher);
  if(!user?.id) throw new ReadError('Sign in with your catalog account.',401);
  const profiles=await readJson(`${url}/rest/v1/profiles?select=id,role,salesman_code&id=eq.${encodeURIComponent(user.id)}`,headers,fetcher);
  const profile=profiles[0];
  if(!profile||profile.id!==user.id||profile.role!=='admin') throw new ReadError('An administrator account is required.',403);
  const clients=await readPages(url,'sales_clients?select=id,client_code,salesman_code&order=id',headers,fetcher);
  const scoped=profile.role==='admin'?clients:clients.filter(c=>profile.salesman_code&&c.salesman_code===profile.salesman_code);
  let orders=[];
  if(includeOrders) {
    const visible=await readPages(url,'orders?select=id,created_at,sales_client_id,sales_client_code,customer_client_code,status,order_items(id,sku,quantity,line_total,unit_price)&order=id',headers,fetcher);
    const ids=new Set(scoped.map(c=>c.id)),codes=new Set(scoped.map(c=>text(c.client_code)));
    orders=visible.filter(o=>!['draft','cancelled'].includes(o.status)&&(profile.role==='admin'||(o.sales_client_id?ids.has(o.sales_client_id):codes.has(text(o.sales_client_code)||text(o.customer_client_code)))));
  }
  return {profile,clients:scoped,orders};
}
const group=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;};
export function reconcileDelivery(catalogOrders,warehouseOrders,warehouseLines) {
  const out=[],whByExternal=group(warehouseOrders.filter(o=>o.source==='catalogolexo'&&o.company==='lexo'),o=>o.external_id);
  const linesByOrder=group(warehouseLines,l=>l.order_id);
  for(const order of catalogOrders) {
    const matches=whByExternal.get(order.id)||[];
    // More than one root match is unresolved, not summed twice.
    const roots=matches.filter(o=>!o.parent_id);
    if(roots.length!==1) continue;
    const warehouse=roots[0];
    if(warehouse.cancelled_at) continue;
    const source=linesByOrder.get(warehouse.id)||[],bySku=group(source,l=>text(l.sku).toUpperCase());
    const catalogBySku=group(order.order_items||[],l=>text(l.sku).toUpperCase());
    const confirmed=Boolean(warehouse.invoiced_at||text(warehouse.invoice_number)||text(warehouse.remito_number));
    for(const [sku,items] of catalogBySku) {
      const target=bySku.get(sku)||[];
      // Repeated SKU lines cannot be assigned safely without line IDs from WarehousePick.
      if(items.length!==1||target.length!==1) continue;
      const item=items[0],line=target[0],quantity=Number(item.quantity),picked=Number(line.qty_picked);
      if(!Number.isFinite(quantity)||quantity<0||Number(line.qty_ordered)!==quantity||!Number.isFinite(picked)||picked<0||picked>quantity) continue;
      out.push({orderId:order.id,itemId:item.id,sku,warehouseOrderId:warehouse.id,pickedQty:picked,
        deliveredQty:confirmed?picked:0,pendingQty:confirmed?quantity-picked:quantity,
        outOfStockQty:line.status==='nostock'?quantity-picked:0,lineStatus:line.status||null,
        confirmed,invoiceNumber:text(warehouse.invoice_number),remitoNumber:text(warehouse.remito_number),confirmedAt:warehouse.invoiced_at||null});
    }
  }
  return out;
}
export async function warehouseDeliveries(orders,{url,key}=warehouseDefaults,fetcher=fetch) {
  const results=[];
  for(let start=0;start<orders.length;start+=60) {
    const allowed=orders.slice(start,start+60),ids=allowed.map(o=>o.id);
    if(!ids.length)continue;
    const header={apikey:key};
    const os=await readPages(url,`orders?select=id,external_id,source,company,parent_id,cancelled_at,invoiced_at,invoice_number,remito_number&source=eq.catalogolexo&company=eq.lexo&external_id=in.(${ids.map(encodeURIComponent).join(',')})&order=id`,header,fetcher);
    if(!os.length)continue;
    const children=await readPages(url,`orders?select=id,parent_id&parent_id=in.(${os.map(o=>encodeURIComponent(o.id)).join(',')})&order=id`,header,fetcher);
    const splitRoots=new Set(children.map(o=>o.parent_id));
    const ls=await readPages(url,`order_lines?select=id,order_id,sku,qty_ordered,qty_picked,status&order_id=in.(${os.map(o=>encodeURIComponent(o.id)).join(',')})&order=id`,header,fetcher);
    results.push(...reconcileDelivery(allowed,os.filter(o=>!splitRoots.has(o.id)),ls));
  }
  return {available:true,lines:results,updatedAt:new Date().toISOString()};
}

export async function warehouseSnapshot(context,{url,key}=warehouseDefaults,fetcher=fetch) {
  const headers={apikey:key},columns='id,number,customer,status,created_at,source,company,client_code,external_id,parent_id,cancelled_at,invoiced_at,invoice_number,remito_number';
  const prefix=`orders?select=${columns}&company=eq.lexo&order=id`;
  const byId=new Map();
  const add=rows=>{for(const row of rows)byId.set(row.id,row);};
  if(context.profile.role==='admin') add(await readPages(url,prefix,headers,fetcher));
  else {
    for(const [field,values] of [['client_code',context.clients.map(c=>c.client_code)],['external_id',context.orders.map(o=>o.id)]]) {
      for(let start=0;start<values.length;start+=60) {
        const quoted=values.slice(start,start+60).map(v=>'"'+text(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"').join(',');
        add(await readPages(url,`${prefix}&${field}=in.(${encodeURIComponent(quoted)})`,headers,fetcher));
      }
    }
  }
  const codes=new Set(context.clients.map(c=>text(c.client_code))),authorized=new Map(context.orders.map(o=>[o.id,o]));
  const roots=[...byId.values()].filter(o=>o.company==='lexo'&&!o.parent_id&&!o.cancelled_at&&o.status!=='cancelled'&&
    (context.profile.role==='admin'||(o.source==='catalogolexo'&&o.external_id?authorized.has(o.external_id):codes.has(text(o.client_code)))));
  const children=new Set(),lines=[];
  for(let start=0;start<roots.length;start+=60) {
    const ids=roots.slice(start,start+60).map(o=>encodeURIComponent(o.id)).join(',');
    const childRows=await readPages(url,`orders?select=id,parent_id&parent_id=in.(${ids})&order=id`,headers,fetcher);
    for(const row of childRows)children.add(row.parent_id);
    lines.push(...await readPages(url,`order_lines?select=id,order_id,sku,name,qty_ordered,qty_picked,status&order_id=in.(${ids})&order=id`,headers,fetcher));
  }
  const lineGroups=group(lines,l=>l.order_id);
  const orders=roots.map(order=>{
    const original=order.source==='catalogolexo'?authorized.get(order.external_id):null;
    const canonical=original?.sales_client_id?context.clients.find(c=>c.id===original.sales_client_id):null;
    const bySku=group(original?.order_items||[],l=>text(l.sku).toUpperCase());
    const warehouseSku=group(lineGroups.get(order.id)||[],l=>text(l.sku).toUpperCase());
    const confirmed=Boolean(order.invoiced_at||text(order.invoice_number)||text(order.remito_number));
    return {id:order.id,number:order.number,createdAt:order.created_at,clientCode:canonical?.client_code||(original?(text(original.sales_client_code)||text(original.customer_client_code)):text(order.client_code)),
      clientId:original?.sales_client_id||null,clientName:order.customer,externalId:original?.id||null,source:order.source||'manual',
      invoiceNumber:text(order.invoice_number),remitoNumber:text(order.remito_number),confirmedAt:order.invoiced_at||null,split:children.has(order.id),
      items:(lineGroups.get(order.id)||[]).map(line=>{
        const matches=bySku.get(text(line.sku).toUpperCase())||[],catalogLine=matches.length===1&&warehouseSku.get(text(line.sku).toUpperCase())?.length===1?matches[0]:null;
        const qty=Number(line.qty_ordered),picked=Number(line.qty_picked);
        const rate=catalogLine&&catalogLine.line_total!==null&&catalogLine.line_total!==undefined&&Number(catalogLine.quantity)>0?Number(catalogLine.line_total)/Number(catalogLine.quantity):null;
        const valid=Number.isFinite(qty)&&qty>=0&&Number.isFinite(picked)&&picked>=0&&picked<=qty;
        const known=valid&&!children.has(order.id);
        return {id:line.id,sku:line.sku,name:line.name,qty:valid?qty:null,pickedQty:known?picked:null,deliveredQty:known?(confirmed?picked:0):null,
          pendingQty:known?qty-(confirmed?picked:0):null,lineStatus:line.status||null,outOfStockQty:known?(line.status==='nostock'?qty-picked:0):null,confirmed:known?confirmed:null,orderedNet:valid&&Number.isFinite(rate)?qty*rate:null,
          deliveredNet:known&&Number.isFinite(rate)?(confirmed?picked:0)*rate:null,catalogItemId:catalogLine?.id||null};
      })};
  });
  return {available:true,orders,lines:reconcileDelivery(context.orders,roots.filter(o=>!children.has(o.id)),lines),updatedAt:new Date().toISOString()};
}
