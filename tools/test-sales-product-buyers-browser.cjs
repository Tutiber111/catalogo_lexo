const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {input}=require('./test-sales-product-buyers.cjs');
const invoiceInput={...input,delivery:{...input.delivery,invoiceFacts:{available:true,lines:[
 {id:'paid-a',documentId:'inv1',orderId:'wh1',catalogOrderId:'a',fromCatalog:true,clientCode:'1',sku:'A',name:'Product A',qty:1,net:100,invoiceDate:'2026-11-02T14:00:00Z'},
 {id:'paid-extra',documentId:'inv2',orderId:'wh2',catalogOrderId:'extra',fromCatalog:true,clientCode:'1',sku:'A',name:'Product A',qty:3,net:300,invoiceDate:'2026-11-03T14:00:00Z'},
 {id:'paid-direct',documentId:'inv3',orderId:'wh3',fromCatalog:false,clientCode:'1',sku:'A',name:'Product A',qty:1,net:80,invoiceDate:'2026-11-03T15:00:00Z'},
]}}};
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
  page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-03T15:00:00Z']));}static now(){return new RealDate('2026-11-03T15:00:00Z').getTime();}};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const mount=async(simple=false,fixture=invoiceInput)=>page.evaluate(({input,simple})=>{const scoped=simple?{...input,analysisSalesmanCode:'855'}:input;SALES_BI.mount(document.querySelector('#dashboard'),{...scoped,owner:simple?'seller':'admin',admin:!simple,simple,live:true,available:true,updatedAt:'2026-11-03T15:00:00Z',salesmanCode:simple?'855':'*',salesmen:[{code:'*',name:'Todos'},{code:'855',name:'Romina'},{code:'800',name:'Other seller'}],companyBestsellers:[],onSalesman(){},onRefresh(){}});},{input:fixture,simple});
  const dates=async(from,to)=>page.evaluate(({from,to})=>{const form=document.querySelector('[data-bi-filters]');form.elements.from.value=from;form.elements.to.value=to;form.elements.to.dispatchEvent(new Event('change',{bubbles:true}));},{from,to});
  const headline=()=>page.locator('.bi-ordered-headlines article strong').first().textContent();
  await mount(false,input);
  // Invoice totals and deliveries by order date use separate sources.
  assert.match(await page.locator('[data-bi-invoice-notice]').textContent(),/no está disponible/);
  assert.match(await page.locator('[data-bi-headlines] h4').last().textContent(),/Facturado · por fecha de factura/);
  assert.equal(await page.locator('.bi-delivered-headlines article strong').first().textContent(),'Sin datos');
  assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'invoiceDate');
  await page.locator('[data-bi-chart=metric]').selectOption('delivered');
  assert.match(await page.locator('[data-bi-table=trend] tbody tr[data-context=false]').first().textContent(),/400/);
  await page.locator('[data-bi-chart=metric]').selectOption('invoiceDate');
  await page.locator('[data-bi-chart=dimension]').selectOption('units');
  const estimateInput={...invoiceInput,catalog:input.catalog.map(p=>p.sku==='A'?{...p,price:'$100'}:p),
    delivery:{...invoiceInput.delivery,invoiceFacts:{available:true,estimated:true,lines:invoiceInput.delivery.invoiceFacts.lines.map(line=>line.fromCatalog?line:{...line,net:null})}}};
  await mount(false,estimateInput);
  assert.match(await page.locator('[data-bi-invoice-notice]').textContent(),/Estimación por fecha de factura/);
  assert.match(await page.locator('[data-bi-headlines] h4').last().textContent(),/Facturado estimado/);
  assert.match(await page.locator('.bi-delivered-headlines article strong').first().textContent(),/500.*estimado/);
  assert.match(await page.locator('[data-bi-chart=metric] option:checked').textContent(),/Facturado estimado/);
  await mount();
  assert.equal(await page.locator('[data-bi-invoice-notice]').count(),0);
  assert.match(await page.locator('.bi-delivered-headlines article strong').first().textContent(),/480/);
  assert.match(await page.locator('.bi-invoice-extra').textContent(),/Con IVA \(21%\).*581.*Kitchen Spot/);
  assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'invoiceDate');
  assert.equal(await page.locator('[data-bi-chart=dimension]').inputValue(),'units','refresh keeps the chosen chart dimension');
  await mount();assert.equal(await page.locator('[name=from]').inputValue(),'2026-11-01');assert.equal(await page.locator('[name=to]').inputValue(),'2026-11-03');assert.match(await headline(),/2\.300/);
  assert.equal(await page.locator('[data-bi-chart=from],[data-bi-chart=to]').count(),0,'chart cannot override global dates');
  await page.locator('[data-bi-chart=dimension]').selectOption('units');assert.equal(await page.locator('[data-bi-chart=dimension]').inputValue(),'units');assert.equal(await page.locator('[data-bi-chart-error]').textContent(),'');
  await page.locator('[data-bi-chart=metric]').selectOption('ordered');assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'ordered');await page.locator('[data-bi-chart=metric]').selectOption('invoiceDate');
  assert.match(await page.locator('.bi-monthly-chart h3').textContent(),/^Tendencia diaria/);
  assert.equal(await page.locator('[data-bi-table=trend] tbody tr[data-context=false]').count(),3,'default chart shows one point per selected day');
  assert.equal(await page.locator('[data-bi-table=trend] tbody tr[data-context=true]').count(),5);
  const canvas=page.locator('[data-bi-canvas]');
  await canvas.focus();await canvas.press('Home');
  assert.equal(await canvas.getAttribute('data-active-date'),'2026-10-27');
  assert.match(await page.locator('[data-bi-chart-readout]').textContent(),/Contexto anterior/);
  await canvas.press('End');
  assert.equal(await canvas.getAttribute('data-active-date'),'2026-11-03');
  const tooltip=JSON.parse(await canvas.getAttribute('data-tooltip-bounds'));
  assert.ok(tooltip.y+tooltip.height<tooltip.pointY,'daily tooltip sits above the active point');
  const hoverDate=async fraction=>canvas.evaluate((el,fraction)=>{
    const rect=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+rect.width*fraction}));
    return el.dataset.activeDate;
  },fraction);
  assert.equal(await hoverDate(0.88),'2026-11-03','pointer tracks the last daily point');
  await page.locator('[data-bi-tab=products]').click();assert.equal(await page.locator('[data-bi-products] tbody tr').count(),2);
  await page.locator('[data-bi-products] button').filter({hasText:'Ver clientes (2)'}).click();
  assert.equal(await page.locator('[data-bi-product-buyers] tbody tr').count(),2);assert.match(await headline(),/1\.200/,'product selection updates global KPIs');
  assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Alice/);assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Bob/);assert.doesNotMatch(await page.locator('[data-bi-product-buyers]').textContent(),/A-1/);
  await page.locator('[name=metric]').selectOption('invoiceDate');assert.equal(await page.locator('[data-bi-product-buyers] tbody tr').count(),1);assert.match(await page.locator('[data-bi-product-buyers] tbody').textContent(),/480/);assert.doesNotMatch(await page.locator('[data-bi-product-buyers] tbody').textContent(),/Bob/);
  assert.equal(await page.locator('[data-bi-chart=metric]').inputValue(),'invoiceDate');
  await page.screenshot({path:'tmp/sales-dashboard/product-buyers-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.sales-bi').evaluate(el=>el.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'tmp/sales-dashboard/product-buyers-mobile.png',fullPage:true});await page.setViewportSize({width:1500,height:1080});
  await page.locator('[data-bi-tab=orders]').click();
  assert.match(await page.locator('[data-bi-table=invoice-lines]').textContent(),/02\/11\/2026.*03\/11\/2026|03\/11\/2026.*02\/11\/2026/);
  await page.locator('[data-bi-tab=deliveries]').click();
  assert.match(await page.locator('[data-bi-table=delivery-lines] thead').textContent(),/Facturado con stock.*Sin stock.*Sin marcar/);
  await page.locator('[data-bi-tab=products]').click();
  await page.locator('[data-bi-clear-product]').click();await page.locator('[name=metric]').selectOption('ordered');
  await dates('2026-08-30','2026-11-03');
  assert.match(await page.locator('.bi-monthly-chart h3').textContent(),/^Tendencia semanal/);
  assert.match(await page.locator('[data-bi-table=trend] tbody tr').last().textContent(),/02\/11\/2026 — 03\/11\/2026/);
  assert.equal(await hoverDate(0.95),'2026-11-02','pointer tracks the clipped final week');
  await dates('2026-10-01','2026-10-03');assert.match(await headline(),/400/);assert.match(await page.locator('[data-bi-headlines] h3').textContent(),/01\/10\/2026.*03\/10\/2026/);
  assert.match(await page.locator('.bi-monthly-chart h3').textContent(),/^Tendencia diaria/);
  assert.equal(await page.locator('[data-bi-table=trend] tbody tr[data-context=false]').count(),3);
  assert.match(await page.locator('[data-bi-table=trend] tbody tr[data-context=true]').first().textContent(),/26\/09\/2026/);
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
  const invoiceExport={available:true,lines:[{...invoiceInput.delivery.invoiceFacts.lines[2],sku:'00000',name:'Export product 0'}]};
  await mount(false,{...invoiceInput,catalog:exportCatalog,orders:[exportOrder],delivery:{...invoiceInput.delivery,invoiceFacts:invoiceExport}});
  await page.addScriptTag({url:localXlsx?'/xlsx.full.min.js':'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'});
  await page.evaluate(()=>{
   window.CATALOG_SUPABASE={loadDashboardExportPrices:async()=>({
    '00000':{listPrice:12.5,suggestedPrice:20},'11230400':{listPrice:46454,suggestedPrice:102200},'3041':{ambiguous:true},
   })};
  });
  await page.locator('[name=brand]').selectOption('OXO');
  assert.match(await page.locator('.bi-brand-share .bi-bar strong').textContent(),/100%/,'brand share uses the filtered sales total');
  await page.locator('[data-bi-tab=products]').click();
  assert.equal(await page.locator('[data-bi-products] tbody tr').count(),100);
  const amountHeader=page.locator('[data-bi-products] th').filter({hasText:'Importe'});
  await amountHeader.locator('[data-bi-sort]').click();
  assert.equal(await amountHeader.getAttribute('aria-sort'),'ascending');
  assert.equal(await page.locator('[data-bi-products] tbody tr').first().locator('td').nth(2).textContent(),'3041','sort uses rows beyond the first page');
  await amountHeader.locator('[data-bi-sort]').click();
  assert.equal(await amountHeader.getAttribute('aria-sort'),'descending');
  assert.equal(await page.locator('[data-bi-products] tbody tr').first().locator('td').nth(2).textContent(),'00000');
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
  assert.equal(sheets.Marcas[1][2],1,'workbook includes the numeric participation fraction');
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
  assert.equal(sheets.Facturación[1][0],'2026-11-03','export uses the invoice date for a direct order');
  assert.equal(sheets.Facturación[1][10],80,'export includes the saved invoiced net value');
  assert.equal(sheets.Resumen.find(r=>r[0]==='Dimensión del gráfico')[1],'Unidades');
  assert.equal(sheets['Indicadores'].find(r=>r[0]==='Pedido'&&r[1]==='Selección')[5],103);
  assert.deepEqual(sheets.Tendencia[1].slice(0,3),['2026-10-27','2026-10-27','Contexto anterior']);
  assert.deepEqual(sheets.Tendencia.at(-1).slice(0,3),['2026-11-03','2026-11-03','Selección']);
  assert.deepEqual(errors,[]);console.log('Product browser: shared filters, buyer drilldown, privacy, mobile layout and filtered Excel download with 103 ranked products and numeric prices passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
