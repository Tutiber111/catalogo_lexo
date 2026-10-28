const assert=require('node:assert/strict'),fs=require('node:fs');
const nativeFetch=global.fetch;
const prepared=JSON.parse(fs.readFileSync('tmp/sales-dashboard/prepared.json','utf8'));
const owner=require('../web/sales-dashboard-access.js').ownerId;
let privateReads=0;let rpcReads=0;let orderReads=0;
global.fetch=async(url,options={})=>{
  if(!String(url).startsWith('https://iexpvwmtxauvzkcncqoc.supabase.co/'))throw new Error('Unexpected test request');
  const headers=options.headers||{},token=headers.Authorization;
  let data;
  if(String(url).includes('/auth/v1/user'))data={id:token==='Bearer owner-fixture'?owner:'other-account'};
  else if(String(url).includes('/profiles?'))data=[{id:token==='Bearer owner-fixture'?owner:'other-account',role:token==='Bearer owner-fixture'?'admin':'salesman'}];
  else if(String(url).includes('/sales_clients?')){
    privateReads++;
    const from=Number(String(headers.Range||'0-499').split('-')[0]);
    data=prepared.clients.slice(from,from+500).map(c=>({id:c.client_code,client_code:c.client_code,salesman_code:c.salesman_code,name:c.name}));
  }else if(String(url).includes('/orders?')){orderReads++;data=[];}else if(String(url).includes('/rpc/')){rpcReads++;throw new Error('Preview must work before migration deployment');}else throw new Error('Unexpected test resource');
  return new Response(JSON.stringify(data),{status:200});
};
process.env.PORT='8096';
const server=require('./static_server.js');
async function main(){try{
  for(const endpoint of ['/__live-history','/__live-deliveries','/__live-scope?salesman=855','/__live-ranking']){
    assert.equal((await nativeFetch('http://127.0.0.1:8096'+endpoint)).status,401);
    assert.equal((await nativeFetch('http://127.0.0.1:8096'+endpoint,{headers:{Authorization:'Bearer other-fixture'}})).status,403);
  }
  assert.equal(privateReads,0,'rejected identities never read client or history data');
  const response=await nativeFetch('http://127.0.0.1:8096/__live-history',{headers:{Authorization:'Bearer owner-fixture'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();
  assert.equal(result.available,true);assert.equal(result.lines.length,52083);
  assert.ok(result.batches.some(b=>b.from_date==='2024-09-02'));
  const scoped=await nativeFetch('http://127.0.0.1:8096/__live-scope?salesman=855',{headers:{Authorization:'Bearer owner-fixture'}});
  assert.equal(scoped.status,200);
  const portfolio=await scoped.json();
  assert.equal(portfolio.salesmanCode,'855');assert.ok(portfolio.clients.length>0);assert.ok(portfolio.lines.length>0);
  assert.ok(portfolio.clients.every(c=>c.salesman_code==='855'));
  const allowed=new Set(portfolio.clients.map(c=>c.client_code));assert.ok(portfolio.lines.every(r=>allowed.has(r.client_code)));
  assert.equal(rpcReads,0,'Romina preview uses authenticated local data without an unpublished RPC');
  const ranking=await nativeFetch('http://127.0.0.1:8096/__live-ranking',{headers:{Authorization:'Bearer owner-fixture'}});
  assert.equal(ranking.status,200);const ranked=await ranking.json();assert.ok(ranked.items.length>0);
  assert.ok(ranked.items.every(p=>Object.keys(p).every(k=>['key','qty'].includes(k))),'company ranking exposes no client identities');
  assert.ok(orderReads>0);
  assert.equal((await nativeFetch('http://127.0.0.1:8096/catalog?dashboard=ventas')).status,200);
  assert.equal((await nativeFetch('http://127.0.0.1:8096/tmp/sales-dashboard/prepared.json')).status,404,'private history never served as a static asset');
  console.log('Standard preview: full private history via shared authenticated routes, anonymous/other-account denial, catalog route, no-store and private-file isolation passed.');
}finally{global.fetch=nativeFetch;server.close();}}
main().catch(e=>{console.error(e);process.exitCode=1});
