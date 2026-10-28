const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let failure=null;
const calls=[];
const api={auth:{onAuthStateChange(){}},from(table){
  return {select(){return this},order(key){calls.push([table,key]);return this},eq(){return this},
    async range(start,end){calls.push([table,start,end]);if(failure)return {error:failure};
      return {data:table==='sales_history_batches'?[{id:'batch',from_date:'2024-09-02',to_date:'2026-09-01'}]:Array.from({length:start===0?500:start===500?1:0},(_,i)=>({line_key:String(start+i)})),error:null};}};
}};
const context={window:{location:{search:'',hash:''},supabase:{createClient:()=>api}},URLSearchParams};
vm.createContext(context);vm.runInContext(fs.readFileSync('web/supabase-client.js','utf8'),context);
async function main(){
  const r=await context.window.CATALOG_SUPABASE.loadDashboardHistory();
  assert.equal(r.lines.length,501);assert.equal(r.available,true);assert.equal(r.batches.length,1);
  assert.ok(calls.some(c=>c[0]==='sales_history_lines'&&c[1]===500&&c[2]===999));
  failure={code:'PGRST205'};
  const missing=await context.window.CATALOG_SUPABASE.loadDashboardHistory();
  assert.equal(missing.available,false);assert.equal(missing.lines.length,0);
  failure={code:'42501',message:'denied'};
  await assert.rejects(()=>context.window.CATALOG_SUPABASE.loadDashboardHistory(),e=>e.code==='42501');
  failure=null;
  const previewReads=[];
  api.auth.getSession=async()=>({data:{session:{access_token:'local-fixture-token'}}});
  const preview={window:{location:{search:'',hash:'',hostname:'127.0.0.1',port:'8091'},supabase:{createClient:()=>api}},URLSearchParams,
    fetch:async(path,options)=>{previewReads.push({path,options});return{ok:true,json:async()=>({available:true,lines:[],batches:[],orders:[],clients:[]})};}};
  vm.createContext(preview);vm.runInContext(fs.readFileSync('web/supabase-client.js','utf8'),preview);
  await preview.window.CATALOG_SUPABASE.loadDashboardHistory();
  await preview.window.CATALOG_SUPABASE.loadDashboardDeliveries();
  assert.deepEqual(previewReads.map(r=>r.path),['/__live-history','/__live-deliveries'],'local catalog works without injected overrides');
  assert.ok(previewReads.every(r=>r.options.cache==='no-store'&&r.options.headers.Authorization==='Bearer local-fixture-token'));
  preview.window.location.port='8080';
  await preview.window.CATALOG_SUPABASE.loadDashboardHistory();
  await preview.window.CATALOG_SUPABASE.loadDashboardDeliveries();
  assert.deepEqual(previewReads.slice(-2).map(r=>r.path),['/__live-history','/__live-deliveries'],'standard catalog shortcut uses private data routes too');
  await preview.window.CATALOG_SUPABASE.loadDashboardScope('855');
  assert.equal(previewReads.at(-1).path,'/__live-scope?salesman=855','local salesperson preview uses the private bridge, not an undeployed RPC');
  const handlers={};let stored=false;
  const sw={self:{location:{origin:'https://catalogolexo.com.ar'},addEventListener:(name,fn)=>handlers[name]=fn}};
  vm.createContext(sw);sw.URL=URL;
  vm.runInContext(fs.readFileSync('web/service-worker.js','utf8'),sw);
  handlers.fetch({request:{method:'GET',url:'https://iexpvwmtxauvzkcncqoc.supabase.co/rest/v1/sales_history_lines'},respondWith(){stored=true}});
  assert.equal(stored,false,'authenticated history bypasses shared service-worker cache');
  handlers.fetch({request:{method:'GET',url:'https://catalogolexo.com.ar/__live-history',headers:{has:name=>name==='authorization'}},respondWith(){stored=true}});
  assert.equal(stored,false,'authenticated same-origin private preview also bypasses shared cache');
  const ui={window:{SALES_BI_MODEL:{},addEventListener(){}}};vm.createContext(ui);vm.runInContext(fs.readFileSync('web/sales-bi.js','utf8'),ui);
  assert.match(ui.window.SALES_BI.csv([['=HYPERLINK("evil")','+evil',-20]]),/"'=HYPERLINK/,'CSV formulas escaped');
  assert.match(ui.window.SALES_BI.csv([[-20]]),/"-20"/,'numeric negatives preserved');
  console.log('Historical API pagination, missing migration, permission errors, private-cache exclusion, and CSV formula protection passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
