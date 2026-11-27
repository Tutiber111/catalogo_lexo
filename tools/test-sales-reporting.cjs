const assert=require('node:assert/strict');
const m=require('../web/sales-bi-model.js');
assert.deepEqual(m.reportingPeriods('2024-03-31').month,{from:'2024-02-01',to:'2024-02-29'});
assert.equal(m.monthShift('2024-02-29',-12),'2023-02-28');
const clients=[{id:'c',clientCode:'1',name:'Client',salesmanCode:'v'},{id:'b',clientCode:'2',name:'New',salesmanCode:'v'}];
const order=(id,date,code='1',qty=10)=>({id,createdAt:date+'T14:00:00Z',status:'placed',customer:{clientCode:code},items:[{id:id+'i',sku:'A',name:'A',qty,lineTotal:qty*100}]});
// WarehousePick copies of the catalog orders: WarehousePick is the order book after the handover.
const wh=(id,day,code,delivered,noStock)=>({id:'w'+id,number:id,createdAt:day+'T14:00:00Z',clientCode:code,externalId:id,source:'catalogolexo',items:[{id:id+'w',sku:'A',name:'A',qty:10,orderedNet:1000,deliveredQty:delivered,outOfStockQty:noStock,pendingQty:delivered===null?null:10-delivered-noStock,confirmed:delivered===null?null:10-delivered-noStock===0,deliveredNet:delivered===null?null:delivered*100}]});
const data=m.prepare({clients,catalog:[{sku:'A',name:'A',section:'OXO'},{sku:'B',name:'B',section:'OXO'}],batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[{line_key:'h',order_key:'h',order_date:'2025-10-01',client_code:'1',sku:'A',ordered_qty:10,invoiced_qty:6,ordered_net:1000,invoiced_net:600,returned_qty:0}],orders:[order('o1','2026-10-16'),order('o2','2026-10-18'),order('o3','2026-10-20'),order('o4','2026-10-23','2')],delivery:{available:true,orders:[wh('o1','2026-10-16','1',5,0),wh('o2','2026-10-18','1',0,10),wh('o3','2026-10-20','1',null,null),wh('o4','2026-10-23','2',null,null),{id:'manual',clientCode:'1',createdAt:'2026-10-22',items:[{id:'m',sku:'A',qty:5,orderedNet:null,deliveredQty:4,pickedQty:4,pendingQty:1,confirmed:true,outOfStockQty:0}]}],lines:[{orderId:'o1',itemId:'o1i',pickedQty:5,deliveredQty:5,pendingQty:5,confirmed:true,outOfStockQty:0},{orderId:'o2',itemId:'o2i',pickedQty:0,deliveredQty:0,pendingQty:10,confirmed:false,outOfStockQty:10,lineStatus:'nostock'}]}});
const f={source:'history-warehouse',from:'2026-10-01',to:'2026-10-23',metric:'ordered'};
assert.equal(m.sourceRows(data,f.source).filter(r=>r.source==='warehouse').length,5,'main is every WarehousePick order, catalog-sent and direct');
assert.equal(m.sourceRows(data,f.source).filter(r=>r.source==='catalog').length,0,'catalog copies never add to WarehousePick');
assert.equal(m.sourceRows(data,'catalog').some(r=>r.source==='warehouse'),false,'catalog-only view is preserved');
assert.equal(data.records.find(r=>r.orderId==='web:o2').occasionId,'web:o1');
assert.equal(data.records.find(r=>r.orderId==='web:o3').occasionId,'web:o3','no rolling chain');
const report=m.reporting(data,f,'2026-10-23');
assert.equal(report.metrics.ordered.current.amount,4500,'the manual order without price takes the last Excel price of its SKU');assert.equal(report.metrics.ordered.current.orders,3,'direct order joins the existing two-day occasion');
assert.equal(report.metrics.ordered.current.units,45);
assert.equal(report.metrics.ordered.current.missing,0);
assert.equal(report.metrics.ordered.current.ticket,1500,'4.500 over 3 grouped purchases');
const directOnly=m.measureRows(m.sourceRows(data,f.source).filter(r=>r.directWarehouse));
assert.equal(directOnly.units,5);
assert.equal(directOnly.pricedLines,1);assert.equal(m.sourceRows(data,f.source).find(r=>r.directWarehouse).priceSource,'history');
assert.equal(m.sourceRows(data,f.source).find(r=>r.directWarehouse).occasionId,'wh:wo3','main groups catalog-sent and direct orders for the same client');
assert.equal(m.sourceRows(data,'warehouse').find(r=>r.directWarehouse).occasionId,'wh:wo3','WarehousePick view groups the same way');
const directOrder=(id,date,options={})=>({id,createdAt:date+'T14:00:00Z',clientCode:'1',items:[{id:'i',sku:'A',qty:3}],...options});
const overlap=m.prepare({clients,orders:[order('a','2026-10-16')],batches:data.batches,
  delivery:{available:true,orders:[
    directOrder('before','2026-10-15'),
    directOrder('linked','2026-10-16',{source:'catalogolexo',externalId:'a'}),
    directOrder('orphan','2026-10-16',{source:'catalogolexo'}),
    directOrder('valid','2026-10-16',{source:'manual'}),
  ]}});
assert.deepEqual(m.sourceRows(overlap,f.source).map(r=>r.orderId),['wh:linked','wh:orphan','wh:valid'],'after cutover every WarehousePick order counts once, catalog copy excluded');
const notSent=m.prepare({clients,orders:[order('a','2026-10-16'),order('waiting','2026-10-17')],batches:data.batches,delivery:{available:true,orders:[directOrder('linked','2026-10-16',{source:'catalogolexo',externalId:'a'})]}});
assert.deepEqual(m.sourceRows(notSent,f.source).map(r=>r.orderId).sort(),['wh:linked'],'only WarehousePick orders count while WarehousePick is readable');
const offline=m.prepare({clients,orders:[order('a','2026-10-16')],batches:data.batches,delivery:{available:false,orders:[]}});
assert.deepEqual(m.sourceRows(offline,f.source).map(r=>r.orderId),['web:a'],'catalog orders stay visible when WarehousePick is unavailable');
assert.equal(report.metrics.delivered.current.amount,900);assert.equal(report.metrics.delivered.current.units,9);assert.equal(report.metrics.delivered.current.orders,2);assert.equal(report.metrics.delivered.current.clients,1);
assert.equal(report.metrics.delivered.year.amount,600,'historical invoiced is delivered');
assert.equal(report.metrics.ordered.changes.amount.year.delta,3500);
assert.equal(m.reporting(data,{...f,from:'2025-01-01',to:'2025-02-01'},'2026-10-23').metrics.ordered.current.amount,0,'headlines follow the selected date filter');
assert.equal(report.customers.find(c=>c.client.clientCode==='2').situation,'insufficient');
assert.equal(report.customers.find(c=>c.client.clientCode==='1').situation,'action');
assert.equal(report.customers.find(c=>c.client.clientCode==='1').reactivated,true);
assert.equal(report.vendors[0].current.amount,4500);
assert.equal(m.stockLoss(data,f).amount,1000,'only explicit stock flag valued at original price');
assert.equal(m.stockLoss(data,f).unknown,2,'unlinked fulfillment remains unknown');
assert.equal(m.monthlyReport(data,{...f,...report.periods.annual}).length,12);
const boundary=m.prepare({clients,orders:[order('a','2026-01-31'),order('b','2026-02-02')],batches:[]});
assert.equal(m.measureRows(m.selected(boundary,{source:'catalog',from:'2026-01-01',to:'2026-01-31'})).amount,2000,'all additions attributed to first date across month boundary');
assert.equal(m.measureRows(m.selected(boundary,{source:'catalog',from:'2026-02-01',to:'2026-02-28'})).orders,0);
const opp=m.opportunityReport(data,{...f,brand:'OXO'},'2026-10-23');
assert.equal(opp.find(c=>c.client.clientCode==='1').notBuyingTarget,false);
const noHistory=m.prepare({clients,orders:[order('live','2026-10-20')],batches:[],lines:[],delivery:{available:false,lines:[]}});
const withoutHistory=m.reporting(noHistory,f,'2026-10-23');
assert.equal(withoutHistory.metrics.ordered.current.amount,1000,'available current catalog values survive missing history');
assert.equal(withoutHistory.metrics.ordered.current.partial,true,'missing primary history cannot masquerade as full coverage');
assert.equal(withoutHistory.metrics.ordered.yearCovered,false);
const catalogAfterCutover=m.prepare({clients,updatedAt:'2026-11-02T14:00:00Z',orders:[order('live','2026-11-01')],batches:[{from_date:'2024-09-02',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}]});
catalogAfterCutover.coverage.from=null;
assert.equal(m.reporting(catalogAfterCutover,{...f,from:'2026-11-01',to:'2026-11-02'},'2026-11-02').metrics.ordered.currentCovered,true,'post-cutover catalog month does not require unrelated ERP coverage');
console.log('Calendar clamps, selected-period comparisons, catalog baseline, historical delivery, any-delivery counts, anchored additions, month boundaries, client frequency/cohorts, vendor totals and explicit stock losses passed.');

const ticketData=m.prepare({clients,batches:data.batches,lines:[{line_key:'jan',order_key:'jan',order_date:'2026-01-05',client_code:'1',sku:'A',ordered_qty:90,ordered_net:9000,invoiced_qty:90,invoiced_net:9000}],orders:[order('oct1','2026-10-16'),order('oct2','2026-10-20')]});
const tickets=m.reporting(ticketData,f,'2026-10-23').metrics.ordered;
assert.equal(tickets.current.ticket,1000);
assert.equal(tickets.ytd.ticket,11000/3,'year average is value divided by occasions, not average of monthly averages');
assert.equal(tickets.ytdCovered,true);
assert.deepEqual(m.reportingPeriods('2026-10-23').ytd,{from:'2026-01-01',to:'2026-10-23'});
assert.equal(withoutHistory.metrics.ordered.ytdCovered,false,'missing history cannot supply a valid year-average comparison');

const portfolios={clients:[{id:'ale',clientCode:'81032',salesmanCode:'810',name:'Alejandro'},{id:'diana',clientCode:'d',salesmanCode:'810'},{id:'direct',clientCode:'a',salesmanCode:'90'},{id:'adrian',clientCode:'b',salesmanCode:'900'},{id:'none',clientCode:'c',salesmanCode:''}],includeUnassigned:true,orders:[order('ale','2026-10-20','81032'),order('d','2026-10-20','d'),order('a','2026-10-20','a'),order('b','2026-10-20','b'),order('c','2026-10-20','c'),order('orphan','2026-10-20','unknown')],batches:data.batches};
const allPortfolios=m.prepare(portfolios),adrian=m.prepare({...portfolios,analysisSalesmanCode:'900'}),diana=m.prepare({...portfolios,analysisSalesmanCode:'810'});
assert.equal(adrian.clients.length,3,'an order with an unknown client code is unassigned, not Adrian');
assert.equal(diana.clients.length,1);
assert.equal(diana.clients[0].clientCode,'d');
assert.equal(m.measureRows(m.sourceRows(adrian,'history-warehouse')).amount,3000);
assert.equal(m.measureRows(m.sourceRows(diana,'history-warehouse')).amount,1000);
assert.equal(m.measureRows(m.sourceRows(allPortfolios,'history-warehouse')).amount,6000,'portfolio overrides preserve company totals');
assert.equal(portfolios.clients[0].salesmanCode,'810','operational assignments remain unchanged');
assert.equal(m.reporting(allPortfolios,f,'2026-10-23').vendors.find(v=>v.code==='900').current.amount,3000);assert.equal(m.reporting(allPortfolios,f,'2026-10-23').vendors.find(v=>v.code==='unassigned').current.amount,2000,'Alejandro (81032) and the unknown client');

assert.equal(m.reporting(allPortfolios,f,'2026-10-23').vendors.find(v=>v.code==='unassigned').current.amount,2000,'Alejandro (81032) and the unknown client');
assert.deepEqual(m.prepare({...portfolios,analysisSalesmanCode:'unassigned'}).clients.map(c=>c.clientCode),['81032','unassigned:unknown']);
assert.equal(m.analysisSalesman({clientCode:'81032',salesmanCode:'805'}),'805','a new explicit assignment takes effect');

assert.equal(report.metrics.ordered.changes.units.year.delta,35);
assert.equal(report.metrics.ordered.changes.units.year.percent,3.5);

const invoiceFacts={available:true,undated:0,lines:[
  {id:'root',documentId:'doc',orderId:'root',catalogOrderId:'oct',fromCatalog:true,sku:'A',clientCode:'1',qty:4,net:310,invoiceDate:'2026-11-01T13:00:00Z'},
  {id:'remainder',documentId:'doc-f',orderId:'root',catalogOrderId:'oct',fromCatalog:true,sku:'A',clientCode:'1',qty:2,net:150,invoiceDate:'2026-11-04T12:00:00Z'},
  {id:'direct-sales',orderId:'direct-order',fromCatalog:false,sku:'A',clientCode:'2',qty:3,net:270,invoiceDate:'2026-11-02T12:00:00Z'},
  {id:'unpriced',orderId:'direct-order',fromCatalog:false,sku:'B',clientCode:'2',qty:1,net:null,invoiceDate:'2026-11-02T12:00:00Z'},
  {id:'utc-boundary',orderId:'earlier',fromCatalog:false,sku:'A',clientCode:'2',qty:1,net:65,invoiceDate:'2026-11-01T02:00:00Z'},
  {id:'without-date',orderId:'unknown-date',sku:'A',clientCode:'2',qty:1,net:90,invoiceDate:null},
]};
const invoiceData=m.prepare({clients,batches:data.batches,lines:[{line_key:'h',order_key:'h',order_date:'2025-11-01',client_code:'1',sku:'A',ordered_qty:3,invoiced_qty:3,ordered_net:300,invoiced_net:300}],
  orders:[order('oct','2026-10-31')],delivery:{available:true,invoiceFacts}});
const nov={source:'history-warehouse',metric:'invoiceDate',from:'2026-11-01',to:'2026-11-27'};
const november=m.reporting(invoiceData,nov,'2026-11-27');
assert.equal(november.metrics.ordered.current.amount,0,'a November invoice does not move the October order');
assert.equal(november.metrics.invoiceDate.current.amount,730,'includes warehouse net for direct and split documents');
assert.equal(november.metrics.invoiceDate.current.units,10,'the unpriced direct line still contributes units');
assert.equal(november.metrics.invoiceDate.current.orders,2,'the split belongs to the original purchase');
assert.equal(november.metrics.invoiceDate.current.partial,true);
assert.equal(november.metrics.invoiceDate.yearCovered,true,'before the handover the Excel invoiced amounts are the comparison base');
assert.equal(m.monthlyReport(invoiceData,{...nov,from:'2026-10-01'})[0].amount,65,'invoice dates use Buenos Aires midnight');
assert.equal(m.productSales(invoiceData,{...nov,source:'catalog'}).find(p=>p.sku==='A').amount,460,'catalog view excludes direct invoices');
assert.equal(m.productSales(invoiceData,{...nov,client:'2'}).find(p=>p.sku==='A').amount,270,'direct invoices follow the client filter');
assert.equal(m.analyze(invoiceData,nov).brands[0].value,730);
assert.equal(m.productSales(invoiceData,{...nov,metric:'invoiced',from:'2025-11-01',to:'2025-11-27'})[0].amount,300,'legacy estimate remains accessible');
console.log('Invoice dates: month boundaries, catalog and direct amounts, split shipments, unknown prices and historical date coverage passed.');

const shortTrend=m.trendReport(invoiceData,{...nov,to:'2026-11-09'});
assert.equal(shortTrend.weekly,false);
assert.equal(shortTrend.rows.length,14);
assert.deepEqual(shortTrend.rows.filter(p=>p.context).map(p=>p.from),['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']);
assert.equal(shortTrend.rows[4].amount,65,'context includes the invoice dated October 31 in Buenos Aires');
assert.equal(shortTrend.rows.filter(p=>!p.context).reduce((sum,p)=>sum+p.amount,0),730);
assert.equal(m.trendReport(invoiceData,{...nov,to:'2026-11-10'}).rows.some(p=>p.context),false,'ten available daily values need no context');
assert.equal(m.trendReport(invoiceData,{...nov,to:'2026-12-31'}).weekly,false,'two complete months stay daily');
const weeklyTrend=m.trendReport(invoiceData,{...nov,to:'2027-01-10'});
assert.equal(weeklyTrend.weekly,true);
assert.deepEqual(weeklyTrend.rows.slice(0,2).map(p=>[p.from,p.to,p.amount]),[
  ['2026-11-01','2026-11-01',310],
  ['2026-11-02','2026-11-08',420],
]);
const clippedTrend=m.trendReport(invoiceData,{...nov,from:'2026-11-02',to:'2027-01-02'});
assert.equal(clippedTrend.rows.filter(p=>p.context).length,5,'nine weekly points also get five daily context points');
assert.deepEqual([clippedTrend.rows.at(-1).from,clippedTrend.rows.at(-1).to],['2026-12-28','2027-01-02']);
const midMonth=m.trendReport(invoiceData,{...nov,from:'2026-11-15',to:'2026-11-16'}).rows;
assert.deepEqual([midMonth[4].to,midMonth[5].from],['2026-10-31','2026-11-15'],'context always comes from the prior calendar month');
console.log('Daily and weekly trend boundaries, fallback days and selected-period invoice totals passed.');

// Ordered versus invoiced: invoiced is what WarehousePick marked with stock.
{
  const gapClients=[{id:'a',clientCode:'1',name:'Kitchen Store',salesmanCode:'855'},{id:'b',clientCode:'2',name:'Casa Bazar',salesmanCode:'800'}];
  const gapOrder=(id,day,items)=>({id,createdAt:day+'T14:00:00Z',status:'placed',customer:{clientCode:'1'},items});
  const gapData=m.prepare({clients:gapClients,batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[],
    orders:[gapOrder('sent','2026-11-02',[{id:'s1',sku:'A',name:'A',qty:10,lineTotal:1000}]),gapOrder('waiting','2026-11-03',[{id:'w1',sku:'B',name:'B',qty:2,lineTotal:300}])],
    delivery:{available:true,orders:[
      {id:'wh-sent',createdAt:'2026-11-02T14:00:00Z',clientCode:'1',clientId:'a',externalId:'sent',source:'catalogolexo',
        items:[{id:'l1',sku:'A',qty:10,deliveredQty:7,outOfStockQty:2,pendingQty:1,confirmed:false,orderedNet:1000,deliveredNet:700}]},
      {id:'wh-manual',createdAt:'2026-11-03T14:00:00Z',clientCode:'2',source:'manual',direct:true,
        items:[{id:'l3',sku:'B',qty:6,deliveredQty:3,outOfStockQty:3,pendingQty:0,confirmed:true,orderedNet:900,deliveredNet:450},
          {id:'l4',sku:'C',qty:2,deliveredQty:0,outOfStockQty:0,pendingQty:2,confirmed:false,orderedNet:null,deliveredNet:null}]}]}});
  const gf={source:'history-warehouse',metric:'ordered',from:'2026-11-01',to:'2026-11-03'};
  const gap=m.orderedVersusInvoiced(gapData,gf);
  assert.equal(gap.orders,2,'only WarehousePick orders; the catalog order not in the warehouse is left out');
  assert.equal(gap.manualOrders,1);
  assert.deepEqual([gap.orderedQty,gap.invoicedQty,gap.noStockQty,gap.pendingQty,gap.unknownQty,gap.differenceQty],[18,10,5,3,0,8]);
  assert.deepEqual([gap.ordered,gap.invoiced,gap.noStock,gap.pending,gap.unknown,gap.difference],[1900,1150,650,100,0,750]);
  assert.equal(gap.missingPrices,1,'unpriced manual line keeps units but no amount');
  const gapReport=m.reporting(gapData,gf,'2026-11-03');
  assert.equal(gapReport.metrics.delivered.current.units,10);assert.equal(gapReport.metrics.delivered.current.amount,1150);
  console.log('Ordered versus invoiced: all WarehousePick orders, with-stock invoicing, sin stock / sin marcar split and unsent catalog orders passed.');
}

// Prices and Kitchen Spot: hand-loaded lines use the catalog list price; KS sales are
// part of invoiced and can be shown apart.
{
  assert.equal(m.listPrice({price:'$13.057'}),13057);assert.equal(m.listPrice({price:'$1.234,50'}),1234.5);assert.equal(m.listPrice({price:''}),null);
  const ksData=m.prepare({clients:[{id:'a',clientCode:'1',name:'Client',salesmanCode:'855'}],catalog:[{sku:'M',name:'Mopa',section:'Leifheit',price:'$1.000'}],
    batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[],orders:[],includeUnassigned:true,
    delivery:{available:true,orders:[{id:'ks',number:'KS - 24/11',kitchenSpot:true,createdAt:'2026-11-23T14:00:00Z',items:[{id:'k1',sku:'M',qty:3,deliveredQty:2,outOfStockQty:1,pendingQty:0,orderedNet:null,deliveredNet:null}]},
      {id:'hand',number:'303',clientCode:'1',createdAt:'2026-11-02T14:00:00Z',items:[{id:'h1',sku:'M',qty:5,deliveredQty:5,outOfStockQty:0,pendingQty:0,orderedNet:null,deliveredNet:null}]}],
    invoiceFacts:{available:true,undated:2,lines:[{id:'k1',orderId:'ks',documentId:'ks',kitchenSpot:true,invoiceDate:'2026-11-24T12:00:00Z',sku:'M',qty:2,net:null},
      {id:'h1',orderId:'hand',documentId:'hand',clientCode:'1',invoiceDate:'2026-11-02T12:00:00Z',sku:'M',qty:5,net:5500}]}}});
  const kf={source:'history-warehouse',metric:'invoiceDate',from:'2026-11-01',to:'2026-11-27'};
  const ksReport=m.reporting(ksData,kf,'2026-11-27').metrics.invoiceDate.current;
  assert.equal(ksReport.amount,5500,'invoice totals use only saved net amounts');
  assert.equal(ksReport.partial,true,'missing invoice prices are marked partial');
  assert.equal(m.kitchenSpotSales(ksData,kf).units,2,'unpriced Kitchen Spot invoices still count in units');
  assert.equal(m.kitchenSpotSales(ksData,kf).missing,1);
  assert.equal(ksData.records.find(r=>r.id==='wh:ks:k1').clientName,'Kitchen Spot');
  assert.equal(ksData.records.find(r=>r.id==='wh:hand:h1').ordered,5000,'hand-loaded order valued at the catalog list price');
  console.log('List prices for hand-loaded orders, saved invoice prices, and Kitchen Spot classification passed.');
}

// Brand portfolio, salesperson/client profiles, product health and the two-line chart.
{
  const cat=[{sku:'A',name:'Tabla',section:'OXO',price:'$100'},{sku:'B',name:'Escurridor',section:'OXO',price:'$200'},{sku:'C',name:'Mopa',section:'Leifheit',price:'$300'},{sku:'D',name:'Balde',section:'Leifheit',price:'$50'},{sku:'H',name:'Oculto',section:'Leifheit',price:'$1',hidden:true}];
  const pc=[{id:'a',clientCode:'1',name:'Uno',salesmanCode:'855'},{id:'b',clientCode:'2',name:'Dos',salesmanCode:'800'}];
  const ord=(id,day,code,items)=>({id,createdAt:day+'T14:00:00Z',status:'placed',customer:{clientCode:code},items});
  const d=m.prepare({clients:pc,catalog:cat,batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],
    lines:[{line_key:'old',order_key:'old',order_date:'2026-06-01',client_code:'2',sku:'D',ordered_qty:4,invoiced_qty:4,ordered_net:200,invoiced_net:200}],
    orders:[ord('o1','2026-11-02','1',[{id:'i1',sku:'A',name:'Tabla',qty:10,lineTotal:1000}]),ord('o2','2026-11-03','2',[{id:'i2',sku:'C',name:'Mopa',qty:2,lineTotal:600}])],
    delivery:{available:true,orders:[
      {id:'w1',createdAt:'2026-11-02T14:00:00Z',clientCode:'1',clientId:'a',externalId:'o1',source:'catalogolexo',items:[{id:'l1',sku:'A',qty:10,deliveredQty:6,outOfStockQty:3,pendingQty:1,orderedNet:1000,deliveredNet:600}]},
      {id:'w2',createdAt:'2026-11-03T14:00:00Z',clientCode:'2',clientId:'b',externalId:'o2',source:'catalogolexo',items:[{id:'l2',sku:'C',qty:2,deliveredQty:2,outOfStockQty:0,pendingQty:0,orderedNet:600,deliveredNet:600}]}],
      invoiceFacts:{available:true,undated:0,lines:[{id:'l1',orderId:'w1',documentId:'w1',clientId:'a',clientCode:'1',invoiceDate:'2026-11-04T12:00:00Z',sku:'A',qty:6,net:600},
        {id:'l2',orderId:'w2',documentId:'w2',clientId:'b',clientCode:'2',invoiceDate:'2026-11-05T12:00:00Z',sku:'C',qty:2,net:600}]}}});
  const f={source:'history-warehouse',metric:'ordered',from:'2026-11-01',to:'2026-11-27'};
  const portfolio=m.brandPortfolio(d,f);
  assert.equal(portfolio.totalSkus,4,'hidden products are not part of the portfolio');
  const oxo=portfolio.rows.find(r=>r.brand==='OXO'),leif=portfolio.rows.find(r=>r.brand==='Leifheit');
  assert.deepEqual([oxo.skus,oxo.soldSkus,oxo.skuShare,oxo.invoicedShare,oxo.index],[2,1,0.5,0.5,1]);
  assert.equal(leif.invoiced.amount,600);assert.equal(portfolio.totalInvoiced,1200);
  const seller=m.scopeProfile(d,f,new Set(['1'])),company=m.scopeProfile(d,f);
  assert.deepEqual([seller.ordered.amount,seller.invoiced.amount,company.ordered.amount,company.invoiced.amount],[1000,600,1600,1200]);
  assert.equal(seller.noStockUnits,3);assert.equal(seller.noStockAmount,300);assert.equal(seller.clients,1);
  assert.equal(company.fillRate,1200/1600);
  const health=m.productHealth(d,f,'2026-11-27');
  assert.deepEqual(health.undelivered.map(p=>[p.sku,p.noStock,p.pending,p.noStockAmount]),[['A',3,1,300]]);
  assert.deepEqual(health.stopped.map(p=>p.sku),['D'],'sold in the previous 12 months, nothing this period');
  assert.deepEqual(health.never.map(p=>p.sku),['B']);
  const trend=m.trendComparison(d,f);
  assert.equal(trend.rows.length,trend.invoiced.length);
  assert.equal(trend.rows.reduce((s,p)=>s+(p.context?0:p.amount),0),1600);
  assert.equal(trend.invoiced.reduce((s,p)=>s+(p.context?0:p.amount),0),1200,'invoiced line dated by invoice');
  console.log('Brand portfolio share, salesperson/client profiles, product health and ordered-vs-invoiced trend passed.');
}

// Catalog orders re-typed by hand in WarehousePick, or added to another order of the same
// client, are counted once; only orders that never reached the warehouse stay on their own.
{
  const mc=[{id:'g',clientCode:'80576',name:'Ideas Obelisco',salesmanCode:'900'}];
  const co=(id,display,day,items)=>({id,displayId:display,createdAt:day+'T14:00:00Z',status:'placed',customer:{clientCode:'80576'},items});
  const md=m.prepare({clients:mc,batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[],
    orders:[co('c303','#303','2026-11-02',[{id:'a',sku:'A',qty:2,lineTotal:200},{id:'b',sku:'B',qty:1,lineTotal:50}]),
      co('c325','#325','2026-11-11',[{id:'x',sku:'X',qty:5,lineTotal:500}]),co('c326','#326','2026-11-12',[{id:'y',sku:'Y',qty:3,lineTotal:300}]),
      co('c310','#310','2026-11-03',[{id:'z',sku:'Z',qty:1,lineTotal:100}])],
    delivery:{available:true,orders:[
      {id:'w303',number:'303',createdAt:'2026-11-02T15:00:00Z',clientCode:'',source:'manual',items:[{id:'1',sku:'A',qty:2,deliveredQty:2,outOfStockQty:0,pendingQty:0,orderedNet:null},{id:'2',sku:'B',qty:1,deliveredQty:1,outOfStockQty:0,pendingQty:0,orderedNet:null}]},
      {id:'w4547',number:'4547',createdAt:'2026-11-11T15:00:00Z',clientCode:'80576',externalId:'c325',source:'catalogolexo',items:[{id:'3',sku:'X',qty:5,deliveredQty:5,outOfStockQty:0,pendingQty:0,orderedNet:500},{id:'4',sku:'Y',qty:3,deliveredQty:3,outOfStockQty:0,pendingQty:0,orderedNet:null}]}],
      invoiceFacts:{available:true,undated:0,lines:[{id:'1',orderId:'w303',documentId:'w303',clientCode:'',invoiceDate:'2026-11-02T18:00:00Z',sku:'A',qty:2,net:200}]}}});
  const mf={source:'history-warehouse',metric:'ordered',from:'2026-11-01',to:'2026-11-27'};
  assert.deepEqual([...new Set(m.sourceRows(md,mf.source).map(r=>r.orderId))].sort(),['wh:w303','wh:w4547'],'counting uses WarehousePick orders only');
  assert.equal(md.records.find(r=>r.orderId==='wh:w303').clientCode,'80576','the re-typed order takes the catalog client');
  assert.equal(md.records.find(r=>r.id==='invoice:1').clientCode,'80576');
  console.log('WarehousePick-only counting and client recovery for orders re-typed by hand passed.');
}

// An order from a catalog account without a client still belongs to the salesperson on the order,
// and the review suggests the master client with the same name.
{
  const sc=[{id:'m',clientCode:'81007',name:'MARECO SERGIO OSCAR',legalName:'MARECO SERGIO OSCAR',salesmanCode:'810'}];
  const sd=m.prepare({clients:sc,includeUnassigned:true,batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[],orders:[],
    delivery:{available:true,orders:[{id:'l11',number:'L-0011',createdAt:'2026-11-19T18:00:00Z',clientCode:'',clientName:'Sergio Oscar Mareco',salesmanCode:'810',externalId:'c345',source:'catalogolexo',
      items:[{id:'1',sku:'A',qty:10,deliveredQty:0,outOfStockQty:0,pendingQty:10,orderedNet:1000}]}],invoiceFacts:{available:true,undated:0,lines:[]}}});
  const sf={source:'history-warehouse',metric:'ordered',from:'2026-11-01',to:'2026-11-27'};
  assert.deepEqual([...new Set(m.sourceRows(sd,sf.source).map(r=>r.clientCode))],['81007'],'same words in any order: merged into the master client');
  assert.equal(m.dataQuality(sd,sf).merged[0].clientCode,'81007');assert.equal(m.dataQuality(sd,sf).noClient.length,0);
  const other=m.prepare({clients:sc,includeUnassigned:true,batches:[{from_date:'2024-01-01',to_date:'2026-10-15',warehouse_from_date:'2026-10-16'}],lines:[],orders:[],
    delivery:{available:true,orders:[{id:'x',number:'L-9',createdAt:'2026-11-19T18:00:00Z',clientCode:'',clientName:'Sergio Perez',salesmanCode:'810',source:'manual',items:[{id:'1',sku:'A',qty:1,deliveredQty:0,outOfStockQty:0,pendingQty:1,orderedNet:100}]}],invoiceFacts:{available:true,undated:0,lines:[]}}});
  assert.equal(other.clients.find(c=>c.name==='Sergio Perez').salesmanCode,'810','no name match: the salesperson on the order still counts');
  assert.equal(m.dataQuality(other,sf).noClient[0].salesmanCode,'810');
  console.log('Name-matched orders merge into their master client; others keep the salesperson on the order passed.');
}
