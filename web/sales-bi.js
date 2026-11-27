/* Linked BI workspace. Private data is held only in this signed-in session's memory. */
(function () {
  const m=window.SALES_BI_MODEL;
  let section='sales', vendorFocus=null, session=null, filters=null, owner='', tab='customers', customerQuery='', customerStatus='all', productTimer, rendering=false,chartFilters=null,report=null,chartScene=null,chartCleanup=null;
  let preparedVersion=null,preparedData=null;
  let opportunityTimer=null;
  let productPage=0;
  const calculations=new Map();
  const tableSorts=new Map();
  const collator=new Intl.Collator('es-AR',{numeric:true,sensitivity:'base'});
  let directoryQuery='', clientEditor=null;
  const calculationKey=(kind,parameters)=>kind+':'+m.recentRange(1).to+':'+JSON.stringify(parameters);
  function calculated(kind,parameters,run){const key=calculationKey(kind,parameters);if(calculations.has(key))return calculations.get(key);const value=run();if(calculations.size>=30)calculations.delete(calculations.keys().next().value);calculations.set(key,value);return value;}
  const safe=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>new Intl.NumberFormat('es-AR',{ maximumFractionDigits:1 }).format(v);
  const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(v);
  const compact=v=>new Intl.NumberFormat('es-AR',{notation:'compact',maximumFractionDigits:1}).format(v);
  const pct=v=>v===null ? 'Sin base comparable' : `${v>0?'+':''}${n(v*100)}%`;
  const date=v=>v ? v.split('-').reverse().join('/') : 'Sin registro';
  const deliveryMeasureName='Entregado · por fecha del pedido';
  const chartMeasureNames={ordered:'Pedido',invoiceDate:'Facturado',delivered:deliveryMeasureName,invoiced:'Facturación histórica estimada'};
  const chartChoices=[['both','Pedido y facturado'],['ordered','Pedido'],['invoiceDate','Facturado'],['delivered',deliveryMeasureName]];
  const trendPeriod=p=>p.from===p.to?date(p.from):`${date(p.from)} — ${date(p.to)}`;
  const sourceLabel=v=>({erp:'Historial Excel',warehouse:'WarehousePick',catalog:'Catálogo'})[v]||v;
  function monthSource(month) {
    if(session?.input.simple)return '';
    const h=session.data.handover;
    if(filters.source!=='history-warehouse'||!h)return '';
    if(month<h.warehouseFrom.slice(0,7))return 'Excel';
    if(month>h.warehouseFrom.slice(0,7)||h.warehouseFrom.endsWith('-01'))return 'WarehousePick';
    return `Excel hasta ${date(h.excelThrough)} · WarehousePick desde ${date(h.warehouseFrom)}`;
  }
  function handoverBanner() {
    const h=session.data.handover;
    if(!h)return '';
    return `<section class="bi-handover" data-bi-handover aria-label="Cambio de fuente de datos"><header><b>Historial Excel hasta ${date(h.excelThrough)} → pedidos de WarehousePick desde ${date(h.warehouseFrom)}</b></header></section>`;
  }
  const options=(items,value)=>items.map(([v,label])=>`<option value="${safe(v)}" ${v===value?'selected':''}>${safe(label)}</option>`).join('');
  function reset() { clearTimeout(productTimer); chartCleanup?.();chartCleanup=null;chartScene=null;session=null; filters=null; chartFilters=null; report=null; owner=''; section='sales'; tab='customers'; customerQuery=''; customerStatus='all';productPage=0;preparedVersion=null;preparedData=null;calculations.clear();tableSorts.clear();directoryQuery='';clientEditor?.close();clearTimeout(opportunityTimer); }
  function mount(panel,input) {
    if (owner!==input.owner) reset();
    if(input.simple){section='sales';if(['comparison','vendors','geography','deliveries'].includes(tab))tab='customers';}
    owner=input.owner;
    const active=panel.contains(document.activeElement)?document.activeElement:null;
    const typing=session&&active?.matches('[data-bi-filters] input')&&active.value!==filters?.[active.name];
    const focus=active?.name?`[name="${active.name}"]`:null;
    if(!input.dataVersion||preparedVersion!==input.dataVersion||!preparedData){preparedData=m.prepare(input);preparedVersion=input.dataVersion||null;calculations.clear();}
    session={ panel,input,data:preparedData };
    if (!filters) {
      const source=input.live?'history-warehouse':input.batches.length?'erp':'catalog';
      filters={...m.currentMonthRange(),source,metric:'ordered',compare:'year',brand:'',category:'',client:'',province:'',product:'',productKey:''};
    }
    if(typing) return;
    render(focus);
  }
  function select(name,label,items) {
    return `<label><span>${label}</span><select name="${name}">${options(items,filters[name])}</select></label>`;
  }
  const situationLabels={within:'Dentro de frecuencia',action:'Acción necesaria',overdue:'Fuera de frecuencia',insufficient:'Historial insuficiente'};
  function salesmanName(code) {
    if (code === '*') return 'Todos los vendedores';
    if (code === '900') return 'Adrian';
    if (code === 'multiple') return 'Varios vendedores';
    if (code === 'unassigned') return 'Sin asignación';
    return session.input.salesmen?.find(s => s.code === code)?.name || code || 'Sin asignación';
  }
  const amountLabel=v=>{
    if(v.unknown&&!v.orders)return 'Sin datos';
    if(v.missing&&v.pricedLines===0)return 'Sin importe';
    const quality=[v.estimated?'estimado':'',v.partial?'parcial':''].filter(Boolean).join(', ');
    return money(v.amount)+(quality?` (${quality})`:'');
  };
  const activeCodes=()=>new Set(report.customers.filter(c=>c.annual?.orders>0).map(c=>String(c.client.clientCode)));
  const actionable=list=>{const active=activeCodes();return list.filter(o=>active.has(String(o.client.clientCode))&&(o.missing.length||o.bestsellers.length));};
  function stockSummary() {
    const loss=m.stockLoss(session.data,filters);
    return `<section class="bi-card"><h3>Venta perdida por falta de stock · período seleccionado</h3><div class="bi-secondary-metrics"><span>Importe sin stock <b>${money(loss.amount)}${loss.missing||loss.unknown?' (parcial)':''}</b></span><span>Unidades sin stock <b>${n(loss.units)}</b></span><span>Pedidos afectados <b>${loss.orders}</b></span><span>Sobre importe pedido <b>${loss.rate===null?'No disponible':n(loss.rate*100)+'%'}</b></span></div><p class="bi-data-note">Solo productos marcados «sin stock» en WarehousePick, valorados al precio neto del pedido original. Las líneas sin marcar no se consideran venta perdida. No facturado en pedidos ya resueltos: ${money(loss.confirmedShortfall)}${loss.shortfallMissing?' (parcial)':''}; este importe puede incluir productos sin stock y no se suma al anterior. ${loss.unknown} líneas sin estado disponible; ${loss.missing} sin importe vinculable. El histórico Excel no identifica la causa: su importe no facturado estimado (${money(loss.uninvoiced)}) se muestra separado y no se atribuye a falta de stock.</p></section>`;
  }
  function comparisonBadge(change, key='amount') {
    if(change.delta===null)return '<small>Sin datos comparables</small>';
    const direction=change.delta>0?'up':change.delta<0?'down':'flat';
    const arrow={up:'↑',down:'↓',flat:'→'}[direction];
    const label={up:'Aumento',down:'Disminución',flat:'Sin cambio'}[direction];
    const amount=key==='amount'?money(change.delta):n(change.delta);
    return `<b class="bi-change bi-change--${direction}" aria-label="${label}: ${safe(amount)}; ${safe(pct(change.percent))}">${arrow} Δ ${change.delta>0?'+':''}${amount} · ${pct(change.percent)}</b>`;
  }
  function headlines() {
    const {data,input}=session;
    const estimated=data.invoiceAvailable&&data.invoiceEstimated;
    const invoiceStatus=filters.source==='erp'?'':estimated?'Estimación por fecha de factura con los precios disponibles.':!data.invoiceAvailable?(input.delivery?.reason==='loading'?'Cargando facturación…':'La facturación por fecha de factura no está disponible.'):'';
    const notice=invoiceStatus?`<p class="bi-notice" role="status" data-bi-invoice-notice>${invoiceStatus}</p>`:'';
    const measures=[['ordered','Pedido · por fecha del pedido','Unidades pedidas'],['invoiceDate',estimated?'Facturado estimado · por fecha de factura':'Facturado · por fecha de factura','Unidades facturadas']];
    const range=report.periods.current,ks=m.kitchenSpotSales(data,{...filters,...range,metric:'invoiceDate'}),invoiced=report.metrics.invoiceDate.current;
    const invoiceExtra=filters.source==='erp'||(!data.invoiceAvailable&&!invoiced.orders)?'':`<div class="bi-secondary-metrics bi-invoice-extra"><span>Con IVA (21%) <b>${amountLabel({...invoiced,amount:invoiced.amount*1.21})}</b></span><span>Incluye Kitchen Spot <b>${amountLabel(ks)}</b> · ${n(ks.units)} u. · ${n(ks.orders)} ${ks.orders===1?'pedido':'pedidos'}</span><span>Sin Kitchen Spot <b>${amountLabel({...invoiced,amount:invoiced.amount-ks.amount})}</b></span>${data.undatedInvoices?`<span>${n(data.undatedInvoices)} ${data.undatedInvoices===1?'pedido marcado con stock todavía sin facturar':'pedidos marcados con stock todavía sin facturar'}</span>`:''}</div>`;
    return `<section class="bi-headlines" data-bi-headlines><h3>Período seleccionado · ${date(report.periods.current.from)} — ${date(report.periods.current.to)}</h3><p class="bi-data-note">Indicadores del período seleccionado. Comparaciones con las mismas fechas del mes y año anteriores. Importes sin IVA. Pedidos agrupados por cliente dentro de 2 días desde la primera compra. Facturado: importes netos de comprobantes por fecha de factura; antes del 16/10, lo facturado según el Excel por fecha del pedido.</p>${measures.map(([metric,title,unitsLabel])=>{const v=report.metrics[metric];return `<h4>${title}</h4>${metric==='invoiceDate'?notice:''}<div class="bi-kpis bi-headline-grid ${metric==='ordered'?'bi-ordered-headlines':'bi-delivered-headlines'}">${[['amount','Importe'],['units',unitsLabel],['orders','Pedidos distintos'],['clients','Clientes distintos']].map(([key,label])=>`<article><span>${label}</span><strong>${!v.currentCovered&&!v.current.orders?'Sin datos':key==='amount'?amountLabel(v.current):(key==='units'&&v.current.unknown&&!v.current.orders?'Sin datos':n(v.current[key])+(!v.currentCovered||key==='units'&&v.current.partial?' (parcial)':''))}</strong>${[['month','Mes anterior'],['year','Mismo período año anterior']].map(([period,name])=>{const change=v.changes[key][period],covered=v[period+'Covered'];return `<small>${name} · ${date(report.periods[period].to)}<br>${covered?`${key==='amount'?amountLabel(v[period]):n(v[period][key])}${v.currentCovered&&change.delta!==null?comparisonBadge(change,key):' · comparación pendiente'}${v.current.partial||v[period].partial?' · datos parciales':''}`:'Sin historial comparable'}</small>`;}).join('')}${v.current.unknown?`<small>${v.current.unknown} líneas sin dato del depósito</small>`:''}</article>`).join('')}</div>${metric==='invoiceDate'?invoiceExtra:''}`;}).join('')}</section>`;
  }
  const pct1=v=>v===null||v===undefined||!Number.isFinite(v)?'—':n(v*100)+'%';
  const pp=(a,b)=>a===null||b===null||!Number.isFinite(a)||!Number.isFinite(b)?'—':`${a>=b?'+':''}${n((a-b)*100)} pp`;
  const productButton=p=>`<button type="button" class="bi-client-link" data-bi-product-key="${safe(p.key)}">${safe(p.name)}</button><small>${safe(p.sku)} · ${safe(p.brand)}</small>`;
  // Products at the top: ordered but not delivered, and catalog products nobody orders.
  function productHealthPanel() {
    if(filters.source==='erp')return '';
    const h=calculated('health',filters,()=>m.productHealth(session.data,filters));
    const undeliveredRow=p=>`<tr><td>${productButton(p)}</td><td>${n(p.orderedQty)}</td><td>${n(p.withStock)}<small>${pct1(p.fillRate)}</small></td><td>${n(p.noStock)}</td><td>${n(p.pending)}</td><td>${money(p.noStockAmount+p.pendingAmount)}${p.missingPrices?' (parcial)':''}</td><td>${n(p.clients)}</td></tr>`;
    const undeliveredTable=(items,key)=>`<div class="bi-table-scroll"><table data-bi-table="${key}"><thead><tr><th>Producto</th><th>Pedido (u.)</th><th>Facturado (u.)</th><th>Sin stock (u.)</th><th>Sin marcar (u.)</th><th>No facturado sin IVA</th><th>Clientes afectados</th></tr></thead><tbody>${items.map(undeliveredRow).join('')||'<tr><td colspan="7">Todo lo pedido en el período se facturó.</td></tr>'}</tbody></table></div>`;
    const stoppedRow=p=>`<tr><td>${productButton(p)}</td><td>${n(p.priorUnits)}</td><td>${n(p.priorClients)}</td><td>${date(p.last)}</td><td>${p.outOfStock?'<span class="bi-badge bi-badge--warn">Sin stock en catálogo</span>':'Disponible'}</td></tr>`;
    const stoppedTable=(items,key)=>`<div class="bi-table-scroll"><table data-bi-table="${key}"><thead><tr><th>Producto</th><th>Unidades 12 meses antes</th><th>Clientes que lo pedían</th><th>Último pedido</th><th>Catálogo</th></tr></thead><tbody>${items.map(stoppedRow).join('')||'<tr><td colspan="5">Todos los productos que se venían pidiendo tuvieron pedidos.</td></tr>'}</tbody></table></div>`;
    const lost=h.undelivered.reduce((s,p)=>s+p.noStockAmount,0),pending=h.undelivered.reduce((s,p)=>s+p.pendingAmount,0);
    return `<section class="bi-card bi-product-health" data-bi-product-health><h3>Productos · qué no se entrega y qué no se pide</h3>
      <div class="bi-secondary-metrics"><span>Productos con faltantes <b>${n(h.undelivered.length)}</b></span><span>Sin stock <b>${money(lost)}</b></span><span>Sin marcar todavía <b>${money(pending)}</b></span><span>Sin pedidos en el período <b>${n(h.stopped.length+h.never.length)} de ${n(h.catalogProducts)}</b></span></div>
      <div class="bi-health-grid">
        <div><h4>Se piden pero no se entregan</h4>${undeliveredTable(h.undelivered.slice(0,8),'health-undelivered')}${h.undelivered.length>8?`<details><summary>Ver los ${n(h.undelivered.length)} productos</summary>${undeliveredTable(h.undelivered.slice(0,300),'health-undelivered-all')}</details>`:''}</div>
        <div><h4>Se pedían y dejaron de pedirse</h4>${stoppedTable(h.stopped.slice(0,8),'health-stopped')}${h.stopped.length>8?`<details><summary>Ver los ${n(h.stopped.length)} productos</summary>${stoppedTable(h.stopped.slice(0,300),'health-stopped-all')}</details>`:''}
          <p class="bi-health-never"><b>${n(h.never.length)}</b> ${h.never.length===1?'producto':'productos'} del catálogo sin pedidos en los últimos 12 meses${h.neverByBrand.length?': '+h.neverByBrand.map(b=>`${safe(b.brand)} ${n(b.count)}/${n(b.total)}`).join(' · '):''}.</p>
          ${h.never.length?`<details><summary>Ver productos sin pedidos en 12 meses</summary><div class="bi-table-scroll"><table data-bi-table="health-never"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio de lista</th><th>Catálogo</th></tr></thead><tbody>${h.never.slice(0,400).map(p=>`<tr><td>${productButton(p)}</td><td>${safe(p.category||'')}</td><td>${p.price===null?'—':money(p.price)}</td><td>${p.outOfStock?'Sin stock':'Disponible'}</td></tr>`).join('')}</tbody></table></div></details>`:''}
        </div>
      </div></section>`;
  }
  // SKUs each brand has in the catalog against what it sells.
  function brandPortfolioPanel() {
    const b=calculated('brand-portfolio',filters,()=>m.brandPortfolio(session.data,filters));
    if(!b.rows.length)return '<section class="bi-card bi-brand-share"><h3>Marcas · portafolio y facturación</h3><p class="bi-empty">No hay productos ni ventas para estos filtros.</p></section>';
    return `<section class="bi-card bi-brand-share bi-brand-portfolio" data-bi-brand-portfolio><h3>Marcas · portafolio versus facturación</h3>
      <div class="bi-chart-legend"><span><i style="background:#a9b8c8"></i>% de los SKUs del catálogo</span><span><i style="background:#1d9a6c"></i>% de lo facturado</span></div>
      ${b.rows.map(r=>`<button type="button" class="bi-bar bi-portfolio-bar" data-bi-dimension="brand" data-value="${safe(r.brand)}"><span><b>${safe(r.brand)}</b><strong>${pct1(r.skuShare)} del portafolio · ${pct1(r.invoicedShare)} de lo facturado</strong></span><i><em class="bi-portfolio-skus" style="width:${Math.min(100,(r.skuShare||0)*100)}%"></em></i><i><em class="bi-portfolio-sales" style="width:${Math.min(100,(r.invoicedShare||0)*100)}%"></em></i><small>${n(r.skus)} SKUs · ${n(r.soldSkus)} con pedidos en el período · facturado ${amountLabel(r.invoiced)}${r.index!==null?` · rinde ${n(r.index)}× su peso`:''}</small></button>`).join('')}
      <details><summary>Ver tabla</summary><div class="bi-table-scroll"><table data-bi-table="brand-portfolio" data-bi-model-sort><thead><tr><th>Marca</th><th>SKUs en catálogo</th><th>% portafolio</th><th>SKUs con pedidos</th><th>Pedido sin IVA</th><th>% pedido</th><th>Facturado sin IVA</th><th>% facturado</th><th>Rinde (× peso)</th></tr></thead><tbody>${b.rows.map(r=>`<tr><td>${safe(r.brand)}</td><td>${n(r.skus)}</td><td>${pct1(r.skuShare)}</td><td>${n(r.soldSkus)}</td><td>${amountLabel(r.ordered)}</td><td>${pct1(r.orderedShare)}</td><td>${amountLabel(r.invoiced)}</td><td>${pct1(r.invoicedShare)}</td><td>${r.index===null?'—':n(r.index)+'×'}</td></tr>`).join('')}</tbody></table></div></details>
      <p class="bi-data-note">Portafolio: SKUs visibles en el catálogo. Facturado: lo marcado con stock en WarehousePick por fecha de factura (y lo facturado del Excel antes del 16/10). «Rinde» compara su parte de lo facturado con su parte del portafolio: más de 1× aporta más de lo que ocupa.</p></section>`;
  }
  function compareRows(rows) {
    return `<div class="bi-table-scroll"><table data-bi-table="profile-compare"><thead><tr><th>Indicador</th>${rows.columns.map(c=>`<th>${safe(c)}</th>`).join('')}</tr></thead><tbody>${rows.items.map(([label,...cells])=>`<tr><td>${safe(label)}</td>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function brandMix(own,company,label) {
    const total=p=>p.brands.reduce((s,b)=>s+b.invoiced.amount,0),ownTotal=total(own),companyTotal=total(company);
    const shares=new Map(company.brands.map(b=>[b.brand,companyTotal?b.invoiced.amount/companyTotal:null]));
    const rows=own.brands.filter(b=>b.invoiced.amount||b.ordered.amount);
    return `<div class="bi-table-scroll"><table data-bi-table="profile-brands"><thead><tr><th>Marca</th><th>Facturado ${safe(label)}</th><th>% ${safe(label)}</th><th>% empresa</th><th>Diferencia</th></tr></thead><tbody>${rows.map(b=>{const share=ownTotal?b.invoiced.amount/ownTotal:null,base=shares.get(b.brand)??null;return `<tr><td>${safe(b.brand)}</td><td>${amountLabel(b.invoiced)}</td><td>${pct1(share)}</td><td>${pct1(base)}</td><td>${pp(share,base)}</td></tr>`;}).join('')||'<tr><td colspan="5">Sin ventas en el período.</td></tr>'}</tbody></table></div>`;
  }
  function topProducts(profile,limit=10) {
    return `<div class="bi-table-scroll"><table data-bi-table="profile-products"><thead><tr><th>Producto</th><th>Pedido (u.)</th><th>Pedido sin IVA</th><th>Facturado (u.)</th><th>Sin stock (u.)</th></tr></thead><tbody>${profile.products.slice(0,limit).map(p=>`<tr><td>${productButton(p)}</td><td>${n(p.ordered.units)}</td><td>${amountLabel(p.ordered)}</td><td>${n(p.withStock)}</td><td>${n(p.noStock)}</td></tr>`).join('')||'<tr><td colspan="5">Sin pedidos en el período.</td></tr>'}</tbody></table></div>`;
  }
  const ticketOf=v=>v.orders?v.amount/v.orders:null;
  const ticketLabel2=v=>ticketOf(v)===null?'—':money(ticketOf(v))+(v.missing?' (parcial)':'');
  const companyOnly=()=>!session.input.simple&&(['*',''].includes(session.input.salesmanCode)||session.input.salesmanCode===undefined);
  // One salesperson against the company: totals, clients, brands and products.
  function vendorProfile(code) {
    const data=session.data,f={...filters,client:''};
    const codes=new Set(data.clients.filter(c=>String(c.salesmanCode||'unassigned')===code).map(c=>String(c.clientCode)));
    const own=calculated('vendor-profile:'+code,f,()=>m.scopeProfile(data,f,codes)),company=calculated('company-profile',f,()=>m.scopeProfile(data,f));
    const vendors=report.vendors.filter(v=>v.current.orders||v.annual.orders).length||1;
    const totals=calculated('client-totals',f,()=>m.clientTotals(data,f));
    const share=(a,b)=>b?pct1(a/b):'—';
    const perClient=p=>p.clients?p.invoiced.amount/p.clients:null;
    const columns=['Vendedor','Empresa','Promedio por vendedor','Participación / diferencia'];
    const items=[
      ['Pedido sin IVA',amountLabel(own.ordered),amountLabel(company.ordered),money(company.ordered.amount/vendors),share(own.ordered.amount,company.ordered.amount)],
      ['Facturado sin IVA',amountLabel(own.invoiced),amountLabel(company.invoiced),money(company.invoiced.amount/vendors),share(own.invoiced.amount,company.invoiced.amount)],
      ['Facturado / pedido',pct1(own.fillRate),pct1(company.fillRate),'—',pp(own.fillRate,company.fillRate)],
      ['Pedidos',n(own.ordered.orders),n(company.ordered.orders),n(company.ordered.orders/vendors),share(own.ordered.orders,company.ordered.orders)],
      ['Clientes con pedidos',`${n(own.clients)} de ${n(codes.size)}`,n(company.clients),n(company.clients/vendors),share(own.clients,company.clients)],
      ['Ticket promedio facturado',ticketLabel2(own.invoiced),ticketLabel2(company.invoiced),'—',ticketOf(own.invoiced)!==null&&ticketOf(company.invoiced)?pct(ticketOf(own.invoiced)/ticketOf(company.invoiced)-1):'—'],
      ['Facturado por cliente activo',perClient(own)===null?'—':money(perClient(own)),perClient(company)===null?'—':money(perClient(company)),'—',perClient(own)!==null&&perClient(company)?pct(perClient(own)/perClient(company)-1):'—'],
      ['Sin stock sin IVA',money(own.noStockAmount),money(company.noStockAmount),money(company.noStockAmount/vendors),share(own.noStockAmount,company.noStockAmount)],
    ];
    const assigned=report.customers.filter(c=>codes.has(String(c.client.clientCode))),entries=assigned.filter(c=>c.annual?.orders>0||c.period?.orders>0||totals.get(String(c.client.clientCode))?.ordered.orders);
    const clientRows=sortedRows(entries.map(c=>({...c,totals:totals.get(String(c.client.clientCode))})).sort((a,b)=>(b.totals?.invoiced.amount||0)-(a.totals?.invoiced.amount||0)||(b.totals?.ordered.amount||0)-(a.totals?.ordered.amount||0)),'vendor-clients',c=>[c.client.legalName||c.client.name,c.totals?.ordered.amount,c.totals?.invoiced.amount,c.totals?.ordered.amount?c.totals.invoiced.amount/c.totals.ordered.amount:null,c.last,c.frequency,situationLabels[c.situation||'insufficient']]);
    return `<section class="bi-card bi-vendor-profile" data-bi-vendor-profile><div class="bi-detail-toolbar"><button type="button" data-bi-vendor="">← Todos los vendedores</button></div>
      <h2>${safe(salesmanName(code))} · ${date(f.from)} — ${date(f.to)}</h2>
      ${companyOnly()?'':'<p class="bi-notice">Para comparar con la empresa elegí «Todos» en Vendedor actual.</p>'}
      ${compareRows({columns,items})}
      <h3>Clientes con compras en 12 meses (${n(entries.length)} de ${n(codes.size)} asignados)</h3>
      <div class="bi-table-scroll"><table data-bi-table="vendor-clients" data-bi-model-sort><thead><tr><th>Cliente</th><th>Pedido</th><th>Facturado</th><th>Facturado / pedido</th><th>Última compra</th><th>Frecuencia</th><th>Situación</th></tr></thead><tbody>${clientRows.map(c=>{const t=c.totals;return `<tr><td><button type="button" class="bi-client-link" data-bi-client="${safe(c.client.clientCode)}">${safe(c.client.legalName||c.client.name)}</button><small>${safe(displayCode(c.client))}</small></td><td>${t?amountLabel(t.ordered):'—'}</td><td>${t?amountLabel(t.invoiced):'—'}</td><td>${t&&t.ordered.amount?pct1(t.invoiced.amount/t.ordered.amount):'—'}</td><td>${c.last?date(c.last):'—'}</td><td>${frequencyLabel(c)}</td><td>${situationLabel(c)}</td></tr>`;}).join('')||'<tr><td colspan="7">Sin clientes asignados.</td></tr>'}</tbody></table></div>
      <div class="bi-profile-grid"><div><h3>Marcas · vendedor versus empresa</h3>${brandMix(own,company,'vendedor')}</div><div><h3>Productos más pedidos</h3>${topProducts(own)}</div></div>
    </section>`;
  }
  // One client: activity, how they compare and what they stopped or never buy.
  function clientAnalysis() {
    if(!filters.client)return '';
    const data=session.data,code=String(filters.client),f={...filters,client:''};
    const entry=report.customers.find(c=>String(c.client.clientCode)===code);
    const client=entry?.client||data.clients.find(c=>String(c.clientCode)===code)||{clientCode:code,name:code};
    const codes=new Set([code]);
    const own=calculated('client-profile:'+code,f,()=>m.scopeProfile(data,f,codes)),company=calculated('company-profile',f,()=>m.scopeProfile(data,f));
    const totals=calculated('client-totals',f,()=>m.clientTotals(data,f));
    const ranked=[...totals.entries()].sort((a,b)=>b[1].invoiced.amount-a[1].invoiced.amount),rank=ranked.findIndex(([c])=>c===code);
    const active=company.clients||1,avgInvoiced=company.invoiced.amount/active,avgOrdered=company.ordered.amount/active;
    const sellerCodes=new Set(data.clients.filter(c=>String(c.salesmanCode)===String(client.salesmanCode)).map(c=>String(c.clientCode)));
    const portfolio=client.salesmanCode?calculated('vendor-profile:'+client.salesmanCode,f,()=>m.scopeProfile(data,f,sellerCodes)):null;
    const portfolioAvg=portfolio&&portfolio.clients?portfolio.invoiced.amount/portfolio.clients:null;
    const opportunity=calculated('opportunities',filters,()=>m.opportunityReport(data,filters)).find(o=>String(o.client.clientCode)===code);
    const columns=['Cliente','Promedio por cliente activo','Diferencia'];
    const items=[
      ['Pedido sin IVA',amountLabel(own.ordered),money(avgOrdered),avgOrdered?pct(own.ordered.amount/avgOrdered-1):'—'],
      ['Facturado sin IVA',amountLabel(own.invoiced),money(avgInvoiced),avgInvoiced?pct(own.invoiced.amount/avgInvoiced-1):'—'],
      ['Facturado / pedido',pct1(own.fillRate),pct1(company.fillRate),pp(own.fillRate,company.fillRate)],
      ['Pedidos',n(own.ordered.orders),n(company.ordered.orders/active),'—'],
      ['Ticket promedio facturado',ticketLabel2(own.invoiced),ticketLabel2(company.invoiced),ticketOf(own.invoiced)!==null&&ticketOf(company.invoiced)?pct(ticketOf(own.invoiced)/ticketOf(company.invoiced)-1):'—'],
      ['Sin stock sin IVA',money(own.noStockAmount),money(company.noStockAmount/active),'—'],
    ];
    if(portfolioAvg!==null)items.push(['Facturado vs su cartera (promedio por cliente)',amountLabel(own.invoiced),money(portfolioAvg),portfolioAvg?pct(own.invoiced.amount/portfolioAvg-1):'—']);
    const facts=[
      ['Vendedor',safe(salesmanName(client.salesmanCode))],
      ['Ranking por facturado',rank>=0&&own.invoiced.amount?`${n(rank+1)}º de ${n(ranked.filter(([,t])=>t.invoiced.amount>0).length)}`:'Sin facturación en el período'],
      ['Participación en lo facturado',company.invoiced.amount?pct1(own.invoiced.amount/company.invoiced.amount):'—'],
      ['Última compra',entry?.last?date(entry.last):'Sin compras'],
      ['Frecuencia',frequencyLabel(entry)],
      ['Situación',situationLabel(entry)],
      ['Ventas 12 meses',entry?amountLabel(entry.annual):'—'],
    ];
    const lostProducts=own.products.filter(p=>p.noStock>0);
    return `<section class="bi-card bi-client-analysis" data-bi-client-analysis><h3>Análisis del cliente · ${safe(client.legalName||client.name)}</h3>
      <div class="bi-secondary-metrics">${facts.map(([k,v])=>`<span>${k} <b>${v}</b></span>`).join('')}</div>
      ${compareRows({columns,items})}
      <div class="bi-profile-grid"><div><h4>Marcas · cliente versus empresa</h4>${brandMix(own,company,'cliente')}</div><div><h4>Productos más pedidos</h4>${topProducts(own,8)}</div></div>
      <div class="bi-profile-grid"><div><h4>Pedidos sin stock</h4>${lostProducts.length?topProducts({products:lostProducts},8):'<p class="bi-empty">Sin faltantes en el período.</p>'}</div>
        <div><h4>Dejó de comprar (pedía hace 3–12 meses)</h4>${opportunity?.missing.length?`<ul class="bi-plain-list">${opportunity.missing.slice(0,10).map(p=>`<li>${productButton({key:JSON.stringify([p.section,String(p.sku).toUpperCase()]),name:p.name,sku:p.sku,brand:p.section})}</li>`).join('')}</ul>`:'<p class="bi-empty">Sin productos discontinuados.</p>'}
        <h4>Más vendidos que no compra</h4>${opportunity?.bestsellers.length?`<ul class="bi-plain-list">${opportunity.bestsellers.slice(0,10).map(p=>`<li>${safe(p.product?.name||p.name||p.key)}<small>${safe(p.product?.sku||'')}</small></li>`).join('')}</ul>`:'<p class="bi-empty">Sin datos.</p>'}</div></div>
    </section>`;
  }
  // Admin-only review of the data that does not add up, with what to fix and where.
  function qualityView() {
    const q=calculated('quality',filters,()=>m.dataQuality(session.data,filters));
    const section=(title,help,head,rows,empty)=>`<section class="bi-card"><h3>${title} <small>(${n(rows.length)})</small></h3><p class="bi-data-note">${help}</p>${rows.length?`<div class="bi-table-scroll"><table data-bi-table="quality"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="bi-empty">${empty}</p>`}</section>`;
    return `<section class="bi-card"><h2>Revisión de datos · ${date(filters.from)} — ${date(filters.to)}</h2><p class="bi-data-note">Pedidos de WarehousePick del período que no se pueden atribuir o valorar bien. Corregirlos en el origen mejora clientes, vendedores e importes.</p></section>
      ${section('Pedidos sin cliente identificado','Se ven en el dashboard pero no suman a ningún cliente del maestro ni a su vendedor. Si el pedido indica su vendedor, se le suma a ese vendedor. Corregir: asignar el cliente a la cuenta del catálogo , cargar el código en WarehousePick o agregar el cliente al maestro.',['Pedido','Fecha','Nombre en el pedido','Motivo','Vendedor del pedido','Pedido sin IVA'],q.noClient.map(o=>`<tr><td>${safe(o.order)}</td><td>${date(o.date)}</td><td>${safe(o.name||'—')}</td><td>${safe(o.reason)}</td><td>${o.salesmanCode?safe(salesmanName(o.salesmanCode)):'—'}</td><td>${amountLabel(o.amount)}</td></tr>`),'Todos los pedidos tienen cliente.')}
      ${section('Pedidos unidos a un cliente por el nombre','El pedido no tiene código de cliente, pero su nombre coincide con un único cliente del maestro (mismas palabras, en cualquier orden). Se cuentan para ese cliente y su vendedor. Para que no dependa del nombre, cargar el código en la cuenta del catálogo o en WarehousePick.',['Pedido','Fecha','Nombre en el pedido','Unido a','Pedido sin IVA'],q.merged.map(o=>`<tr><td>${safe(o.order)}</td><td>${date(o.date)}</td><td>${safe(o.name)}</td><td>${safe(o.clientCode)} · ${safe(o.clientName)}</td><td>${amountLabel(o.amount)}</td></tr>`),'Ningún pedido necesitó unirse por nombre.')}
      ${section('Productos sin precio de catálogo','Se valoran con el último precio del Excel o quedan sin importe. Corregir: agregar el producto o su precio al catálogo.',['Producto / SKU','Situación','Unidades','Pedidos'],q.products.map(p=>`<tr><td>${safe(p.name)}<small>${safe(p.sku)}${p.kitchenSpot?' · Kitchen Spot':''}</small></td><td>${safe(p.issue)}</td><td>${n(p.units)}</td><td>${safe(p.orders.slice(0,6).join(', '))}${p.orders.length>6?` y ${p.orders.length-6} más`:''}</td></tr>`),'Todos los productos tienen precio de catálogo.')}
      ${section('Pedidos del catálogo que no están en WarehousePick','No se cuentan en el dashboard: el depósito no los tiene (no se enviaron, se cancelaron allí o se cargaron en otra empresa).',['Pedido','Fecha','Cliente','Líneas','Unidades','Importe sin IVA'],q.catalogOrders.map(o=>`<tr><td>${safe(o.order)}</td><td>${date(o.date)}</td><td>${safe(o.name)}</td><td>${n(o.lines)}</td><td>${n(o.units)}</td><td>${money(o.amount)}</td></tr>`),q.warehouseAvailable?'Todos los pedidos del catálogo llegaron a WarehousePick.':'WarehousePick no está disponible.')}`;
  }
  function deliveryRatio(ordered, delivered, known=true) {
    if(!known||!ordered||delivered===null)return 'Sin datos';
    return n(delivered/ordered*100)+'%';
  }
  function ticketSummary() {
    const ordered=report.metrics.ordered.current,delivered=report.metrics.delivered.current;
    const known=!(delivered.unknown&&!delivered.orders),partial=ordered.partial||delivered.partial;
    const moneyKnown=known&&!(delivered.missing&&delivered.pricedLines===0);
    const ticketLabel=v=>v.ticket===null||v.unknown&&!v.orders?'Sin datos':money(v.ticket)+(v.partial?' (parcial)':'');
    const ticketMeasures=[['ordered','pedido'],['invoiceDate','facturado']];
    return `<section class="bi-card bi-ticket-summary"><h3>Facturado y ticket promedio · período seleccionado</h3><div class="bi-kpis bi-headline-grid"><article><span>Facturado / pedido · importe</span><strong>${deliveryRatio(ordered.amount,delivered.amount,moneyKnown)}${partial&&moneyKnown?' (parcial)':''}</strong><small>Unidades: ${deliveryRatio(ordered.units,delivered.units,known)}${partial&&known?' (parcial)':''}</small></article>${ticketMeasures.map(([metric,measureName])=>{const v=report.metrics[metric];return `<article><span>Ticket promedio ${measureName}</span><strong>${ticketLabel(v.current)}</strong>${[['year','Mismo período año anterior',report.periods.year],['ytd','Promedio del año al cierre',report.periods.ytd]].map(([key,label,range])=>{const prior=v[key],comparable=v.currentCovered&&v[key+'Covered']&&v.current.ticket!==null&&prior.ticket!==null&&!(v.current.unknown&&!v.current.orders)&&!(prior.unknown&&!prior.orders);return `<small>${label} · ${date(range.from)} — ${date(range.to)}<br>${v[key+'Covered']?ticketLabel(prior):'Sin historial comparable'}${comparable?comparisonBadge({delta:v.current.ticket-prior.ticket,percent:prior.ticket?(v.current.ticket-prior.ticket)/Math.abs(prior.ticket):null}):''}</small>`;}).join('')}</article>`;}).join('')}</div></section>`;
  }
  function chart() {
    if(!chartFilters)chartFilters={metric:'invoiceDate',dimension:'amount'};
    const f={...filters,...chartFilters},both=f.metric==='both';
    const invoiceLabel=session.data.invoiceAvailable&&session.data.invoiceEstimated?'Facturado estimado':'Facturado';
    let weekly,series;
    if(both){
      const t=calculated('chart-both',f,()=>m.trendComparison(session.data,f));weekly=t.weekly;
      series=[{key:'ordered',label:'Pedido',color:'#176fc1',rows:t.rows},{key:'invoiced',label:invoiceLabel,color:'#1d9a6c',rows:t.invoiced}];
    } else {
      const t=calculated('chart',f,()=>m.trendReport(session.data,f));weekly=t.weekly;
      series=[{key:f.metric,label:f.metric==='invoiceDate'?invoiceLabel:chartMeasureNames[f.metric],color:'#176fc1',rows:t.rows}];
    }
    const rows=series[0].rows;
    for(const s of series)s.values=s.rows.map(p=>m.trendPointValue(p,f.dimension));
    const annualFor=metric=>calculated('annual',{...f,metric},()=>{
      const selection={...f,...report.periods.annual};
      return metric==='invoiced'?m.measureRows(m.invoicedRows(session.data,selection),'invoiceDate'):m.measureRows(m.selected(session.data,{...selection,metric}),metric);
    });
    for(const s of series)s.annual=annualFor(s.key);
    const format=v=>v===null?'Sin datos':f.dimension==='amount'||f.dimension==='ticket'?money(v):n(v);
    const plotted=series.flatMap(s=>s.values).filter(v=>v!==null),tickets=f.dimension==='ticket'?series.map(s=>s.annual.ticket||0):[];
    const max=Math.max(1,...plotted,...tickets),min=Math.min(0,...plotted,...tickets);
    chartScene={rows,series,min,max,format,f,handover:session.input.simple?null:session.data.handover,weekly};
    const field=(key,label,choices)=>`<label>${label}<select data-bi-chart="${key}">${options(choices,f[key])}</select></label>`;
    const legend=both?`<div class="bi-chart-legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}<small>Pedido por fecha del pedido · facturado por fecha de factura (Excel: facturado estimado por fecha del pedido)</small></div>`:'';
    return `<section class="bi-card bi-monthly-chart">
      <div class="bi-card-title"><h3>Tendencia ${weekly?'semanal':'diaria'}</h3></div>
      <form class="bi-chart-filters" data-bi-chart-form>${field('metric','Medida',chartChoices.map(([key,label])=>[key,key==='invoiceDate'?invoiceLabel:key==='both'?'Pedido y '+invoiceLabel.toLowerCase():label]))}${field('dimension','Analizar',[['amount','Importe'],['units','Unidades'],['orders','Pedidos distintos'],['clients','Clientes distintos'],['ticket','Ticket promedio']])}<span data-bi-chart-error role="status"></span></form>
      ${legend}
      <div class="bi-chart-scroll"><canvas class="bi-trend bi-canvas-chart" data-bi-canvas tabindex="0" role="img" aria-label="Gráfico ${weekly?'semanal':'diario'} interactivo. Usá las flechas para explorar las fechas."></canvas><span class="bi-chart-readout" data-bi-chart-readout role="status" aria-live="polite"></span></div>
      ${rows[0]?.context?'<small data-bi-chart-context>Zona sombreada · últimos 5 días del mes anterior, fuera de los totales seleccionados.</small>':''}
      <div class="bi-secondary-metrics bi-annual-ticket">${series.map(s=>`<span>Ticket ${s.label.toLowerCase()} · 12 meses al ${date(report.periods.current.to)}: <b>${s.annual.ticket===null?'Sin datos':money(s.annual.ticket)}</b>${s.annual.partial?' · parcial':''}.</span>`).join('')}</div>
      <details><summary>Ver detalle del gráfico</summary><div class="bi-table-scroll"><table data-bi-table="trend">
        <thead><tr><th>Fecha o semana</th><th>Período</th>${series.map(s=>`<th>${safe(s.label)} · importe</th>`).join('')}<th>Pedidos</th><th>Clientes</th><th>Ticket</th></tr></thead>
        <tbody>${rows.map((p,i)=>`<tr data-context="${p.context}"><td>${trendPeriod(p)}</td><td>${p.context?'Contexto anterior':'Selección'}</td>${series.map(s=>`<td>${amountLabel(s.rows[i])}</td>`).join('')}<td>${p.orders}</td><td>${p.clients}</td><td>${p.ticket===null?'—':money(p.ticket)}</td></tr>`).join('')}</tbody>
      </table></div></details>
    </section>`;
  }
  function bars(rows,key) {
    const max=Math.max(1,...rows.map(r=>Math.abs(r.value)));
    const visible=key==='brand'?rows:rows.slice(0,8);
    return visible.map(r=>`<button type="button" class="bi-bar" data-bi-dimension="${key}" data-value="${safe(r.id)}"><span><b>${safe(r.name)}</b><strong>${money(r.value)}${r.share!=null?' · '+n(r.share*100)+'%':''}</strong></span><i><em style="width:${Math.min(100,Math.abs(r.value)/max*100)}%"></em></i><small>${n(r.qty)} unidades · ${r.buyers} clientes</small></button>`).join('') || '<p class="bi-empty">No hay ventas para estos filtros.</p>';
  }

  function compareSort(a,b,direction) {
    if(a==null||b==null)return Number(a==null)-Number(b==null);
    return direction*(typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b)));
  }

  function sortedRows(rows,key,values) {
    const sort=tableSorts.get(key);
    return sort ? [...rows].sort((a,b)=>compareSort(values(a)[sort.column],values(b)[sort.column],sort.direction)) : rows;
  }

  function cellValue(cell,label) {
    if(!cell)return null;
    const text=(cell.dataset.sortValue??cell.textContent).trim();
    if(!text||/^(—|sin datos|sin registro|no disponible|historial insuficiente)$/i.test(text))return null;
    const day=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(day)return day[3]+day[2]+day[1];
    if(!/importe|venta|periodo|mes anterior|variacion|ultimos 12|frecuencia promedio|nuevos|reactivados|ticket|unidades|pedidos distintos|clientes compradores|diferencia|\(u\.\)|sin iva|^pedidos$|^clientes$/i.test(m.norm(label)))return text;
    const numeric=text.match(/^(?:Ver clientes \(|Cada )?(?:[↑↓→]\s*)?(?:Δ\s*)?([+-]?)\s*\$?\s*([+-]?\d[\d.]*,?\d*)(?=$|[\s%)]|\()/);
    return numeric ? Number(numeric[1]+numeric[2].replaceAll('.','').replace(',','.')) : text;
  }

  function decorateTables(scope) {
    scope.querySelectorAll('table').forEach((table,index)=>{
      const key=table.dataset.biTable||`${section}:${table.closest('[data-bi-detail]')?tab:'panel'}:${index}`;
      const modelSorted=table.hasAttribute('data-bi-model-sort');
      const headers=[...table.tHead?.rows[0]?.cells||[]];
      const order=()=>{
        const sort=tableSorts.get(key);
        headers.forEach((header,column)=>header.setAttribute('aria-sort',sort?.column===column?(sort.direction===1?'ascending':'descending'):'none'));
        const body=table.tBodies[0];
        if(!sort||modelSorted||!body)return;
        const rows=[...body.rows].filter(row=>row.cells.length===headers.length);
        const label=headers[sort.column].querySelector('[data-bi-sort]').textContent;
        const values=new Map(rows.map(row=>[row,cellValue(row.cells[sort.column],label)]));
        rows.sort((a,b)=>compareSort(values.get(a),values.get(b),sort.direction));
        for(const row of rows)body.append(row);
      };
      headers.forEach((header,column)=>{
        if(!header.textContent.trim()||header.querySelector('[data-bi-sort]'))return;
        const button=document.createElement('button');
        button.type='button';button.dataset.biSort='';button.textContent=header.textContent.trim();
        header.replaceChildren(button);
        button.onclick=()=>{
          const prior=tableSorts.get(key);
          tableSorts.set(key,{column,direction:prior?.column===column?-prior.direction:1});
          if(modelSorted){
            productPage=0;renderDetail();
            const updated=[...session.panel.querySelectorAll('[data-bi-table]')].find(node=>node.dataset.biTable===key);
            updated?.tHead.rows[0].cells[column]?.querySelector('button')?.focus({preventScroll:true});
          } else order();
        };
      });
      order();
    });
  }

  function directoryClients(input) {
    const clients=new Map(input.clients.map(client=>[String(client.clientCode),client]));
    for(const row of input.lines||[]){
      const clientCode=String(row.client_code||'').trim();
      if(!clientCode||clients.has(clientCode))continue;
      clients.set(clientCode,{clientCode,name:row.client_name||clientCode,locality:row.locality||'',salesmanCode:m.analysisSalesman({clientCode})});
    }
    return [...clients.values()];
  }

  function directoryView(input) {
    const salesmen=input.registeredSalesmen||[];
    const names=new Map(salesmen.map(s=>[s.code,s.name]));
    const clients=calculated('directory',{},()=>directoryClients(input));
    return `<section class="bi-card"><h2>Clientes y vendedores</h2>
      <label class="bi-directory-search">Buscar cliente <input type="search" data-bi-directory-search value="${safe(directoryQuery)}" placeholder="Código, nombre, localidad o vendedor"></label>
      <div class="bi-table-scroll"><table data-bi-table="directory-clients"><caption>${clients.length} clientes</caption>
        <thead><tr><th>Código</th><th>Nombre</th><th>Razón social</th><th>Dirección</th><th>Localidad</th><th>Vendedor</th><th>Ficha</th><th aria-label="Acciones"></th></tr></thead>
        <tbody>${clients.map(c=>`<tr><td>${safe(c.clientCode)}</td><td>${safe(c.name)}</td><td>${safe(c.legalName)}</td><td>${safe(c.address)}</td><td>${safe(c.locality)}</td><td>${safe(names.has(c.salesmanCode)?c.salesmanCode+' · '+names.get(c.salesmanCode):salesmanName(c.salesmanCode))}</td><td>${c.id?'Catálogo':'Solo historial'}</td><td><button type="button" data-bi-edit-client="${safe(c.clientCode)}">${c.id?'Editar':'Crear ficha'}</button></td></tr>`).join('')}</tbody></table></div>
      <p data-bi-directory-empty hidden>No hay clientes para esta búsqueda.</p></section>
      <section class="bi-card"><h3>Vendedores registrados</h3><div class="bi-table-scroll"><table data-bi-table="directory-salesmen"><thead><tr><th>Código</th><th>Nombre</th></tr></thead><tbody>${salesmen.map(s=>`<tr><td>${safe(s.code)}</td><td>${safe(s.name)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function filterDirectory(root) {
    const query=m.norm(directoryQuery);
    const rows=[...root.querySelectorAll('[data-bi-table="directory-clients"] tbody tr')];
    for(const row of rows)row.hidden=!m.norm([...row.cells].slice(0,7).map(cell=>cell.textContent).join(' ')).includes(query);
    root.querySelector('[data-bi-directory-empty]').hidden=rows.some(row=>!row.hidden);
  }

  function editDirectoryClient(code) {
    const current=session;
    if(clientEditor?.open||!current.input.admin||current.input.simple||!current.input.onSaveClient)return;
    const client=calculated('directory',{},()=>directoryClients(current.input)).find(c=>String(c.clientCode)===code);
    if(!client)return;
    const dialog=document.createElement('dialog');
    dialog.className='bi-client-groups-dialog';
    const fields=[['name','Nombre'],['legalName','Razón social'],['address','Dirección'],['locality','Localidad'],['sourceSalesmanLabel','Etiqueta de vendedor']];
    const sellers=(current.input.registeredSalesmen||[]).filter(s=>code!=='81032'||s.code!=='810');
    dialog.innerHTML=`<header><h2>${client.id?'Editar cliente':'Crear ficha de cliente'}</h2><button type="button" aria-label="Cerrar" data-close>×</button></header>
      <form><label>Código de cliente<input readonly value="${safe(code)}"></label>
      ${fields.map(([name,label])=>`<label>${label}<input name="${name}" value="${safe(client[name])}" ${name==='name'?'required':''}></label>`).join('')}
      <label>Vendedor<select name="salesmanCode" required>${options([['','Elegí un vendedor'],...sellers.map(s=>[s.code,s.code+' · '+s.name])],client.salesmanCode)}</select></label>
      <p role="alert"></p><button type="submit">Guardar</button></form>`;
    clientEditor=dialog;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{
      dialog.remove();
      if(clientEditor===dialog)clientEditor=null;
      if(session?.owner===current.owner) {
        const button=[...current.panel.querySelectorAll('[data-bi-edit-client]')].find(button=>button.dataset.biEditClient===code);
        button?.focus({preventScroll:true});
      }
    },{once:true});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      if(session?.owner!==current.owner||!session.input.admin){dialog.close();return;}
      const form=event.target,button=form.querySelector('[type=submit]'),status=form.querySelector('[role=alert]');
      const changes=Object.fromEntries(new FormData(form));
      if(!changes.name.trim()){status.textContent='Ingresá el nombre del cliente.';return;}
      button.disabled=true;status.textContent='';
      try {
        await current.input.onSaveClient(client,changes);
        if(dialog.isConnected)dialog.close();
      } catch(error) {
        button.disabled=false;
        status.textContent=error?.code==='23505'?'Ya existe una ficha con ese código. Actualizá el panel.':'No se pudo guardar el cliente.';
      }
    };
    dialog.showModal();
  }
  const helpDefinitions=[
    [/facturado y ticket/,'Período seleccionado. Excel hasta el 15/10; desde el 16/10, todos los pedidos de WarehousePick (del catálogo y cargados a mano). Facturado es lo marcado con stock.'],
    [/pedido versus facturado/,'Pedido menos lo marcado con stock en WarehousePick. La diferencia se separa en sin stock, líneas todavía sin marcar y, para el historial Excel, lo no facturado sin detalle.'],
    [/facturado \/ pedido/,'Facturado (con stock) dividido por pedido, en importe o unidades según el indicador. Usa el mismo período y ventas del panel; parcial indica entregas sin información. No es la tasa de falta de stock.'],
    [/ticket promedio pedido|ticket promedio facturado/,'Importe dividido por compras agrupadas; facturado cuenta compras con al menos una unidad marcada con stock. Compara la selección con las mismas fechas del año anterior y con importe ÷ compras desde el 1 de enero hasta el cierre seleccionado. No promedia tickets mensuales.'],
    [/explorar ventas/,'Los filtros se aplican al cambiar en indicadores, gráficos y tablas. El período inicial es este mes hasta hoy.'],
    [/^facturado.*con stock/,'Unidades marcadas con stock en WarehousePick, agrupadas por fecha del pedido. Valoradas al precio neto del pedido; parcial si faltan precios o marcas.'],
    [/^facturado.*fecha de factura/,'Unidades e importes de los comprobantes, agrupados por la fecha registrada de facturación.'],
    [/^pedido$/,'Ventas solicitadas por el cliente, con los importes y precios originales de cada pedido.'],
    [/periodo seleccionado|mes en curso|analisis de ventas/,'Usa las fechas seleccionadas. Compara con esas fechas desplazadas un mes y un año, ajustando los días de meses más cortos.'],
    [/^importe$|venta del periodo/,'Importe neto sin IVA. Se respeta el precio del pedido original; «parcial» indica datos incompletos.'],
    [/pedidos distintos|^pedidos$/,'Pedidos del mismo cliente dentro de 2 días del primero cuentan como una compra, fechada en ese primer día.'],
    [/clientes distintos/,'Clientes únicos con compras; en entregado, basta una unidad entregada para contar al cliente.'],
    [/unidades pedidas/,'Cantidad de productos pedidos en el período del panel. Compara con las mismas fechas del mes y año anteriores.'],
    [/unidades entregadas|entregado al precio/,'Unidades facturadas del Excel hasta el 15/10 y entregas confirmadas de WarehousePick desde el 16/10. Usa el período del panel; los importes se valoran al precio original del pedido.'],
    [/pendientes/,'Unidades pedidas menos entregadas confirmadas. Las líneas sin información no se consideran cero entregado.'],
    [/pedido versus entregado/,'Compara pedidos recientes y su entrega confirmada con el mismo período y filtros.'],
    [/venta perdida|importe sin stock/,'Unidades marcadas sin stock en WarehousePick × precio neto original. Los pedidos abiertos no son pérdida de stock.'],
    [/unidades sin stock/,'Cantidad que WarehousePick marcó explícitamente sin stock.'],
    [/pedidos afectados/,'Compras agrupadas con al menos un producto marcado sin stock.'],
    [/sobre importe pedido/,'Importe sin stock ÷ importe pedido. No se calcula si falta cobertura para la comparación.'],
    [/tendencia (diaria|semanal)/,'Usa las fechas del filtro general. Muestra días hasta dos meses y semanas para períodos más largos. Recorré las fechas con el cursor o las flechas.'],
    [/ticket.*12 meses|^ticket$|ticket.*promedio/,'Importe ÷ compras agrupadas. La línea anual usa el importe total de 12 meses ÷ sus compras, no la media de tickets mensuales.'],
    [/accion necesaria/,'Clientes a 14 días o menos de su próxima compra esperada, según su frecuencia de los últimos 12 meses.'],
    [/fuera de frecuencia/,'Clientes cuya próxima fecha de compra esperada ya pasó, sin días de tolerancia.'],
    [/reposiciones/,'Productos nuevamente disponibles que el cliente compró en al menos dos ocasiones durante 12 meses, o que pidió y no recibió por falta de stock. Visto y gestionado son estados distintos.'],
    [/ampliar|oportunidades/,'Más vendidos de la empresa por unidades entregadas de los últimos 12 meses que el cliente no compró, y productos comprados entre 3 y 12 meses atrás, ausentes en los últimos 3.'],
    [/participacion por marca/,'Importe y porcentaje del total de ventas con los filtros actuales. Seleccioná una marca para filtrar.'],
    [/frecuencia promedio/,'Promedio de días entre compras agrupadas en los últimos 12 meses. Requiere al menos dos compras.'],
    [/ultima compra/,'Fecha de la última compra agrupada registrada hasta el cierre del período seleccionado.'],
    [/situacion/,'Dentro de frecuencia, acción necesaria desde 14 días antes, fuera de frecuencia o historial insuficiente.'],
    [/nuevos/,'Clientes cuya primera compra registrada está en los últimos 12 meses. Puede existir historia anterior no disponible.'],
    [/reactivados/,'Clientes que volvieron a comprar después de al menos 12 meses sin compras.'],
    [/vendedores|^vendedor$/,'Las ventas históricas y actuales siguen al vendedor asignado hoy al cliente.'],
    [/ultimos 12 meses/,'Ventas de 12 meses hasta el cierre del período seleccionado.'],
    [/mes anterior|variacion|comparacion/,'Comparación al mismo día corrido. Δ es la diferencia en importe; % es el cambio frente al valor anterior.'],
    [/catalogo versus warehousepick|comparar fuentes|diferencia/,'Compara catálogo y depósito por pedido y SKU. Las fuentes se contrastan; no se suman.'],
    [/historial excel|cambio de fuente/,'Excel hasta el 15/10/2026. Desde el 16/10: pedidos del catálogo con entregas de WarehousePick.'],
    [/warehousepick/,'Informa unidades entregadas y sin stock. Los pedidos directos del depósito cuentan por unidades; sin precio original, los importes se muestran como parciales.'],
    [/^catalogo$/,'Pedidos y precios originales del catálogo. El estado del catálogo por sí solo no confirma una entrega.'],
    [/facturad.*erp/,'Facturación histórica estimada a partir de la cantidad facturada y el precio neto del pedido.'],
    [/devueltas/,'Unidades devueltas informadas por el historial Excel, mostradas por separado.'],
    [/sin asignacion/,'Clientes de ventas sin una coincidencia confirmada en la cartera actual.'],
    [/sin compras del conjunto/,'Sin compras de la marca o conjunto seleccionado durante los últimos 12 meses.'],
    [/productos antes comprados/,'Comprados entre 3 y 12 meses atrás, pero ausentes en los últimos 3 meses.'],
    [/mas vendidos/,'Hasta 20 productos disponibles con más unidades entregadas de toda la empresa en 12 meses que este cliente no compró. No se muestran ventas de otros clientes.'],
    [/clientes que compraron|clientes compradores/,'Clientes con al menos una unidad de este producto según la medida y período seleccionados. En entregado, solo cuentan entregas confirmadas.'],
    [/^cliente|clientes.*ventas/,'Ventas y frecuencia de los clientes de la cartera actual. Seleccioná un cliente para ver su detalle.'],
    [/producto|sku/,'Identificación del producto en los pedidos. Las marcas históricas se vinculan por SKU exacto.'],
    [/pedido/,'Compras agrupadas del cliente. Los pedidos originales y sus líneas se conservan en el detalle.'],
    [/provincia|ubicaciones/,'Distribución de las ventas por provincia informada; los datos ausentes quedan sin provincia.']
  ];
  function helpText(label){const key=m.norm(label);const text=helpDefinitions.find(([pattern])=>pattern.test(key))?.[1]||`${label}: detalle de la selección actual. Los importes se muestran sin IVA.`;return session?.input.simple&&/Excel|WarehousePick|ERP/.test(text)?'Información de tus clientes para el período indicado. Importes sin IVA al precio original; parcial indica datos incompletos.':text;}
  function decorateInfo(scope) {
    // Explanations live in the guide and short contextual tooltips, not in the
    // primary reading flow. Keep numbers, date ranges and data-quality flags.
    scope.querySelectorAll('p.bi-data-note,.bi-sidebar-note,.bi-header p,.bi-handover p,.bi-insights p,.bi-delivery-summary>p').forEach(el=>el.remove());
    scope.querySelector('.bi-footer>span:last-child')?.remove();
    scope.querySelectorAll('.bi-notice').forEach(el=>{
      if(el.hasAttribute('data-bi-delivery-notice')||el.hasAttribute('data-bi-history-notice')||el.hasAttribute('data-bi-invoice-notice'))return;
      const text=el.textContent;
      if(text.startsWith('ERP hasta ')){el.remove();return;}
      el.textContent=text.includes('líneas no tienen importe')?`${text.match(/^\d+/)?.[0]||''} líneas sin importe · totales parciales.`:text.includes('origen seleccionado')?'Facturación no disponible para esta fuente.':'Historial Excel no disponible.';
    });
    function add(target,label=target?.textContent?.trim()){
      if(!target||!label||target.querySelector('[data-bi-info]'))return;
      const button=document.createElement('button');button.type='button';button.className='bi-info-button';button.textContent='i';button.dataset.biInfo=helpText(label);button.setAttribute('aria-label',`Información: ${label}`);target.append(' ',button);
    }
    scope.querySelectorAll('h2,h3,h4,thead th,.bi-kpis article>span:first-child,.bi-delivery-summary article>span:first-child,.bi-insights article>span:first-child,.bi-secondary-metrics>span').forEach(el=>add(el));
    const handover=scope.querySelector('.bi-handover header');if(handover)add(handover,'Cambio de fuente');
    scope.querySelectorAll('.bi-source-cards>button').forEach(button=>{
      const wrapper=document.createElement('div');wrapper.className='bi-source-card';button.before(wrapper);wrapper.append(button);add(wrapper,button.querySelector('b').textContent);
    });
    const nav=scope.querySelector('.bi-tabs');if(nav)add(nav,({customers:'Clientes · ventas',vendors:'Vendedores',products:'Productos',orders:'Pedidos',deliveries:'Pedido versus facturado',comparison:'Comparar fuentes',opportunities:'Oportunidades',geography:'Ubicaciones'})[tab]);
  }
  function bindInfo(root) {
    const tooltip=document.createElement('div');tooltip.className='bi-info-tooltip';tooltip.id='bi-context-help';tooltip.role='tooltip';tooltip.hidden=true;root.append(tooltip);let active=null;
    function hide(){active?.removeAttribute('aria-describedby');active=null;tooltip.hidden=true;}
    function show(button){if(active&&active!==button)active.removeAttribute('aria-describedby');active=button;tooltip.textContent=button.dataset.biInfo;tooltip.hidden=false;button.setAttribute('aria-describedby',tooltip.id);const b=button.getBoundingClientRect(),t=tooltip.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(window.innerWidth-t.width-8,b.left+b.width/2-t.width/2))+'px';tooltip.style.top=(b.top>=t.height+12?b.top-t.height-8:Math.min(window.innerHeight-t.height-8,b.bottom+8))+'px';}
    root.addEventListener('pointerover',e=>{const b=e.target.closest('[data-bi-info]');if(b)show(b);});
    root.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-bi-info]'))hide();});
    root.addEventListener('pointerout',e=>{if(e.target.closest('[data-bi-info]')&&!e.target.closest('[data-bi-info]').contains(e.relatedTarget))hide();});
    root.addEventListener('focusin',e=>{if(e.target.matches('[data-bi-info]'))show(e.target);});
    root.addEventListener('focusout',e=>{if(e.target.matches('[data-bi-info]'))hide();});
    root.addEventListener('click',e=>{const b=e.target.closest('[data-bi-info]');if(!b)return;e.preventDefault();show(b);});
    root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!tooltip.hidden){e.preventDefault();e.stopPropagation();hide();}});
    root.addEventListener('scroll',hide,true);
  }
  function bindChart(root) {
    chartCleanup?.();chartCleanup=null;
    const canvas=root.querySelector('[data-bi-canvas]'),scene=chartScene;
    if(!canvas||!scene?.rows.length)return;
    const ctx=canvas.getContext('2d'),{rows,series,min,max,format,f,handover}=scene,values=series[0].values;
    const readout=root.querySelector('[data-bi-chart-readout]');
    const dayMs=86400000,start=m.timestamp(rows[0].from),end=m.timestamp(rows.at(-1).to)+dayMs;
    const axisX=time=>64+(time-start)/(end-start)*540;
    const centers=rows.map(p=>axisX((m.timestamp(p.from)+m.timestamp(p.to)+dayMs)/2));
    const x=i=>centers[i],y=v=>215-(v-min)/(max-min)*130;
    const contextEnd=rows.filter(p=>p.context).at(-1)?.to;
    const crossYear=rows[0].from.slice(0,4)!==rows.at(-1).to.slice(0,4);
    const shortDate=day=>day.slice(8)+'/'+day.slice(5,7)+(crossYear?'/'+day.slice(2,4):'');
    const axisTicks=[0];
    for(let i=1;i<rows.length-1;i++){
      if(x(i)-x(axisTicks.at(-1))>=48&&x(rows.length-1)-x(i)>=48)axisTicks.push(i);
    }
    if(x(rows.length-1)-x(axisTicks.at(-1))>=48)axisTicks.push(rows.length-1);
    let active=-1;
    const label=i=>{const p=rows[i];return [`${trendPeriod(p)}`,p.context?'Contexto anterior':'',...series.map(s=>`${s.label}: ${format(s.values[i])}${s.rows[i].partial?' · parcial':''}`),`${n(p.orders)} pedidos · ${n(p.clients)} clientes`,`Ticket: ${p.ticket===null?'Sin datos':money(p.ticket)}`,p.unknown?`${n(p.unknown)} líneas sin datos`:p.partial?'Importes conocidos; datos parciales':''];};
    function line(x1,y1,x2,y2,color,width=1,dash=[]) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);}
    function draw() {
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(3,window.devicePixelRatio||1);
      const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      ctx.setTransform(canvas.width/620,0,0,canvas.height/260,0,0);
      ctx.clearRect(0,0,620,260);ctx.fillStyle='#fff';ctx.fillRect(0,0,620,260);ctx.font='11px Arial';
      if(contextEnd){
        const boundary=axisX(m.timestamp(contextEnd)+dayMs);
        ctx.fillStyle='#edf4fb';ctx.fillRect(64,70,boundary-64,150);
        line(boundary,70,boundary,220,'#9ab4cf',1,[3,3]);
      }
      for(const k of [0,.5,1]){const tick=min+(max-min)*k;line(64,y(tick),605,y(tick),'#e5ebf1');ctx.fillStyle='#63758c';ctx.textAlign='right';ctx.fillText(compact(tick),57,y(tick)+4);}
      if(f.source==='history-warehouse'&&handover&&rows.some(p=>p.from<=handover.warehouseFrom&&p.to>=handover.warehouseFrom)){
        const changeX=axisX(m.timestamp(handover.warehouseFrom)+dayMs/2);
        line(changeX,74,changeX,219,'#238378',1,[4,4]);ctx.fillStyle='#176c63';ctx.textAlign='center';ctx.fillText(`${date(handover.warehouseFrom)} · cambio de fuente`,Math.max(160,Math.min(493,changeX)),18);
      }
      if(f.dimension==='ticket')for(const s of series)if(s.annual.ticket!==null)line(64,y(s.annual.ticket),605,y(s.annual.ticket),series.length>1?s.color:'#df922e',1.5,[5,4]);
      const pointRadius=Math.min(3.5,Math.max(1.5,250/rows.length));
      for(const s of series){
        ctx.strokeStyle=s.color;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();let gap=true;
        s.values.forEach((v,i)=>{if(v===null){gap=true;return;}if(gap||rows[i].context!==rows[i-1].context)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));gap=false;});ctx.stroke();
        s.values.forEach((v,i)=>{if(v!==null){ctx.beginPath();ctx.arc(x(i),y(v),i===active?6:pointRadius,0,Math.PI*2);ctx.fillStyle=s.color;ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.stroke();}});
      }
      ctx.fillStyle='#63758c';ctx.textAlign='center';ctx.font='10px Arial';
      axisTicks.forEach(i=>ctx.fillText(shortDate(rows[i].from),x(i),241));
      if(active<0||!rows[active])return;
      const p=rows[active],peak=Math.max(...series.map(s=>s.values[active]).filter(v=>v!==null),-Infinity),pointY=peak===-Infinity?85:y(peak);
      line(x(active),pointY+8,x(active),219,'#64809b',1,[3,3]);
      const unit=f.dimension==='orders'?' ped.':f.dimension==='clients'?' clientes':'';
      const period=p.from===p.to?shortDate(p.from):`${shortDate(p.from)}–${shortDate(p.to)}`;
      const lines=series.length>1?[`${period}${p.context?' · contexto':''}`,...series.map(s=>`${s.label}: ${format(s.values[active])}${unit}${s.rows[active].partial?' *':''}`)]:[`${period} · ${format(values[active])}${unit}${p.partial?' *':''}`,`${n(p.orders)} ped. · ${n(p.clients)} clientes${p.context?' · contexto':''}`];
      ctx.font='9px Arial';
      const w=Math.min(196,Math.max(100,...lines.map(t=>ctx.measureText(t).width+18))),h=10+lines.length*13;
      const tx=Math.max(4,Math.min(616-w,x(active)-w/2)),ty=Math.max(25,pointY-h-12);
      canvas.dataset.tooltipBounds=JSON.stringify({x:tx,y:ty,width:w,height:h,pointX:x(active),pointY});
      ctx.save();ctx.shadowColor='rgba(17,35,55,.14)';ctx.shadowBlur=5;ctx.fillStyle='#142e49';ctx.beginPath();ctx.roundRect(tx,ty,w,h,4);ctx.fill();ctx.restore();
      ctx.fillStyle='#142e49';ctx.beginPath();ctx.moveTo(x(active)-4,ty+h);ctx.lineTo(x(active),ty+h+5);ctx.lineTo(x(active)+4,ty+h);ctx.fill();
      ctx.textAlign='left';lines.forEach((text,i)=>{ctx.font=(i===0?'bold ':'')+'9px Arial';ctx.fillStyle=i===0?'white':'#b9d3e9';ctx.fillText(text,tx+9,ty+14+i*13,w-18);});
    }
    function show(index,keyboard=false){
      const next=Math.max(0,Math.min(rows.length-1,index));
      if(keyboard&&readout)readout.textContent=label(next).filter(Boolean).join('. ');
      if(next===active)return;
      active=next;
      canvas.dataset.activeDate=rows[active].from;canvas.dataset.activeMonth=rows[active].from.slice(0,7);
      draw();
    }
    function pointer(e){
      const rect=canvas.getBoundingClientRect(),px=(e.clientX-rect.left)/rect.width*620;
      const nearest=centers.reduce((best,center,i)=>Math.abs(center-px)<Math.abs(x(best)-px)?i:best,0);
      show(nearest);
    }
    function hide(){active=-1;delete canvas.dataset.activeDate;delete canvas.dataset.activeMonth;delete canvas.dataset.tooltipBounds;if(readout)readout.textContent='';draw();}
    function key(e){if(!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key))return;e.preventDefault();if(e.key==='Escape'){hide();return;}show(e.key==='Home'?0:e.key==='End'?rows.length-1:active<0?0:active+(e.key==='ArrowLeft'?-1:1),true);}
    canvas.addEventListener('pointermove',pointer);canvas.addEventListener('pointerdown',pointer);canvas.addEventListener('pointerleave',hide);canvas.addEventListener('keydown',key);canvas.addEventListener('focus',()=>{if(rows.length)show(0,true);});canvas.addEventListener('blur',hide);
    const observer=new ResizeObserver(draw);observer.observe(canvas);draw();
    chartCleanup=()=>observer.disconnect();
  }
  function render(focus,selection) {
    if (!session) return;
    clearTimeout(productTimer);
    const {data,input,panel}=session;
    const previousPanel=panel.querySelector('.bi-filter-panel');
    const filtersOpen=previousPanel ? previousPanel.open : !window.matchMedia?.('(max-width:720px)').matches;
    const result=calculated('analysis',filters,()=>m.analyze(data,filters)), t=result.totals;
    const operationalRows=m.selected(data,{...filters,metric:'ordered'}).filter(r=>r.source==='catalog'||r.source==='warehouse');
    const warehouseTotals=m.totals(operationalRows);
    const warehouseMoneyKnown=warehouseTotals.deliveryKnownLines>warehouseTotals.deliveredMissingValues;
    const warehouseMoneyPartial=warehouseTotals.deliveryUnknownLines||warehouseTotals.missingValues||warehouseTotals.deliveredMissingValues;
    const hasRecentOrders=operationalRows.length>0;
    report=calculated('report',filters,()=>m.reporting(data,filters));
    const knownOpportunities=calculations.get(calculationKey('opportunities',filters));
    const opportunityCount=knownOpportunities?actionable(knownOpportunities).length:null;
    const source=m.sourceRows(data,filters.source,filters.metric);
    const dimension=key=>[...new Set(source.map(r=>r[key]))].sort().map(v=>[v,v]);
    const isInvoice=filters.metric==='invoiced';
    const isDelivered=['delivered','invoiceDate'].includes(filters.metric);
    const metricLabel=filters.metric==='invoiceDate'?'Facturado por fecha de factura':filters.metric==='delivered'?deliveryMeasureName:isInvoice?'Facturado ERP estimado':'Pedido';
    const sourceNames={erp:'Historial Excel',warehouse:'WarehousePick',catalog:'Catálogo','history-warehouse':'Excel + todos los pedidos de WarehousePick',combined:'Excel + catálogo'};
    const invoiceUnavailable=filters.source==='catalog' || (!input.batches.length) || filters.from>data.coverage.to;
    const assignedBuyers=new Set(result.rows.filter(r=>r.clientId && (isDelivered?r.deliveredQty:isInvoice?r.invoicedQty:r.orderedQty)).map(r=>r.clientCode)).size;
    const selectedClient=data.clients.find(c=>String(c.clientCode)===filters.client);
    rendering=true;
    try {
    panel.innerHTML=`<div class="sales-bi">
      <header class="bi-header"><div><span class="bi-eyebrow">LEXO / INTELIGENCIA COMERCIAL</span><h2>Análisis de ventas</h2><p>Rendimiento de ventas y oportunidades para tu próxima visita.</p></div><div class="bi-header-actions">${input.admin&&!input.simple?'<button type="button" data-bi-groups>Agrupar clientes</button><button type="button" data-bi-access>Accesos al dashboard</button>':''}<a class="bi-guide-link" href="/sales-dashboard-guide.html" target="_blank" rel="noopener">Guía</a><button type="button" data-bi-workbook>Descargar Excel</button><button type="button" data-bi-export>Exportar filas</button><button type="button" data-bi-refresh>Actualizar</button><span data-bi-export-status role="status" hidden></span></div></header>
      ${input.live?`<div class="bi-live-status" data-bi-live-status role="status">En vivo · ${safe(new Date(input.updatedAt).toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}))}</div>`:'<div class="bi-live-status">Vista de archivos históricos · <a href="/live">Conectar datos actuales del catálogo</a></div>'}
      <nav class="bi-section-tabs" aria-label="Secciones del dashboard"><button type="button" data-bi-section="sales" aria-pressed="${section==='sales'}">Ventas</button><button type="button" data-bi-section="vendors" aria-pressed="${section==='vendors'}">Vendedores</button>${input.admin&&!input.simple?`<button type="button" data-bi-section="directory" aria-pressed="${section==='directory'}">Clientes y vendedores</button><button type="button" data-bi-section="quality" aria-pressed="${section==='quality'}">Revisión de datos</button>`:''}</nav>
      <div class="bi-layout"><aside class="bi-sidebar"><details class="bi-filter-panel" open><summary>Filtros y cartera</summary><h3>Explorar ventas</h3>
      ${input.admin||input.fullAccess?`<label><span>Vendedor actual</span><select data-bi-salesman>${options(input.salesmen.map(s=>[s.code,`${s.code==='*'?'':s.code+' · '}${s.name}`]),input.salesmanCode)}</select></label>`:`<p class="bi-scope">Cartera del vendedor ${safe(input.salesmanCode || 'sin asignar')}</p>`}
      <form data-bi-filters>
      ${select('source','Origen de los pedidos',[['history-warehouse','Excel + catálogo + WarehousePick (principal)'],['erp','Historial Excel'],['warehouse','WarehousePick'],['catalog','Catálogo'],['combined','Excel + catálogo (alternativa)']])}
      ${select('metric','Analizar por',[['ordered','Pedido'],['invoiceDate','Facturado']])}
      <div class="bi-date-shortcuts"><button type="button" data-bi-preset="current">Este mes</button><button type="button" data-bi-preset="all">Todo el historial</button><button type="button" data-bi-preset="recent">Últimos 30 días</button><button type="button" data-bi-preset="month">Último mes completo</button><button type="button" data-bi-preset="year">12 meses</button></div>
      <label><span>Desde</span><input name="from" type="date" value="${safe(filters.from)}" max="${m.recentRange(1).to}" required></label><label><span>Hasta (inclusive)</span><input name="to" type="date" value="${safe(filters.to)}" max="${m.recentRange(1).to}" required></label>
      ${select('compare','Comparar con',[['year','Mismo período del año anterior'],['period','Período anterior de igual duración']])}
      ${select('client','Cliente',[['','Todos los clientes'],...data.clients.map(c=>[String(c.clientCode),`${c.displayCode||c.clientCode} · ${c.legalName || c.name}`]),...(!selectedClient&&filters.client?[[filters.client,filters.client+' · Sin asignación']]:[])])}
      ${select('brand','Marca',[['','Todas las marcas'],...dimension('brand')])}
      ${select('category','Categoría',[['','Todas las categorías'],...dimension('category')])}
      ${select('province','Provincia de destino',[['','Todas las provincias'],...dimension('province')])}
      <label><span>Producto o SKU</span><input type="search" name="product" value="${safe(filters.product)}" placeholder="Buscar en las ventas"></label>
      <p class="bi-error" data-bi-error role="alert"></p><button type="button" class="bi-reset" data-bi-reset>Restablecer</button></form>
      <p class="bi-sidebar-note">ARS nominales, sin IVA.<br>Asignación actual de clientes.</p></details></aside>
      <main class="bi-main"><div class="bi-context"><div><strong>${date(filters.from)} — ${date(filters.to)}</strong><span>${safe(sourceNames[filters.source])}${filters.client?' · Cliente '+safe(filters.client):''}${filters.brand?' · '+safe(filters.brand):''}</span></div><span class="bi-context-measure">${safe(metricLabel.toUpperCase())}</span></div>
      ${headlines()}
      ${clientAnalysis()}
      ${productHealthPanel()}
      ${ticketSummary()}
      <section class="bi-source-cards" aria-label="Ventas por origen en el período seleccionado">${[['erp','Historial Excel'],['warehouse','WarehousePick'],['catalog','Catálogo']].map(([key,label])=>{const rows=m.selected(data,{...filters,source:key}),dates=rows.map(r=>r.occasionDate||r.date).sort();return `<button type="button" data-bi-source="${key}"><b>${label}</b><strong>${new Set(rows.map(r=>r.occasionId||r.orderId)).size} pedidos · ${n(rows.length)} líneas</strong><small>${dates.length?`${date(dates[0])} — ${date(dates.at(-1))}`:'Sin registros en el período'}</small></button>`;}).join('')}</section>
      ${handoverBanner()}
      ${!data.warehouseAvailable&&filters.source!=='erp'?`<p class="bi-notice" role="status" data-bi-delivery-notice>${input.delivery?.reason==='loading'?'Cargando entregas…':input.simple?'No se pudieron consultar las entregas.':input.delivery?.reason==='access_denied'?'Acceso a entregas de WarehousePick rechazado.':input.delivery?.reason==='lines_unavailable'?'WarehousePick no devolvió el detalle por producto.':'No se pudieron consultar las entregas de WarehousePick.'}</p>`:''}
      ${input.historyStatus?'<p class="bi-notice" role="status" data-bi-history-notice>'+({loading:'Cargando historial de ventas…',unavailable:'No se pudo cargar el historial. Se muestran los datos disponibles.',stale:'No se pudo actualizar el historial. Se muestra la última versión cargada.'}[input.historyStatus])+'</p>':!input.available?'<p class="bi-notice" role="status">El historial ERP todavía no está habilitado en este entorno. Podés explorar los pedidos del catálogo.</p>':!input.batches.length?'<p class="bi-notice">Todavía no hay historial ERP importado.</p>':''}
      ${data.warehouseAvailable&&filters.source!=='erp'&&hasRecentOrders&&!warehouseTotals.deliveryKnownLines?'<p class="bi-notice" role="status" data-bi-delivery-notice>Sin líneas de entrega conciliadas para estos filtros.</p>':''}
      ${stockSummary()}
      ${chart()}
      <div class="bi-insights"><article><span>Acción necesaria</span><strong>${report.customers.filter(c=>c.situation==='action').length}</strong><p>Clientes a 14 días o menos de su próxima compra esperada.</p><button type="button" data-bi-status="action">Ver clientes</button></article><article><span>Fuera de frecuencia</span><strong>${report.customers.filter(c=>c.situation==='overdue').length}</strong><p>Clientes cuya fecha de compra esperada ya pasó.</p><button type="button" data-bi-status="overdue">Ver clientes</button></article><article><span>${filters.client?'Ampliar este cliente':'Ampliar la cartera'}</span><strong data-bi-opportunity-count aria-busy="${opportunityCount===null}">${opportunityCount===null?'…':opportunityCount}</strong><p>Clientes activos (compraron en los últimos 12 meses) con productos para ofrecer.</p><button type="button" data-bi-tab="opportunities">Ver clientes</button></article></div>
      <section class="bi-card"><nav class="bi-tabs" aria-label="Detalle de ventas">${[['customers','Clientes'],['products','Productos'],['orders','Pedidos'],['deliveries','Pedido vs facturado'],['comparison','Comparar fuentes'],['restocks','Reposiciones'],['opportunities','Oportunidades']].map(([v,label])=>`<button type="button" data-bi-tab="${v}" aria-pressed="${tab===v}">${label}</button>`).join('')}</nav>
      ${filters.client?`<div class="bi-client-context"><div><strong>${safe(selectedClient?.legalName || selectedClient?.name || filters.client)}</strong><span>Cliente ${safe(selectedClient?.displayCode||filters.client)} · ${safe(selectedClient?.locality || '')}</span></div><button type="button" data-bi-clear-client>Ver toda la cartera</button>${!input.readOnly&&selectedClient?.id&&(!selectedClient.members||selectedClient.members.some(c=>c.id))?`<button type="button" data-bi-order>${selectedClient.members?'Elegir local y crear pedido':'Crear pedido'}</button>`:''}</div>`:''}
      <div data-bi-detail>${detail(result)}</div></section>
      ${brandPortfolioPanel()}
      <p class="bi-data-note">Marcas históricas confirmadas por SKU en la revisión manual. Se excluyen de todos los totales ${m.reviewed.excludedSkus.length} SKUs indicados por el administrador; los registros originales se conservan.</p><footer class="bi-footer"><span>${result.rows.length.toLocaleString('es-AR')} líneas filtradas · ${t.unclassified} sin marca identificada · ${t.unmatched} fuera del catálogo actual.</span><span>Las oportunidades describen el historial disponible; no implican que nunca haya comprado.</span></footer>
      </main></div></div>`;
    const root=panel.querySelector('.sales-bi');
    if((input.admin||input.fullAccess)&&!input.simple){
      const label=root.querySelector('[data-bi-salesman]')?.closest('label');
      if(label)label.insertAdjacentHTML('afterend',`<button type="button" class="bi-preview-button" data-bi-preview ${['*','unassigned',''].includes(input.salesmanCode)?'disabled':''}>Ver como este vendedor</button>`);
    }
    if(input.preview)root.insertAdjacentHTML('afterbegin',`<div class="bi-preview-toolbar"><b>Vista del vendedor · ${safe(input.salesmen.find(s=>s.code===input.salesmanCode)?.name||input.salesmanCode)}</b><button type="button" data-bi-return-admin>${input.admin?'Volver a administración':'Volver al dashboard general'}</button></div>`);
    if(input.simple)simplifySalesman(root);

    if(section==='directory'&&input.admin&&!input.simple){
      root.querySelector('.bi-sidebar').hidden=true;
      root.querySelector('.bi-layout').classList.add('bi-directory-layout');
      root.querySelector('.bi-main').innerHTML=directoryView(input);
      filterDirectory(root);
    }
    if(section==='quality'&&input.admin&&!input.simple)root.querySelector('.bi-main').innerHTML=qualityView();
    if(section==='vendors') {
      const main=root.querySelector('.bi-main');
      const previousTab=tab;tab='vendors';const vendors=detail(result);tab='customers';const customers=detail(result);tab=previousTab;
      main.innerHTML=vendorFocus!==null?vendorProfile(vendorFocus):`<section class="bi-card"><h2>Vendedores</h2><p class="bi-data-note">Elegí un vendedor para ver todos sus datos, sus clientes y la comparación con la empresa.</p>${vendors}</section>${headlines()}${ticketSummary()}${chart()}<section class="bi-card"><h3>Cartera de clientes · ${safe(input.salesmen?.find(s=>s.code===input.salesmanCode)?.name||'Todos los vendedores')}</h3><div data-bi-detail>${customers}</div></section>`;
    }
    clearTimeout(opportunityTimer);
    if(opportunityCount===null){const currentSession=session;const update=()=>{if(session!==currentSession||session.panel.querySelector('.sales-bi')!==root)return;const value=actionable(calculated('opportunities',filters,()=>m.opportunityReport(data,filters))).length;const node=root.querySelector('[data-bi-opportunity-count]');if(node){node.textContent=value;node.setAttribute('aria-busy','false');}};opportunityTimer=setTimeout(()=>{if(window.requestIdleCallback)window.requestIdleCallback(update,{timeout:1500});else update();},0);}
    decorateTables(root);decorateInfo(root);bindInfo(root);
    bindChart(root);window.RESTOCK_NOTICES?.bind(root);
    root.querySelector('.bi-filter-panel').open=filtersOpen;
    root.addEventListener('submit',apply);
    root.addEventListener('click',click);
    root.addEventListener('change',e=>{
      if(rendering) return;
      if(e.target.matches('[data-bi-chart]')) {
        const next={...chartFilters,[e.target.dataset.biChart]:e.target.value};
        chartFilters=next;render(`[data-bi-chart="${e.target.dataset.biChart}"]`);return;
      }
      if(e.target.matches('[data-bi-salesman]')) { input.onSalesman(e.target.value); return; }
      if(e.target.matches('[data-bi-customer-status]')) { customerStatus=e.target.value; renderDetail(); }
      if(e.target.matches('[data-bi-filters] select, [data-bi-filters] input')) {
        applyFilters(e.target.form,`[name="${e.target.name}"]`);
      }
    });
    root.addEventListener('input',e=>{
      if(rendering) return;
      if(e.target.matches('[data-bi-directory-search]')) {
        directoryQuery=e.target.value;
        filterDirectory(root);
      }
      if(e.target.matches('[name="product"]')) {
        clearTimeout(productTimer);
        const field=e.target;
        productTimer=setTimeout(()=>{
          if(session?.panel.querySelector('.sales-bi')===root) applyFilters(field.form,'[name="product"]',[field.selectionStart,field.selectionEnd]);
        },180);
      }
      if(e.target.matches('[data-bi-customer-query]')) {
        customerQuery=e.target.value; const start=e.target.selectionStart; renderDetail();
        const field=panel.querySelector('[data-bi-customer-query]'); field.focus(); field.setSelectionRange(start,start);
      }
    });
    if (focus) {
      const field=panel.querySelector(focus); field?.focus({preventScroll:true});
      if(selection) field?.setSelectionRange(...selection);
    }
    } finally { rendering=false; }
  }
  const displayCode=client=>{const code=String(client.displayCode||client.clientCode||'');return code.startsWith('unassigned:')?'Sin código de cliente':code==='kitchen-spot'?'Kitchen Spot':code;};
  const frequencyLabel=a=>!a||!a.annual?.orders?'Sin compras en 12 meses':a.frequency===null||a.frequency===undefined?(a.annual.orders===1?'1 compra en 12 meses':'Historial insuficiente'):`Cada ${n(a.frequency)} días`;
  const situationLabel=a=>!a||!a.annual?.orders?'Sin compras en 12 meses':a.frequency===null||a.frequency===undefined?'1 compra: sin frecuencia aún':situationLabels[a.situation]||'—';
  function filteredCustomers(result) {
    const activity = new Map(report.customers.map(c => [String(c.client.clientCode), c]));
    const query = m.norm(customerQuery);
    return result.customers.map(c => ({...c, activity: activity.get(String(c.client.clientCode))}))
      .filter(c => (customerStatus === 'every' || (customerStatus === 'all' ? c.activity?.annual?.orders > 0 || c.activity?.period?.orders > 0 : c.status === customerStatus || c.activity?.situation === customerStatus)) &&
        m.norm(`${c.client.name} ${c.client.legalName} ${c.client.displayCode || c.client.clientCode} ${c.client.members?.map(member => member.name).join(' ') || ''} ${c.client.locality}`).includes(query));
  }
  function deliveryDocument(row) {
    if(row.deliveryConfirmed)return [row.invoiceNumber,row.remitoNumber].filter(Boolean).join(' / ')||'Confirmado';
    if(row.deliveryConfirmed===false)return 'Pendiente de confirmación';
    return session.data.warehouseAvailable?'Sin vínculo disponible':'Consulta al depósito no disponible';
  }
  function detail(r) {
    if(tab==='restocks')return window.RESTOCK_NOTICES?.view(session.input.simple?session.input.salesmanCode:'',Boolean(session.input.preview||session.input.readOnly))||'<p>Reposiciones no disponibles.</p>';
    if(tab==='vendors')return `<h3>Vendedores · ${filters.metric==='ordered'?'pedido':'entregado / facturado'} · período seleccionado</h3><p class="bi-data-note">Asignación actual del cliente. Nuevos: primera compra registrada en los últimos 12 meses; reactivados: regreso después de al menos 12 meses sin comprar. La primera compra real puede preceder al historial disponible.</p><div class="bi-table-scroll"><table data-bi-table="vendor-analytics"><thead><tr><th>Vendedor</th><th>Período seleccionado</th><th>Mismas fechas del mes anterior</th><th>Variación monto / %</th><th>Últimos 12 meses</th><th>Situaciones de clientes</th><th>Nuevos (12m)</th><th>Reactivados (12m)</th></tr></thead><tbody>${report.vendors.filter(v=>v.current.orders||v.month.orders||v.annual.orders).map(v=>`<tr><td><button type="button" class="bi-client-link" data-bi-vendor="${safe(v.code)}">${safe(salesmanName(v.code))}</button></td><td>${amountLabel(v.current)}</td><td>${amountLabel(v.month)}</td><td>${comparisonBadge(v.change)}</td><td>${amountLabel(v.annual)}</td><td>${Object.entries(v.situations).map(([key,count])=>`${situationLabels[key]}: ${count}`).join('<br>')}</td><td>${v.newClients}</td><td>${v.reactivated}</td></tr>`).join('')}</tbody></table></div>`;
    if(tab==='comparison') {
      const comparisons=m.compareSources(session.data,filters),counts={};for(const row of comparisons)counts[row.status]=(counts[row.status]||0)+1;
      const labels={same:'Coincide',different:'Cantidad diferente','warehouse-only':'Solo en WarehousePick','catalog-only':'Solo en catálogo'};
      const rows=sortedRows(comparisons.slice().sort((a,b)=>(a.status==='same')-(b.status==='same')),'source-comparison',row=>[row.orderLabel,row.name,row.hasCatalog?row.catalogQty:null,row.hasWarehouse?row.warehouseQty:null,row.hasCatalog&&row.hasWarehouse?row.delta:null,labels[row.status]]);
      return `<h3>Catálogo versus WarehousePick</h3><p class="bi-data-note">Mismo período y filtros. Se vinculan por el ID del pedido del catálogo y el SKU. Los pedidos de carga directa del depósito también aparecen. Esta tabla compara fuentes; no suma ambos registros.</p><div class="bi-comparison-counts">${Object.entries(labels).map(([key,label])=>`<span>${label}: <b>${counts[key]||0}</b></span>`).join('')}</div><div class="bi-table-scroll"><table data-bi-table="source-comparison" data-bi-model-sort><caption>${rows.length} productos por pedido${rows.length>200?' · primeros 200; ajustá los filtros':''}</caption><thead><tr><th>Pedido / cliente</th><th>Producto / SKU</th><th>Catálogo (u.)</th><th>WarehousePick (u.)</th><th>Diferencia (u.)</th><th>Estado</th></tr></thead><tbody>${rows.slice(0,200).map(row=>`<tr><td>${safe(row.orderLabel)}<small>${safe(row.clientName)}</small></td><td>${safe(row.name)}<small>${safe(row.sku)}</small></td><td>${row.hasCatalog?n(row.catalogQty):'Sin registro'}</td><td>${row.hasWarehouse?n(row.warehouseQty):'Sin registro'}</td><td>${row.hasCatalog&&row.hasWarehouse?n(row.delta):'—'}</td><td>${labels[row.status]}</td></tr>`).join('')||'<tr><td colspan="6">No hay registros para comparar.</td></tr>'}</tbody></table></div>`;
    }
    if(tab==='deliveries') {
      const pending=row=>row.deliveredQty===null||row.deliveredQty===undefined?null:Math.max(0,row.orderedQty-row.deliveredQty-Number(row.outOfStockQty||0));
      const origin=row=>row.source==='catalog'?'Catálogo · no llegó a WarehousePick':row.catalogOrderId?'Catálogo':'Cargado en el depósito';
      const gapValue=row=>row.ordered===null||row.ordered===undefined||row.deliveredQty===null||row.deliveredQty===undefined||!row.orderedQty?null:row.ordered/row.orderedQty*(row.orderedQty-row.deliveredQty);
      const rows=sortedRows(m.selected(session.data,{...filters,metric:'ordered'}).filter(row=>['catalog','warehouse'].includes(row.source)),'delivery-lines',row=>[row.orderLabel||row.orderId,row.productName,row.orderedQty,row.deliveredQty,row.outOfStockQty,pending(row),gapValue(row),origin(row)]);
      const qty=v=>v===null||v===undefined?'Sin datos':n(v);
      return `<h3>Pedido versus facturado por producto</h3><p class="bi-data-note">${rows.length} líneas${rows.length>100?' · primeras 100; exportá para ver todas':''}. Facturado = unidades marcadas con stock en WarehousePick.</p><div class="bi-table-scroll"><table data-bi-table="delivery-lines" data-bi-model-sort><thead><tr><th>Pedido / Cliente</th><th>Producto / SKU</th><th>Pedido (u.)</th><th>Facturado con stock (u.)</th><th>Sin stock (u.)</th><th>Sin marcar (u.)</th><th>Diferencia sin IVA</th><th>Origen</th></tr></thead><tbody>${rows.slice(0,100).map(row=>`<tr><td>${safe(row.orderLabel||row.orderId)}<small>${safe(row.clientName)}</small></td><td>${safe(row.productName)}<small>${safe(row.sku)}</small></td><td>${n(row.orderedQty)}</td><td>${qty(row.deliveredQty)}</td><td>${qty(row.outOfStockQty)}</td><td>${qty(pending(row))}</td><td>${row.source==='catalog'?'Sin dato del depósito':gapValue(row)===null?'Sin importe':money(gapValue(row))}</td><td>${origin(row)}</td></tr>`).join('')||'<tr><td colspan="8">No hay pedidos de WarehousePick ni del catálogo para estos filtros.</td></tr>'}</tbody></table></div>`;
    }
    if (tab==='orders'&&filters.metric==='invoiceDate') {
      const rows=sortedRows([...r.rows].sort((a,b)=>b.date.localeCompare(a.date)),'invoice-lines',
        row=>[row.date,deliveryDocument(row),row.clientName,row.sku,row.invoicedQty,row.invoiced]);
      return `<h3>Líneas facturadas</h3><div class="bi-table-scroll"><table data-bi-table="invoice-lines" data-bi-model-sort>
        <caption>${n(rows.length)} líneas${rows.length>100?' · primeras 100; exportá para ver todas':''}</caption>
        <thead><tr><th>Fecha de factura</th><th>Comprobante</th><th>Cliente</th><th>Producto / SKU</th><th>Unidades facturadas</th><th>Importe sin IVA</th></tr></thead>
        <tbody>${rows.slice(0,100).map(row=>`<tr><td>${date(row.date)}</td><td>${safe(deliveryDocument(row))}<small>${safe(row.orderLabel)}</small></td><td>${safe(row.clientName)}</td><td>${safe(row.productName)}<small>${safe(row.sku)}</small></td><td>${n(row.invoicedQty)}</td><td>${row.invoiced===null?'Sin importe':money(row.invoiced)}</td></tr>`).join('')||'<tr><td colspan="6">Sin líneas facturadas disponibles.</td></tr>'}</tbody></table></div>`;
    }
    if (tab==='orders') {
      const orders=new Map();
      for(const row of r.rows) { const key=row.occasionId||row.orderId; if(!orders.has(key)) orders.set(key,[]); orders.get(key).push(row); }
      const sorted=[...orders.entries()].sort((a,b)=>b[1][0].date.localeCompare(a[1][0].date)||b[0].localeCompare(a[0]));
      return `<h3>Pedidos y líneas</h3><p class="bi-data-note">${sorted.length} pedidos en la selección. ${sorted.length>50?'Se muestran los 50 más recientes. Ajustá las fechas o exportá todas las filas.':''}</p>${sorted.slice(0,50).map(([id,rows])=>`<details class="bi-order"><summary><strong>${safe(rows[0].orderLabel||id)}</strong><small class="bi-source-badge bi-source-${rows[0].source}">${safe(sourceLabel(rows[0].source))}</small><span>${date(rows[0].date)} · ${safe(rows[0].clientName)}</span><b>${money(rows.reduce((s,row)=>s+row.ordered,0))} pedido</b></summary><p class="bi-data-note">Origen: ${safe(sourceLabel(rows[0].source))}${rows[0].sourceFile?` · Archivo: ${safe(rows[0].sourceFile)}`:''}</p><div class="bi-table-scroll"><table data-bi-table="order-${safe(id)}"><thead><tr><th>Producto / SKU</th><th>Pedido (u.)</th><th>Facturado (u.)</th><th>Pedido sin IVA</th><th>Facturado sin IVA</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${safe(row.productName)}<small>${safe(row.sku)}</small></td><td>${n(row.orderedQty)}</td><td>${(row.source==='erp'?row.invoicedQty:row.deliveredQty)==null?'No disponible':n(row.source==='erp'?row.invoicedQty:row.deliveredQty)}</td><td>${row.ordered==null?'Sin importe':money(row.ordered)}</td><td>${(row.source==='erp'?row.invoiced:row.delivered)==null?'No disponible':money(row.source==='erp'?row.invoiced:row.delivered)}</td></tr>`).join('')}</tbody></table></div></details>`).join('') || '<p>No hay pedidos para estos filtros.</p>'}`;
    }
    if (tab==='geography') return `<h3>Ventas por provincia de destino</h3>${bars(r.provinces,'province')}<p class="bi-data-note">Los pedidos del catálogo sin provincia aparecen en Sin provincia.</p>`;
    if(tab==='opportunities') {
        const opportunities=actionable(calculated('opportunities',filters,()=>m.opportunityReport(session.data,filters)));
      const missing=opportunities.filter(o=>o.missing.length),best=opportunities.filter(o=>o.bestsellers.length);
      const table=(items,kind)=>`<div class="bi-table-scroll"><table data-bi-table="opportunity-${kind}" data-bi-model-sort><thead><tr><th>Cliente</th><th>Productos</th></tr></thead><tbody>${sortedRows(items,'opportunity-'+kind,o=>[o.client.legalName||o.client.name,kind==='best'?o.bestsellers[0]?.product.name:o.missing[0]?.name]).slice(0,200).map(o=>`<tr><td><button type="button" data-bi-client="${safe(o.client.clientCode)}">${safe(o.client.legalName||o.client.name)}</button></td><td>${(kind==='best'?o.bestsellers.map(p=>({...p.product,qty:p.qty})):o.missing).map(p=>`<button type="button" class="bi-opportunity-product" data-bi-product="${safe(p.sku)}">${safe(p.sku)} · ${safe(p.name)}${kind==='best'?` <small>${n(p.qty)} unidades vendidas en la empresa</small>`:''}</button>`).join('')}</td></tr>`).join('')||'<tr><td colspan="2">Sin oportunidades para esta selección.</td></tr>'}</tbody></table></div>`;
      return `<h3>Oportunidades por cliente</h3><p class="bi-data-note">Solo clientes que compraron en los últimos 12 meses.</p><section class="bi-opportunity-group"><h4>Más vendidos de la empresa que no compra${session.data.companyRankingPartial?' · parcial':''}</h4>${session.data.companyBestsellers===null&&!session.data.companyRankingAvailable?'<p class="bi-empty">Ranking general pendiente de actualización.</p>':table(best,'best')}</section><section class="bi-opportunity-group"><h4>Productos antes comprados, ahora ausentes</h4>${table(missing,'missing')}</section>`;

    }
    if (tab==='products') return productView();
    const rows=sortedRows(filteredCustomers(r),'customer-analytics',({client,activity:a})=>[client.legalName||client.name,salesmanName(client.salesmanCode),a?.period.amount,a?.annual.amount,a?.frequency,a?.last,situationLabels[a?.situation||'insufficient']]);
    return `<div class="bi-detail-toolbar"><label>Buscar cliente<input type="search" data-bi-customer-query value="${safe(customerQuery)}" placeholder="Nombre, código o localidad"></label><label>Situación<select data-bi-customer-status>${options([['all','Con compras en 12 meses'],...Object.entries(situationLabels).filter(([k])=>k!=='insufficient'),['every','Todos, incluso sin compras']],customerStatus)}</select></label><span>${rows.length} clientes</span></div>
      <div class="bi-table-scroll"><table data-bi-table="customer-analytics" data-bi-model-sort><caption>Clientes · ventas y frecuencia</caption><thead><tr><th>Cliente</th><th>Vendedor</th><th>Venta del período</th><th>Ventas 12m al cierre</th><th>Frecuencia promedio</th><th>Última compra</th><th>Situación</th></tr></thead><tbody>${rows.map(c=>{const a=c.activity;return `<tr><td><button type="button" class="bi-client-link" data-bi-client="${safe(c.client.clientCode)}">${safe(c.client.legalName||c.client.name)}</button><small>${safe(displayCode(c.client))}</small></td><td>${safe(salesmanName(c.client.salesmanCode))}</td><td>${a?amountLabel(a.period):'—'}</td><td>${a?amountLabel(a.annual):'—'}</td><td>${frequencyLabel(a)}</td><td>${a?.last?date(a.last):'—'}</td><td>${situationLabel(a)}${a?.remaining!==null&&a?.remaining!==undefined&&a?.frequency!==null?`<small>${a.remaining<0?n(-a.remaining)+' días fuera de frecuencia':n(a.remaining)+' días hasta próxima compra esperada'}</small>`:''}</td></tr>`;}).join('')||'<tr><td colspan="7">No hay clientes para estos filtros.</td></tr>'}</tbody></table></div><p class="bi-data-note">Frecuencia al cierre seleccionado: promedio entre ocasiones de compra en los últimos 12 meses. Agregados dentro de 2 días desde el primer pedido forman una ocasión. Acción necesaria desde 14 días antes; sin tolerancia después de la fecha esperada.</p>`;
  }

  function productView() {
    const products=sortedRows(calculated('product-sales',filters,()=>m.productSales(session.data,filters)),'products',p=>[p.name,p.brand,p.sku,p.unknown&&!p.orders?null:p.units,p.unknown&&!p.orders?null:p.amount,p.buyers.length]);
    const seller=c=>c.salesmanCode==='900'?'Adrian':c.salesmanCode==='multiple'?'Varios vendedores':session.input.salesmen?.find(s=>s.code===c.salesmanCode)?.name||c.salesmanCode||'Sin asignación';
    if(filters.productKey) {
      const product=products.find(p=>p.key===filters.productKey);
      return `<section class="bi-product-buyers"><h3>Clientes que compraron este producto</h3><div class="bi-product-toolbar"><button type="button" data-bi-clear-product>← Todos los productos</button></div>${product?`<h4>${safe(product.name)} · ${safe(product.sku)} · ${safe(product.brand)}</h4><div class="bi-secondary-metrics"><span>Unidades <b>${n(product.units)}</b></span><span>Importe <b>${amountLabel(product)}</b></span><span>Clientes compradores <b>${product.buyers.length}</b></span><span>Pedidos distintos <b>${product.orders}</b></span></div><div class="bi-table-scroll"><table data-bi-product-buyers data-bi-table="product-buyers"><thead><tr><th>Cliente</th><th>Vendedor</th><th>Unidades</th><th>Importe</th><th>Pedidos distintos</th><th>Última compra</th></tr></thead><tbody>${product.buyers.map(c=>`<tr><td><button type="button" class="bi-client-link" data-bi-client="${safe(c.client.clientCode)}">${safe(c.client.legalName||c.client.name)}</button><small>${safe(c.client.displayCode||c.client.clientCode)}</small></td><td>${safe(seller(c.client))}</td><td>${n(c.units)}</td><td>${amountLabel(c)}</td><td>${c.orders}</td><td>${date(c.last)}</td></tr>`).join('')||'<tr><td colspan="6">Sin compradores confirmados para esta medida.</td></tr>'}</tbody></table></div>`:'<p>No hay ventas de este producto para los filtros seleccionados.</p>'}</section>`;
    }
    const pages=Math.max(1,Math.ceil(products.length/100));productPage=Math.min(productPage,pages-1);
    return `<h3>Ventas por producto</h3><div class="bi-table-scroll"><table data-bi-products data-bi-table="products" data-bi-model-sort><caption>${products.length} productos · ${date(filters.from)} — ${date(filters.to)}</caption><thead><tr><th>Producto</th><th>Marca</th><th>SKU</th><th>Unidades</th><th>Importe</th><th>Clientes compradores</th></tr></thead><tbody>${products.slice(productPage*100,(productPage+1)*100).map(p=>`<tr><td><button type="button" class="bi-client-link" data-bi-product-key="${safe(p.key)}">${safe(p.name)}</button></td><td>${safe(p.brand)}</td><td>${safe(p.sku)}</td><td>${p.unknown&&!p.orders?'Sin datos':n(p.units)+(p.unknown?' (parcial)':'')}</td><td>${amountLabel(p)}</td><td><button type="button" data-bi-product-key="${safe(p.key)}">Ver clientes (${p.buyers.length})</button></td></tr>`).join('')||'<tr><td colspan="6">No hay productos vendidos para estos filtros.</td></tr>'}</tbody></table></div>${pages>1?`<div class="bi-product-toolbar"><button type="button" data-bi-product-page="${productPage-1}" ${productPage===0?'disabled':''}>Anterior</button><span>Página ${productPage+1} de ${pages}</span><button type="button" data-bi-product-page="${productPage+1}" ${productPage===pages-1?'disabled':''}>Siguiente</button></div>`:''}`;
  }
  function simplifySalesman(scope) {
    scope.classList.add('bi-salesman-view');
    scope.querySelector('[data-bi-salesman]')?.closest('label')?.remove();
    scope.querySelector('.bi-scope')?.remove();
    scope.querySelector('[data-bi-filters]')?.insertAdjacentHTML('beforebegin','<p class="bi-scope">Tu cartera</p>');
    scope.querySelectorAll('.bi-source-cards,.bi-handover,.bi-delivery-summary:not([data-bi-gap]),.bi-footer,.bi-guide-link,.bi-section-tabs,.bi-source-badge,[data-bi-salesman],[data-bi-source],[data-bi-tab="comparison"],[data-bi-tab="deliveries"],[data-bi-tab="geography"],.bi-header [data-bi-export],.bi-header [data-bi-workbook]').forEach(el=>el.remove());
    scope.querySelector('[name="source"]')?.closest('label')?.remove();
    const metric=scope.querySelector('[name="metric"]');
    if(metric){metric.querySelector('[value="invoiced"]')?.remove();const invoiced=metric.querySelector('[value="invoiceDate"]');if(invoiced)invoiced.textContent='Facturado';}
    const context=scope.querySelector('.bi-context>div>span');if(context)context.textContent='Ventas de tu cartera';
    scope.querySelectorAll('.bi-main>.bi-secondary-metrics').forEach(el=>el.remove());
    scope.querySelector('.bi-header h2')?.replaceChildren('Mi gestión comercial');
    scope.querySelectorAll('p.bi-data-note').forEach(el=>el.remove());
    scope.querySelectorAll('.bi-notice:not([data-bi-invoice-notice])').forEach(el=>{el.textContent='Parte de la información no está disponible. Los totales pueden ser parciales.';});
    scope.querySelectorAll('th').forEach(el=>{if(m.norm(el.textContent)==='vendedor'){const i=el.cellIndex;el.closest('table').querySelectorAll('tr').forEach(row=>row.cells[i]?.remove());}});
  }
  function renderDetail() { if(session){const el=session.panel.querySelector('[data-bi-detail]');if(!el)return;el.innerHTML=detail(calculated('analysis',filters,()=>m.analyze(session.data,filters)));if(session.input.simple)simplifySalesman(el);decorateTables(el);decorateInfo(el);window.RESTOCK_NOTICES?.bind(el);} }
  function apply(e) {
    if(!e.target.matches('[data-bi-filters]')) return;
    e.preventDefault();
    const field=document.activeElement;
    applyFilters(e.target,field?.name?`[name="${field.name}"]`:null);
  }
  function applyFilters(form,focus,selection) {
    const next={...filters};
    for(const name of Object.keys(filters)) if(form.elements[name]) next[name]=form.elements[name].value;
    if(!m.validRange(next.from,next.to)) { form.querySelector('[data-bi-error]').textContent='Elegí un rango de fechas válido.'; return; }
    if(next.source!==filters.source) {
      const rows=m.sourceRows(session.data,next.source);
      for(const key of ['brand','category','province']) if(next[key]&&!rows.some(row=>row[key]===next[key])) next[key]='';
    }
    if(next.product!==filters.product)next.productKey='';
    productPage=0;
    if(next.metric!==filters.metric&&chartFilters)chartFilters.metric=next.metric;
    filters=next; render(focus,selection);
  }
  function click(e) {
    const button=e.target.closest('button'); if(!button || !session) return;
    const d=button.dataset;
    if('biAccess' in d){if(session.input.admin)session.input.onManageAccess?.();return;}
    if('biEditClient' in d){editDirectoryClient(d.biEditClient);return;}
    if('biGroups' in d){session.input.onManageGroups?.();return;}
    if('biRefresh' in d) { session.input.onRefresh(); return; }
    if('biSource' in d) { filters.source=d.biSource;filters.brand='';filters.category='';filters.province='';filters.product='';filters.productKey='';render('[name="source"]');return; }
    if('biExport' in d) { download(); return; }
    if('biWorkbook' in d) { void downloadWorkbook(button); return; }
    if('biReset' in d) { filters=null; mount(session.panel,session.input); return; }
    if('biPreview' in d){session.input.onPreview?.(true);return;}
    if('biReturnAdmin' in d){session.input.onPreview?.(false);return;}
    if('biVendor' in d) { vendorFocus=d.biVendor||null; render(); return; }
    if('biSection' in d) { section=d.biSection;vendorFocus=null;tab='customers';render(`[data-bi-section="${section}"]`);return; }
    if('biTab' in d) { tab=d.biTab; render(`[data-bi-tab="${tab}"]`); return; }
    if('biStatus' in d) { customerStatus=d.biStatus; tab='customers'; render('[data-bi-customer-status]'); return; }
    if('biClient' in d) { filters.client=d.biClient;section='sales';vendorFocus=null;tab='customers';render('[name="client"]');return; }
    if('biClearClient' in d) { filters.client=''; render('[name="client"]'); return; }
    if('biOrder' in d) { if(session.input.readOnly)return; const client=session.data.clients.find(c=>String(c.clientCode)===filters.client); if(client?.members)window.DASHBOARD_CLIENT_GROUPS?.chooseClient(client.members,session.input.onClient);else if(client)session.input.onClient(client); return; }
    if('biDimension' in d) { filters[d.biDimension]=d.value; render(`[name="${d.biDimension}"]`); return; }
    if('biProductPage' in d) {productPage=Math.max(0,Number(d.biProductPage)||0);renderDetail();return;}
    if('biProductKey' in d) { filters.productKey=d.biProductKey;filters.product=JSON.parse(d.biProductKey)[1];tab='products';render();return; }
    if('biClearProduct' in d) { filters.productKey='';filters.product='';tab='products';render();return; }
    if('biProduct' in d) { filters.product=d.biProduct;filters.productKey='';tab='products';render('[name="product"]');return; }
    if('biMonth' in d) { filters.from=d.biMonth+'-01'; filters.to=m.iso(Date.UTC(Number(d.biMonth.slice(0,4)),Number(d.biMonth.slice(5)),0)); render('[name="from"]'); return; }
    if('biPreset' in d) {
      const range=m.currentMonthRange();
      if(d.biPreset==='month'){range.to=m.iso(m.timestamp(range.from)-86400000);range.from=range.to.slice(0,7)+'-01';}
      if(d.biPreset==='all') Object.assign(range,m.allRange(session.data,filters.source));
      if(d.biPreset==='recent') Object.assign(range,m.recentRange());
      if(d.biPreset==='year')range.from=m.monthShift(range.from,-11);
      filters={...filters,...range}; render('[name="from"]');
    }
  }
  function csv(rows) {
    return '\ufeff'+rows.map(row=>row.map(value=>{
      const v=typeof value==='string'&&/^[\s]*[=+@\-]/.test(value)?`'${value}`:String(value??'');
      return '"'+v.replace(/"/g,'""')+'"';
    }).join(';')).join('\r\n');
  }
  function download() {
    const rows=m.selected(session.data,filters);
    const body=tab==='comparison'?csv([['Pedido','Cliente','Producto','SKU','Unidades catálogo','Unidades WarehousePick','Diferencia','Estado'],...m.compareSources(session.data,filters).map(r=>[r.orderLabel,r.clientName,r.name,r.sku,r.hasCatalog?r.catalogQty:null,r.hasWarehouse?r.warehouseQty:null,r.hasCatalog&&r.hasWarehouse?r.delta:null,r.status])]):filters.metric==='invoiceDate'?csv([['Fecha de factura','Factura','Remito','Pedido','Cliente','SKU','Producto','Unidades facturadas','Importe sin IVA'],...rows.map(r=>[r.date,r.invoiceNumber,r.remitoNumber,r.orderLabel,r.clientName,r.sku,r.productName,r.invoicedQty,r.invoiced])]):csv([['Fecha pedido','Fecha grupo de compra','ID grupo de compra','Origen','Archivo Excel','Fila Excel','WarehousePick desde (vista principal)','Pedido','Cliente','Nombre cliente','Código de local original','Nombre de local original','SKU','Producto','Marca','Origen de marca','Provincia','Unidades pedidas','Unidades facturadas ERP','Unidades devueltas ERP','Importe pedido sin IVA','Importe facturado estimado sin IVA','Unidades marcadas con stock (facturadas)','Unidades sin stock','Unidades sin marcar','Facturado al precio neto del pedido'],
      ...rows.map(r=>[r.date,r.occasionDate,r.occasionId,sourceLabel(r.source),r.sourceFile,r.sourceRow,session.data.handover?.warehouseFrom,r.orderId,r.clientCode,r.clientName,r.sourceClientCode||r.clientCode,r.sourceClientName||r.clientName,r.sku,r.productName,r.brand,({catalog:'Catálogo actual','reviewed-sku':'Revisión manual por SKU',unclassified:'Sin identificar'})[r.brandSource],r.province,r.orderedQty,r.invoicedQty,r.returnedQty,r.ordered,r.invoiced,r.deliveredQty,r.outOfStockQty,r.pendingDeliveryQty,r.delivered])]);
    const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=`ventas-${filters.source}-${filters.from}-${filters.to}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function downloadWorkbook(button) {
    const current = session;
    if (current.input.simple || !(current.input.admin || current.input.fullAccess)) return;
    const status = current.panel.querySelector('[data-bi-export-status]');
    const showStatus = message => { status.textContent = message; status.hidden = !message; };
    if (!window.XLSX || !window.SALES_BI_EXPORT) {
      showStatus('No se pudo cargar el exportador de Excel. Actualizá la página.');
      return;
    }
    const selection = {...filters};
    const currentReport = report;
    const graph = chartScene;
    const analysis = calculated('analysis', selection, () => m.analyze(current.data, selection));
    const customers = filteredCustomers(analysis);
    const selectedClient = current.data.clients.find(c => String(c.clientCode) === selection.client);
    const context = {
      seller: salesmanName(current.input.salesmanCode),
      client: selectedClient?.legalName || selectedClient?.name || selection.client || 'Todos',
      customerQuery,
      customerStatus: situationLabels[customerStatus] || 'Todas',
      situationLabels,
    };
    button.disabled = true;
    showStatus('Preparando Excel…');
    try {
      const api = window.CATALOG_SUPABASE;
      const [priceResult, restockResult] = await Promise.allSettled([
        api?.loadDashboardExportPrices?.(),
        api?.loadRestockInbox?.(),
      ]);
      if (session !== current || !button.isConnected) return;
      for (const result of [priceResult, restockResult]) {
        if (result.status === 'rejected' && ['42501','PGRST301','PGRST303'].includes(result.reason?.code)) {
          showStatus('Tu sesión ya no tiene acceso a este informe.');
          return;
        }
      }
      const prices = priceResult.status === 'fulfilled' ? priceResult.value : null;
      const restocks = restockResult.status === 'fulfilled' ? restockResult.value : null;
      const {data} = current;
      const chart = {
        ...graph,
        annual: graph.series[0].annual,
        values: graph.series[0].values,
        invoiced: graph.series[1]||null,
        metric: graph.f.metric,
        label: {amount:'Importe',units:'Unidades',orders:'Pedidos distintos',clients:'Clientes distintos',ticket:'Ticket promedio'}[graph.f.dimension],
      };
      const file = window.SALES_BI_EXPORT.workbook(window.XLSX, {
        data, filters: selection, context, report: currentReport, chart, analysis, customers, prices, restocks, sellerName: salesmanName,
        products: calculated('product-sales', selection, () => m.productSales(data, selection)),
        opportunities: calculated('opportunities', selection, () => m.opportunityReport(data, selection)),
        comparison: m.compareSources(data, selection), loss: m.stockLoss(data, selection),
        invoiceRows:m.selected(data,{...selection,metric:'invoiceDate'}),
        gap: m.orderedVersusInvoiced(data, selection),
        portfolio: m.brandPortfolio(data, selection), health: selection.source === 'erp' ? null : m.productHealth(data, selection),
        warehouseTotals: selection.source === 'erp' ? null : m.totals(m.selected(data,{...selection,metric:'ordered'}).filter(r => r.source === 'catalog' || r.source === 'warehouse')),
      });
      window.XLSX.writeFile(file, `lexo-dashboard-${selection.from}-${selection.to}.xlsx`, {compression:true});
      showStatus(prices ? '' : 'Excel descargado. La lista de precios no está disponible.');
    } catch (error) {
      console.error('No se pudo exportar el dashboard', error);
      showStatus('No se pudo descargar el Excel. Intentá nuevamente.');
    } finally {
      button.disabled = false;
    }
  }
  window.addEventListener('catalog:restocks-changed',()=>{if(session&&tab==='restocks')renderDetail();});
  window.SALES_BI={ mount,reset,csv,setLiveError:message=>{const el=session?.panel.querySelector('[data-bi-live-status]');if(el)el.textContent=message;},suspend:()=>{clearTimeout(productTimer);chartCleanup?.();chartCleanup=null;chartScene=null;session=null;},syncOwner:value=>{if(owner&&owner!==value) reset();} };
})();
