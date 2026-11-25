import {persistDeliverySnapshot} from '../_shared/sales-delivery-cache.mjs';
import { catalogContext, warehouseSnapshot, ReadError } from '../_shared/sales-delivery-reader.mjs';

Deno.serve(async request => {
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store','Content-Type':'application/json'};
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
  try {
    const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY');
    if(!url||!key)throw new ReadError('Catalog connection is unavailable.');
    const body=await request.json().catch(()=>({}));
    const context=await catalogContext({url,key,token:request.headers.get('authorization'),salesmanCode:body.salesmanCode||null});
    let data;
    try {
      data=await warehouseSnapshot(context,{readerKey:Deno.env.get('WAREHOUSE_READER_KEY')});
    } catch(error) {
      const denied=error instanceof ReadError&&(error.status===401||error.status===403);
      return new Response(JSON.stringify({
        code:denied?'warehouse_access_denied':error instanceof ReadError&&error.code==='warehouse_lines_unavailable'?error.code:'warehouse_unavailable',
        error:denied?'WarehousePick denied the delivery integration access.':'WarehousePick delivery data is unavailable.',
      }),{status:502,headers});
    }
    try{await persistDeliverySnapshot({url,key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),orders:context.orders,snapshot:data});}catch{console.warn('Company delivery ranking could not be updated.');}
    return new Response(JSON.stringify(data),{headers});
  }catch(error){
    return new Response(JSON.stringify({error:error instanceof ReadError?error.message:'Delivery refresh failed.'}),{status:error instanceof ReadError?error.status:502,headers});
  }
});
