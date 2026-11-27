/* Workbook data uses the same scoped model and filters as the dashboard. */
(function () {
  const priceSource = 'Lista de precios Mercado Libre octubre 2026';
  // Retired OXO codes matched against the October catalog update and price-list descriptions.
  const replacements = {
    '11295000': '11295200',
    '11211000': '11313700',
    '70981': '1114980',
    '70881': '1115080',
    '32480': '11230400',
    '11181400': '11168300',
  };
  const measureNames = { both: 'Pedido y facturado', ordered: 'Pedido', delivered: 'Entregado por fecha del pedido', invoiceDate: 'Facturado por fecha de factura', invoiced: 'Facturado histórico estimado' };
  const sourceNames = { erp: 'Historial Excel', catalog: 'Catálogo', warehouse: 'WarehousePick', 'history-warehouse': 'Excel + catálogo + pedidos directos de WarehousePick', combined: 'Excel + catálogo (alternativa)' };
  const priceHeaders = ['SKU de la lista', 'Precio de lista ARS (col. E)', 'Precio sugerido ARS (col. F)', 'Coincidencia de precio'];

  function priceColumns(sku, brand, prices) {
    const code = String(sku ?? '').trim().toUpperCase();
    const replacement = brand === 'OXO' && Object.hasOwn(replacements, code) ? replacements[code] : '';
    if (!prices) return ['', null, null, 'Lista no disponible'];
    const exact = Object.hasOwn(prices, code);
    const matchedCode = exact ? code : replacement;
    if (!matchedCode || !Object.hasOwn(prices, matchedCode)) return ['', null, null, 'Sin coincidencia'];
    const row = prices[matchedCode];
    if (row.ambiguous) {
      const brandPrice = row.byBrand && Object.hasOwn(row.byBrand, brand) ? row.byBrand[brand] : null;
      return brandPrice
        ? [matchedCode, brandPrice.listPrice, brandPrice.suggestedPrice, 'SKU exacto por marca']
        : [matchedCode, null, null, 'SKU con precios distintos'];
    }
    return [matchedCode, row.listPrice, row.suggestedPrice, exact ? 'SKU exacto' : 'Sustituto'];
  }

  const clientCode = client => String(client.displayCode || client.clientCode || '');
  const clientName = client => client.legalName || client.name;
  const known = value => !(value.unknown && !value.orders);
  const amount = value => known(value) && !(value.missing && value.pricedLines === 0) ? value.amount : null;
  const units = value => known(value) ? value.units : null;
  const quality = value => known(value) ? (value.partial ? 'Parcial' : '') : 'Sin datos';

  function sheets({ data, filters, context, report, chart, analysis, customers, products, comparison, opportunities, loss, warehouseTotals, gap, portfolio, health, restocks, prices, sellerName, invoiceRows=[] }) {
    const result = {};
    const price = item => priceColumns(item.sku, item.brand || item.section, prices);
    const ordered = report.metrics.ordered.current;
    const delivered = report.metrics.delivered.current;
    const metrics = [
      ['Medida', 'Período', 'Desde', 'Hasta', 'Importe sin IVA', 'Unidades', 'Pedidos distintos', 'Clientes distintos', 'Ticket promedio sin IVA', 'Cobertura', 'Calidad'],
    ];
    const changes = [['Medida', 'Comparación', 'Indicador', 'Diferencia', 'Variación']];
    const periods = [['current', 'Selección'], ['month', 'Mes anterior'], ['year', 'Mismo período año anterior'], ['ytd', 'Año al cierre']];
    for (const measure of ['ordered','invoiceDate','delivered']) {
      const figures=report.metrics[measure];
      for (const [key, label] of periods) {
        const range = report.periods[key], value = figures[key];
        const covered = figures[key + 'Covered'];
        const show = key === 'current' ? covered || value.orders > 0 : covered;
        metrics.push([measureNames[measure], label, range.from, range.to,
          ...(show ? [amount(value), units(value), value.orders, value.clients, value.ticket] : [null, null, null, null, null]),
          covered ? 'Cubierto' : 'Incompleto', quality(value)]);
      }
      for (const period of ['year', 'ytd']) {
        const current = figures.current.ticket, prior = figures[period].ticket;
        const comparable = figures.currentCovered && figures[period + 'Covered'] && current !== null && prior !== null
          && known(figures.current) && known(figures[period]);
        changes.push([measureNames[measure], period === 'year' ? 'Año anterior' : 'Año al cierre', 'Ticket promedio',
          comparable ? current - prior : null, comparable && prior ? (current - prior) / Math.abs(prior) : null]);
      }
      for (const [key, label] of [['amount', 'Importe'], ['units', 'Unidades'], ['orders', 'Pedidos distintos'], ['clients', 'Clientes distintos']]) {
        for (const period of ['month', 'year']) {
          const value = figures.changes[key][period];
          const comparable = figures.currentCovered && figures[period + 'Covered'] && known(figures.current) && known(figures[period]);
          changes.push([measureNames[measure], period === 'month' ? 'Mes anterior' : 'Año anterior', label, comparable ? value.delta : null, comparable ? value.percent : null]);
        }
      }
    }

    result['Resumen'] = [['Filtro o indicador', 'Valor'],
      ['Desde', filters.from], ['Hasta (inclusive)', filters.to], ['Origen', sourceNames[filters.source]],
      ['Medida', measureNames[filters.metric]], ['Vendedor', context.seller], ['Cliente', context.client],
      ['Marca', filters.brand || 'Todas'], ['Categoría', filters.category || 'Todas'], ['Provincia', filters.province || 'Todas'],
      ['Producto o SKU', filters.product || 'Todos'], ['Búsqueda de clientes', context.customerQuery || ''],
      ['Situación de clientes', context.customerStatus], ['Medida del gráfico', measureNames[chart.metric]], ['Dimensión del gráfico', chart.label],
      ['Precio de lista y sugerido', priceSource], ['Disponibilidad de la lista', prices ? 'Disponible' : 'No disponible'],
      ['Importe facturado (con stock) / pedido', amount(delivered) !== null && ordered.amount ? delivered.amount / ordered.amount : null],
      ['Unidades facturadas (con stock) / pedidas', known(delivered) && ordered.units ? delivered.units / ordered.units : null],
      ['Calidad de la relación facturado / pedido', quality(delivered) || quality(ordered)],
      ['Ticket de referencia del gráfico (12 meses)', chart.annual.ticket],
      ['Importe sin stock', loss.amount], ['Unidades sin stock', loss.units], ['Pedidos afectados por falta de stock', loss.orders],
      ['Proporción del importe sin stock', loss.rate], ['Líneas sin información de stock', loss.unknown],
      ['Importe no entregado en pedidos confirmados', loss.confirmedShortfall], ['Importe histórico no facturado', loss.uninvoiced],
      ['Inicio de pedidos del catálogo y el depósito en vista principal', data.handover?.warehouseFrom],
      ['Ranking de oportunidades', data.companyRankingPartial ? 'Parcial' : data.companyRankingAvailable ? 'Disponible' : 'No disponible'],
      ['Reposiciones pendientes', restocks?.available ? 'Bandeja actual, independiente del período' : 'No disponible']];
    if (gap) {
      const partial = gap.missingPrices ? ' (parcial: ' + gap.missingPrices + ' líneas sin precio)' : '';
      result['Pedido vs facturado'] = [['Concepto', 'Importe sin IVA', 'Unidades', 'Nota'],
        ['Pedido', gap.ordered, gap.orderedQty, gap.orders + ' pedidos; ' + gap.manualOrders + ' cargados en el depósito' + partial],
        ['Facturado (marcado con stock en WarehousePick)', gap.invoiced, gap.invoicedQty, ''],
        ['Diferencia', gap.difference, gap.differenceQty, ''],
        ['  Sin stock', gap.noStock, gap.noStockQty, 'Marcado «sin stock» en el depósito'],
        ['  Sin marcar todavía', gap.pending, gap.pendingQty, 'El depósito aún no lo resolvió'],
        ['  Sin dato del depósito', gap.unknown, gap.unknownQty, gap.unknownLines + ' líneas del catálogo aún no están en WarehousePick'],
        ['  Historial Excel no facturado', gap.history, gap.historyQty, 'Sin detalle de causa']];
    }
    result['Productos'] = [['Posición', 'SKU', 'Producto', 'Marca', 'Unidades', 'Importe sin IVA', 'Pedidos distintos', 'Clientes compradores', 'Calidad', ...priceHeaders],
      ...products.map((p, i) => [i + 1, String(p.sku), p.name, p.brand, units(p), amount(p), p.orders, p.buyers.length, quality(p), ...price(p)])];
    result['Compradores por producto'] = [['SKU', 'Producto', 'Marca', 'Código cliente', 'Cliente', 'Vendedor', 'Unidades', 'Importe sin IVA', 'Pedidos distintos', 'Última compra', 'Calidad', ...priceHeaders],
      ...products.flatMap(p => p.buyers.map(b => [String(p.sku), p.name, p.brand, clientCode(b.client), clientName(b.client), sellerName(b.client.salesmanCode), units(b), amount(b), b.orders, b.last, quality(b), ...price(p)]))];
    if (portfolio) result['Marcas portafolio'] = [['Marca', 'SKUs en catálogo', '% portafolio', 'SKUs con pedidos', 'Pedido sin IVA', '% pedido', 'Facturado sin IVA', '% facturado', 'Rinde (× peso)'],
      ...portfolio.rows.map(r => [r.brand, r.skus, r.skuShare, r.soldSkus, amount(r.ordered), r.orderedShare, amount(r.invoiced), r.invoicedShare, r.index])];
    if (health) {
      result['Productos sin entregar'] = [['SKU', 'Producto', 'Marca', 'Pedido (u.)', 'Facturado (u.)', 'Sin stock (u.)', 'Sin marcar (u.)', 'Sin stock sin IVA', 'Sin marcar sin IVA', 'Clientes afectados'],
        ...health.undelivered.map(p => [String(p.sku), p.name, p.brand, p.orderedQty, p.withStock, p.noStock, p.pending, p.noStockAmount, p.pendingAmount, p.clients])];
      result['Productos sin pedidos'] = [['SKU', 'Producto', 'Marca', 'Situación', 'Unidades 12 meses antes', 'Clientes que lo pedían', 'Último pedido', 'Catálogo'],
        ...[...health.stopped, ...health.never].map(p => [String(p.sku), p.name, p.brand, p.priorUnits ? 'Dejó de pedirse' : 'Sin pedidos en 12 meses', p.priorUnits, p.priorClients, p.last, p.outOfStock ? 'Sin stock' : 'Disponible'])];
    }
    result['Indicadores'] = metrics;
    result['Comparaciones'] = changes;
    const invoicedTrend = chart.invoiced;
    result['Tendencia'] = [['Desde', 'Hasta', 'Período', 'Valor del gráfico', 'Importe sin IVA', 'Unidades', 'Pedidos distintos', 'Clientes distintos', 'Ticket promedio sin IVA', 'Calidad', ...(invoicedTrend ? ['Facturado · valor del gráfico', 'Facturado sin IVA', 'Unidades facturadas'] : [])],
      ...chart.rows.map((p, i) => [p.from, p.to, p.context ? 'Contexto anterior' : 'Selección', chart.values[i], amount(p), units(p), p.orders, p.clients, p.ticket, quality(p),
        ...(invoicedTrend ? [invoicedTrend.values[i], amount(invoicedTrend.rows[i]), units(invoicedTrend.rows[i])] : [])])];
    result['Clientes'] = [['Código cliente', 'Cliente', 'Vendedor', 'Importe del período sin IVA', 'Importe 12 meses sin IVA', 'Frecuencia (días)', 'Última compra', 'Situación', 'Días hasta próxima compra', 'Calidad'],
      ...customers.map(({ client, activity: a }) => [clientCode(client), clientName(client), sellerName(client.salesmanCode), a ? amount(a.period) : null,
        a ? amount(a.annual) : null, a?.frequency, a?.last, context.situationLabels[a?.situation || 'insufficient'], a?.remaining, a ? quality(a.period) : 'Sin datos'])];
    result['Vendedores'] = [['Código vendedor', 'Vendedor', 'Importe del período sin IVA', 'Mes anterior sin IVA', 'Diferencia', 'Variación', 'Importe 12 meses sin IVA', 'Dentro de frecuencia', 'Acción necesaria', 'Fuera de frecuencia', 'Historial insuficiente', 'Nuevos (12m)', 'Reactivados (12m)'],
      ...report.vendors.map(v => [String(v.code), sellerName(v.code), amount(v.current), amount(v.month), v.change.delta, v.change.percent, amount(v.annual), v.situations.within, v.situations.action, v.situations.overdue, v.situations.insufficient, v.newClients, v.reactivated])];
    result.Marcas = [['Marca', 'Importe sin IVA', 'Participación', 'Unidades', 'Clientes'],
      ...analysis.brands.map(r => [r.name, r.value, r.share, r.qty, r.buyers])];
    result.Provincias = [['Provincia', 'Importe sin IVA', 'Unidades', 'Clientes'],
      ...analysis.provinces.map(r => [r.name, r.value, r.qty, r.buyers])];
    result['Pedidos y entregas'] = [['Fecha pedido', 'Fecha grupo de compra', 'ID grupo de compra', 'Origen', 'Archivo de origen', 'Fila', 'Pedido', 'Código cliente', 'Cliente', 'Código de local original', 'Nombre de local original', 'SKU', 'Producto', 'Marca', 'Provincia', 'Unidades pedidas', 'Unidades facturadas ERP', 'Unidades devueltas ERP', 'Importe pedido sin IVA', 'Importe facturado estimado sin IVA', 'Unidades facturadas (con stock)', 'Unidades sin stock', 'Unidades sin marcar', 'Importe facturado (con stock) sin IVA', 'Factura', 'Remito', ...priceHeaders],
      ...analysis.rows.filter(r=>!r.invoiceOnly).map(r => [r.date, r.occasionDate, r.occasionId, sourceNames[r.source], r.sourceFile, r.sourceRow, r.orderLabel || r.orderId,
        String(r.clientCode), r.clientName, String(r.sourceClientCode || r.clientCode), r.sourceClientName || r.clientName, String(r.sku), r.productName, r.brand, r.province,
        r.orderedQty, r.invoicedQty, r.returnedQty, r.ordered, r.invoiced, r.deliveredQty, r.outOfStockQty, r.pendingDeliveryQty, r.delivered, r.invoiceNumber, r.remitoNumber, ...price(r)])];
    result['Facturación'] = [['Fecha de factura', 'Factura', 'Remito', 'Pedido', 'Código cliente', 'Cliente', 'SKU', 'Producto', 'Marca', 'Unidades facturadas', 'Importe sin IVA', ...priceHeaders],
      ...invoiceRows.map(r=>[r.date,r.invoiceNumber,r.remitoNumber,r.orderLabel,String(r.clientCode),r.clientName,String(r.sku),r.productName,r.brand,r.invoicedQty,r.invoiced,...price(r)])];
    result['Comparación de fuentes'] = [['Pedido', 'Cliente', 'SKU', 'Producto', 'Unidades catálogo', 'Unidades WarehousePick', 'Diferencia', 'Estado'],
      ...comparison.map(r => [r.orderLabel, r.clientName, String(r.sku), r.name, r.hasCatalog ? r.catalogQty : null, r.hasWarehouse ? r.warehouseQty : null,
        r.hasCatalog && r.hasWarehouse ? r.delta : null, ({same:'Coincide',different:'Cantidad diferente','warehouse-only':'Solo en WarehousePick','catalog-only':'Solo en catálogo'})[r.status]])];
    result['Oportunidades'] = [['Código cliente', 'Cliente', 'Motivo', 'SKU', 'Producto', 'Marca', 'Unidades vendidas en la empresa', ...priceHeaders],
      ...opportunities.flatMap(o => [
        ...o.bestsellers.map(({product: p, qty}) => [clientCode(o.client), clientName(o.client), 'Más vendido que no compra', String(p.sku), p.name, p.section, qty, ...price(p)]),
        ...o.missing.map(p => [clientCode(o.client), clientName(o.client), 'Compraba antes', String(p.sku), p.name, p.section, null, ...price(p)]),
      ])];
    if (restocks?.available) {
      result['Reposiciones pendientes'] = [['Reposición', 'Fecha', 'Código cliente', 'Cliente', 'SKU', 'Producto', 'Marca', 'Compras', 'Unidades habituales', 'Unidades pedidas sin stock', 'Última compra', 'Frecuencia (días)', ...priceHeaders],
        ...restocks.items.flatMap(batch => batch.products.map(p => [batch.title, batch.receivedAt, String(p.clientCode), p.clientName, String(p.sku), p.name, p.brand, p.purchases, p.usualQty, p.missedQty, p.lastPurchase, p.frequency, ...price(p)]))];
    }
    return result;
  }

  function workbook(xlsx, data) {
    const file = xlsx.utils.book_new();
    for (const [name, rows] of Object.entries(sheets(data))) {
      const sheet = xlsx.utils.aoa_to_sheet(rows);
      const headers = rows[0];
      sheet['!cols'] = headers.map((header, i) => ({wch: Math.min(55, Math.max(14, header.length + 2, ...rows.slice(1, 40).map(row => String(row[i] ?? '').length + 2)))}));
      const summary = name === 'Resumen' || name === 'Entrega WarehousePick';
      if (!summary) sheet['!autofilter'] = {ref: sheet['!ref']};
      for (const [column, header] of headers.entries()) {
        const format = ['Variación', 'Participación'].includes(header) ? '0.0%' : priceHeaders.slice(1, 3).includes(header) ? '#,##0.00' : null;
        if (!format) continue;
        for (let row = 1; row < rows.length; row++) {
          const cell = sheet[xlsx.utils.encode_cell({r:row,c:column})];
          if (cell?.t === 'n') cell.z = format;
        }
      }
      if (summary) {
        for (const [row, [label]] of rows.entries()) {
          if (!label.includes(' / ') && !label.startsWith('Proporción')) continue;
          const cell = sheet[xlsx.utils.encode_cell({r:row,c:1})];
          if (cell?.t === 'n') cell.z = '0.0%';
        }
      }
      xlsx.utils.book_append_sheet(file, sheet, name);
    }
    return file;
  }

  const api = {priceColumns, sheets, workbook};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SALES_BI_EXPORT = api;
})();
