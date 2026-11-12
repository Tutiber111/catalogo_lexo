const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {input}=require('./test-sales-product-buyers.cjs');
async function main(){
 const localXlsx=process.env.SALES_TEST_XLSX;
 const server=http.createServer((req,res)=>{
  const name=req.url.split('?')[0].slice(1);
  if(name==='xlsx.full.min.js'&&localXlsx){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(localXlsx));return;}
  if(['sales-bi.css','sales-product-brands.js','sales-bi-model.js','sales-bi-export.js','sales-bi.js'].includes(name)){
   res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
   res.end(fs.readFileSync('web/'+name));return;
  }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/sales-bi.css"><div id="dashboard"></div><script src="/sales-product-brands.js"></script><script src="/sales-bi-model.js"></script><script src="/sales-bi-export.js"></script><script src="/sales-bi.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-03T15:00:00Z']));}static now(){return new RealDate('2026-11-03T15:00:00Z').getTime();}};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const mount=async(simple=false,fixture=input)=>page.evaluate(({input,simple})=>{const scoped=simple?{...input,analysisSalesmanCode:'855'}:input;SALES_BI.mount(document.querySelector('#dashboard'),{...scoped,owner:simple?'seller':'admin',admin:!simple,simple,live:true,available:true,updatedAt:'2026-11-03T15:00:00Z',salesmanCode:simple?'855':'*',salesmen:[{code:'*',name:'Todos'},{code:'855',name:'Romina'},{code:'800',name:'Other seller'}],companyBestsellers:[],onSalesman(){},onRefresh(){}});},{input:fixture,simple});
  const dates=async(from,to)=>page.evaluate(({from,to})=>{const form=document.querySelector('[data-bi-filters]');form.elements.from.value=from;form.elements.to.value=to;form.elements.to.dispatchEvent(new Event('change',{bubbles:true}));},{from,to});
  const headline=()=>page.locator('.bi-ordered-headlines article strong').first().textContent();
  await mount();assert.equal(await page.locator('[name=from]').inputValue(),'2026-11-01');assert.equal(await page.locator('[name=to]').inputValue(),'2026-11-03');assert.match(await headline(),/2\.300/);
  assert.equal(await page.locator('[data-bi-chart=from],[data-bi-chart=to]').count(),0,'chart cannot override global dates');
  await page.locator('[data-bi-chart=dimension]').selectOption('units');assert.equal(await page.locator('[data-bi-chart=dimension]').inputValue(),'units');assert.equal(await page.locator('[data-bi-chart-error]').textContent(),'');
  await page.locator('[data-bi-chart=metric]').selectOption('ordered');assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'ordered');await page.locator('[data-bi-chart=metric]').selectOption('delivered');
  assert.equal(await page.locator('.bi-monthly-chart tbody tr').count(),1,'default graph uses selected month');
  await page.locator('[data-bi-tab=products]').click();assert.equal(await page.locator('[data-bi-products] tbody tr').count(),2);
  await page.locator('[data-bi-products] button').filter({hasText:'Ver clientes (2)'}).click();
  assert.equal(await page.locator('[data-bi-product-buyers] tbody tr').count(),2);assert.match(await headline(),/1\.200/,'product selection updates global KPIs');
  assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Alice/);assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Bob/);assert.doesNotMatch(await page.locator('[data-bi-product-buyers]').textContent(),/A-1/);
  await page.locator('[name=metric]').selectOption('delivered');assert.equal(await page.locator('[data-bi-product-buyers] tbody tr').count(),1);assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/400/);assert.doesNotMatch(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Bob/);
  assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'delivered');
  await page.screenshot({path:'tmp/sales-dashboard/product-buyers-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.sales-bi').evaluate(el=>el.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'tmp/sales-dashboard/product-buyers-mobile.png',fullPage:true});await page.setViewportSize({width:1500,height:1080});
  await page.locator('[data-bi-clear-product]').click();await page.locator('[name=metric]').selectOption('ordered');
  await dates('2026-10-01','2026-10-03');assert.match(await headline(),/400/);assert.match(await page.locator('[data-bi-headlines] h3').textContent(),/01\/10\/2026.*03\/10\/2026/);assert.match(await page.locator('.bi-monthly-chart tbody tr').textContent(),/2026-10/);assert.equal(await page.locator('.bi-monthly-chart tbody tr').count(),1);
  await page.locator('[data-bi-section=vendors]').click();assert.match(await page.locator('.bi-main').textContent(),/Período seleccionado/);assert.match(await headline(),/400/);await page.locator('[data-bi-section=sales]').click();
  await page.locator('[data-bi-preset=current]').click();assert.match(await headline(),/2\.300/);await page.locator('[data-bi-preset=month]').click();assert.equal(await page.locator('[name=from]').inputValue(),'2026-10-01');assert.equal(await page.locator('[name=to]').inputValue(),'2026-10-31');
  await page.locator('[data-bi-reset]').click();assert.equal(await page.locator('[name=from]').inputValue(),'2026-11-01');await page.locator('[name=brand]').selectOption('OXO');await page.locator('[data-bi-tab=products]').click();await page.locator('[data-bi-products] button').filter({hasText:'Ver clientes (2)'}).click();await page.locator('[data-bi-product-buyers] [data-bi-client="2"]').click();assert.equal(await page.locator('[name=client]').inputValue(),'2');assert.match(await headline(),/700/);assert.equal(await page.locator('[data-bi-tab=customers]').getAttribute('aria-pressed'),'true');
  await mount(true);assert.equal(await page.locator('[name=source],[data-bi-salesman],[data-bi-workbook]').count(),0);await page.locator('[data-bi-tab=products]').click();assert.doesNotMatch(await page.locator('.bi-main').textContent(),/Bob|Other seller/);await page.locator('[data-bi-products] button').filter({hasText:'Ver clientes (1)'}).first().click();assert.doesNotMatch(await page.locator('[data-bi-product-buyers]').textContent(),/Bob|Other seller/);assert.match(await headline(),/500|1\.100/);

  const exportCatalog=[
   ...Array.from({length:101},(_,i)=>({sku:String(i).padStart(5,'0'),name:'Export product '+i,section:'OXO'})),
   {sku:'32480',name:'Historical spinner',section:'OXO'},
   {sku:'3041',name:'Duplicate price code',section:'OXO'},
   {sku:'excluded',name:'Filtered brand',section:'Other'},
  ];
  const exportOrder={...input.orders[0],items:exportCatalog.map((p,i)=>({id:'item'+i,sku:p.sku,name:p.name,qty:1,lineTotal:200-i}))};
  await mount(false,{...input,catalog:exportCatalog,orders:[exportOrder]});
  await page.addScriptTag({url:localXlsx?'/xlsx.full.min.js':'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'});
  await page.evaluate(()=>{
   window.CATALOG_SUPABASE={loadDashboardExportPrices:async()=>({
    '00000':{listPrice:12.5,suggestedPrice:20},'11230400':{listPrice:46454,suggestedPrice:102200},'3041':{ambiguous:true},
   })};
  });
  await page.locator('[name=brand]').selectOption('OXO');
  await page.locator('[data-bi-tab=products]').click();
  assert.equal(await page.locator('[data-bi-products] tbody tr').count(),100);
  await page.locator('[data-bi-chart=dimension]').selectOption('units');
  const downloadEvent=page.waitForEvent('download');
  await page.locator('[data-bi-workbook]').click();
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'lexo-dashboard-2026-11-01-2026-11-03.xlsx');
  const sheets=await page.evaluate(encoded=>{
   const workbook=XLSX.read(encoded,{type:'base64',cellNF:true});
   return Object.fromEntries(workbook.SheetNames.map(name=>[name,XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:null})]));
  },fs.readFileSync(await download.path()).toString('base64'));
  const ranked=sheets.Productos.slice(1);
  assert.equal(ranked.length,103,'exports all matching products across pages');
  assert.equal(ranked[0][1],'00000','leading zeroes survive the download');
  assert.deepEqual(ranked[0].slice(9),['00000',12.5,20,'SKU exacto']);
  assert.deepEqual(ranked.find(r=>r[1]==='32480').slice(9),['11230400',46454,102200,'Sustituto']);
  assert.deepEqual(ranked.find(r=>r[1]==='3041').slice(9),['3041',null,null,'SKU con precios distintos']);
  assert.deepEqual(await page.evaluate(()=>{
   const prices={'3041':{ambiguous:true,byBrand:{Leifheit:{listPrice:30,suggestedPrice:40}}},'11181400':{listPrice:10,suggestedPrice:20},'11168300':{listPrice:12,suggestedPrice:24}};
   return [SALES_BI_EXPORT.priceColumns('3041','Leifheit',prices),SALES_BI_EXPORT.priceColumns('11181400','OXO',prices)];
  }),[['3041',30,40,'SKU exacto por marca'],['11181400',10,20,'SKU exacto']]);
  assert.equal(sheets['Compradores por producto'].length,104);
  assert.equal(sheets['Pedidos y entregas'].length,104);
  assert.equal(sheets.Resumen.find(r=>r[0]==='Dimensión del gráfico')[1],'Unidades');
  assert.equal(sheets['Indicadores'].find(r=>r[0]==='Pedido'&&r[1]==='Selección')[5],103);
  assert.equal(sheets['Tendencia mensual'][1][0],'2026-11');
  assert.deepEqual(errors,[]);console.log('Product browser: shared filters, buyer drilldown, privacy, mobile layout and filtered Excel download with 103 ranked products and numeric prices passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
