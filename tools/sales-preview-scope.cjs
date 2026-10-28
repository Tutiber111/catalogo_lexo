/* Admin review only. Caller authentication and admin role are checked first. */
const clean=v=>String(v??'').trim();
const assignment=(code,seller)=>clean(code)==='81032'?'unassigned':['','90','900'].includes(clean(seller))?'900':clean(seller);
module.exports=function previewScope(context,prepared,requested){
 if(context.profile.role!=='admin')throw Object.assign(new Error('Administrator preview required.'),{status:403});
 const target=clean(requested)==='90'?'900':clean(requested);
 if(!target||target==='*')throw Object.assign(new Error('Choose one salesperson.'),{status:400});
 const byId=new Map(context.clients.map(c=>[c.id,c])),byCode=new Map(context.clients.map(c=>[clean(c.client_code),c]));
 const orders=context.orders.filter(o=>{
   const c=o.sales_client_id?byId.get(o.sales_client_id):byCode.get(clean(o.sales_client_code)||clean(o.customer_client_code));
   return !['draft','cancelled'].includes(o.status)&&assignment(c?.client_code,c?.salesman_code)===target;
 });
 return {available:true,salesmanCode:target,
   clients:context.clients.filter(c=>assignment(c.client_code,c.salesman_code)===target),orders,
   batches:prepared.batches||[prepared.batch],
   lines:prepared.lines.filter(r=>assignment(r.client_code,byCode.get(clean(r.client_code))?.salesman_code)===target)};
};
