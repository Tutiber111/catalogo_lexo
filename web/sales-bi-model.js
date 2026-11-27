/* Sales analytics uses explicit ERP quantities, never catalog status as invoice proof. */
(function () {
  const reviewed=typeof module!=='undefined'&&module.exports?require('./sales-product-brands.js'):window.SALES_PRODUCT_BRANDS;
  if(!reviewed)throw new Error('Sales brand review rules are unavailable');
  const excludedSkus=new Set(reviewed.excludedSkus||[]);
  const str = value => String(value ?? '').trim();
  const norm = value => str(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dayMs = 86400000;
  const iso = value => new Date(value).toISOString().slice(0, 10);
  const businessDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'});
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
    if(str(client.clientCode)==='81032'&&['','810'].includes(code))return 'unassigned';
    if(str(client.clientCode)==='kitchen-spot'||str(client.clientCode).startsWith('unassigned:'))return 'unassigned';
    if(!code&&str(client.clientCode)==='80605')return '805';
    return !code||code==='90'||code==='900'?'900':code;
  }
  function primarySourceRow(row,cutover) {
    if(row.invoiceOnly)return false;
    if(row.source==='erp')return !cutover||row.date<cutover;
    // After the handover WarehousePick is the order book: catalog orders sent to the
    // warehouse and orders loaded there by hand. A catalog order counts on its own
    // only while it has no WarehousePick order, so nothing is counted twice.
    return (row.source==='warehouse'||(row.source==='catalog'&&!row.inWarehouse))&&(!cutover||row.date>=cutover);
  }
  function assignOccasions(records,cutover) {
    const assign=(rows,idField,dateField)=>{
      const clients=new Map();
      for(const row of rows) {
        if(row.excludedFromAnalytics)continue;
        const key=row.unassigned?'order:'+row.orderId:row.clientCode;
        if(!clients.has(key))clients.set(key,[]);
        clients.get(key).push(row);
      }
      for(const purchases of clients.values()) {
        purchases.sort((a,b)=>a.date.localeCompare(b.date)||a.orderId.localeCompare(b.orderId));
        let anchor=null,id=null;
        for(const row of purchases) {
          if(anchor===null||timestamp(row.date)-timestamp(anchor)>2*dayMs){anchor=row.date;id=row.orderId;}
          row[idField]=id;
          row[dateField]=anchor;
        }
      }
    };
    const purchases=records.filter(row=>!row.invoiceOnly);
    for(const source of ['erp','catalog','warehouse'])assign(purchases.filter(row=>row.source===source),'occasionId','occasionDate');
    assign(records.filter(row=>primarySourceRow(row,cutover)),'primaryOccasionId','primaryOccasionDate');
    const orders=new Map(purchases.map(row=>[row.orderId,row]));
    for(const row of records)if(row.invoiceOnly){
      const purchase=orders.get(row.orderId);
      row.occasionId=purchase?.primaryOccasionId||purchase?.occasionId||row.orderId;
      row.occasionDate=row.date;
    }
  }
  // Current catalog list price, before VAT ("$13.057" or "$1.234,50"). Catalog orders use
  // this same price, so it values WarehousePick lines that carry no price of their own.
  function listPrice(product) {
    const raw=str(product?.price).replace(/[^0-9.,]/g,'');
    if(!raw)return null;
    const value=Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/\./g,''));
    return Number.isFinite(value)&&value>0?value:null;
  }
  const kitchenSpotClient={clientCode:'kitchen-spot',name:'Kitchen Spot'};
  // Same client written differently ("Sergio Oscar Mareco" / "MARECO SERGIO OSCAR"): same words, any order.
  const nameWords=v=>norm(v).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>1&&!['sa','srl','sas','de','del','la','el','y'].includes(w)).sort();
  function matchByName(name,master) {
    const mine=nameWords(name);if(mine.length<2)return null;
    const hits=master.filter(c=>[c.name,c.legalName].some(v=>{const theirs=nameWords(v);return theirs.length>=2&&(mine.every(w=>theirs.includes(w))||theirs.every(w=>mine.includes(w)));}));
    return hits.length===1?hits[0]:null;
  }
  // Catalog orders that reached WarehousePick without the link: re-typed by hand under the
  // same number (e.g. "303"), or added to another order of the same client. Both are
  // already counted in WarehousePick, so the catalog copy must not count again.
  function matchUnlinkedCatalogOrders(data,sentToWarehouse) {
    const adopted=new Map(),warehouse=data.delivery?.available?data.delivery.orders||[]:[];
    if(!warehouse.length)return adopted;
    const quantities=items=>{const map=new Map();for(const item of items||[]){const sku=str(item.sku).toUpperCase(),qty=Number(item.qty??item.quantity);if(sku&&Number.isFinite(qty))map.set(sku,(map.get(sku)||0)+qty);}return map;};
    const catalogById=new Map((data.orders||[]).map(o=>[o.id,o]));
    const extra=new Map(warehouse.map(w=>{
      // What a WarehousePick order holds beyond its own catalog order.
      const own=quantities(w.items),linked=w.externalId?quantities(catalogById.get(w.externalId)?.items):new Map();
      for(const [sku,qty] of linked)own.set(sku,(own.get(sku)||0)-qty);
      return [w.id,own];
    }));
    const number=v=>str(v).replace(/^#|^web-?/i,'').trim();
    const clientOf=o=>str(o.customer?.salesClient?.clientCode||o.customer?.clientCode);
    for(const o of data.orders||[]) {
      if(['draft','cancelled'].includes(o.status)||sentToWarehouse.has(o.id))continue;
      const wanted=quantities(o.items);if(!wanted.size)continue;
      const covers=(w,exact)=>{const have=extra.get(w.id);return [...wanted].every(([sku,qty])=>exact?have.get(sku)===qty:(have.get(sku)||0)>=qty);};
      const created=Date.parse(o.createdAt),code=clientOf(o);
      const sameNumber=warehouse.find(w=>!w.externalId&&number(w.number)&&number(w.number)===number(o.displayId||o.orderNumber)&&covers(w,true)&&quantities(w.items).size===wanted.size);
      const merged=sameNumber||(code?warehouse.find(w=>str(w.clientCode)===code&&Math.abs(Date.parse(w.createdAt)-created)<=10*dayMs&&covers(w,false)):null);
      if(!merged)continue;
      sentToWarehouse.add(o.id);
      for(const [sku,qty] of wanted)extra.get(merged.id).set(sku,(extra.get(merged.id).get(sku)||0)-qty);
      if(sameNumber&&!str(sameNumber.clientCode))adopted.set(sameNumber.id,{clientId:o.customer?.salesClient?.id||null,clientCode:code});
    }
    return adopted;
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
    // Last price each SKU was sold at in the Excel history, for products no longer in the catalog.
    const historyPrice=new Map();
    for(const line of [...(data.lines||[])].sort((a,b)=>str(a.order_date).localeCompare(str(b.order_date)))){
      const qty=Number(line.ordered_qty),net=Number(line.ordered_net);
      if(qty>0&&Number.isFinite(net)&&net>0)historyPrice.set(str(line.sku).toUpperCase(),net/qty);
    }
    const fallbackPrice=row=>{const list=listPrice(row.product);if(list!==null)return {price:list,source:'list'};const old=historyPrice.get(str(row.sku).toUpperCase());return old?{price:old,source:'history'}:null;};
    const sentToWarehouse=new Set(data.delivery?.available?(data.delivery.orders||[]).map(order=>order.externalId).filter(Boolean):[]);
    const adoptedClient=matchUnlinkedCatalogOrders(data,sentToWarehouse);
    // WarehousePick is the order book: catalog orders count on their own only while it can't be read.
    const warehouseLive=Boolean(data.delivery?.available&&Array.isArray(data.delivery.orders));
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
        returnedQty:null, ordered:Number(item.lineTotal || 0), invoiced:null, itemId:item.id, catalogOrderId:o.id, inWarehouse:warehouseLive||sentToWarehouse.has(o.id), linkedToWarehouse:sentToWarehouse.has(o.id) }));
    }
    for(const raw of data.delivery?.orders||[]) {
      const adopted=adoptedClient.get(raw.id),order=adopted&&!raw.clientId&&!str(raw.clientCode)?{...raw,...adopted}:raw;
      const c=order.clientId?byId.get(order.clientId):clients.get(str(order.clientCode));
      if(!c&&!data.includeUnassigned)continue;
      const d=new Date(order.createdAt);if(!Number.isFinite(+d))continue;
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
      const directWarehouse=!order.externalId&&(order.direct??(order.source!=='catalogolexo'));
      const ks=order.kitchenSpot&&!c;
      for(const item of order.items||[]) {
        if(item.qty===null||!Number.isFinite(Number(item.qty)))continue;
        const row=enrich({id:`wh:${order.id}:${item.id}`,orderId:`wh:${order.id}`,orderLabel:`Pedido ${order.number||order.id}`,source:'warehouse',date,directWarehouse,kitchenSpot:Boolean(order.kitchenSpot),warehouseClientCode:str(raw.clientCode),warehouseClientName:raw.clientName||'',orderSalesmanCode:str(raw.salesmanCode),
          clientCode:c?str(c.clientCode):ks?kitchenSpotClient.clientCode:`unassigned:${str(order.clientCode)||order.id}`,unassigned:!c,clientName:c?.name||(ks?kitchenSpotClient.name:order.clientName),
          sku:item.sku,productName:item.name,locality:c?.locality||'',province:'Sin provincia',orderedQty:Number(item.qty),
          ordered:item.orderedNet??null,invoicedQty:null,invoiced:null,returnedQty:null,
          pickedQty:item.pickedQty??null,deliveredQty:item.deliveredQty??null,pendingDeliveryQty:item.pendingQty??null,
          deliveryConfirmed:item.confirmed??null,delivered:item.deliveredNet??null,invoiceNumber:order.invoiceNumber,
          outOfStockQty:item.outOfStockQty??null,lineStatus:item.lineStatus??null,priceSource:item.priceSource??null,
          remitoNumber:order.remitoNumber,deliveryConfirmedAt:order.confirmedAt,catalogOrderId:order.externalId,itemId:item.id});
        const fallback=row.ordered===null?fallbackPrice(row):null,price=fallback?.price??null;
        if(price!==null){
          row.ordered=row.orderedQty*price;row.priceSource=fallback.source;
          if(row.deliveredQty!==null&&row.deliveredQty!==undefined)row.delivered=row.deliveredQty*price;
        }
        records.push(row);
      }
    }
    const invoiceEstimated=data.delivery?.invoiceFacts?.estimated===true;
    for(const raw of data.delivery?.invoiceFacts?.lines||[]) {
      const adopted=adoptedClient.get(raw.orderId),fact=adopted&&!raw.clientId&&!str(raw.clientCode)?{...raw,...adopted}:raw;
      const client=fact.clientId?byId.get(fact.clientId):clients.get(str(fact.clientCode));
      const confirmedAt=Date.parse(fact.invoiceDate);
      if((!client&&!data.includeUnassigned)||!Number.isFinite(confirmedAt)||!(fact.qty>0))continue;
      const ks=fact.kitchenSpot&&!client;
      const row=enrich({id:`invoice:${fact.id}`,orderId:`wh:${fact.orderId}`,
        orderLabel:`Pedido ${fact.number||fact.orderId}`,source:'warehouse',invoiceOnly:true,invoiceEstimated,fromCatalog:fact.fromCatalog,kitchenSpot:Boolean(fact.kitchenSpot),orderSalesmanCode:str(raw.salesmanCode),
        date:businessDate.format(confirmedAt),invoiceDocumentId:fact.documentId,deliveryConfirmedAt:fact.invoiceDate,invoiceNumber:fact.invoiceNumber,remitoNumber:fact.remitoNumber,
        clientCode:client?str(client.clientCode):ks?kitchenSpotClient.clientCode:`unassigned:${str(fact.clientCode)||fact.orderId}`,
        unassigned:!client,clientName:client?.name||(ks?kitchenSpotClient.name:fact.clientName),sku:fact.sku,productName:fact.name,province:'Sin provincia',
        orderedQty:null,ordered:null,invoicedQty:fact.qty,invoiced:fact.net,deliveredQty:fact.qty,delivered:fact.net,priceSource:fact.priceSource||null,
        pickedQty:null,pendingDeliveryQty:null,deliveryConfirmed:true});
      const fallback=invoiceEstimated&&row.invoiced==null?fallbackPrice(row):null;
      if(fallback){row.invoiced=row.delivered=row.invoicedQty*fallback.price;row.priceSource=fallback.source;}
      records.push(row);
    }
    const dates = (data.batches || []).map(b => b.to_date).sort();
    const starts = (data.batches || []).map(b => b.from_date).sort();
    const handovers=[...new Set((data.batches||[]).map(b=>b.warehouse_from_date).filter(Boolean))];
    if(handovers.some(d=>!Number.isFinite(timestamp(d)))||handovers.length>1)throw new Error('Invalid or conflicting source handover dates');
    // The confirmed source transition still applies if the Excel history has not arrived.
    const warehouseFrom=handovers[0]||(dates.length?iso(timestamp(dates.at(-1))+dayMs):
      ['loading','unavailable'].includes(data.historyStatus)?'2026-10-16':null);
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
    // Orders without a client code that name exactly one client of the master are that client.
    const master=data.clients.filter(c=>c.id),merges=new Map();
    for(const row of records){
      if(!row.unassigned||row.clientCode==='kitchen-spot'||row.source==='erp')continue;
      const name=row.warehouseClientName||row.clientName;
      if(!merges.has(name))merges.set(name,matchByName(name,master));
      const target=merges.get(name);if(!target)continue;
      Object.assign(row,{mergedFrom:{clientCode:row.clientCode,name},clientCode:str(target.clientCode),clientId:target.id,clientName:target.legalName||target.name,unassigned:false,locality:target.locality||row.locality});
    }
    assignOccasions(records,warehouseFrom);
    // Keep historical identities available for reporting and group membership.
    for(const row of records) {
      if(clients.has(row.clientCode))continue;
      const historicalClient={id:'',clientCode:row.clientCode,name:row.clientName};
      // An order without a client can still name its salesperson (the account's "Código de vendedor").
      const fromOrder=row.unassigned&&row.clientCode!=='kitchen-spot'?str(row.orderSalesmanCode):'';
      clients.set(row.clientCode,{...historicalClient,orderSalesman:Boolean(fromOrder),salesmanCode:fromOrder?analysisSalesman({clientCode:'',salesmanCode:fromOrder}):analysisSalesman(historicalClient)});
    }
    const selectedSalesman=str(data.analysisSalesmanCode);
    const scopedClients=[...clients.values()].filter(c=>!selectedSalesman||selectedSalesman==='*'||c.salesmanCode===selectedSalesman);
    const scopedCodes=new Set(scopedClients.map(c=>str(c.clientCode)));
    return groupClients({ companyRankingPartial:Boolean(data.companyRankingPartial),companyBestsellers:data.companyBestsellers??null,companyRankingAvailable:data.companyRankingAvailable??(!data.analysisSalesmanCode||data.analysisSalesmanCode==='*'),records:records.filter(r=>scopedCodes.has(r.clientCode)), clients:scopedClients, catalog:[...catalog.values()].flatMap(m => [...m.values()]),
      coverage: { from:starts[0] || null, to:dates.at(-1) || null },
      handover:warehouseFrom?{warehouseFrom,excelThrough:iso(timestamp(warehouseFrom)-dayMs),confirmed:handovers.length===1}:null,
      catalogCoverage:{from:catalogDates[0]||null,to:recentRange(1,data.updatedAt?Date.parse(data.updatedAt):Date.now()).to}, batches:data.batches || [],
      catalogAvailable:Array.isArray(data.orders),
      warehouseAvailable:Boolean(data.delivery?.available),warehouseCoverage:{from:records.filter(r=>r.source==='warehouse'&&!r.invoiceOnly).map(r=>r.date).sort()[0]||null,to:recentRange(1).to},
      invoiceAvailable:data.delivery?.invoiceFacts?.available===true,invoiceEstimated,undatedInvoices:data.delivery?.invoiceFacts?.undated||0 },data.clientGroups||[]);
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
    assignOccasions(records,data.handover?.warehouseFrom);
    return {...data,records,clients:[...data.clients.filter(c=>!mapping.has(str(c.clientCode))),...combined],groupingBase:data,
      clientGroups:combined.map(c=>({id:c.id.slice(6),name:c.name,clientCodes:c.members.map(m=>str(m.clientCode))}))};
  }
  function sourceRows(data, source, metric) {
    if(metric==='invoiceDate') {
      if(source==='erp')return [];
      const from=source==='history-warehouse'?data.handover?.warehouseFrom:null;
      // Before the handover the Excel history is the only record of what was invoiced.
      const history=source==='history-warehouse'?data.records.filter(r=>r.source==='erp'&&!r.excludedFromAnalytics&&primarySourceRow(r,from))
        .map(r=>r.primaryOccasionId===r.occasionId&&r.primaryOccasionDate===r.occasionDate?r:{...r,occasionId:r.primaryOccasionId??r.occasionId,occasionDate:r.primaryOccasionDate??r.occasionDate}):[];
      if(!data.invoiceAvailable)return history;
      return [...history,...data.records.filter(r=>r.invoiceOnly&&!r.excludedFromAnalytics&&(!from||r.date>=from)
        && (!['catalog','combined'].includes(source)||r.fromCatalog))];
    }
    const records=data.records.filter(r=>!r.excludedFromAnalytics&&!r.invoiceOnly);
    if (source === 'catalog') return records.filter(r => r.source === 'catalog');
    if (source === 'warehouse') return records.filter(r => r.source === 'warehouse');
    if (source === 'history-warehouse') return records.filter(r=>primarySourceRow(r,data.handover?.warehouseFrom))
      .map(r=>r.primaryOccasionId===r.occasionId&&r.primaryOccasionDate===r.occasionDate?r:
        {...r,occasionId:r.primaryOccasionId??r.occasionId,occasionDate:r.primaryOccasionDate??r.occasionDate});
    if (source === 'combined') return records.filter(r => r.source === 'erp' || (r.source==='catalog'&&(!data.coverage.to || r.date > data.coverage.to)));
    return records.filter(r => r.source === 'erp');
  }
  function selected(data, f, includeDate = true) {
    return sourceRows(data, f.source, f.metric).filter(r => (!includeDate || ((r.occasionDate||r.date) >= f.from && (r.occasionDate||r.date) <= f.to))
      && (!f.client || r.clientCode === f.client) && (!f.brand || r.brand === f.brand)
      && (!f.province || r.province === f.province) && (!f.category || r.category === f.category)
      && (!f.productKey || productKey(r) === f.productKey)
      && (!f.product || norm(`${r.sku} ${r.productName}`).includes(norm(f.product))));
  }
  const productKey=r=>JSON.stringify([r.brand,str(r.sku).toUpperCase()]);
  function productSales(data,f) {
    const groups=new Map(),clients=new Map(data.clients.map(c=>[str(c.clientCode),c]));
    for(const row of selected(data,f)) {
      const key=productKey(row);
      if(!groups.has(key))groups.set(key,{key,sku:row.sku,name:row.productName,brand:row.brand,rows:[]});
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].map(p=>{
      const metric=f.metric||'ordered',total=measureRows(p.rows,metric),byClient=new Map();
      for(const row of p.rows){if(!byClient.has(row.clientCode))byClient.set(row.clientCode,[]);byClient.get(row.clientCode).push(row);}
      const buyers=[...byClient.entries()].map(([code,rows])=>{
        const value=measureRows(rows,metric);
        const last=rows.filter(r=>measureRows([r],metric).units>0).map(r=>r.occasionDate||r.date).sort().at(-1)||null;
        return {client:clients.get(code)||{clientCode:code,name:rows[0].clientName},...value,last};
      }).filter(c=>c.units>0).sort((a,b)=>b.amount-a.amount||str(a.client.name).localeCompare(str(b.client.name)));
      return {key:p.key,sku:p.sku,name:p.name,brand:p.brand,...total,qty:total.units,value:total.amount,buyers};
    }).filter(p=>p.units>0||p.unknown).sort((a,b)=>b.amount-a.amount||str(a.sku).localeCompare(str(b.sku)));
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
      average:t.missingValues ? null : t.orders.size ? t.ordered / t.orders.size : 0,
      fulfillment:t.orderedQty && !t.catalogLines ? t.invoicedQty / t.orderedQty : null };
  }
  function analyze(data, f) {
    if (!validRange(f.from, f.to)) throw new Error('Invalid date range');
    const rows = selected(data, f), t = totals(rows);
    const previous = previousRange(f.from, f.to, f.compare);
    const priorRows = selected(data, { ...f, ...previous });
    const prior = totals(priorRows);
    const covered = (from,to) => {
      if(f.metric==='invoiceDate')return invoiceCovered(data,f.source,{from,to});
      if(f.source==='erp'||f.metric==='invoiced')return data.coverage.from&&from>=data.coverage.from&&to<=data.coverage.to;
      if(['warehouse','history-warehouse'].includes(f.source))return false;
      if(f.source==='catalog'||!data.coverage.from)return data.catalogCoverage.from&&from>=data.catalogCoverage.from&&to<=data.catalogCoverage.to;
      return from>=data.coverage.from&&(to<=data.coverage.to||(data.catalogCoverage.from&&data.catalogCoverage.from<=iso(timestamp(data.coverage.to)+dayMs)&&to<=data.catalogCoverage.to));
    };
    const priorCovered = f.metric!=='delivered'&&covered(previous.from,previous.to);
    const metric = f.metric==='invoiceDate'?'invoiced':['invoiced','delivered'].includes(f.metric) ? f.metric : 'ordered';
    const qtyKey = metric === 'invoiced' ? 'invoicedQty' : metric==='delivered'?'deliveredQty':'orderedQty';
    const quantity=r=>metric==='delivered'&&r.source==='erp'?r.invoicedQty:r[qtyKey];
    const value=r=>metric==='delivered'&&r.source==='erp'?r.invoiced:r[metric];
    const groups = key => {
      const map = new Map();
      for (const r of rows) {
        const id = r[key];
        if (!map.has(id)) map.set(id, { id, name:id, value:0, qty:0, buyers:new Set() });
        const g = map.get(id); g.value += Number(value(r) || 0); g.qty += Number(quantity(r) || 0);
        if (quantity(r)>0) g.buyers.add(r.clientCode);
      }
      return [...map.values()].map(g => ({ ...g, buyers:g.buyers.size })).sort((a,b) => b.value-a.value || a.name.localeCompare(b.name));
    };
    const months = new Map();
    const cursor = new Date(`${f.from.slice(0,7)}-01T00:00:00Z`);
    for (let i=0; i<1200 && iso(cursor) <= f.to; i++) {
      const month = iso(cursor).slice(0,7); months.set(month, { month, ordered:0,invoiced:0,delivered:0,orderedQty:0,invoicedQty:0,deliveredQty:0,deliveryKnownLines:0 }); cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    for (const r of rows) { const m=months.get((r.occasionDate||r.date).slice(0,7)); if (m) { for(const key of ['ordered','invoiced','delivered','orderedQty','invoicedQty','deliveredQty'])m[key]+=Number(r.source==='erp'&&key==='delivered'?r.invoiced:r.source==='erp'&&key==='deliveredQty'?r.invoicedQty:r[key]||0);if(r.source==='erp'||r.deliveredQty!==null&&r.deliveredQty!==undefined)m.deliveryKnownLines++; } }
    const perCustomer = new Map();
    for (const c of data.clients) if (!f.client || str(c.clientCode) === f.client) perCustomer.set(str(c.clientCode), { client:c, current:0, prior:0, last:null, units:0,priorUnits:0,missingValues:0 });
    // Includes historical-only customers for the admin's unassigned review.
    for (const r of selected(data,f,false)) {
      if (!perCustomer.has(r.clientCode)) perCustomer.set(r.clientCode, { client:{ clientCode:r.clientCode,name:r.clientName }, current:0,prior:0,last:null,units:0,priorUnits:0,missingValues:0 });
      const c=perCustomer.get(r.clientCode);
      const day=r.occasionDate||r.date;
      if (quantity(r)>0 && day <= f.to && (!c.last || day > c.last)) c.last = day;
      if (day >= f.from && day <= f.to) { c.current+=Number(value(r) || 0); c.units+=Number(quantity(r) || 0);if(value(r)===null)c.missingValues++; }
      if (day >= previous.from && day <= previous.to) {c.prior+=Number(value(r) || 0);c.priorUnits+=Number(quantity(r)||0);}
    }
    const customers = [...perCustomer.values()].map(c => ({ ...c, delta:priorCovered && c.prior ? (c.current-c.prior)/Math.abs(c.prior) : null,
      days:c.last ? Math.round((timestamp(f.to)-timestamp(c.last))/dayMs) : null,
      status:!c.units && c.priorUnits > 0 && priorCovered ? 'lost' : c.units > 0 && !c.missingValues && c.prior > c.current && priorCovered ? 'declining'
        : c.units > 0 ? 'active' : 'inactive' })).sort((a,b) => b.current-a.current || str(a.client.name).localeCompare(str(b.client.name)));
    const products = new Map();
    for (const r of rows) {
      const id=`${r.brand}:${r.sku}`;
      if (!products.has(id)) products.set(id, { sku:r.sku,name:r.productName,brand:r.brand,value:0,qty:0,matched:r.matched });
      const p=products.get(id); p.value+=Number(value(r) || 0); p.qty+=Number(quantity(r) || 0);
    }
    const bought = new Set(rows.filter(r=>quantity(r) > 0).map(r=>`${r.brand}:${str(r.sku).toUpperCase()}`));
    const opportunities = data.catalog.filter(p => !excludedSkus.has(str(p.sku).toUpperCase()) && !p.hidden && !p.outOfStock && (!f.brand || p.section===f.brand)
      && (!f.productKey || productKey({brand:p.section,sku:p.sku})===f.productKey)
      && (!f.category || p.category===f.category) && (!f.product || norm(`${p.sku} ${p.name}`).includes(norm(f.product)))
      && !bought.has(`${p.section}:${str(p.sku).toUpperCase()}`));
    const brands = groups('brand');
    const brandTotal = brands.reduce((sum, brand) => sum + brand.value, 0);
    return { rows, totals:t, prior, previous, priorCovered:Boolean(priorCovered), covered:Boolean(covered(f.from,f.to)),
      change:priorCovered && prior[metric] ? (t[metric]-prior[metric])/Math.abs(prior[metric]) : null,
      trend:[...months.values()], brands:brands.map(brand=>({...brand,share:brandTotal?brand.value/brandTotal:null})), provinces:groups('province'), customers,
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
    const catalog=selected(data,{...f,source:'catalog',metric:'ordered'}),warehouse=selected(data,{...f,source:'warehouse',metric:'ordered'});
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
  function currentMonthRange(today=recentRange(1).to) {return {from:today.slice(0,7)+'-01',to:today};}
  function reportingPeriods(today=recentRange(1).to,range=currentMonthRange(today)) {
    if(!Number.isFinite(timestamp(today)))throw new Error('Invalid reporting day');
    if(!validRange(range.from,range.to))throw new Error('Invalid reporting range');
    const {from,to}=range;
    return {today,asOf:to,current:{from,to},month:{from:monthShift(from,-1),to:monthShift(to,-1)},
      year:{from:monthShift(from,-12),to:monthShift(to,-12)},ytd:{from:to.slice(0,4)+'-01-01',to},annual:{from:monthShift(to.slice(0,7)+'-01',-11),to}};
  }
  function measureRows(rows, metric='ordered') {
    const delivered=metric==='delivered',invoiced=metric==='invoiced'||metric==='invoiceDate', orders=new Set(),clients=new Set();
    let amount=0,missing=0,pricedLines=0,unknown=0,units=0,estimated=false;const pricedOrders=new Set();
    for(const r of rows) {
      const qty=invoiced?r.invoicedQty:delivered?(r.source==='erp'?r.invoicedQty:r.deliveredQty):r.orderedQty;
      const value=invoiced?r.invoiced:delivered?(r.source==='erp'?r.invoiced:r.delivered):r.ordered;
      if(qty===null||qty===undefined){unknown++;continue;}
      if(qty<=0)continue;
      units+=qty;orders.add(r.occasionId||r.orderId);clients.add(r.clientCode);
      if(invoiced&&r.invoiceEstimated)estimated=true;
      if(value===null||value===undefined||!Number.isFinite(value))missing++;
      else {amount+=value;pricedLines++;pricedOrders.add(r.occasionId||r.orderId);}
    }
    // Lines without a price leave their order out of the average, instead of hiding it.
    return {amount,orders:orders.size,clients:clients.size,units,missing,pricedLines,unknown,estimated,
      ticket:pricedOrders.size?amount/pricedOrders.size:null,partial:Boolean(missing||unknown)};
  }
  function reporting(data,f,today=recentRange(1).to) {
    const periods=reportingPeriods(today,validRange(f.from,f.to)?f:currentMonthRange(today)),asOf=periods.asOf;
    const rangeCache=new Map();
    const inRange=(range,metric=f.metric)=>{
      const dateBasis=metric==='invoiceDate'?'invoiceDate':'ordered';
      const key=range.from+':'+range.to+':'+dateBasis;
      if(!rangeCache.has(key))rangeCache.set(key,selected(data,{...f,...range,metric:dateBasis}).filter(r=>r.date<=today));
      return rangeCache.get(key);
    };
    const comparison=(current,prior,key)=>{
      if(key==='amount'&&[current,prior].some(value=>(value.missing&&!value.pricedLines)||(value.unknown&&!value.orders))) {
        return {delta:null,percent:null};
      }
      const delta=current[key]-prior[key];
      return {delta,percent:prior[key]?delta/Math.abs(prior[key]):null};
    };
    const metrics={};
    for(const metric of ['ordered','delivered','invoiceDate']) {
      const current=measureRows(inRange(periods.current,metric),metric),month=measureRows(inRange(periods.month,metric),metric),year=measureRows(inRange(periods.year,metric),metric),ytd=measureRows(inRange(periods.ytd,metric),metric);
      const coverage=range=>{
        if(metric==='invoiceDate')return invoiceCovered(data,f.source,range);
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
      if(f.source==='history-warehouse'&&!data.warehouseAvailable&&data.handover) {
        for(const [period,measure] of [[periods.current,current],[periods.month,month],[periods.year,year],[periods.ytd,ytd]]) {
          if(period.to>=data.handover.warehouseFrom)measure.partial=true;
        }
      }
      if(!currentCovered&&current.orders)current.partial=true;
      metrics[metric]={current,month,year,ytd,currentCovered,monthCovered,yearCovered,ytdCovered:coverage(periods.ytd),
        changes:Object.fromEntries(['amount','units','orders','clients'].map(key=>[key,{month:comparison(current,month,key),year:comparison(current,year,key)}]))};
    }
    const annualRows=inRange(periods.annual),all=selected(data,{...f,metric:'ordered'},false).filter(r=>(r.occasionDate||r.date)<=asOf&&r.date<=today&&r.orderedQty>0);
    const groupByClient=rows=>{const map=new Map();for(const r of rows){if(!map.has(r.clientCode))map.set(r.clientCode,[]);map.get(r.clientCode).push(r);}return map;};
    const periodGroups=groupByClient(selected(data,f)),annualGroups=groupByClient(annualRows),allGroups=groupByClient(all);
    const customerMeasure=f.metric||'ordered';
    const measureFor=(rows,range)=>{
      const value=measureRows(rows,customerMeasure);
      if(customerMeasure==='invoiceDate'&&!invoiceCovered(data,f.source,range)){
        value.unknown++;value.partial=true;
      }
      return value;
    };
    const entry=c=>({client:c,period:measureFor(periodGroups.get(str(c.clientCode))||[],periods.current),annual:measureFor(annualGroups.get(str(c.clientCode))||[],periods.annual)});
    const perClient=new Map(data.clients.filter(c=>!f.client||str(c.clientCode)===f.client).map(c=>[str(c.clientCode),entry(c)]));
    for(const [code,rows] of allGroups)if(!perClient.has(code))perClient.set(code,entry({clientCode:code,name:rows[0].clientName}));
    const customers=[...perClient.entries()].map(([code,c])=>{
      const dates=[...new Set((allGroups.get(code)||[]).map(r=>r.occasionDate||r.date))].sort();
      const first=dates[0]||null,last=dates.at(-1)||null;
      const reactivated=dates.some((day,i)=>i>0&&day>=periods.annual.from&&dates[i-1]<=monthShift(day,-12));
      const recent=dates.filter(d=>d>=monthShift(asOf,-12));
      const frequency=recent.length>=2?(timestamp(recent.at(-1))-timestamp(recent[0]))/dayMs/(recent.length-1):null;
      const elapsed=last?(timestamp(asOf)-timestamp(last))/dayMs:null,remaining=frequency===null?null:frequency-elapsed;
      const situation=remaining===null?'insufficient':remaining<0?'overdue':remaining<=14?'action':'within';
      return {...c,last,first,frequency,remaining,situation,newClient:Boolean(first&&first>=periods.annual.from),reactivated};
    });
    const vendors=new Map();
    for(const c of customers){const code=str(c.client.salesmanCode)||'unassigned';if(!vendors.has(code))vendors.set(code,{code,customers:[],newClients:0,reactivated:0});const v=vendors.get(code);v.customers.push(c);v.newClients+=Number(c.newClient);v.reactivated+=Number(c.reactivated);}
    for(const v of vendors.values()){
      const codes=new Set(v.customers.map(c=>str(c.client.clientCode))),scope=range=>inRange(range).filter(r=>codes.has(r.clientCode));
      v.current=measureFor(scope(periods.current),periods.current);v.month=measureFor(scope(periods.month),periods.month);v.annual=measureFor(scope(periods.annual),periods.annual);
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
  function invoiceCovered(data,source,range) {
    if(source==='erp')return false;
    const cutover=data.handover?.warehouseFrom;
    if(source!=='history-warehouse'||!cutover||range.from>=cutover)return Boolean(data.invoiceAvailable&&(!cutover||range.from>=cutover));
    const before=iso(timestamp(cutover)-dayMs);
    const historyOk=Boolean(data.coverage.from&&range.from>=data.coverage.from&&(range.to<cutover?range.to:before)<=data.coverage.to);
    return historyOk&&(range.to<cutover||Boolean(data.invoiceAvailable));
  }
  function trendMeasures(data,f,range,rows) {
    const value=measureRows(rows,f.metric);
    const missingInvoiceDates=f.metric==='invoiceDate'&&!invoiceCovered(data,f.source,range);
    const missingHistory=f.metric==='invoiced'&&(!data.coverage.from||range.from<data.coverage.from||range.to>data.coverage.to);
    if(missingInvoiceDates||missingHistory){value.unknown++;value.partial=true;}
    return value;
  }
  function monthlyReport(data,f) {
    const months=[],cursor=new Date(timestamp(f.from.slice(0,7)+'-01'));
    for(let i=0;i<1200&&iso(cursor)<=f.to;i++){
      const month=iso(cursor).slice(0,7),range={from:month===f.from.slice(0,7)?f.from:month+'-01',to:month===f.to.slice(0,7)?f.to:iso(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0))};
      const value=trendMeasures(data,f,range,selected(data,{...f,...range}));
      months.push({month,...value});cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    return months;
  }
  function trendPointValue(point, dimension='amount') {
    if(point.unknown&&!point.orders)return null;
    if(dimension==='amount'&&point.missing&&!point.pricedLines)return null;
    return point[dimension];
  }
  function trendReport(data,f) {
    if(!validRange(f.from,f.to))return {weekly:false,rows:[]};
    const weekly=f.to>=monthShift(f.from,2);
    const byDay=new Map();
    for(const row of selected(data,f,false)){
      const day=row.occasionDate||row.date;
      if(!byDay.has(day))byDay.set(day,[]);
      byDay.get(day).push(row);
    }
    const points=(start,end,byWeek,context=false)=>{
      const result=[];
      for(let from=start;from<=end;){
        const weekday=(new Date(from).getUTCDay()+6)%7;
        const to=byWeek?Math.min(end,from+(6-weekday)*dayMs):from;
        const range={from:iso(from),to:iso(to)};
        const rows=[];
        for(let day=from;day<=to;day+=dayMs)rows.push(...(byDay.get(iso(day))||[]));
        result.push({...range,context,...trendMeasures(data,f,range,rows)});
        from=to+dayMs;
      }
      return result;
    };
    const rows=points(timestamp(f.from),timestamp(f.to),weekly);
    if(rows.filter(point=>trendPointValue(point,f.dimension)!==null).length>=10)return {weekly,rows};
    const monthStart=timestamp(f.from.slice(0,7)+'-01');
    const context=points(monthStart-5*dayMs,monthStart-dayMs,false,true);
    return {weekly,rows:[...context,...rows]};
  }
  // Ordered versus invoiced for the selected period. For WarehousePick and catalog
  // rows, invoiced is what the warehouse marked "con stock"; the gap splits into
  // "sin stock" and lines nobody has marked yet. Excel history has no such detail.
  function orderedVersusInvoiced(data,f) {
    const out={ordered:0,orderedQty:0,invoiced:0,invoicedQty:0,noStock:0,noStockQty:0,pending:0,pendingQty:0,
      history:0,historyQty:0,unknown:0,unknownLines:0,unknownQty:0,missingPrices:0,orders:new Set(),manualOrders:new Set()};
    for(const r of selected(data,{...f,metric:'ordered'})) {
      const qty=Number(r.orderedQty);
      if(!Number.isFinite(qty)||qty<=0)continue;
      out.orders.add(r.orderId);
      if(r.source==='warehouse'&&!r.catalogOrderId)out.manualOrders.add(r.orderId);
      const rate=r.ordered===null||r.ordered===undefined||!Number.isFinite(Number(r.ordered))?null:Number(r.ordered)/qty;
      if(rate===null)out.missingPrices++;
      const money=units=>rate===null?0:rate*units;
      out.orderedQty+=qty;out.ordered+=money(qty);
      if(r.source==='erp') {
        const invoiced=Number(r.invoicedQty||0);
        out.invoicedQty+=invoiced;out.invoiced+=Number(r.invoiced||0);
        out.historyQty+=qty-invoiced;out.history+=Number(r.ordered||0)-Number(r.invoiced||0);
        continue;
      }
      if(r.deliveredQty===null||r.deliveredQty===undefined){out.unknownLines++;out.unknownQty+=qty;out.unknown+=money(qty);continue;}
      const withStock=Number(r.deliveredQty),noStock=Number(r.outOfStockQty||0),pending=Math.max(0,qty-withStock-noStock);
      out.invoicedQty+=withStock;out.invoiced+=money(withStock);
      out.noStockQty+=noStock;out.noStock+=money(noStock);
      out.pendingQty+=pending;out.pending+=money(pending);
    }
    return {...out,orders:out.orders.size,manualOrders:out.manualOrders.size,
      differenceQty:out.orderedQty-out.invoicedQty,difference:out.ordered-out.invoiced};
  }
  // Invoiced rows for analysis: WarehousePick lines marked con stock, dated by invoice,
  // plus the Excel history's invoiced quantities before the handover.
  function invoicedRows(data,f,includeDate=true) {
    if(f.source==='history-warehouse')return selected(data,{...f,metric:'invoiceDate'},includeDate);
    const warehouse=selected(data,{...f,metric:'invoiceDate'},includeDate);
    const history=['erp','combined'].includes(f.source)?selected(data,{...f,metric:'ordered'},includeDate).filter(r=>r.source==='erp'):[];
    return [...history,...warehouse];
  }
  // Ordered and invoiced on the same dates, for the default two-line chart.
  function trendComparison(data,f) {
    const base=trendReport(data,{...f,metric:'ordered'});
    if(!base.rows.length)return {weekly:base.weekly,rows:[],invoiced:[]};
    const byDay=new Map();
    for(const row of invoicedRows(data,f,false)){const day=row.date;if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(row);}
    const invoiced=base.rows.map(point=>{
      const rows=[];
      for(let day=timestamp(point.from);day<=timestamp(point.to);day+=dayMs)rows.push(...(byDay.get(iso(day))||[]));
      const value=measureRows(rows,'invoiceDate');
      if(f.source!=='erp'&&!data.invoiceAvailable&&data.handover&&point.to>=data.handover.warehouseFrom){value.unknown++;value.partial=true;}
      return {from:point.from,to:point.to,context:point.context,...value};
    });
    return {weekly:base.weekly,rows:base.rows,invoiced};
  }
  const amountOf=(rows,metric)=>measureRows(rows,metric);
  // Portfolio share (SKUs in the catalog) against what each brand sells.
  function brandPortfolio(data,f) {
    const catalog=new Map();
    for(const p of data.catalog||[]){
      if(p.hidden||excludedSkus.has(str(p.sku).toUpperCase()))continue;
      if(f.brand&&p.section!==f.brand)continue;
      const brand=p.section||'Sin marca';
      if(!catalog.has(brand))catalog.set(brand,new Set());
      catalog.get(brand).add(str(p.sku).toUpperCase());
    }
    const orderedRows=selected(data,{...f,metric:'ordered'}),invoiced=invoicedRows(data,f);
    const brands=new Map();
    const get=brand=>{if(!brands.has(brand))brands.set(brand,{brand,skus:catalog.get(brand)?.size||0,soldSkus:new Set(),ordered:[],invoiced:[]});return brands.get(brand);};
    for(const brand of catalog.keys())get(brand);
    const linked=r=>r.brand!=='Sin vincular';
    for(const r of orderedRows.filter(linked)){const b=get(r.brand);b.ordered.push(r);if(r.orderedQty>0&&catalog.get(r.brand)?.has(str(r.sku).toUpperCase()))b.soldSkus.add(str(r.sku).toUpperCase());}
    for(const r of invoiced.filter(linked))get(r.brand).invoiced.push(r);
    const rows=[...brands.values()].map(b=>({brand:b.brand,skus:b.skus,soldSkus:b.soldSkus.size,ordered:amountOf(b.ordered,'ordered'),invoiced:amountOf(b.invoiced,'invoiceDate')}));
    const totalSkus=rows.reduce((s,r)=>s+r.skus,0),totalOrdered=rows.reduce((s,r)=>s+r.ordered.amount,0),totalInvoiced=rows.reduce((s,r)=>s+r.invoiced.amount,0);
    return {totalSkus,totalOrdered,totalInvoiced,rows:rows.map(r=>{
      const skuShare=totalSkus?r.skus/totalSkus:null,invoicedShare=totalInvoiced?r.invoiced.amount/totalInvoiced:null;
      return {...r,skuShare,orderedShare:totalOrdered?r.ordered.amount/totalOrdered:null,invoicedShare,
        index:skuShare&&invoicedShare!==null?invoicedShare/skuShare:null};
    }).filter(r=>r.skus||r.ordered.units||r.invoiced.units).sort((a,b)=>b.invoiced.amount-a.invoiced.amount||b.skus-a.skus)};
  }
  // Everything about a set of clients (one salesperson or one client) in the period.
  function scopeProfile(data,f,codes=null) {
    const inScope=r=>!codes||codes.has(r.clientCode);
    const ordered=selected(data,{...f,metric:'ordered'}).filter(inScope),invoiced=invoicedRows(data,f).filter(inScope);
    const fill=measureRows(ordered,'delivered'),orderedTotal=measureRows(ordered,'ordered');
    const group=(rows,key)=>{const map=new Map();for(const r of rows){const k=key(r);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return map;};
    const invoicedByBrand=group(invoiced,r=>r.brand);
    const brands=[...group(ordered,r=>r.brand)].map(([brand,rows])=>({brand,ordered:measureRows(rows,'ordered'),invoiced:measureRows(invoicedByBrand.get(brand)||[],'invoiceDate')}));
    for(const [brand,rows] of invoicedByBrand)if(!brands.some(b=>b.brand===brand))brands.push({brand,ordered:measureRows([],'ordered'),invoiced:measureRows(rows,'invoiceDate')});
    brands.sort((a,b)=>b.invoiced.amount-a.invoiced.amount||b.ordered.amount-a.ordered.amount);
    const products=[...group(ordered,productKey)].map(([key,rows])=>{
      const value=measureRows(rows,'ordered'),noStock=rows.reduce((s,r)=>s+Number(r.outOfStockQty||0),0);
      return {key,sku:rows[0].sku,name:rows[0].productName,brand:rows[0].brand,ordered:value,
        withStock:rows.reduce((s,r)=>s+(r.source==='erp'?Number(r.invoicedQty||0):Number(r.deliveredQty||0)),0),noStock};
    }).sort((a,b)=>b.ordered.amount-a.ordered.amount);
    let noStockAmount=0,noStockUnits=0;
    for(const r of ordered){const q=Number(r.outOfStockQty||0);if(q>0&&r.ordered!==null&&r.orderedQty>0){noStockAmount+=r.ordered/r.orderedQty*q;noStockUnits+=q;}}
    return {ordered:orderedTotal,invoiced:measureRows(invoiced,'invoiceDate'),fill,
      fillRate:orderedTotal.amount?fill.amount/orderedTotal.amount:null,
      noStockAmount,noStockUnits,brands,products,clients:new Set(ordered.filter(r=>r.orderedQty>0).map(r=>r.clientCode)).size};
  }
  // Products that sell but are not delivered, and catalog products nobody orders.
  function productHealth(data,f,today=recentRange(1).to) {
    const rows=selected(data,{...f,metric:'ordered'}).filter(r=>['warehouse','catalog'].includes(r.source));
    const byProduct=new Map();
    for(const r of rows){
      if(r.deliveredQty===null||r.deliveredQty===undefined||!(r.orderedQty>0))continue;
      const k=productKey(r);
      if(!byProduct.has(k))byProduct.set(k,{key:k,sku:r.sku,name:r.productName,brand:r.brand,orderedQty:0,withStock:0,noStock:0,pending:0,noStockAmount:0,pendingAmount:0,missingPrices:0,clients:new Set(),orders:new Set()});
      const p=byProduct.get(k),noStock=Number(r.outOfStockQty||0),pending=Math.max(0,r.orderedQty-r.deliveredQty-noStock),rate=r.ordered===null||r.ordered===undefined?null:r.ordered/r.orderedQty;
      p.orderedQty+=r.orderedQty;p.withStock+=r.deliveredQty;p.noStock+=noStock;p.pending+=pending;
      if(rate===null)p.missingPrices++;else{p.noStockAmount+=rate*noStock;p.pendingAmount+=rate*pending;}
      if(noStock>0||pending>0){p.clients.add(r.clientCode);p.orders.add(r.orderId);}
    }
    const undelivered=[...byProduct.values()].filter(p=>p.noStock>0||p.pending>0)
      .map(p=>({...p,clients:p.clients.size,orders:p.orders.size,fillRate:p.orderedQty?p.withStock/p.orderedQty:null}))
      .sort((a,b)=>b.noStockAmount-a.noStockAmount||b.noStock-a.noStock||b.pendingAmount-a.pendingAmount);
    const available=(data.catalog||[]).filter(p=>!p.hidden&&!excludedSkus.has(str(p.sku).toUpperCase())
      &&(!f.brand||p.section===f.brand)&&(!f.category||p.category===f.category)&&(!f.productKey||productKey({brand:p.section,sku:p.sku})===f.productKey)
      &&(!f.product||norm(`${p.sku} ${p.name}`).includes(norm(f.product))));
    const unique=new Map();for(const p of available){const k=productKey({brand:p.section,sku:p.sku});if(!unique.has(k))unique.set(k,p);}
    const orderedNow=new Set(selected(data,{...f,metric:'ordered'}).filter(r=>r.orderedQty>0).map(productKey));
    const yearStart=monthShift(f.from,-12),before=iso(timestamp(f.from)-dayMs);
    const earlier=new Map();
    for(const r of selected(data,{...f,metric:'ordered',from:yearStart,to:before}))if(r.orderedQty>0){const k=productKey(r);const e=earlier.get(k)||{units:0,last:null,clients:new Set()};e.units+=r.orderedQty;e.last=!e.last||r.date>e.last?r.date:e.last;e.clients.add(r.clientCode);earlier.set(k,e);}
    const notOrdered=[...unique].filter(([k])=>!orderedNow.has(k)).map(([k,p])=>{const e=earlier.get(k);return {key:k,sku:p.sku,name:p.name,brand:p.section,category:p.category,outOfStock:Boolean(p.outOfStock),price:listPrice(p),priorUnits:e?.units||0,priorClients:e?.clients.size||0,last:e?.last||null};})
      .sort((a,b)=>b.priorUnits-a.priorUnits||str(a.brand).localeCompare(str(b.brand))||str(a.sku).localeCompare(str(b.sku)));
    const stopped=notOrdered.filter(p=>p.priorUnits>0),never=notOrdered.filter(p=>!p.priorUnits);
    const neverByBrand=[...group2(never,p=>p.brand)].map(([brand,items])=>({brand,count:items.length,total:[...unique.values()].filter(p=>p.section===brand).length})).sort((a,b)=>b.count-a.count);
    return {undelivered,stopped,never,neverByBrand,catalogProducts:unique.size};
  }
  // Per-client ordered/invoiced totals in one pass, for portfolio tables and rankings.
  function clientTotals(data,f) {
    const ordered=group2(selected(data,{...f,client:'',metric:'ordered'}),r=>r.clientCode),invoiced=group2(invoicedRows(data,{...f,client:''}),r=>r.clientCode);
    const out=new Map();
    for(const code of new Set([...ordered.keys(),...invoiced.keys()])){
      const rows=ordered.get(code)||[];let noStock=0;
      for(const r of rows){const q=Number(r.outOfStockQty||0);if(q>0&&r.ordered!==null&&r.orderedQty>0)noStock+=r.ordered/r.orderedQty*q;}
      out.set(code,{ordered:measureRows(rows,'ordered'),invoiced:measureRows(invoiced.get(code)||[],'invoiceDate'),noStockAmount:noStock,name:(rows[0]||invoiced.get(code)[0]).clientName});
    }
    return out;
  }
  function group2(rows,key){const map=new Map();for(const r of rows){const k=key(r);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return map;}
  // What does not add up: orders without a known client, products without a price or
  // outside the catalog, and catalog orders that never reached WarehousePick.
  function dataQuality(data,f) {
    const rows=selected(data,{...f,client:'',metric:'ordered'}).filter(r=>r.source==='warehouse');
    const byOrder=new Map();
    for(const r of rows){
      if(!r.unassigned||r.clientCode==='kitchen-spot')continue;
      if(!byOrder.has(r.orderId))byOrder.set(r.orderId,{order:r.orderLabel,date:r.date,name:r.warehouseClientName||r.clientName||'',code:r.warehouseClientCode||'',fromCatalog:Boolean(r.catalogOrderId),rows:[]});
      byOrder.get(r.orderId).rows.push(r);
    }

    const noClient=[...byOrder.values()].map(o=>({...o,amount:measureRows(o.rows,'ordered'),salesmanCode:o.rows[0].orderSalesmanCode||'',reason:o.code?'Código '+o.code+' no está en los clientes del catálogo':o.fromCatalog?'Cuenta del catálogo sin cliente asignado':'Cargado en el depósito sin código de cliente'}))
      .sort((a,b)=>b.amount.amount-a.amount.amount);
    const products=new Map();
    for(const r of rows){
      const issue=!r.matched?'Fuera del catálogo actual':r.priceSource==='history'?'Valuado al último precio del Excel':r.ordered===null||r.ordered===undefined?'Sin precio':null;
      if(!issue)continue;
      const k=str(r.sku).toUpperCase()+'|'+issue;
      if(!products.has(k))products.set(k,{sku:r.sku,name:r.productName,issue,units:0,orders:new Set(),kitchenSpot:true});
      const p=products.get(k);p.units+=r.orderedQty;p.orders.add(r.orderLabel);p.kitchenSpot=p.kitchenSpot&&r.kitchenSpot;
    }
    const notInWarehouse=data.records.filter(r=>r.source==='catalog'&&!r.linkedToWarehouse&&r.date>=f.from&&r.date<=f.to&&(!data.handover||r.date>=data.handover.warehouseFrom));
    const catalogOrders=[...group2(notInWarehouse,r=>r.orderId)].map(([id,items])=>({order:items[0].orderLabel,date:items[0].date,name:items[0].clientName,lines:items.length,units:items.reduce((s,r)=>s+r.orderedQty,0),amount:items.reduce((s,r)=>s+Number(r.ordered||0),0)}));
    const merged=[...group2(rows.filter(r=>r.mergedFrom),r=>r.orderId).values()].map(items=>({order:items[0].orderLabel,date:items[0].date,name:items[0].mergedFrom.name,clientCode:items[0].clientCode,clientName:items[0].clientName,amount:measureRows(items,'ordered')}));
    return {noClient,merged,products:[...products.values()].map(p=>({...p,orders:[...p.orders]})).sort((a,b)=>b.units-a.units),catalogOrders,warehouseAvailable:data.warehouseAvailable};
  }
  function kitchenSpotSales(data,f) {
    const rows=selected(data,f).filter(r=>r.kitchenSpot);
    return measureRows(rows,f.metric||'ordered');
  }
  function stockLoss(data,f) {
    const rows=selected(data,{...f,metric:'ordered'});let amount=0,units=0,missing=0,unknown=0,uninvoiced=0,confirmedShortfall=0,shortfallMissing=0;const orders=new Set();
    for(const r of rows){if(r.source==='erp'){uninvoiced+=Math.max(0,r.ordered-r.invoiced);continue;}
      if(r.deliveryConfirmed===true&&r.deliveredQty!==null&&r.orderedQty>r.deliveredQty){if(r.ordered===null)shortfallMissing++;else confirmedShortfall+=r.ordered/r.orderedQty*(r.orderedQty-r.deliveredQty);}
      if(r.outOfStockQty===null||r.outOfStockQty===undefined){unknown++;continue;}
      if(r.outOfStockQty<=0)continue;units+=r.outOfStockQty;orders.add(r.occasionId||r.orderId);
      if(r.ordered===null||r.orderedQty<=0)missing++;else amount+=r.ordered/r.orderedQty*r.outOfStockQty;
    }
    const ordered=measureRows(rows);return {amount,units,orders:orders.size,missing,unknown,uninvoiced,confirmedShortfall,shortfallMissing,rate:ordered.amount&&!rows.some(r=>r.source==='erp')?amount/ordered.amount:null};
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
    const target=available.filter(p=>(!f.brand||p.section===f.brand)&&(!f.category||p.category===f.category)&&(!f.productKey||productKey({brand:p.section,sku:p.sku})===f.productKey)&&(!f.product||norm(`${p.sku} ${p.name}`).includes(norm(f.product))));
    const key=p=>`${p.brand||p.section}:${str(p.sku).toUpperCase()}`,targetKeys=new Set(target.map(key));
    const start=monthShift(today,-12),recentStart=monthShift(today,-3);
    const rows=sourceRows(data,f.source).filter(r=>(r.occasionDate||r.date)>=start&&(r.occasionDate||r.date)<=today&&r.orderedQty>0);
    const bought=new Map(),recent=new Map(),prior=new Map();
    for(const r of rows){const k=key(r);if(!bought.has(r.clientCode)){bought.set(r.clientCode,new Set());recent.set(r.clientCode,new Set());prior.set(r.clientCode,new Set());}bought.get(r.clientCode).add(k);((r.occasionDate||r.date)>=recentStart?recent:prior).get(r.clientCode).add(k);}
    const ranking=data.companyBestsellers!==null?data.companyBestsellers:companyBestsellers(data,today);
    const bestsellers=ranking.filter(p=>targetKeys.has(p.key)).slice(0,20).map(p=>({...p,product:target.find(t=>key(t)===p.key)}));
    return data.clients.filter(c=>!f.client||str(c.clientCode)===f.client).map(client=>{const code=str(client.clientCode),purchases=bought.get(code)||new Set(),now=recent.get(code)||new Set(),old=prior.get(code)||new Set();return {client,notBuyingTarget:![...targetKeys].some(k=>purchases.has(k)),missing:target.filter(p=>old.has(key(p))&&!now.has(key(p))),bestsellers:bestsellers.filter(p=>!purchases.has(p.key))};});

  }
  const model={ prepare,analyze,analysisSalesman,sourceRows,selected,totals,productKey,productSales,validRange,previousRange,defaultRange,currentMonthRange,recentRange,allRange,compareSources,iso,timestamp,norm,reviewed,reportingPeriods,monthShift,measureRows,reporting,orderedVersusInvoiced,kitchenSpotSales,listPrice,invoicedRows,trendComparison,brandPortfolio,scopeProfile,productHealth,clientTotals,dataQuality,invoiceCovered,monthlyReport,trendReport,trendPointValue,stockLoss,companyBestsellers,opportunityReport };
  if (typeof module!=='undefined' && module.exports) module.exports=model;
  else window.SALES_BI_MODEL=model;
})();
