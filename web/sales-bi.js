/* Linked BI workspace. Private data is held only in this signed-in session's memory. */
(function () {
  const m=window.SALES_BI_MODEL;
  let section='sales', session=null, filters=null, owner='', tab='customers', customerQuery='', customerStatus='all', productTimer, rendering=false,chartFilters=null,report=null,chartScene=null,chartCleanup=null;
  let preparedVersion=null,preparedData=null;
  let opportunityTimer=null;
  const calculations=new Map();
  const calculationKey=(kind,parameters)=>kind+':'+m.recentRange(1).to+':'+JSON.stringify(parameters);
  function calculated(kind,parameters,run){const key=calculationKey(kind,parameters);if(calculations.has(key))return calculations.get(key);const value=run();if(calculations.size>=30)calculations.delete(calculations.keys().next().value);calculations.set(key,value);return value;}
  const safe=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>new Intl.NumberFormat('es-AR',{ maximumFractionDigits:1 }).format(v);
  const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(v);
  const compact=v=>new Intl.NumberFormat('es-AR',{notation:'compact',maximumFractionDigits:1}).format(v);
  const pct=v=>v===null ? 'Sin base comparable' : `${v>0?'+':''}${n(v*100)}%`;
  const date=v=>v ? v.split('-').reverse().join('/') : 'Sin registro';
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
    return `<section class="bi-handover" data-bi-handover aria-label="Cambio de fuente de datos"><header><b>Excel hasta ${date(h.excelThrough)} → Catálogo + WarehousePick desde ${date(h.warehouseFrom)}</b></header></section>`;
  }
  const options=(items,value)=>items.map(([v,label])=>`<option value="${safe(v)}" ${v===value?'selected':''}>${safe(label)}</option>`).join('');
  function reset() { clearTimeout(productTimer); chartCleanup?.();chartCleanup=null;chartScene=null;session=null; filters=null; chartFilters=null; report=null; owner=''; tab='customers'; customerQuery=''; customerStatus='all';preparedVersion=null;preparedData=null;calculations.clear();clearTimeout(opportunityTimer); }
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
      filters={...(input.live?m.allRange(session.data,source):m.defaultRange(session.data,source)),source,metric:'ordered',compare:'year',brand:'',category:'',client:'',province:'',product:''};
    }
    if(typing) return;
    render(focus);
  }
  function select(name,label,items) {
    return `<label><span>${label}</span><select name="${name}">${options(items,filters[name])}</select></label>`;
  }
  const situationLabels={within:'Dentro de frecuencia',action:'Acción necesaria',overdue:'Fuera de frecuencia',insufficient:'Historial insuficiente'};
  const amountLabel=v=>v.unknown&&!v.orders?'Sin datos':`${money(v.amount)}${v.partial?' (parcial)':''}`;
  function stockSummary() {
    const loss=m.stockLoss(session.data,filters);
    return `<section class="bi-card"><h3>Venta perdida por falta de stock · período seleccionado</h3><div class="bi-secondary-metrics"><span>Importe sin stock <b>${money(loss.amount)}${loss.missing||loss.unknown?' (parcial)':''}</b></span><span>Unidades sin stock <b>${n(loss.units)}</b></span><span>Pedidos afectados <b>${loss.orders}</b></span><span>Sobre importe pedido <b>${loss.rate===null?'No disponible':n(loss.rate*100)+'%'}</b></span></div><p class="bi-data-note">Solo productos marcados «sin stock» en WarehousePick, valorados al precio neto del pedido original. Los pedidos pendientes no se consideran venta perdida. No entregado en pedidos ya facturados: ${money(loss.confirmedShortfall)}${loss.shortfallMissing?' (parcial)':''}; este importe puede incluir productos sin stock y no se suma al anterior. ${loss.unknown} líneas sin estado disponible; ${loss.missing} sin importe vinculable. El histórico Excel no identifica la causa: su importe no facturado estimado (${money(loss.uninvoiced)}) se muestra separado y no se atribuye a falta de stock.</p></section>`;
  }
  function comparisonBadge(change, key='amount') {
    const direction=change.delta>0?'up':change.delta<0?'down':'flat';
    const arrow={up:'↑',down:'↓',flat:'→'}[direction];
    const label={up:'Aumento',down:'Disminución',flat:'Sin cambio'}[direction];
    const amount=key==='amount'?money(change.delta):n(change.delta);
    return `<b class="bi-change bi-change--${direction}" aria-label="${label}: ${safe(amount)}; ${safe(pct(change.percent))}">${arrow} Δ ${change.delta>0?'+':''}${amount} · ${pct(change.percent)}</b>`;
  }
  function headlines() {
    return `<section class="bi-headlines" data-bi-headlines><h3>Mes en curso · ${date(report.periods.current.from)} — ${date(report.periods.today)}</h3><p class="bi-data-note">Fechas fijas hasta hoy, independientes del filtro de período. Comparaciones al mismo día del mes. Importes sin IVA; entregado según fecha del pedido. Pedidos agrupados por cliente dentro de 2 días desde la primera compra.</p>${['ordered','delivered'].map(metric=>{const v=report.metrics[metric];return `<h4>${metric==='ordered'?'Pedido':'Entregado / facturado'}</h4><div class="bi-kpis bi-headline-grid ${metric==='ordered'?'bi-ordered-headlines':'bi-delivered-headlines'}">${[['amount','Importe'],['units',metric==='ordered'?'Unidades pedidas':'Unidades entregadas'],['orders','Pedidos distintos'],['clients','Clientes distintos']].map(([key,label])=>`<article><span>${label}</span><strong>${!v.currentCovered&&!v.current.orders?'Sin datos':key==='amount'?amountLabel(v.current):(key==='units'&&v.current.unknown&&!v.current.orders?'Sin datos':n(v.current[key])+(!v.currentCovered||key==='units'&&v.current.partial?' (parcial)':''))}</strong>${[['month','Mes anterior'],['year','Mismo mes año anterior']].map(([period,name])=>{const change=v.changes[key][period],covered=v[period+'Covered'];return `<small>${name} · ${date(report.periods[period].to)}<br>${covered?`${key==='amount'?amountLabel(v[period]):n(v[period][key])}${v.currentCovered?comparisonBadge(change,key):' · comparación pendiente'}${v.current.partial||v[period].partial?' · datos parciales':''}`:'Sin historial comparable'}</small>`;}).join('')}${v.current.unknown?`<small>${v.current.unknown} líneas sin información de entrega</small>`:''}</article>`).join('')}</div>`;}).join('')}</section>`;
  }
  function deliveryRatio(ordered, delivered, known=true) {
    if(!known||!ordered||delivered===null)return 'Sin datos';
    return n(delivered/ordered*100)+'%';
  }
  function ticketSummary() {
    const ordered=report.metrics.ordered.current,delivered=report.metrics.delivered.current;
    const known=!(delivered.unknown&&!delivered.orders),partial=ordered.partial||delivered.partial;
    const ticketLabel=v=>v.ticket===null||v.unknown&&!v.orders?'Sin datos':money(v.ticket)+(v.partial?' (parcial)':'');
    return `<section class="bi-card bi-ticket-summary"><h3>Entrega y ticket promedio · mes en curso</h3><div class="bi-kpis bi-headline-grid"><article><span>Entregado / pedido · importe</span><strong>${deliveryRatio(ordered.amount,delivered.amount,known)}${partial&&known?' (parcial)':''}</strong><small>Unidades: ${deliveryRatio(ordered.units,delivered.units,known)}${partial&&known?' (parcial)':''}</small></article>${['ordered','delivered'].map(metric=>{const v=report.metrics[metric];return `<article><span>Ticket promedio ${metric==='ordered'?'pedido':'entregado'}</span><strong>${ticketLabel(v.current)}</strong>${[['year','Mismo mes año anterior',report.periods.year],['ytd','Promedio año en curso',report.periods.ytd]].map(([key,label,range])=>{const prior=v[key],comparable=v.currentCovered&&v[key+'Covered']&&v.current.ticket!==null&&prior.ticket!==null&&!(v.current.unknown&&!v.current.orders)&&!(prior.unknown&&!prior.orders);return `<small>${label} · ${date(range.from)} — ${date(range.to)}<br>${v[key+'Covered']?ticketLabel(prior):'Sin historial comparable'}${comparable?comparisonBadge({delta:v.current.ticket-prior.ticket,percent:prior.ticket?(v.current.ticket-prior.ticket)/Math.abs(prior.ticket):null}):''}</small>`;}).join('')}</article>`;}).join('')}</div></section>`;
  }
  function chart() {
    if(!chartFilters)chartFilters={...report.periods.annual,metric:'delivered',dimension:'amount'};
    const f={...filters,...chartFilters},rows=calculated('chart',f,()=>m.monthlyReport(session.data,f)),annual=calculated('annual',f,()=>m.measureRows(m.selected(session.data,{...f,...report.periods.annual}),f.metric));
    const format=v=>v===null?'Sin datos':f.dimension==='amount'||f.dimension==='ticket'?money(v):n(v);
    const value=p=>p.unknown&&!p.orders?null:f.dimension==='ticket'?p.ticket:p[f.dimension];
    const values=rows.map(value),max=Math.max(1,...values.filter(v=>v!==null),f.dimension==='ticket'?annual.ticket||0:0);
    chartScene={rows,values,max,format,annual,f,handover:session.input.simple?null:session.data.handover};
    const field=(key,label,choices)=>`<label>${label}<select data-bi-chart="${key}">${options(choices,chartFilters[key])}</select></label>`;
    return `<section class="bi-card bi-monthly-chart"><div class="bi-card-title"><h3>Últimos 12 meses · tendencia mensual</h3></div><form class="bi-chart-filters" data-bi-chart-form><label>Desde<input type="date" data-bi-chart="from" value="${chartFilters.from}"></label><label>Hasta<input type="date" data-bi-chart="to" value="${chartFilters.to}"></label>${field('metric','Medida',[['ordered','Pedido'],['delivered','Entregado / facturado']])}${field('dimension','Analizar',[['amount','Importe'],['units','Unidades'],['orders','Pedidos distintos'],['clients','Clientes distintos'],['ticket','Ticket promedio']])}<button type="button" data-bi-chart-reset>Últimos 12 meses</button><span data-bi-chart-error role="status"></span></form><p class="bi-data-note">Filtros de fecha y medida propios del gráfico. Respeta cliente, vendedor, marca y producto de la selección. Agregados atribuidos a la primera fecha del grupo.</p><div class="bi-chart-scroll"><canvas class="bi-trend bi-canvas-chart" data-bi-canvas tabindex="0" role="img" aria-label="Gráfico mensual interactivo. Mové el cursor o usá las flechas para explorar los meses. Los valores también están en la tabla mensual."></canvas><span class="bi-chart-readout" data-bi-chart-readout role="status" aria-live="polite"></span></div><div class="bi-secondary-metrics bi-annual-ticket"><span>Ticket ${f.metric==='delivered'?'entregado':'pedido'} últimos 12 meses: <b>${annual.ticket===null?'Sin datos':money(annual.ticket)}</b>${annual.partial?' · parcial':''}.</span></div><details><summary>Ver detalle mensual</summary><div class="bi-table-scroll"><table><thead><tr><th>Mes</th><th>Importe</th><th>Pedidos</th><th>Clientes</th><th>Ticket</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.month}</td><td>${amountLabel(p)}</td><td>${p.orders}</td><td>${p.clients}</td><td>${p.ticket===null?'—':money(p.ticket)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }
  function bars(rows,key) {
    const max=Math.max(1,...rows.map(r=>Math.abs(r.value)));
    return rows.slice(0,8).map(r=>`<button type="button" class="bi-bar" data-bi-dimension="${key}" data-value="${safe(r.id)}"><span><b>${safe(r.name)}</b><strong>${money(r.value)}</strong></span><i><em style="width:${Math.min(100,Math.abs(r.value)/max*100)}%"></em></i><small>${n(r.qty)} unidades · ${r.buyers} clientes</small></button>`).join('') || '<p class="bi-empty">No hay ventas para estos filtros.</p>';
  }
  const helpDefinitions=[
    [/entrega y ticket/,'Mes actual hasta hoy. La entrega usa las mismas ventas que el encabezado: Excel hasta el 15/10 y catálogo con WarehousePick desde el 16/10.'],
    [/entregado \/ pedido/,'Entregado dividido por pedido, en importe o unidades según el indicador. Usa el mismo período y ventas del panel; parcial indica entregas sin información. No es la tasa de falta de stock.'],
    [/ticket promedio pedido|ticket promedio entregado/,'Importe dividido por compras agrupadas; entregado cuenta compras con al menos una unidad entregada. Compara el mes hasta hoy con igual período del año anterior y con importe ÷ compras desde el 1 de enero hasta hoy. No promedia tickets mensuales.'],
    [/explorar ventas/,'Los filtros se aplican al cambiar. Las fechas del detalle no cambian el encabezado ni las fechas propias del gráfico.'],
    [/^entregado.*facturado/,'Ventas con entrega confirmada. En el historial Excel se usa la cantidad facturada y su importe estimado.'],
    [/^pedido$/,'Ventas solicitadas por el cliente, con los importes y precios originales de cada pedido.'],
    [/mes en curso|analisis de ventas/,'Mes actual hasta hoy. Comparaciones al mismo día del mes anterior y del año anterior.'],
    [/^importe$|venta del periodo/,'Importe neto sin IVA. Se respeta el precio del pedido original; «parcial» indica datos incompletos.'],
    [/pedidos distintos|^pedidos$/,'Pedidos del mismo cliente dentro de 2 días del primero cuentan como una compra, fechada en ese primer día.'],
    [/clientes distintos/,'Clientes únicos con compras; en entregado, basta una unidad entregada para contar al cliente.'],
    [/unidades pedidas/,'Cantidad de productos pedidos en el período del panel. En el encabezado: mes actual hasta hoy, comparado al mismo día del mes anterior y del año anterior.'],
    [/unidades entregadas|entregado al precio/,'Unidades facturadas del Excel hasta el 15/10 y entregas confirmadas de WarehousePick desde el 16/10. Usa el período del panel; los importes se valoran al precio original del pedido.'],
    [/pendientes/,'Unidades pedidas menos entregadas confirmadas. Las líneas sin información no se consideran cero entregado.'],
    [/pedido versus entregado/,'Compara pedidos recientes y su entrega confirmada con el mismo período y filtros.'],
    [/venta perdida|importe sin stock/,'Unidades marcadas sin stock en WarehousePick × precio neto original. Los pedidos abiertos no son pérdida de stock.'],
    [/unidades sin stock/,'Cantidad que WarehousePick marcó explícitamente sin stock.'],
    [/pedidos afectados/,'Compras agrupadas con al menos un producto marcado sin stock.'],
    [/sobre importe pedido/,'Importe sin stock ÷ importe pedido. No se calcula si falta cobertura para la comparación.'],
    [/tendencia mensual/,'Fechas y medida propias del gráfico. Mové el cursor para recorrer los meses; flechas para usar el teclado.'],
    [/ticket.*12 meses|^ticket$|ticket.*promedio/,'Importe ÷ compras agrupadas. La línea anual usa el importe total de 12 meses ÷ sus compras, no la media de tickets mensuales.'],
    [/accion necesaria/,'Clientes a 14 días o menos de su próxima compra esperada, según su frecuencia de los últimos 12 meses.'],
    [/fuera de frecuencia/,'Clientes cuya próxima fecha de compra esperada ya pasó, sin días de tolerancia.'],
    [/reposiciones/,'Productos nuevamente disponibles que el cliente compró en al menos dos ocasiones durante 12 meses, o que pidió y no recibió por falta de stock. Visto y gestionado son estados distintos.'],
    [/ampliar|oportunidades/,'Más vendidos de la empresa por unidades entregadas de los últimos 12 meses que el cliente no compró, y productos comprados entre 3 y 12 meses atrás, ausentes en los últimos 3.'],
    [/participacion por marca/,'Importe de cada marca en la selección. Seleccioná una marca para filtrar.'],
    [/frecuencia promedio/,'Promedio de días entre compras agrupadas en los últimos 12 meses. Requiere al menos dos compras.'],
    [/ultima compra/,'Fecha de la última compra agrupada registrada del cliente en la fuente seleccionada.'],
    [/situacion/,'Dentro de frecuencia, acción necesaria desde 14 días antes, fuera de frecuencia o historial insuficiente.'],
    [/nuevos/,'Clientes cuya primera compra registrada está en los últimos 12 meses. Puede existir historia anterior no disponible.'],
    [/reactivados/,'Clientes que volvieron a comprar después de al menos 12 meses sin compras.'],
    [/vendedores|^vendedor$/,'Las ventas históricas y actuales siguen al vendedor asignado hoy al cliente.'],
    [/ultimos 12 meses/,'Ventas de los últimos 12 meses del informe, hasta hoy.'],
    [/mes anterior|variacion|comparacion/,'Comparación al mismo día corrido. Δ es la diferencia en importe; % es el cambio frente al valor anterior.'],
    [/catalogo versus warehousepick|comparar fuentes|diferencia/,'Compara catálogo y depósito por pedido y SKU. Las fuentes se contrastan; no se suman.'],
    [/historial excel|cambio de fuente/,'Excel hasta el 15/10/2026. Desde el 16/10: pedidos del catálogo con entregas de WarehousePick.'],
    [/warehousepick/,'Informa cantidades entregadas y productos sin stock; los precios provienen del pedido del catálogo.'],
    [/^catalogo$/,'Pedidos y precios originales del catálogo. El estado del catálogo por sí solo no confirma una entrega.'],
    [/facturad.*erp/,'Facturación histórica estimada a partir de la cantidad facturada y el precio neto del pedido.'],
    [/devueltas/,'Unidades devueltas informadas por el historial Excel, mostradas por separado.'],
    [/sin asignacion/,'Clientes de ventas sin una coincidencia confirmada en la cartera actual.'],
    [/sin compras del conjunto/,'Sin compras de la marca o conjunto seleccionado durante los últimos 12 meses.'],
    [/productos antes comprados/,'Comprados entre 3 y 12 meses atrás, pero ausentes en los últimos 3 meses.'],
    [/mas vendidos/,'Hasta 20 productos disponibles con más unidades entregadas de toda la empresa en 12 meses que este cliente no compró. No se muestran ventas de otros clientes.'],
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
      const text=el.textContent;
      if(text.startsWith('ERP hasta ')){el.remove();return;}
      el.textContent=text.includes('WarehousePick no respondió')?'WarehousePick no disponible.':text.includes('líneas no tienen importe')?`${text.match(/^\d+/)?.[0]||''} líneas sin importe · totales parciales.`:text.includes('origen seleccionado')?'Facturación no disponible para esta fuente.':'Historial Excel no disponible.';
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
    const nav=scope.querySelector('.bi-tabs');if(nav)add(nav,({customers:'Clientes · ventas',vendors:'Vendedores',products:'Productos',orders:'Pedidos',deliveries:'Pedido versus entregado',comparison:'Comparar fuentes',opportunities:'Oportunidades',geography:'Ubicaciones'})[tab]);
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
    if(!canvas||!scene)return;
    const ctx=canvas.getContext('2d'),{rows,values,max,format,annual,f,handover}=scene;
    const readout=root.querySelector('[data-bi-chart-readout]');
    const x=i=>64+(i+.5)/Math.max(1,rows.length)*540,y=v=>215-v/max*130;
    let active=-1;
    const label=i=>{const p=rows[i];return [`${p.month} · ${f.metric==='delivered'?'Entregado / facturado':'Pedido'}`,`${format(values[i])}${p.partial?' · parcial':''}`,`${n(p.orders)} pedidos · ${n(p.clients)} clientes`,`Ticket: ${p.ticket===null?'Sin datos':money(p.ticket)}`,p.unknown?`${n(p.unknown)} líneas sin datos`:p.partial?'Importes conocidos; datos parciales':''];};
    function line(x1,y1,x2,y2,color,width=1,dash=[]) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);}
    function draw() {
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(3,window.devicePixelRatio||1);
      const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      ctx.setTransform(canvas.width/620,0,0,canvas.height/260,0,0);
      ctx.clearRect(0,0,620,260);ctx.fillStyle='#fff';ctx.fillRect(0,0,620,260);ctx.font='11px Arial';
      for(const k of [0,.5,1]){line(64,y(max*k),605,y(max*k),'#e5ebf1');ctx.fillStyle='#63758c';ctx.textAlign='right';ctx.fillText(compact(max*k),57,y(max*k)+4);}
      if(f.source==='history-warehouse'&&handover&&handover.warehouseFrom>=f.from&&handover.warehouseFrom<=f.to){const i=rows.findIndex(p=>p.month===handover.warehouseFrom.slice(0,7));if(i>=0){line(x(i),74,x(i),219,'#238378',1,[4,4]);ctx.fillStyle='#176c63';ctx.textAlign='center';ctx.fillText(`${date(handover.warehouseFrom)} · cambio de fuente`,Math.max(160,Math.min(493,x(i))),18);}}
      if(f.dimension==='ticket'&&annual.ticket!==null)line(64,y(annual.ticket),605,y(annual.ticket),'#df922e',1.5,[5,4]);
      ctx.strokeStyle='#176fc1';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();let gap=true;
      values.forEach((v,i)=>{if(v===null){gap=true;return;}if(gap)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));gap=false;});ctx.stroke();
      const every=Math.max(1,Math.ceil(rows.length/12));
      rows.forEach((p,i)=>{if(values[i]!==null){ctx.beginPath();ctx.arc(x(i),y(values[i]),i===active?6:3.5,0,Math.PI*2);ctx.fillStyle='#176fc1';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.stroke();}if(i%every===0||i===rows.length-1){ctx.fillStyle='#63758c';ctx.textAlign='center';ctx.font='10px Arial';ctx.fillText(p.month.slice(5)+'/'+p.month.slice(2,4),x(i),241);}});
      if(active<0||!rows[active])return;
      const p=rows[active],pointY=values[active]===null?85:y(values[active]);
      line(x(active),pointY+8,x(active),219,'#64809b',1,[3,3]);
      const unit=f.dimension==='orders'?' ped.':f.dimension==='clients'?' clientes':'';
      const lines=[`${p.month} · ${format(values[active])}${unit}${p.partial?' *':''}`,`${n(p.orders)} ped. · ${n(p.clients)} clientes`];
      ctx.font='9px Arial';
      const w=Math.min(176,Math.max(100,...lines.map(t=>ctx.measureText(t).width+18))),h=36;
      const tx=Math.max(4,Math.min(616-w,x(active)-w/2)),ty=Math.max(25,pointY-h-12);
      canvas.dataset.tooltipBounds=JSON.stringify({x:tx,y:ty,width:w,height:h,pointX:x(active),pointY});
      ctx.save();ctx.shadowColor='rgba(17,35,55,.14)';ctx.shadowBlur=5;ctx.fillStyle='#142e49';ctx.beginPath();ctx.roundRect(tx,ty,w,h,4);ctx.fill();ctx.restore();
      ctx.fillStyle='#142e49';ctx.beginPath();ctx.moveTo(x(active)-4,ty+h);ctx.lineTo(x(active),ty+h+5);ctx.lineTo(x(active)+4,ty+h);ctx.fill();
      ctx.textAlign='left';lines.forEach((text,i)=>{ctx.font=(i===0?'bold ':'')+'9px Arial';ctx.fillStyle=i===0?'white':'#b9d3e9';ctx.fillText(text,tx+9,ty+14+i*13,w-18);});
    }
    function show(index,keyboard=false){active=Math.max(0,Math.min(rows.length-1,index));canvas.dataset.activeMonth=rows[active]?.month||'';if(keyboard&&readout)readout.textContent=rows[active]?label(active).filter(Boolean).join('. '):'';draw();}
    function pointer(e){if(!rows.length)return;const rect=canvas.getBoundingClientRect(),px=(e.clientX-rect.left)/rect.width*620;show(Math.floor((Math.max(64,Math.min(604,px))-64)/540*rows.length));}
    function hide(){active=-1;delete canvas.dataset.activeMonth;delete canvas.dataset.tooltipBounds;if(readout)readout.textContent='';draw();}
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
    const warehouseTotals=m.totals(result.rows.filter(r=>r.source==='catalog'||r.source==='warehouse'));
    const hasRecentOrders=result.rows.some(r=>r.source==='catalog'||r.source==='warehouse');
    report=calculated('report',filters,()=>m.reporting(data,filters));
    const knownOpportunities=calculations.get(calculationKey('opportunities',filters));
    const opportunityCount=knownOpportunities?knownOpportunities.reduce((total,o)=>total+o.missing.length+o.bestsellers.length,0):null;
    const source=m.sourceRows(data,filters.source);
    const dimension=key=>[...new Set(source.map(r=>r[key]))].sort().map(v=>[v,v]);
    const isInvoice=filters.metric==='invoiced';
    const isDelivered=filters.metric==='delivered';
    const metricLabel=isDelivered?'Entregado confirmado':isInvoice?'Facturado ERP estimado':'Pedido';
    const sourceNames={erp:'Historial Excel',warehouse:'WarehousePick',catalog:'Catálogo','history-warehouse':'Excel + catálogo · entregas WarehousePick',combined:'Excel + catálogo'};
    const invoiceUnavailable=filters.source==='catalog' || (!input.batches.length) || filters.from>data.coverage.to;
    const assignedBuyers=new Set(result.rows.filter(r=>r.clientId && (isDelivered?r.deliveredQty:isInvoice?r.invoicedQty:r.orderedQty)).map(r=>r.clientCode)).size;
    const selectedClient=data.clients.find(c=>String(c.clientCode)===filters.client);
    rendering=true;
    try {
    panel.innerHTML=`<div class="sales-bi">
      <header class="bi-header"><div><span class="bi-eyebrow">LEXO / INTELIGENCIA COMERCIAL</span><h2>Análisis de ventas</h2><p>Rendimiento de ventas y oportunidades para tu próxima visita.</p></div><div class="bi-header-actions">${input.admin&&!input.simple?'<button type="button" data-bi-groups>Agrupar clientes</button>':''}<a class="bi-guide-link" href="/sales-dashboard-guide.html" target="_blank" rel="noopener">Guía</a><button type="button" data-bi-export>Exportar filas</button><button type="button" data-bi-refresh>Actualizar</button></div></header>
      ${input.live?`<div class="bi-live-status" data-bi-live-status role="status">En vivo · ${safe(new Date(input.updatedAt).toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}))}</div>`:'<div class="bi-live-status">Vista de archivos históricos · <a href="/live">Conectar datos actuales del catálogo</a></div>'}
      <nav class="bi-section-tabs" aria-label="Secciones del dashboard"><button type="button" data-bi-section="sales" aria-pressed="${section==='sales'}">Ventas</button><button type="button" data-bi-section="vendors" aria-pressed="${section==='vendors'}">Vendedores</button></nav>
      <div class="bi-layout"><aside class="bi-sidebar"><details class="bi-filter-panel" open><summary>Filtros y cartera</summary><h3>Explorar ventas</h3>
      ${input.admin?`<label><span>Vendedor actual</span><select data-bi-salesman>${options(input.salesmen.map(s=>[s.code,`${s.code==='*'?'':s.code+' · '}${s.name}`]),input.salesmanCode)}</select></label>`:`<p class="bi-scope">Cartera del vendedor ${safe(input.salesmanCode || 'sin asignar')}</p>`}
      <form data-bi-filters>
      ${select('source','Origen de los pedidos',[['history-warehouse','Excel + catálogo (principal)'],['erp','Historial Excel'],['warehouse','WarehousePick'],['catalog','Catálogo'],['combined','Excel + catálogo (alternativa)']])}
      ${select('metric','Analizar por',[['ordered','Pedido'],['delivered','Entregado confirmado (WarehousePick)'],['invoiced','Facturado ERP (estimado)']])}
      <div class="bi-date-shortcuts"><button type="button" data-bi-preset="all">Todo el historial</button><button type="button" data-bi-preset="recent">Últimos 30 días</button><button type="button" data-bi-preset="month">Último mes completo</button><button type="button" data-bi-preset="year">12 meses</button></div>
      <label><span>Desde</span><input name="from" type="date" value="${safe(filters.from)}" required></label><label><span>Hasta (inclusive)</span><input name="to" type="date" value="${safe(filters.to)}" required></label>
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
      ${ticketSummary()}
      <section class="bi-source-cards" aria-label="Datos disponibles">${[['erp','Historial Excel'],['warehouse','WarehousePick'],['catalog','Catálogo']].map(([key,label])=>{const rows=m.sourceRows(data,key),dates=rows.map(r=>r.date).sort();return `<button type="button" data-bi-source="${key}"><b>${label}</b><strong>${new Set(rows.map(r=>r.occasionId||r.orderId)).size} pedidos · ${n(rows.length)} líneas</strong><small>${dates.length?`${date(dates[0])} — ${date(dates.at(-1))}`:'Sin registros disponibles'}</small></button>`;}).join('')}</section>
      ${handoverBanner()}
      ${['warehouse','history-warehouse'].includes(filters.source)&&!data.warehouseAvailable?'<p class="bi-notice">WarehousePick no respondió. El historial Excel se conserva. Los pedidos del catálogo siguen disponibles; la entrega no se supone igual a cero.</p>':''}
      ${t.missingValues?`<p class="bi-notice">${t.missingValues} líneas no tienen importe de pedido disponible. WarehousePick no contiene precios: los importes vinculados se valoran al precio neto del pedido original del catálogo. Los totales monetarios son parciales; las cantidades se conservan.</p>`:''}
      ${!input.available?'<p class="bi-notice" role="status">El historial ERP todavía no está habilitado en este entorno. Podés explorar los pedidos del catálogo.</p>':!input.batches.length?'<p class="bi-notice">Todavía no hay historial ERP importado.</p>':''}
      ${filters.source==='combined'?`<p class="bi-notice">ERP hasta ${date(data.coverage.to)}; catálogo desde el día siguiente. Los pedidos del catálogo dentro del período ERP se excluyen para evitar duplicación. El catálogo no informa facturación.</p>`:''}
      ${filters.source!=='catalog'&&data.coverage.to?`<p class="bi-data-note">ERP disponible: ${date(data.coverage.from)} a ${date(data.coverage.to)}. ${!result.covered?'El período seleccionado excede la cobertura ERP. ':''}Facturación agrupada por fecha del pedido; el archivo no contiene fechas ni importes de factura. Estimación: cantidad facturada × precio neto del pedido. Devoluciones informadas por separado.</p>`:'<p class="bi-data-note">Importes de pedidos del catálogo. Su estado de envío no acredita facturación.</p>'}
      ${isInvoice&&invoiceUnavailable?'<p class="bi-notice" role="status">El origen seleccionado no informa cantidades facturadas. Elegí Historial ERP para analizar facturación.</p>':''}
      ${filters.source!=='erp'?`<section class="bi-delivery-summary" aria-label="Pedido versus entregado"><h3>Pedido versus entregado · WarehousePick</h3><div><article><span>Entregado / pedido · importe</span><strong>${deliveryRatio(warehouseTotals.ordered,warehouseTotals.delivered,warehouseTotals.deliveryKnownLines>0&&!warehouseTotals.missingValues&&!warehouseTotals.deliveredMissingValues)}${warehouseTotals.deliveryUnknownLines&&warehouseTotals.deliveryKnownLines?' (parcial)':''}</strong></article><article><span>Entregado / pedido · unidades</span><strong>${deliveryRatio(warehouseTotals.orderedQty,warehouseTotals.deliveredQty,warehouseTotals.deliveryKnownLines>0)}${warehouseTotals.deliveryUnknownLines&&warehouseTotals.deliveryKnownLines?' (parcial)':''}</strong></article><article><span>Unidades pedidas</span><strong>${hasRecentOrders?n(warehouseTotals.orderedQty):'Sin datos'}</strong></article><article><span>Unidades entregadas confirmadas</span><strong>${warehouseTotals.deliveryKnownLines?n(warehouseTotals.deliveredQty)+(warehouseTotals.deliveryUnknownLines?' (parcial)':''):'Sin datos'}</strong></article><article><span>Unidades pendientes de confirmar</span><strong>${warehouseTotals.deliveryKnownLines?n(warehouseTotals.pendingDeliveryQty)+(warehouseTotals.deliveryUnknownLines?' (parcial)':''):'Sin datos'}</strong></article><article><span>Entregado al precio neto del pedido</span><strong>${warehouseTotals.deliveryKnownLines?(warehouseTotals.deliveredMissingValues===warehouseTotals.deliveryKnownLines?'Sin importe':money(warehouseTotals.delivered)+(warehouseTotals.deliveryUnknownLines||warehouseTotals.deliveredMissingValues?' (parcial)':'')):'Sin datos'}</strong></article></div><p>Pedido según ${filters.source==='warehouse'?'WarehousePick (vista de fuente)':'el catálogo'}; entregado confirmado por factura/remito en WarehousePick. Mismo período y filtros, sin incluir el historial Excel en esta comparación. ${warehouseTotals.deliveryKnownLines} líneas con información; ${warehouseTotals.deliveryUnknownLines} líneas sin datos de entrega. Los registros sin vínculo no cuentan como cero entregado.${input.delivery?.available?'':' Conexión a WarehousePick no disponible en este entorno.'}</p></section>`:''}
      <div class="bi-secondary-metrics"><span>Ticket pedido promedio <b>${money(t.average)}</b></span><span>Unidades facturadas / pedidas ERP <b>${t.fulfillment===null?'No disponible':n(t.fulfillment*100)+'%'}</b></span><span>Unidades devueltas ERP <b>${invoiceUnavailable?'No disponible':n(t.returnedQty)}</b></span><span>Clientes sin asignación <b>${new Set(result.rows.filter(r=>!r.clientId).map(r=>r.clientCode)).size}</b></span></div>
      ${stockSummary()}
      ${chart()}
      <div class="bi-insights"><article><span>Acción necesaria</span><strong>${report.customers.filter(c=>c.situation==='action').length}</strong><p>Clientes a 14 días o menos de su próxima compra esperada.</p><button type="button" data-bi-status="action">Ver clientes</button></article><article><span>Fuera de frecuencia</span><strong>${report.customers.filter(c=>c.situation==='overdue').length}</strong><p>Clientes cuya fecha de compra esperada ya pasó.</p><button type="button" data-bi-status="overdue">Ver clientes</button></article><article><span>${filters.client?'Ampliar este cliente':'Ampliar la cartera'}</span><strong data-bi-opportunity-count aria-busy="${opportunityCount===null}">${opportunityCount===null?'…':opportunityCount}</strong><p>Productos disponibles del catálogo sin compras según los filtros y el período.</p><button type="button" data-bi-tab="opportunities">Ver productos</button></article></div>
      <section class="bi-card"><nav class="bi-tabs" aria-label="Detalle de ventas">${[['customers','Clientes'],['products','Productos'],['orders','Pedidos'],['deliveries','Entregas'],['comparison','Comparar fuentes'],['restocks','Reposiciones'],['opportunities','Oportunidades'],['geography','Ubicaciones']].map(([v,label])=>`<button type="button" data-bi-tab="${v}" aria-pressed="${tab===v}">${label}</button>`).join('')}</nav>
      ${filters.client?`<div class="bi-client-context"><div><strong>${safe(selectedClient?.legalName || selectedClient?.name || filters.client)}</strong><span>Cliente ${safe(selectedClient?.displayCode||filters.client)} · ${safe(selectedClient?.locality || '')}</span></div><button type="button" data-bi-clear-client>Ver toda la cartera</button>${selectedClient?.id&&(!selectedClient.members||selectedClient.members.some(c=>c.id))?`<button type="button" data-bi-order>${selectedClient.members?'Elegir local y crear pedido':'Crear pedido'}</button>`:''}</div>`:''}
      <div data-bi-detail>${detail(result)}</div></section>
      <section class="bi-card bi-brand-share"><h3>Participación por marca</h3>${bars(result.brands,'brand')}</section>
      <p class="bi-data-note">Marcas históricas confirmadas por SKU en la revisión manual. Se excluyen de todos los totales ${m.reviewed.excludedSkus.length} SKUs indicados por el administrador; los registros originales se conservan.</p><footer class="bi-footer"><span>${result.rows.length.toLocaleString('es-AR')} líneas filtradas · ${t.unclassified} sin marca identificada · ${t.unmatched} fuera del catálogo actual.</span><span>Las oportunidades describen el historial disponible; no implican que nunca haya comprado.</span></footer>
      </main></div></div>`;
    const root=panel.querySelector('.sales-bi');
    if(input.admin&&!input.simple){
      const label=root.querySelector('[data-bi-salesman]')?.closest('label');
      if(label)label.insertAdjacentHTML('afterend',`<button type="button" class="bi-preview-button" data-bi-preview ${['*','unassigned',''].includes(input.salesmanCode)?'disabled':''}>Ver como este vendedor</button>`);
    }
    if(input.preview)root.insertAdjacentHTML('afterbegin',`<div class="bi-preview-toolbar"><b>Vista del vendedor · ${safe(input.salesmen.find(s=>s.code===input.salesmanCode)?.name||input.salesmanCode)}</b><button type="button" data-bi-return-admin>Volver a administración</button></div>`);
    if(input.simple)simplifySalesman(root);

    if(section==='vendors') {
      const main=root.querySelector('.bi-main');
      const previousTab=tab;tab='vendors';const vendors=detail(result);tab='customers';const customers=detail(result);tab=previousTab;
      main.innerHTML=`<section class="bi-card"><h2>Vendedores</h2>${vendors}</section>${headlines()}${ticketSummary()}${chart()}<section class="bi-card"><h3>Cartera de clientes · ${safe(input.salesmen?.find(s=>s.code===input.salesmanCode)?.name||'Todos los vendedores')}</h3><div data-bi-detail>${customers}</div></section>`;
    }
    clearTimeout(opportunityTimer);
    if(opportunityCount===null){const currentSession=session;const update=()=>{if(session!==currentSession||session.panel.querySelector('.sales-bi')!==root)return;const value=calculated('opportunities',filters,()=>m.opportunityReport(data,filters)).reduce((sum,o)=>sum+o.missing.length+o.bestsellers.length,0);const node=root.querySelector('[data-bi-opportunity-count]');if(node){node.textContent=value;node.setAttribute('aria-busy','false');}};opportunityTimer=setTimeout(()=>{if(window.requestIdleCallback)window.requestIdleCallback(update,{timeout:1500});else update();},0);}
    decorateInfo(root);bindInfo(root);
    bindChart(root);window.RESTOCK_NOTICES?.bind(root);
    root.querySelector('.bi-filter-panel').open=filtersOpen;
    root.addEventListener('submit',apply);
    root.addEventListener('click',click);
    root.addEventListener('change',e=>{
      if(rendering) return;
      if(e.target.matches('[data-bi-chart]')) {
        const next={...chartFilters,[e.target.dataset.biChart]:e.target.value};
        if(!m.validRange(next.from,next.to)){root.querySelector('[data-bi-chart-error]').textContent='Elegí fechas válidas.';return;}
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
  function detail(r) {
    const salesmanName=code=>code==='multiple'?'Varios vendedores':code==='unassigned'?'Sin asignación':code==='900'?'Adrian':session.input.salesmen?.find(s=>s.code===code)?.name||code||'Sin asignación';
    if(tab==='restocks')return window.RESTOCK_NOTICES?.view(session.input.simple?session.input.salesmanCode:'',Boolean(session.input.preview))||'<p>Reposiciones no disponibles.</p>';
    if(tab==='vendors')return `<h3>Vendedores · ${filters.metric==='ordered'?'pedido':'entregado / facturado'} · mes en curso y últimos 12 meses</h3><p class="bi-data-note">Asignación actual del cliente. Nuevos: primera compra registrada en los últimos 12 meses; reactivados: regreso después de al menos 12 meses sin comprar. La primera compra real puede preceder al historial disponible.</p><div class="bi-table-scroll"><table><thead><tr><th>Vendedor</th><th>Mes en curso</th><th>Mes anterior al mismo día</th><th>Variación monto / %</th><th>Últimos 12 meses</th><th>Situaciones de clientes</th><th>Nuevos (12m)</th><th>Reactivados (12m)</th></tr></thead><tbody>${report.vendors.map(v=>`<tr><td>${safe(salesmanName(v.code))}</td><td>${amountLabel(v.current)}</td><td>${amountLabel(v.month)}</td><td>${comparisonBadge(v.change)}</td><td>${amountLabel(v.annual)}</td><td>${Object.entries(v.situations).map(([key,count])=>`${situationLabels[key]}: ${count}`).join('<br>')}</td><td>${v.newClients}</td><td>${v.reactivated}</td></tr>`).join('')}</tbody></table></div>`;
    if(tab==='comparison') {
      const rows=m.compareSources(session.data,filters),counts={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
      const labels={same:'Coincide',different:'Cantidad diferente','warehouse-only':'Solo en WarehousePick','catalog-only':'Solo en catálogo'};
      return `<h3>Catálogo versus WarehousePick</h3><p class="bi-data-note">Mismo período y filtros. Se vinculan por el ID del pedido del catálogo y el SKU. Los pedidos de carga directa del depósito también aparecen. Esta tabla compara fuentes; no suma ambos registros.</p><div class="bi-comparison-counts">${Object.entries(labels).map(([key,label])=>`<span>${label}: <b>${counts[key]||0}</b></span>`).join('')}</div><div class="bi-table-scroll"><table><caption>${rows.length} productos por pedido${rows.length>200?' · primeros 200; ajustá los filtros':''}</caption><thead><tr><th>Pedido / cliente</th><th>Producto / SKU</th><th>Catálogo (u.)</th><th>WarehousePick (u.)</th><th>Diferencia (u.)</th><th>Estado</th></tr></thead><tbody>${rows.slice().sort((a,b)=>(a.status==='same')-(b.status==='same')).slice(0,200).map(row=>`<tr><td>${safe(row.orderLabel)}<small>${safe(row.clientName)}</small></td><td>${safe(row.name)}<small>${safe(row.sku)}</small></td><td>${row.hasCatalog?n(row.catalogQty):'Sin registro'}</td><td>${row.hasWarehouse?n(row.warehouseQty):'Sin registro'}</td><td>${row.hasCatalog&&row.hasWarehouse?n(row.delta):'—'}</td><td>${labels[row.status]}</td></tr>`).join('')||'<tr><td colspan="6">No hay registros para comparar.</td></tr>'}</tbody></table></div>`;
    }
    if(tab==='deliveries') {
      const rows=r.rows.filter(row=>['catalog','warehouse'].includes(row.source));
      return `<h3>Pedido versus entregado por producto</h3><p class="bi-data-note">${rows.length} líneas recientes${rows.length>100?' · primeras 100; exportá para ver todas':''}. Preparado significa pickeado. Entregado confirmado usa factura/remito de WarehousePick.</p><div class="bi-table-scroll"><table><thead><tr><th>Pedido / Cliente</th><th>Producto / SKU</th><th>Pedido (u.)</th><th>Preparado (u.)</th><th>Entregado (u.)</th><th>Pendiente de confirmar (u.)</th><th>Comprobante</th></tr></thead><tbody>${rows.slice(0,100).map(row=>`<tr><td>${safe(row.orderLabel||row.orderId)}<small>${safe(row.clientName)}</small></td><td>${safe(row.productName)}<small>${safe(row.sku)}</small></td><td>${n(row.orderedQty)}</td><td>${row.pickedQty===null?'Sin datos':n(row.pickedQty)}</td><td>${row.deliveredQty===null?'Sin datos':n(row.deliveredQty)}</td><td>${row.pendingDeliveryQty===null?'Sin datos':n(row.pendingDeliveryQty)}</td><td>${row.deliveryConfirmed?safe([row.invoiceNumber,row.remitoNumber].filter(Boolean).join(' / ')||'Confirmado'):row.deliveryConfirmed===false?'Pendiente de confirmación':'Sin vínculo disponible'}</td></tr>`).join('')||'<tr><td colspan="7">No hay líneas del catálogo para estos filtros.</td></tr>'}</tbody></table></div>`;
    }
    if (tab==='orders') {
      const orders=new Map();
      for(const row of r.rows) { const key=row.occasionId||row.orderId; if(!orders.has(key)) orders.set(key,[]); orders.get(key).push(row); }
      const sorted=[...orders.entries()].sort((a,b)=>b[1][0].date.localeCompare(a[1][0].date)||b[0].localeCompare(a[0]));
      return `<h3>Pedidos y líneas</h3><p class="bi-data-note">${sorted.length} pedidos en la selección. ${sorted.length>50?'Se muestran los 50 más recientes. Ajustá las fechas o exportá todas las filas.':''}</p>${sorted.slice(0,50).map(([id,rows])=>`<details class="bi-order"><summary><strong>${safe(rows[0].orderLabel||id)}</strong><small class="bi-source-badge bi-source-${rows[0].source}">${safe(sourceLabel(rows[0].source))}</small><span>${date(rows[0].date)} · ${safe(rows[0].clientName)}</span><b>${money(rows.reduce((s,row)=>s+row.ordered,0))} pedido</b></summary><p class="bi-data-note">Origen: ${safe(sourceLabel(rows[0].source))}${rows[0].sourceFile?` · Archivo: ${safe(rows[0].sourceFile)}`:''}</p><div class="bi-table-scroll"><table><thead><tr><th>Producto / SKU</th><th>Pedido (u.)</th><th>Facturado (u.)</th><th>Pedido sin IVA</th><th>${session.input.simple?'Entregado sin IVA':'Facturado estimado sin IVA'}</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${safe(row.productName)}<small>${safe(row.sku)}</small></td><td>${n(row.orderedQty)}</td><td>${session.input.simple?(row.deliveredQty===null?'No disponible':n(row.deliveredQty)):(row.invoicedQty===null?'No disponible':n(row.invoicedQty))}</td><td>${money(row.ordered)}</td><td>${session.input.simple?(row.delivered===null?'No disponible':money(row.delivered)):(row.invoiced===null?'No disponible':money(row.invoiced))}</td></tr>`).join('')}</tbody></table></div></details>`).join('') || '<p>No hay pedidos para estos filtros.</p>'}`;
    }
    if (tab==='geography') return `<h3>Ventas por provincia de destino</h3>${bars(r.provinces,'province')}<p class="bi-data-note">Los pedidos del catálogo sin provincia aparecen en Sin provincia.</p>`;
    if(tab==='opportunities') {
        const opportunities=calculated('opportunities',filters,()=>m.opportunityReport(session.data,filters));
      const missing=opportunities.filter(o=>o.missing.length),best=opportunities.filter(o=>o.bestsellers.length);
      const table=(items,kind)=>`<div class="bi-table-scroll"><table><thead><tr><th>Cliente</th><th>Productos</th></tr></thead><tbody>${items.slice(0,200).map(o=>`<tr><td><button type="button" data-bi-client="${safe(o.client.clientCode)}">${safe(o.client.legalName||o.client.name)}</button></td><td>${(kind==='best'?o.bestsellers.map(p=>({...p.product,qty:p.qty})):o.missing).map(p=>`<button type="button" class="bi-opportunity-product" data-bi-product="${safe(p.sku)}">${safe(p.sku)} · ${safe(p.name)}${kind==='best'?` <small>${n(p.qty)} unidades vendidas en la empresa</small>`:''}</button>`).join('')}</td></tr>`).join('')||'<tr><td colspan="2">Sin oportunidades para esta selección.</td></tr>'}</tbody></table></div>`;
      return `<h3>Oportunidades por cliente</h3><section class="bi-opportunity-group"><h4>Más vendidos de la empresa que no compra${session.data.companyRankingPartial?' · parcial':''}</h4>${session.data.companyBestsellers===null&&!session.data.companyRankingAvailable?'<p class="bi-empty">Ranking general pendiente de actualización.</p>':table(best,'best')}</section><section class="bi-opportunity-group"><h4>Productos antes comprados, ahora ausentes</h4>${table(missing,'missing')}</section>`;

    }
    if (tab==='products') return `<h3>Productos vendidos</h3>${productTable(r.products,false)}`;
    const rows=r.customers.map(c=>({...c,activity:report.customers.find(v=>String(v.client.clientCode)===String(c.client.clientCode))})).filter(c=>(customerStatus==='all'||c.status===customerStatus||c.activity?.situation===customerStatus)&&m.norm(`${c.client.name} ${c.client.legalName} ${c.client.displayCode||c.client.clientCode} ${c.client.members?.map(m=>m.name).join(' ')||''} ${c.client.locality}`).includes(m.norm(customerQuery)));
    return `<div class="bi-detail-toolbar"><label>Buscar cliente<input type="search" data-bi-customer-query value="${safe(customerQuery)}" placeholder="Nombre, código o localidad"></label><label>Situación<select data-bi-customer-status>${options([['all','Todos'],...Object.entries(situationLabels)],customerStatus)}</select></label><span>${rows.length} clientes</span></div>
      <div class="bi-table-scroll"><table><caption>Clientes · ventas y frecuencia</caption><thead><tr><th>Cliente</th><th>Vendedor</th><th>Venta del período</th><th>Ventas últimos 12 meses</th><th>Frecuencia promedio</th><th>Última compra</th><th>Situación</th></tr></thead><tbody>${rows.slice(0,200).map(c=>{const a=c.activity;return `<tr><td><button type="button" class="bi-client-link" data-bi-client="${safe(c.client.clientCode)}">${safe(c.client.legalName||c.client.name)}</button><small>${safe(c.client.displayCode||c.client.clientCode)}</small></td><td>${safe(salesmanName(c.client.salesmanCode))}</td><td>${a?amountLabel(a.period):'—'}</td><td>${a?amountLabel(a.annual):'—'}</td><td>${a?.frequency===null||!a?'Historial insuficiente':`Cada ${n(a.frequency)} días`}</td><td>${date(a?.last)}</td><td>${situationLabels[a?.situation]||'Historial insuficiente'}${a?.remaining!==null&&a?`<small>${a.remaining<0?n(-a.remaining)+' días fuera de frecuencia':n(a.remaining)+' días hasta próxima compra esperada'}</small>`:''}</td></tr>`;}).join('')||'<tr><td colspan="7">No hay clientes para estos filtros.</td></tr>'}</tbody></table></div><p class="bi-data-note">Frecuencia: promedio entre ocasiones de compra en los últimos 12 meses. Agregados dentro de 2 días desde el primer pedido forman una ocasión. Acción necesaria desde 14 días antes; sin tolerancia después de la fecha esperada. ${rows.length>200?'Primeros 200 clientes; usá la búsqueda para ver otros.':''}</p>`;
  }

  function productTable(rows,opportunities) {
    return `<div class="bi-table-scroll"><table><caption>${rows.length} productos${rows.length>100?' · primeros 100':''}</caption><thead><tr><th>Producto</th><th>Marca</th><th>SKU</th>${opportunities?'<th>Categoría</th>':'<th>Unidades</th><th>Importe</th>'}</tr></thead><tbody>${rows.slice(0,100).map(p=>`<tr><td>${safe(p.name)}</td><td>${safe(p.brand)}</td><td>${opportunities?safe(p.sku):`<button type="button" data-bi-product="${safe(p.sku)}">${safe(p.sku)}</button>`}</td>${opportunities?`<td>${safe(p.category)}</td>`:`<td>${n(p.qty)}</td><td>${money(p.value)}</td>`}</tr>`).join('') || `<tr><td colspan="5">No hay productos para estos filtros.</td></tr>`}</tbody></table></div>`;
  }
  function simplifySalesman(scope) {
    scope.classList.add('bi-salesman-view');
    scope.querySelector('[data-bi-salesman]')?.closest('label')?.remove();
    scope.querySelector('.bi-scope')?.remove();
    scope.querySelector('[data-bi-filters]')?.insertAdjacentHTML('beforebegin','<p class="bi-scope">Tu cartera</p>');
    scope.querySelectorAll('.bi-source-cards,.bi-handover,.bi-delivery-summary,.bi-footer,.bi-guide-link,.bi-section-tabs,.bi-source-badge,[data-bi-salesman],[data-bi-source],[data-bi-tab="comparison"],[data-bi-tab="deliveries"],[data-bi-tab="geography"],.bi-header [data-bi-export]').forEach(el=>el.remove());
    scope.querySelector('[name="source"]')?.closest('label')?.remove();
    const metric=scope.querySelector('[name="metric"]');
    if(metric){metric.querySelector('[value="invoiced"]')?.remove();metric.querySelector('[value="delivered"]').textContent='Entregado / facturado';}
    const context=scope.querySelector('.bi-context>div>span');if(context)context.textContent='Ventas de tu cartera';
    scope.querySelectorAll('.bi-main>.bi-secondary-metrics').forEach(el=>el.remove());
    scope.querySelector('.bi-header h2')?.replaceChildren('Mi gestión comercial');
    scope.querySelectorAll('p.bi-data-note').forEach(el=>el.remove());
    scope.querySelectorAll('.bi-notice').forEach(el=>{el.textContent='Parte de la información no está disponible. Los totales pueden ser parciales.';});
    scope.querySelectorAll('th').forEach(el=>{if(m.norm(el.textContent)==='vendedor'){const i=el.cellIndex;el.closest('table').querySelectorAll('tr').forEach(row=>row.cells[i]?.remove());}});
  }
  function renderDetail() { if(session){const el=session.panel.querySelector('[data-bi-detail]');el.innerHTML=detail(calculated('analysis',filters,()=>m.analyze(session.data,filters)));if(session.input.simple)simplifySalesman(el);decorateInfo(el);window.RESTOCK_NOTICES?.bind(el);} }
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
    filters=next; render(focus,selection);
  }
  function click(e) {
    const button=e.target.closest('button'); if(!button || !session) return;
    const d=button.dataset;
    if('biChartReset' in d){chartFilters=null;render();return;}
    if('biGroups' in d){session.input.onManageGroups?.();return;}
    if('biRefresh' in d) { session.input.onRefresh(); return; }
    if('biSource' in d) { filters.source=d.biSource;filters.brand='';filters.category='';filters.province='';filters.product='';filters={...filters,...m.allRange(session.data,filters.source)};render('[name="source"]');return; }
    if('biExport' in d) { download(); return; }
    if('biReset' in d) { filters=null; mount(session.panel,session.input); return; }
    if('biPreview' in d){session.input.onPreview?.(true);return;}
    if('biReturnAdmin' in d){session.input.onPreview?.(false);return;}
    if('biSection' in d) { section=d.biSection;tab='customers';render(`[data-bi-section="${section}"]`);return; }
    if('biTab' in d) { tab=d.biTab; render(`[data-bi-tab="${tab}"]`); return; }
    if('biStatus' in d) { customerStatus=d.biStatus; tab='customers'; render('[data-bi-customer-status]'); return; }
    if('biClient' in d) { filters.client=d.biClient; render('[name="client"]'); return; }
    if('biClearClient' in d) { filters.client=''; render('[name="client"]'); return; }
    if('biOrder' in d) { const client=session.data.clients.find(c=>String(c.clientCode)===filters.client); if(client?.members)window.DASHBOARD_CLIENT_GROUPS?.chooseClient(client.members,session.input.onClient);else if(client)session.input.onClient(client); return; }
    if('biDimension' in d) { filters[d.biDimension]=d.value; render(`[name="${d.biDimension}"]`); return; }
    if('biProduct' in d) { filters.product=d.biProduct; tab='products'; render('[name="product"]'); return; }
    if('biMonth' in d) { filters.from=d.biMonth+'-01'; filters.to=m.iso(Date.UTC(Number(d.biMonth.slice(0,4)),Number(d.biMonth.slice(5)),0)); render('[name="from"]'); return; }
    if('biPreset' in d) {
      const range=m.defaultRange(session.data,filters.source);
      if(d.biPreset==='all') Object.assign(range,m.allRange(session.data,filters.source));
      if(d.biPreset==='recent') Object.assign(range,m.recentRange());
      if(d.biPreset==='year') { const start=new Date(m.timestamp(range.from)); start.setUTCMonth(start.getUTCMonth()-11); range.from=m.iso(start); }
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
    const body=tab==='comparison'?csv([['Pedido','Cliente','Producto','SKU','Unidades catálogo','Unidades WarehousePick','Diferencia','Estado'],...m.compareSources(session.data,filters).map(r=>[r.orderLabel,r.clientName,r.name,r.sku,r.hasCatalog?r.catalogQty:null,r.hasWarehouse?r.warehouseQty:null,r.hasCatalog&&r.hasWarehouse?r.delta:null,r.status])]):csv([['Fecha pedido','Fecha grupo de compra','ID grupo de compra','Origen','Archivo Excel','Fila Excel','WarehousePick desde (vista principal)','Pedido','Cliente','Nombre cliente','Código de local original','Nombre de local original','SKU','Producto','Marca','Origen de marca','Provincia','Unidades pedidas','Unidades facturadas ERP','Unidades devueltas ERP','Importe pedido sin IVA','Importe facturado estimado sin IVA','Unidades preparadas WarehousePick','Unidades entregadas confirmadas','Unidades pendientes de confirmar','Entregado al precio neto del pedido'],
      ...rows.map(r=>[r.date,r.occasionDate,r.occasionId,sourceLabel(r.source),r.sourceFile,r.sourceRow,session.data.handover?.warehouseFrom,r.orderId,r.clientCode,r.clientName,r.sourceClientCode||r.clientCode,r.sourceClientName||r.clientName,r.sku,r.productName,r.brand,({catalog:'Catálogo actual','reviewed-sku':'Revisión manual por SKU',unclassified:'Sin identificar'})[r.brandSource],r.province,r.orderedQty,r.invoicedQty,r.returnedQty,r.ordered,r.invoiced,r.pickedQty,r.deliveredQty,r.pendingDeliveryQty,r.delivered])]);
    const url=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=`ventas-${filters.source}-${filters.from}-${filters.to}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.addEventListener('catalog:restocks-changed',()=>{if(session&&tab==='restocks')renderDetail();});
  window.SALES_BI={ mount,reset,csv,setLiveError:message=>{const el=session?.panel.querySelector('[data-bi-live-status]');if(el)el.textContent=message;},suspend:()=>{clearTimeout(productTimer);chartCleanup?.();chartCleanup=null;chartScene=null;session=null;},syncOwner:value=>{if(owner&&owner!==value) reset();} };
})();
