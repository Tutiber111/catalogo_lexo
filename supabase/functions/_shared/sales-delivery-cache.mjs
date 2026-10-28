// Called only after authenticated WarehousePick reconciliation; browser data cannot write this cache.
export async function persistDeliverySnapshot({url,key,orders,snapshot,fetcher=fetch}){
 if(!key||!snapshot?.available)return false;
 const response=await fetcher(url+'/rest/v1/rpc/replace_sales_delivery_snapshot',{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({p_order_ids:orders.map(o=>o.id),p_lines:snapshot.lines,p_observed_at:snapshot.updatedAt})
 });
 if(!response.ok)throw new Error('Could not refresh company delivery ranking.');
 return true;
}
