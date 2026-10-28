/* Shared loopback API. Private files are released only after catalog Auth and
 * the existing owner check succeed; never serve them as static web assets. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let reader;
async function salesPreviewApi(request,response,pathname) {
  if(!['/__live-history','/__live-deliveries','/__live-scope','/__live-ranking'].includes(pathname))return false;
  response.setHeader('Cache-Control','no-store');
  try {
    if(request.method!=='GET'){response.writeHead(405);response.end();return true;}
    const config=fs.readFileSync(path.join(root,'web/supabase-client.js'),'utf8');
    const url=config.match(/url:\s*"([^"]+)"/)[1],key=config.match(/anonKey:\s*"([^"]+)"/)[1];
    const api=await (reader ||= import('../supabase/functions/_shared/sales-delivery-reader.mjs'));
    const requested=new URL(request.url,'http://localhost').searchParams.get('salesman');
    const needsScope=pathname==='/__live-scope'||pathname==='/__live-deliveries'&&requested;
    const context=await api.catalogContext({url,key,token:request.headers.authorization,includeOrders:pathname!=='/__live-history',includeDetails:Boolean(needsScope)||pathname==='/__live-ranking',includeHistory:pathname==='/__live-scope'});
    let scope;
    if(needsScope){
      if(context.profile.role==='admin'){
        const prepared=JSON.parse(fs.readFileSync(path.join(root,'tmp/sales-dashboard/prepared.json'),'utf8'));
        scope=require('./sales-preview-scope.cjs')(context,prepared,requested);
      }else scope=context.scope;
    }
    let result;
    if(pathname==='/__live-ranking'){
      if(context.profile.role!=='admin')throw Object.assign(new Error('Administrator preview required.'),{status:403});
      const prepared=JSON.parse(fs.readFileSync(path.join(root,'tmp/sales-dashboard/prepared.json'),'utf8'));
      const products=JSON.parse(fs.readFileSync(path.join(root,'web/data/catalog.json'),'utf8')).products;
      let delivery;try{delivery=await api.warehouseSnapshot(context);}catch{delivery={available:false,lines:[]};}
      const model=require('../web/sales-bi-model.js');
      const data=model.prepare({...prepared,catalog:products,clients:context.clients.map(c=>({id:c.id,clientCode:c.client_code,name:c.name,salesmanCode:c.salesman_code})),
        orders:context.orders.map(o=>({id:o.id,status:o.status,createdAt:o.created_at,customer:{salesClient:{id:o.sales_client_id,clientCode:o.sales_client_code},clientCode:o.customer_client_code,name:o.customer_name},items:o.order_items.map(i=>({id:i.id,sku:i.sku,name:i.name,qty:i.quantity,lineTotal:Number(i.line_total)}))})),delivery,includeUnassigned:true,companyRankingAvailable:true});
      result={available:true,items:model.companyBestsellers(data),partial:data.records.some(r=>r.source==='catalog'&&r.deliveredQty===null)};
    }else if(pathname==='/__live-scope')result=scope;
    else if(pathname==='/__live-history'){
      const prepared=JSON.parse(fs.readFileSync(path.join(root,'tmp/sales-dashboard/prepared.json'),'utf8'));
      const codes=new Set(context.clients.map(c=>String(c.client_code)));
      result={available:true,batches:prepared.batches||[prepared.batch],lines:context.profile.role==='admin'?prepared.lines:prepared.lines.filter(r=>codes.has(String(r.client_code)))};
    }else result=await api.warehouseSnapshot(scope?{profile:{...context.profile,role:'salesman'},clients:scope.clients,orders:scope.orders}:context);
    response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});response.end(JSON.stringify(result));
  }catch(error){
    response.writeHead(error.status||502,{'Content-Type':'application/json;charset=utf-8'});
    response.end(JSON.stringify({error:error.status?error.message:'Could not refresh private dashboard data.'}));
  }
  return true;
}
module.exports=salesPreviewApi;
