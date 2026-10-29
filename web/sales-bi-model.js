/* Sales analytics uses explicit ERP quantities, never catalog status as invoice proof. */
(function () {
  const reviewed=typeof module!=='undefined'&&module.exports?require('./sales-product-brands.js'):window.SALES_PRODUCT_BRANDS;
  if(!reviewed)throw new Error('Sales brand review rules are unavailable');
  const excludedSkus=new Set(reviewed.excludedSkus||[]);
  const str = value => String(value ?? '').trim();
  const norm = value => str(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dayMs = 86400000;
  const iso = value => new Date(value).toISOString().slice(0, 10);
  function timestamp(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(day))) return NaN;
    const n = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(n) && iso(n) === day ? n : NaN;
  }
  const validRange = (from, to) => Number.isFinite(timestamp(from)) && Number.isFinite(timestamp(to)) && from <= to;
  function yearBack(day) {
    const d = new Date(timestamp(day)), month = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    if (d.getUTCMonth() !== month) d.setUTCDate(0);
    return iso(d);
  }
  function previousRange(from, to, mode) {
    if (!validRange(from, to)) return null;
    if (mode === 'year') return { from: yearBack(from), to: yearBack(to) };
    const span = timestamp(to) - timestamp(from) + dayMs;
    return { from: iso(timestamp(from) - span), to: iso(timestamp(from) - dayMs) };
  }
  function analysisSalesman(client) {
    const code=str(client.salesmanCode);
    if(str(client.clientCode)==='81032')return 'unassigned';
    return !code||code==='90'||code==='900'?'900':code;
  }
  function prepare(data) {
    data={...data,clients:data.clients.map(c=>({...c,salesmanCode:analysisSalesman(c)}))};
    const clients = new Map(data.clients.map(c => [str(c.clientCode), c]));
    const byId = new Map(data.clients.map(c => [c.id, c]));
    const catalog = new Map();
    for (const p of data.catalog || []) {
      const code = str(p.sku).toUpperCase();
      if (!code) continue;
      if (!catalog.has(code)) catalog.set(code, new Map());
      catalog.get(code).set(`${p.section}:${code}`, p);
    }
    const enrich = row => {
      const sku=str(row.sku).toUpperCase();
      const candidates = catalog.get(sku);
      const product = candidates?.size === 1 ? candidates.values().next().value : null;
      // Historical brand attribution does not create a purchasable catalog item.
      // An ambiguous current SKU cannot be resolved by an unqualified SKU mapping.
      const reviewedBrand=!candidates?.size?reviewed.brands[sku]:null;
      const c = row.unassigned ? null : clients.get(row.clientCode);
      return { ...row, clientId: c?.id || '', clientName: c?.legalName || c?.name || row.clientName,
        locality: c?.locality || row.locality || '',
        brand: product?.section || reviewedBrand || 'Sin vincular', category: product?.category || 'Sin categoría',
        brandSource:product?'catalog':reviewedBrand?'reviewed-sku':'unclassified',
        excludedFromAnalytics:excludedSkus.has(sku),
        productName: product?.name || row.productName, product, matched: Boolean(product) };
    };
    const records = (data.lines || []).map(r => enrich({ id:r.line_key, orderId:`erp:${r.order_key}`, source:'erp',
      date:r.order_date, clientCode:str(r.client_code), clientName:r.client_name, sku:r.sku,
      productName:r.product_name, locality:r.locality, province:r.province || 'Sin provincia',
      orderedQty:Number(r.ordered_qty), invoicedQty:Number(r.invoiced_qty), returnedQty:Number(r.returned_qty),
      ordered:Number(r.ordered_net), invoiced:Number(r.invoiced_net), batchId:r.batch_id, sourceRow:r.source_row,
      sourceFile:(data.batches||[]).find(b=>b.id===r.batch_id)?.source_name||'' }));
    for (const o of data.orders || []) {
      if (['draft','cancelled'].includes(o.status)) continue;
      // Explicit IDs take precedence over potentially stale text customer codes.
      const c = o.customer?.salesClient?.id ? byId.get(o.customer.salesClient.id)
        : clients.get(str(o.customer?.salesClient?.clientCode || o.customer?.clientCode));
      if (!c&&!data.includeUnassigned) continue;
      const d = new Date(o.createdAt);
      if (!Number.isFinite(+d)) continue;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Argentina/Buenos_Aires', year:'numeric',month:'2-digit',day:'2-digit' }).format(d);
      for (const [i,item] of (o.items || []).entries()) records.push(enrich({ id:`web:${o.id}:${i}`, orderId:`web:${o.id}`,orderLabel:o.displayId||o.id, source:'catalog',
        date, clientCode:c?str(c.clientCode):`unassigned:${str(o.customer?.salesClient?.clientCode||o.customer?.clientCode||o.customerId||o.id)}`,
        unassigned:!c,clientName:c?.name||o.customer?.name||'Sin asignación', sku:item.sku, productName:item.name,
        locality:c?.locality||'', province:'Sin provincia', orderedQty:Number(item.qty || 0), invoicedQty:null,
        returnedQty:null, ordered:Number(item.lineTotal || 0), invoiced:null, itemId:item.id, catalogOrderId:o.id }));
    }
    for(const order of data.delivery?.orders||[]) {
      const c=order.clientId?byId.get(order.clientId):clients.get(str(order.clientCode));
      if(!c&&!data.includeUnassigned)continue;
      const d=new Date(order.createdAt);if(!Number.isFinite(+d))continue;
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
      for(const item of order.items||[]) {
        if(item.qty===null||!Number.isFinite(Number(item.qty)))continue;
        records.push(enrich({id:`wh:${order.id}:${item.id}`,orderId:`wh:${order.id}`,orderLabel:`Depósito ${order.number||order.id}`,source:'warehouse',date,
          clientCode:c?str(c.clientCode):`unassigned:${str(order.clientCode)||order.id}`,unassigned:!c,clientName:c?.name||order.clientName,
          sku:item.sku,productName:item.name,locality:c?.locality||'',province:'Sin provincia',orderedQty:Number(item.qty),
          ordered:item.orderedNet??null,invoicedQty:null,invoiced:null,returnedQty:null,
          pickedQty:item.pickedQty??null,deliveredQty:item.deliveredQty??null,pendingDeliveryQty:item.pendingQty??null,
          deliveryConfirmed:item.confirmed??null,delivered:item.deliveredNet??null,invoiceNumber:order.invoiceNumber,
          outOfStockQty:item.outOfStockQty??null,lineStatus:item.lineStatus??null,
          remitoNumber:order.remitoNumber,deliveryConfirmedAt:order.confirmedAt,catalogOrderId:order.externalId,itemId:item.id}));
      }
    }
    const dates = (data.batches || []).map(b => b.to_date).sort();
    const starts = (data.batches || []).map(b => b.from_date).sort();
    const handovers=[...new Set((data.batches||[]).map(b=>b.warehouse_from_date).filter(Boolean))];
    if(handovers.some(d=>!Number.isFinite(timestamp(d)))||handovers.length>1)throw new Error('Invalid or conflicting source handover dates');
    const warehouseFrom=handovers[0]||(dates.length?iso(timestamp(dates.at(-1))+dayMs):null);
    const catalogDates=records.filter(r=>r.source==='catalog').map(r=>r.date).sort();
    const deliveries=new Map((data.delivery?.lines||[]).map(l=>[`${l.orderId}:${l.itemId}`,l]));
    for(const row of records) {
      if(row.source==='warehouse')continue;
      const delivery=row.source==='catalog'?deliveries.get(`${row.catalogOrderId}:${row.itemId}`):null;
      row.pickedQty=delivery?.pickedQty??null;row.deliveredQty=delivery?.deliveredQty??null;
      row.pendingDeliveryQty=delivery?.pendingQty??null;row.deliveryConfirmed=delivery?.confirmed??null;
      row.invoiceNumber=delivery?.invoiceNumber||'';row.remitoNumber=delivery?.remitoNumber||'';row.deliveryConfirmedAt=delivery?.confirmedAt||null;
      row.outOfStockQty=delivery?.outOfStockQty??null;row.lineStatus=delivery?.lineStatus??null;
      row.delivered=delivery&&row.orderedQty ? row.ordered/row.orderedQty*delivery.deliveredQty : delivery?0:null;
      if(row.source==='erp'){row.deliveredQty=row.invoicedQty;row.delivered=row.invoiced;}
    }
    // Group additions against the first order day, never a rolling chain. Keep raw
    // order IDs/dates for provenance; reporting uses the purchase occasion date.
    const occasionScopes=['erp','catalog','warehouse'].map(source=>records.filter(r=>r.source===source));
    occasionScopes.push(records.filter(r=>r.source==='erp'?(!warehouseFrom||r.date<warehouseFrom):r.source==='catalog'&&(!warehouseFrom||r.date>=warehouseFrom)));
    for(const scope of occasionScopes) {
      const byClient=new Map();
      for(const row of scope.filter(r=>!r.excludedFromAnalytics)){
        const key=row.unassigned?'order:'+row.orderId:row.clientCode;
        if(!byClient.has(key))byClient.set(key,[]);byClient.get(key).push(row);
      }
      for(const rows of byClient.values()) {
        rows.sort((a,b)=>a.date.localeCompare(b.date)||a.orderId.localeCompare(b.orderId));let anchor=null,id=null;
        for(const row of rows){if(anchor===null||timestamp(row.date)-timestamp(anchor)>2*dayMs){anchor=row.date;id=row.orderId;}row.occasionId=id;row.occasionDate=anchor;}
      }
    }
    // Preserve unmatched identities while assigning their analysis to Adrian.
    for(const row of records)if(!clients.has(row.clientCode))clients.set(row.clientCode,{id:'',clientCode:row.clientCode,name:row.clientName,salesmanCode:'900'});
    const selectedSalesman=str(data.analysisSalesmanCode);
    const scopedClients=[...clients.values()].filter(c=>!selectedSalesman||selectedSalesman==='*'||c.salesmanCode===selectedSalesman);
    const scopedCodes=new Set(scopedClients.map(c=>str(c.clientCode)));
    return groupClients({ companyRankingPartial:Boolean(data.companyRankingPartial),companyBestsellers:data.companyBestsellers??null,companyRankingAvailable:data.companyRankingAvailable??(!data.analysisSalesmanCode||data.analysisSalesmanCode==='*'),records:records.filter(r=>scopedCodes.has(r.clientCode)), clients:scopedClients, catalog:[...catalog.values()].flatMap(m => [...m.values()]),
      coverage: { from:starts[0] || null, to:dates.at(-1) || null },
      handover:warehouseFrom?{warehouseFrom,excelThrough:iso(timestamp(warehouseFrom)-dayMs),confirmed:handovers.length===1}:null,
      catalogCoverage:{from:catalogDates[0]||null,to:recentRange(1,data.updatedAt?Date.parse(data.updatedAt):Date.now()).to}, batches:data.batches || [],
      catalogAvailable:Array.isArray(data.orders),
      warehouseAvailable:Boolean(data.delivery?.available),warehouseCoverage:{from:records.filter(r=>r.source==='warehouse').map(r=>r.date).sort()[0]||null,to:recentRange(1).to} },data.clientGroups||[]);
  }
  function groupClients(data,groups) {
    const mapping=new Map(),combined=[];
    for(const group of groups){
      const members=data.clients.filter(c=>group.clientCodes.includes(str(c.clientCode)));
      if(!members.length)continue;
      const codes=[...new Set(members.map(c=>c.salesmanCode))];
      const client={id:'group:'+group.id,clientCode:'group:'+group.id,name:group.name,legalName:group.name,
        salesmanCode:codes.length===1?codes[0]:'multiple',locality:'',members,displayCode:members.map(c=>c.clientCode).join(' + ')};
      combined.push(client);for(const member of members){if(mapping.has(str(member.clientCode)))throw new Error('Client appears in more than one dashboard group');mapping.set(str(member.clientCode),client);}
    }
    if(!mapping.size)return data;
    const records=data.records.map(row=>{const c=mapping.get(row.clientCode);return c?{...row,sourceClientCode:row.clientCode,sourceClientName:row.clientName,clientCode:c.clientCode,clientName:c.name,clientId:c.id}: {...row};});
    const scopes=['erp','catalog','warehouse'].map(source=>records.filter(r=>r.source===source));
    scopes.push(records.filter(r=>r.source==='erp'?(!data.handover||r.date<data.handover.warehouseFrom):r.source==='catalog'&&(!data.handover||r.date>=data.handover.warehouseFrom)));
    for(const scope of scopes){const buckets=new Map();for(const row of scope.filter(r=>!r.excludedFromAnalytics)){const key=row.unassigned?'order:'+row.orderId:row.clientCode;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);}
      for(const rows of buckets.values()){rows.sort((a,b)=>a.date.localeCompare(b.date)||a.orderId.localeCompare(b.orderId));let anchor=null,id=null;for(const row of rows){if(anchor===null||timestamp(row.date)-timestamp(anchor)>2*dayMs){anchor=row.date;id=row.orderId;}row.occasionId=id;row.occasionDate=anchor;}}}
    return {...data,records,clients:[...data.clients.filter(c=>!mapping.has(str(c.clientCode))),...combined],groupingBase:data,
      clientGroups:combined.map(c=>({id:c.id.slice(6),name:c.name,clientCodes:c.members.map(m=>str(m.clientCode))}))};
  }
  function sourceRows(data, source) {
    const records=data.records.filter(r=>!r.excludedFromAnalytics);
    if (source === 'catalog') return records.filter(r => r.source === 'catalog');
    if (source === 'warehouse') return records.filter(r => r.source === 'warehouse');
    if (source === 'history-warehouse') return records.filter(r=>r.source==='erp'?(!data.handover||r.date<data.handover.warehouseFrom):r.source==='catalog'&&(!data.handover||r.date>=data.handover.warehouseFrom));
    if (source === 'combined') return records.filter(r => r.source === 'erp' || (r.source==='catalog'&&(!data.coverage.to || r.date > data.coverage.to)));
    return records.filter(r => r.source === 'erp');
  }
  function selected(data, f, includeDate = true) {
    return sourceRows(data, f.source).filter(r => (!includeDate || ((r.occasionDate||r.date) >= f.from && (r.occasionDate||r.date) <= f.to))
      && (!f.client || r.clientCode === f.client) && (!f.brand || r.brand === f.brand)
      && (!f.province || r.province === f.province) && (!f.category || r.category === f.category)
      && (!f.product || norm(`${r.sku} ${r.productName}`).includes(norm(f.product))));
  }
  function totals(rows) {
    const t = { ordered:0, invoiced:0, orderedQty:0, invoicedQty:0, returnedQty:0,deliveredQty:0,pickedQty:0,pendingDeliveryQty:0,delivered:0,deliveryKnownLines:0,deliveryUnknownLines:0,missingValues:0,deliveredMissingValues:0, orders:new Set(), buyers:new Set(), invoicedOrders:new Set(), catalogLines:0, unmatched:0, unclassified:0 };
    for (const r of rows) {
      if(r.excludedFromAnalytics)continue;
      for (const k of ['ordered','invoiced','orderedQty','invoicedQty','returnedQty']) t[k] += Number(r[k] || 0);
      if (r.orderedQty !== 0 || r.ordered !== 0) { t.orders.add(r.occasionId||r.orderId); t.buyers.add(r.clientCode); }
      if (r.invoicedQty !== null && r.invoicedQty !== 0) t.invoicedOrders.add(r.occasionId||r.orderId);
      if(r.ordered===null||r.ordered===undefined)t.missingValues++;
      if (['catalog','warehouse'].includes(r.source)) t.catalogLines++;
      if(['catalog','warehouse'].includes(r.source)) {
        if(r.deliveredQty===null||r.deliveredQty===undefined)t.deliveryUnknownLines++;
        else {t.deliveryKnownLines++;t.deliveredQty+=r.deliveredQty;t.pickedQty+=r.pickedQty;t.pendingDeliveryQty+=r.pendingDeliveryQty;t.delivered+=Number(r.delivered||0);if(r.delivered===null)t.deliveredMissingValues++;}
      }
      if (!r.matched) t.unmatched++;
      if(r.brandSource==='unclassified')t.unclassified++;
    }
    return { ...t, orders:t.orders.size, buyers:t.buyers.size, invoicedOrders:t.invoicedOrders.size,
      average:t.orders.size ? t.ordered / t.orders.size : 0,
      fulfillment:t.orderedQty && !t.catalogLines ? t.invoicedQty / t.orderedQty : null };
  }
  function analyze(data, f) {
    if (!validRange(f.from, f.to)) throw new Error('Invalid date range');
    const rows = selected(data, f), t = totals(rows);
    const previous = previousRange(f.from, f.to, f.compare);
    const priorRows = selected(data, { ...f, ...previous });
    const prior = totals(priorRows);
    const covered = (from,to) => {
      if(f.source==='erp'||f.metric==='invoiced')return data.coverage.from&&from>=data.coverage.from&&to<=data.coverage.to;
      if(['warehouse','history-warehouse'].includes(f.source))return false;
      if(f.source==='catalog'||!data.coverage.from)return data.catalogCoverage.from&&from>=data.catalogCoverage.from&&to<=data.catalogCoverage.to;
      return from>=data.coverage.from&&(to<=data.coverage.to||(data.catalogCoverage.from&&data.catalogCoverage.from<=iso(timestamp(data.coverage.to)+dayMs)&&to<=data.catalogCoverage.to));
    };
    const priorCovered = f.metric!=='delivered'&&covered(previous.from,previous.to);
    const metric = ['invoiced','delivered'].includes(f.metric) ? f.metric : 'ordered';
    const qtyKey = metric === 'invoiced' ? 'invoicedQty' : metric==='delivered'?'deliveredQty':'orderedQty';
    const groups = key => {
      const map = new Map();
      for (const r of rows) {
        const id = r[key];
        if (!map.has(id)) map.set(id, { id, name:id, value:0, qty:0, buyers:new Set() });
        const g = map.get(id); g.value += Number(r[metric] || 0); g.qty += Number(r[qtyKey] || 0);
        if (r[qtyKey]) g.buyers.add(r.clientCode);
      }
      return [...map.values()].map(g => ({ ...g, buyers:g.buyers.size })).sort((a,b) => b.value-a.value || a.name.localeCompare(b.name));
    };
    const months = new Map();
    const cursor = new Date(`${f.from.slice(0,7)}-01T00:00:00Z`);
    for (let i=0; i<1200 && iso(cursor) <= f.to; i++) {
      const month = iso(cursor).slice(0,7); months.set(month, { month, ordered:0,invoiced:0,delivered:0,orderedQty:0,invoicedQty:0,deliveredQty:0,deliveryKnownLines:0 }); cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    for (const r of rows) { const m=months.get(r.date.slice(0,7)); if (m) { for(const key of ['ordered','invoiced','delivered','orderedQty','invoicedQty','deliveredQty'])m[key]+=Number(r[key]||0);if(r.deliveredQty!==null&&r.deliveredQty!==undefined)m.deliveryKnownLines++; } }
    const perCustomer = new Map();
    for (const c of data.clients) if (!f.client || str(c.clientCode) === f.client) perCustomer.set(str(c.clientCode), { client:c, current:0, prior:0, last:null, units:0,priorUnits:0,missingValues:0 });
    // Includes historical-only customers for the admin's unassigned review.
    for (const r of selected(data,f,false)) {
      if (!perCustomer.has(r.clientCode)) perCustomer.set(r.clientCode, { client:{ clientCode:r.clientCode,name:r.clientName }, current:0,prior:0,last:null,units:0,priorUnits:0,missingValues:0 });
      const c=perCustomer.get(r.clientCode);
      if (r[qtyKey] && r.date <= f.to && (!c.last || r.date > c.last)) c.last = r.date;
      if (r.date >= f.from && r.date <= f.to) { c.current+=Number(r[metric] || 0); c.units+=Number(r[qtyKey] || 0);if(r[metric]===null)c.missingValues++; }
      if (r.date >= previous.from && r.date <= previous.to) {c.prior+=Number(r[metric] || 0);c.priorUnits+=Number(r[qtyKey]||0);}
    }
    const customers = [...perCustomer.values()].map(c => ({ ...c, delta:priorCovered && c.prior ? (c.current-c.prior)/Math.abs(c.prior) : null,
      days:c.last ? Math.round((timestamp(f.to)-timestamp(c.last))/dayMs) : null,
      status:!c.units && c.priorUnits > 0 && priorCovered ? 'lost' : c.units > 0 && !c.missingValues && c.prior > c.current && priorCovered ? 'declining'
        : c.units > 0 ? 'active' : 'inactive' })).sort((a,b) => b.current-a.current || str(a.client.name).localeCompare(str(b.client.name)));
    const products = new Map();
    for (const r of rows) {
      const id=`${r.brand}:${r.sku}`;
      if (!products.has(id)) products.set(id, { sku:r.sku,name:r.productName,brand:r.brand,value:0,qty:0,matched:r.matched });
      const p=products.get(id); p.value+=Number(r[metric] || 0); p.qty+=Number(r[qtyKey] || 0);
    }
    const bought = new Set(rows.filter(r=>r[qtyKey] > 0).map(r=>`${r.brand}:${str(r.sku).toUpperCase()}`));
    const opportunities = data.catalog.filter(p => !excludedSkus.has(str(p.sku).toUpperCase()) && !p.hidden && !p.outOfStock && (!f.brand || p.section===f.brand)
      && (!f.category || p.category===f.category) && (!f.product || norm(`${p.sku} ${p.name}`).includes(norm(f.product)))
      && !bought.has(`${p.section}:${str(p.sku).toUpperCase()}`));
    return { rows, totals:t, prior, previous, priorCovered:Boolean(priorCovered), covered:Boolean(covered(f.from,f.to)),
      change:priorCovered && prior[metric] ? (t[metric]-prior[metric])/Math.abs(prior[metric]) : null,
      trend:[...months.values()], brands:groups('brand'), provinces:groups('province'), customers,
      products:[...products.values()].sort((a,b)=>b.value-a.value), opportunities,
      lost:customers.filter(c=>c.status==='lost'), declining:customers.filter(c=>c.status==='declining'), metric };
  }
  function defaultRange(data, source = 'erp') {
    const end = source === 'catalog' || source === 'combined' ? iso(Date.now())
      : data.coverage.to || [...data.records].map(r=>r.date).sort().at(-1) || iso(Date.now());
    const d=new Date(timestamp(end));
    const lastDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));
    if (end < iso(lastDay)) d.setUTCDate(0);
    const to=iso(d); d.setUTCDate(1);
    return { from:iso(d), to };
  }
  function recentRange(days=30,now=Date.now()) {
    const to=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    return {from:iso(timestamp(to)-(days-1)*dayMs),to};
  }
  function allRange(data,source='history-warehouse') {
    const dates=sourceRows(data,source).map(r=>r.date).sort();
    return {from:data.coverage.from&&source==='history-warehouse'?data.coverage.from:dates[0]||recentRange().from,to:recentRange(1).to};
  }
  function compareSources(data,f) {
    const catalog=selected(data,{...f,source:'catalog'}),warehouse=selected(data,{...f,source:'warehouse'});
    const groups=new Map();
    const get=(key,r)=>{if(!groups.has(key))groups.set(key,{key,orderLabel:r.orderLabel||r.orderId,sku:r.sku,name:r.productName,catalogQty:0,warehouseQty:0,hasCatalog:false,hasWarehouse:false,catalogValue:0,warehouseValue:0,missingWarehouseValue:false,clientName:r.clientName});return groups.get(key);};
    for(const r of catalog){const g=get(`${r.catalogOrderId}:${str(r.sku).toUpperCase()}`,r);g.catalogQty+=r.orderedQty;g.catalogValue+=Number(r.ordered||0);g.hasCatalog=true;}
    for(const r of warehouse){const g=get(`${r.catalogOrderId||r.orderId}:${str(r.sku).toUpperCase()}`,r);g.warehouseQty+=r.orderedQty;g.warehouseValue+=Number(r.ordered||0);g.hasWarehouse=true;if(r.ordered===null)g.missingWarehouseValue=true;}
    return [...groups.values()].map(g=>({...g,delta:g.warehouseQty-g.catalogQty,status:!g.hasCatalog?'warehouse-only':!g.hasWarehouse?'catalog-only':g.warehouseQty===g.catalogQty?'same':'different'}));
  }
  // Calendar comparisons use Buenos Aires dates, with shorter months clamped.
  function monthShift(day, months) {
    const d=new Date(timestamp(day)), last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months+1,0));
    return iso(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),Math.min(d.getUTCDate(),last.getUTCDate())));
  }
  function reportingPeriods(today=recentRange(1).to) {
    if(!Number.isFinite(timestamp(today)))throw new Error('Invalid reporting day');
    const from=today.slice(0,7)+'-01';
    return {today,current:{from,to:today},month:{from:monthShift(from,-1),to:monthShift(today,-1)},
      year:{from:monthShift(from,-12),to:monthShift(today,-12)},ytd:{from:today.slice(0,4)+'-01-01',to:today},annual:{from:monthShift(from,-11),to:today}};
  }
  function measureRows(rows, metric='ordered') {
    const delivered=metric==='delivered', orders=new Set(),clients=new Set();
    let amount=0,missing=0,unknown=0,units=0;
    for(const r of rows) {
      const qty=delivered?(r.source==='erp'?r.invoicedQty:r.deliveredQty):r.orderedQty;
      const value=delivered?(r.source==='erp'?r.invoiced:r.delivered):r.ordered;
      if(qty===null||qty===undefined){unknown++;continue;}
      if(qty<=0)continue;
      units+=qty;orders.add(r.occasionId||r.orderId);clients.add(r.clientCode);
      if(value===null||value===undefined||!Number.isFinite(value))missing++;else amount+=value;
    }
    return {amount,orders:orders.size,clients:clients.size,units,missing,unknown,
      ticket:orders.size?amount/orders.size:null,partial:Boolean(missing||unknown)};
  }
  function reporting(data,f,today=recentRange(1).to) {
    const periods=reportingPeriods(today);
    const inRange=range=>selected(data,{...f,...range}).filter(r=>r.date<=today);
    const comparison=(current,prior,key)=>({delta:current[key]-prior[key],percent:prior[key]?(current[key]-prior[key])/Math.abs(prior[key]):null});
    const metrics={};
    for(const metric of ['ordered','delivered']) {
      const current=measureRows(inRange(periods.current),metric),month=measureRows(inRange(periods.month),metric),year=measureRows(inRange(periods.year),metric),ytd=measureRows(inRange(periods.ytd),metric);
      const coverage=range=>{
        const erpCovered=(from,to)=>Boolean(data.coverage.from&&from>=data.coverage.from&&to<=data.coverage.to);
        const catalogCovered=(from,to)=>Boolean(to<=data.catalogCoverage.to&&((data.catalogCoverage.from&&from>=data.catalogCoverage.from)||(data.catalogAvailable&&data.handover&&from>=data.handover.warehouseFrom)));
        const erpOk=erpCovered(range.from,range.to);
        if(f.source==='erp')return Boolean(erpOk);
        if(f.source==='history-warehouse'){
          const cutover=data.handover?.warehouseFrom;
          if(!cutover)return false;
          if(range.to<cutover)return erpOk;
          if(range.from>=cutover)return catalogCovered(range.from,range.to);
          return erpCovered(range.from,iso(timestamp(cutover)-dayMs))&&catalogCovered(cutover,range.to);
        }
        if(f.source==='warehouse')return Boolean(data.warehouseAvailable&&data.warehouseCoverage.from&&range.from>=data.warehouseCoverage.from);
        return Boolean(data.catalogCoverage.from&&range.from>=data.catalogCoverage.from&&range.to<=data.catalogCoverage.to);
      };
      const currentCovered=coverage(periods.current),monthCovered=coverage(periods.month),yearCovered=coverage(periods.year);
      if(!currentCovered&&current.orders)current.partial=true;
      metrics[metric]={current,month,year,ytd,currentCovered,monthCovered,yearCovered,ytdCovered:coverage(periods.ytd),
        changes:Object.fromEntries(['amount','units','orders','clients'].map(key=>[key,{month:comparison(current,month,key),year:comparison(current,year,key)}]))};
    }
    const annualRows=inRange(periods.annual),all=sourceRows(data,f.source).filter(r=>r.date<=today&&r.orderedQty>0&&(!f.client||r.clientCode===f.client));
    const groupByClient=rows=>{const map=new Map();for(const r of rows){if(!map.has(r.clientCode))map.set(r.clientCode,[]);map.get(r.clientCode).push(r);}return map;};
    const periodGroups=groupByClient(selected(data,f)),annualGroups=groupByClient(annualRows),allGroups=groupByClient(all);
    const customerMeasure=f.metric==='ordered'?'ordered':'delivered';
    const entry=c=>({client:c,period:measureRows(periodGroups.get(str(c.clientCode))||[],customerMeasure),annual:measureRows(annualGroups.get(str(c.clientCode))||[],customerMeasure)});
    const perClient=new Map(data.clients.filter(c=>!f.client||str(c.clientCode)===f.client).map(c=>[str(c.clientCode),entry(c)]));
    for(const [code,rows] of allGroups)if(!perClient.has(code))perClient.set(code,entry({clientCode:code,name:rows[0].clientName}));
    const customers=[...perClient.entries()].map(([code,c])=>{
      const dates=[...new Set((allGroups.get(code)||[]).map(r=>r.occasionDate||r.date))].sort();
      const first=dates[0]||null,last=dates.at(-1)||null;
      const reactivated=dates.some((day,i)=>i>0&&day>=periods.annual.from&&dates[i-1]<=monthShift(day,-12));
      const recent=dates.filter(d=>d>=monthShift(today,-12));
      const frequency=recent.length>=2?(timestamp(recent.at(-1))-timestamp(recent[0]))/dayMs/(recent.length-1):null;
      const elapsed=last?(timestamp(today)-timestamp(last))/dayMs:null,remaining=frequency===null?null:frequency-elapsed;
      const situation=remaining===null?'insufficient':remaining<0?'overdue':remaining<=14?'action':'within';
      return {...c,last,first,frequency,remaining,situation,newClient:Boolean(first&&first>=periods.annual.from),reactivated};
    });
    const vendors=new Map();
    for(const c of customers){const code=str(c.client.salesmanCode)||'unassigned';if(!vendors.has(code))vendors.set(code,{code,customers:[],newClients:0,reactivated:0});const v=vendors.get(code);v.customers.push(c);v.newClients+=Number(c.newClient);v.reactivated+=Number(c.reactivated);}
    for(const v of vendors.values()){
      const codes=new Set(v.customers.map(c=>str(c.client.clientCode))),scope=range=>inRange(range).filter(r=>codes.has(r.clientCode));
      v.current=measureRows(scope(periods.current),customerMeasure);v.month=measureRows(scope(periods.month),customerMeasure);v.annual=measureRows(scope(periods.annual),customerMeasure);
      v.change=comparison(v.current,v.month,'amount');v.situations=Object.fromEntries(['within','action','overdue','insufficient'].map(s=>[s,v.customers.filter(c=>c.situation===s).length]));
    }
    let vendorRows=[...vendors.values()];
    if(data.groupingBase&&!data.vendorScoped){
      const base=data.groupingBase;
      vendorRows=[...new Set(base.clients.map(c=>c.salesmanCode))].flatMap(code=>{
        const clients=base.clients.filter(c=>c.salesmanCode===code),codes=new Set(clients.map(c=>str(c.clientCode)));
        const scoped=groupClients({...base,clients,records:base.records.filter(r=>codes.has(r.clientCode))},data.clientGroups);
        return reporting({...scoped,vendorScoped:true},f,today).vendors.map(v=>({...v,code}));
      });
    }
    return {periods,metrics,customers,vendors:vendorRows.sort((a,b)=>b.current.amount-a.current.amount)};
  }
  function monthlyReport(data,f) {
    const months=[],cursor=new Date(timestamp(f.from.slice(0,7)+'-01'));
    for(let i=0;i<1200&&iso(cursor)<=f.to;i++){const month=iso(cursor).slice(0,7);months.push({month,...measureRows(selected(data,{...f,from:month===f.from.slice(0,7)?f.from:month+'-01',to:month===f.to.slice(0,7)?f.to:iso(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0))}),f.metric)});cursor.setUTCMonth(cursor.getUTCMonth()+1);}
    return months;
  }
  function stockLoss(data,f) {
    const rows=selected(data,f);let amount=0,units=0,missing=0,unknown=0,uninvoiced=0,confirmedShortfall=0,shortfallMissing=0;const orders=new Set();
    for(const r of rows){if(r.source==='erp'){uninvoiced+=Math.max(0,r.ordered-r.invoiced);continue;}
      if(r.deliveryConfirmed===true&&r.deliveredQty!==null&&r.orderedQty>r.deliveredQty){if(r.ordered===null)shortfallMissing++;else confirmedShortfall+=r.ordered/r.orderedQty*(r.orderedQty-r.deliveredQty);}
      if(r.outOfStockQty===null||r.outOfStockQty===undefined){unknown++;continue;}
      if(r.outOfStockQty<=0)continue;units+=r.outOfStockQty;orders.add(r.occasionId||r.orderId);
      if(r.ordered===null||r.orderedQty<=0)missing++;else amount+=r.ordered/r.orderedQty*r.outOfStockQty;
    }
    const ordered=measureRows(rows);return {amount,units,orders:orders.size,missing,unknown,uninvoiced,confirmedShortfall,shortfallMissing,rate:ordered.amount&&!rows.some(r=>r.source==='erp')&&!missing&&!unknown&&!ordered.partial?amount/ordered.amount:null};
  }
  function companyBestsellers(data,today=recentRange(1).to) {
    if(!data.companyRankingAvailable)return [];
    const ranked=new Map(),start=monthShift(today,-12);
    for(const r of sourceRows(data,'history-warehouse')){
      if((r.occasionDate||r.date)<start||(r.occasionDate||r.date)>today)continue;
      const qty=r.source==='erp'?r.invoicedQty:r.deliveredQty;
      if(!(qty>0))continue;
      const key=`${r.brand}:${str(r.sku).toUpperCase()}`,entry=ranked.get(key)||{key,qty:0};entry.qty+=qty;ranked.set(key,entry);
    }
    return [...ranked.values()].sort((a,b)=>b.qty-a.qty||a.key.localeCompare(b.key));
  }
  function opportunityReport(data,f,today=recentRange(1).to) {
    const available=data.catalog.filter(p=>!p.hidden&&!p.outOfStock&&!excludedSkus.has(str(p.sku).toUpperCase()));
    const target=available.filter(p=>(!f.brand||p.section===f.brand)&&(!f.category||p.category===f.category)&&(!f.product||norm(`${p.sku} ${p.name}`).includes(norm(f.product))));
    const key=p=>`${p.brand||p.section}:${str(p.sku).toUpperCase()}`,targetKeys=new Set(target.map(key));
    const start=monthShift(today,-12),recentStart=monthShift(today,-3);
    const rows=sourceRows(data,f.source).filter(r=>(r.occasionDate||r.date)>=start&&(r.occasionDate||r.date)<=today&&r.orderedQty>0);
    const bought=new Map(),recent=new Map(),prior=new Map();
    for(const r of rows){const k=key(r);if(!bought.has(r.clientCode)){bought.set(r.clientCode,new Set());recent.set(r.clientCode,new Set());prior.set(r.clientCode,new Set());}bought.get(r.clientCode).add(k);((r.occasionDate||r.date)>=recentStart?recent:prior).get(r.clientCode).add(k);}
    const ranking=data.companyBestsellers!==null?data.companyBestsellers:companyBestsellers(data,today);
    const bestsellers=ranking.filter(p=>targetKeys.has(p.key)).slice(0,20).map(p=>({...p,product:target.find(t=>key(t)===p.key)}));
    return data.clients.filter(c=>!f.client||str(c.clientCode)===f.client).map(client=>{const code=str(client.clientCode),purchases=bought.get(code)||new Set(),now=recent.get(code)||new Set(),old=prior.get(code)||new Set();return {client,notBuyingTarget:![...targetKeys].some(k=>purchases.has(k)),missing:target.filter(p=>old.has(key(p))&&!now.has(key(p))),bestsellers:bestsellers.filter(p=>!purchases.has(p.key))};});

  }
  const model={ prepare,analyze,sourceRows,selected,totals,validRange,previousRange,defaultRange,recentRange,allRange,compareSources,iso,timestamp,norm,reviewed,reportingPeriods,monthShift,measureRows,reporting,monthlyReport,stockLoss,companyBestsellers,opportunityReport };
  if (typeof module!=='undefined' && module.exports) module.exports=model;
  else window.SALES_BI_MODEL=model;
})();
