const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),workerSource=fs.readFileSync('web/service-worker.js','utf8');
async function workerCheck(){
  const handlers={},stored=new Map(),requests=[],writes=[];
  const cache={match:async r=>stored.get(typeof r==='string'?r:r.url),put:async(r,v)=>{stored.set(r.url,v);}};
  const context={URL,self:{location:{origin:'https://catalogolexo.com.ar'},addEventListener:(n,f)=>handlers[n]=f},
    caches:{open:async()=>cache},fetch:async request=>{requests.push(request.url);return{ok:true,clone(){return{cached:true}}};}};
  vm.runInNewContext(workerSource,context);
  async function get(url){let result;handlers.fetch({request:{method:'GET',url},respondWith:p=>result=p,waitUntil:p=>writes.push(p)});const response=await result;await Promise.all(writes);return response;}
  const url='https://catalogolexo.com.ar/assets/pages/test.png?v=1';
  await get(url);await get(url);
  assert.equal(requests.length,1,'second page view is served without a network request');
  context.fetch=async()=>{throw Error('offline')};
  assert.equal((await get(url)).cached,true,'cached image remains available offline');
  await assert.rejects(()=>get(url.replace('v=1','v=2')),/offline/,'new version cannot reuse stale image');
  let intercepted=false;handlers.fetch({request:{method:'GET',url:'https://example.supabase.co/rest/v1/orders'},respondWith(){intercepted=true;}});
  assert.equal(intercepted,false,'private API responses bypass cache');
}
async function prefetchCheck(){
  let timer,aborted=0,active=0,maxActive=0;
  const fetched=[],cacheNames=[],saved=new Set(['p0?v=1']);
  const context={state:{catalog:{pages:Array.from({length:400},(_,i)=>({image:{src:`p${i}?v=1`}}))},catalogView:'pages',currentIndex:5},
    navigator:{connection:{effectiveType:'4g'}},window:{caches:{}},isOnline:()=>true,visiblePageIndexes:()=>Array.from({length:400},(_,i)=>i),
    clearTimeout(){timer=null;},setTimeout(fn){timer=fn;return 1;},AbortController:class{constructor(){this.signal={aborted:false};}abort(){this.signal.aborted=true;aborted++;}},
    caches:{open:async n=>{cacheNames.push(n);return{match:async u=>saved.has(u),put:async u=>saved.add(u)}}},
    fetch:async(u,o)=>{fetched.push([u,o]);active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return{ok:true};},console};
  vm.createContext(context);
  vm.runInContext(source.match(/const CATALOG_PAGE_CACHE_NAME = "[^"]+";/)[0]+source.slice(source.indexOf('function scheduleCatalogAssetCache()'),source.indexOf('\nfunction readAccountCustomer()')),context);
  context.scheduleCatalogAssetCache();assert.equal(fetched.length,0,'visible page loads before any prefetch');
  await timer();assert.deepEqual(fetched.map(r=>r[0]),['p6?v=1','p4?v=1'],'only adjacent pages, not the full 400-page catalog');
  assert.equal(maxActive,1);assert.ok(fetched.every(([,o])=>o.cache==='force-cache'&&o.priority==='low'));
  assert.equal(cacheNames[0],workerSource.match(/const PAGE_CACHE_NAME = "([^"]+)"/)[1],'prefetch and viewer share one cache');
  context.state.catalogCacheController=new context.AbortController();context.prioritizeCatalogSectionCache();assert.equal(aborted,1,'navigation cancels background work');
  context.navigator.connection.saveData=true;context.scheduleCatalogAssetCache();assert.equal(timer,null,'data saver skips prefetch');
  context.navigator.connection.saveData=false;context.navigator.connection.effectiveType='3g';context.scheduleCatalogAssetCache();assert.equal(timer,null,'slow connections skip prefetch');
  context.navigator.connection.effectiveType='4g';context.state.catalogView='grid';context.scheduleCatalogAssetCache();assert.equal(timer,null,'product view does not download catalog pages');
}
(async()=>{await workerCheck();await prefetchCheck();console.log('Page cache: one network request across repeat views, offline reuse, version isolation, private API bypass; prefetch limited to two adjacent pages, sequential, low priority, cancellable, and connection-aware.');})().catch(e=>{console.error(e);process.exitCode=1});
