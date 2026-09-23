import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
test('every catalog placement has a shipped local product image', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json', import.meta.url), 'utf8'));
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../web/data/product-browse-data.js', import.meta.url), 'utf8'), context);
  for (const product of catalog.products) {
    const image = context.window.PRODUCT_BROWSE_DATA[product.id]?.image;
    assert.match(image || '', /^assets\/products\/[^/]+\.jpg$/, `Missing local photo: ${product.sku}`);
    assert.ok(fs.statSync(new URL('../web/' + image, import.meta.url)).size > 100, `Empty photo: ${product.sku}`);
  }
});
test('browse categories follow the storefront tree and reviewed product exceptions', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json', import.meta.url), 'utf8'));
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../web/data/product-browse-data.js', import.meta.url), 'utf8'), context);
  const bySku = new Map();
  const roots = new Set(['Frascos','Cocina','Cafetería','Balanzas','Tenders','Hidratación','Planchado','Limpieza','Cuchillos']);
  for (const product of catalog.products) {
    const categories = context.window.PRODUCT_BROWSE_DATA[product.id]?.categories;
    assert.equal(categories?.length, 1, `Expected one reviewed category for ${product.sku}`);
    const parts = categories[0].split(' > ');
    assert.ok(roots.has(parts[0]) && parts.length <= 2, `Invalid category for ${product.sku}: ${categories[0]}`);
    assert.notEqual(parts[0], parts[1], `Repeated category for ${product.sku}`);
    bySku.set(product.sku, categories[0]);
  }
  assert.equal(bySku.get('3208'), 'Frascos > De vidrio');
  assert.equal(bySku.get('3215'), 'Frascos');
  assert.equal(bySku.get('3216'), 'Frascos');
  assert.equal(bySku.get('D5110'), 'Cuchillos > Dreamfarm');
});
const render = source.slice(source.indexOf('const browseLoadSentinel ='), source.indexOf('\ndocument.querySelectorAll("[data-catalog-view]")'));
function setup({autoLoad=false}={}) {
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, { hidden: false, innerHTML: '', value: '', scrollTop: 0, classList: { toggle() {} }, querySelectorAll: () => [], after() {} });
    return elements.get(key);
  };
  const products = [
    { id:'a', sku:'001', section:'Lexo', name:'Café <b>', price:'$100' },
    { id:'b', sku:'002', section:'OXO', name:'Café', price:'$200', outOfStock:true },
    { id:'c', sku:'003', section:'Lexo', name:'Hidden', price:'$300', hidden:true },
  ];
  const state = { catalogView:'grid', catalog:{products}, productsById:new Map(products.map(p=>[p.id,p])), cart:new Map(), brandFilter:'all', browseCategoryGroup:'all', browseCategoryPath:'', browseMajorCategoryRoots:new Set(), browseLimit:60, browseFilterKey:'' };
  const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const sandbox = { state, window:{PRODUCT_BROWSE_DATA:{a:{categories:['Cocina']}}}, document:{body:element('body'), querySelector:element,querySelectorAll:()=>[]}, els:{pageStage:element('stage'),searchInput:element('search')}, normalizeProductSearch:s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''), isVisibleProduct:p=>!p.hidden, brandMatches:b=>state.brandFilter==='all'||state.brandFilter===b, searchFields:p=>[p.name,p.sku,p.section], hasPriceAccess:()=>true, escapeHtml:escape, escapeAttribute:escape };
  if (autoLoad) sandbox.IntersectionObserver = class {
    constructor(callback, options) { sandbox.onBrowseIntersection=callback; sandbox.observerOptions=options; }
    observe(node) { sandbox.observedNode=node; }
  };
  vm.createContext(sandbox);
  sandbox.normalizeSkuQuery = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  vm.runInContext(source.slice(source.indexOf('function uniqueProductsBySku(products)'), source.indexOf('\nfunction openBarcodeProductChoice')), sandbox);
  vm.runInContext(source.slice(source.indexOf('function searchFields(product)'), source.indexOf('\nfunction skuFields(product)')), sandbox);
  vm.runInContext(source.slice(source.indexOf('function browseCartQuantity(product)'), source.indexOf('\nfunction setBrowseCartQuantity')), sandbox);
  vm.runInContext(render, sandbox);
  return { ...sandbox, element, setAccess:value=>sandbox.hasPriceAccess=()=>value, run:()=>sandbox.renderProductBrowser() };
}
test('brand and accent-insensitive search intersect and exclude hidden products', () => {
  const x=setup(); x.state.brandFilter='Lexo'; x.els.searchInput.value='cafe'; x.run();
  assert.match(x.element('#browseCount').textContent,/1 productos/);
  assert.match(x.element('#browseProducts').innerHTML,/SKU 001/);
  assert.doesNotMatch(x.element('#browseProducts').innerHTML,/SKU 002|SKU 003/);
  assert.match(x.element('#browseProducts').innerHTML,/Café &lt;b&gt;/);
});
test('pending access never renders a price; stock labels are preserved', () => {
  const x=setup(); x.setAccess(false); x.run();
  assert.doesNotMatch(x.element('#browseProducts').innerHTML,/\$100|\$200/);
  assert.match(x.element('#browseProducts').innerHTML,/Precios pendientes/);
  assert.match(x.element('#browseProducts').innerHTML,/Sin stock/);
});
test('CSV category metadata is searchable without replacing product data', () => {
  const x=setup(); x.els.searchInput.value='cocina'; x.run();
  assert.match(x.element('#browseCount').textContent,/1 productos/);
  assert.match(x.element('#browseProducts').innerHTML,/\$100/);
});
test('a SKU repeated across catalog pages appears once in browsing', () => {
  const x=setup(); x.state.catalog.products.push({...x.state.catalog.products[0],id:'duplicate'}); x.run();
  assert.match(x.element('#browseCount').textContent,/2 productos/);
});
test('pagination resets when filtering and empty results offer reset', () => {
  const x=setup(); x.state.catalog.products=Array.from({length:125},(_,i)=>({id:String(i),sku:String(i),name:'Product',section:'Lexo',price:'$1'})); x.run();
  assert.match(x.element('#browseCount').textContent,/Mostrando 60/);
  assert.equal(x.element('#browseMore').hidden,false);
  x.state.browseLimit=120; x.run(); assert.match(x.element('#browseCount').textContent,/Mostrando 120/);
  x.els.searchInput.value='missing'; x.run(); assert.match(x.element('#browseProducts').innerHTML,/data-browse-reset/); assert.equal(x.element('#browseMore').hidden,true);
});
test('scrolling near the end loads the next batch automatically', () => {
  const x=setup({autoLoad:true});
  x.state.catalog.products=Array.from({length:125},(_,i)=>({id:String(i),sku:String(i),name:'Product',section:'Lexo',price:'$1'}));
  x.run();
  assert.equal(x.element('#browseMore').hidden,true);
  assert.equal(x.element('#browseLoadSentinel').hidden,false);
  assert.equal(x.observedNode,x.element('#browseLoadSentinel'));
  assert.equal(x.observerOptions.root,x.element('#productBrowser'));
  x.onBrowseIntersection([{isIntersecting:true}]);
  assert.match(x.element('#browseCount').textContent,/Mostrando 120/);
  x.onBrowseIntersection([{isIntersecting:true}]);
  assert.match(x.element('#browseCount').textContent,/Mostrando 125/);
  assert.equal(x.element('#browseLoadSentinel').hidden,true);
  x.els.searchInput.value='missing'; x.run();
  assert.match(x.element('#browseCount').textContent,/Mostrando 0/);
  x.onBrowseIntersection([{isIntersecting:true}]);
  assert.equal(x.state.browseLimit,60);
});
test('brand, category and subcategory filters narrow the same product set', () => {
  const x=setup();
  x.state.catalog.products=[
    ...Array.from({length:9},(_,i)=>({id:`u${i}`,sku:`U${i}`,name:'Café',section:i<5?'Lexo':'OXO',category:'Utensilios',price:'$1'})),
    ...Array.from({length:9},(_,i)=>({id:`g${i}`,sku:`G${i}`,name:'Café',section:'Lexo',category:'Gadgets',price:'$1'})),
    ...Array.from({length:9},(_,i)=>({id:`h${i}`,sku:`H${i}`,name:'Café',section:'Lexo',category:'Botellas',price:'$1'})),
  ];
  for (const p of x.state.catalog.products) x.window.PRODUCT_BROWSE_DATA[p.id]={categories:[p.id[0]==='h'?'Hidratación > Botellas':`Cocina > ${p.category}`]};
  x.state.brandFilter='Lexo'; x.state.browseCategoryGroup='Cocina'; x.state.browseCategoryPath='Cocina > Utensilios'; x.els.searchInput.value='cafe'; x.run();
  assert.match(x.element('#browseCount').textContent,/5 productos.*Cocina > Utensilios/);
  assert.match(x.element('#browseProducts').innerHTML,/SKU U0/);
  assert.doesNotMatch(x.element('#browseProducts').innerHTML,/SKU U5|SKU G0|SKU H0/);
  assert.match(x.element('#browseCategoryGroups').innerHTML,/Cocina/);
  assert.match(x.element('#browseCategoryDetails').innerHTML,/Utensilios/);
  assert.match(x.element('#browseCategoryDetails').innerHTML,/Subcategorías de Cocina/);
  assert.match(x.element('#browseCategoryDetails').innerHTML,/data-browse-category-path="Cocina &gt; Utensilios"/);
  assert.match(x.element('#browseCategoryGroups').innerHTML,/data-browse-category-group="Hidratación"/);
  x.state.browseCategoryPath='Cocina > Gadgets'; x.run();
  assert.match(x.element('#browseCount').textContent,/9 productos/);
});
test('published descriptions appear on cards as escaped text', () => {
  const x=setup(); x.window.PRODUCT_BROWSE_DATA.a.description='Durable <b>cup</b>'; x.run();
  assert.match(x.element('#browseProducts').innerHTML,/browse-description/);
  assert.match(x.element('#browseProducts').innerHTML,/Durable &lt;b&gt;cup&lt;\/b&gt;/);
});
test('grid and list cards show cart counts, editable controls, and in-cart emphasis', () => {
  const x=setup(); x.state.cart.set('a', 3); x.run();
  assert.match(x.element('#browseProducts').innerHTML,/browse-card is-in-cart/);
  assert.match(x.element('#browseProducts').innerHTML,/3 en el carrito/);
  assert.match(x.element('#browseProducts').innerHTML,/data-browse-quantity="a"/);
  assert.match(x.element('#browseProducts').innerHTML,/data-browse-inc="a"/);
  assert.match(x.element('#browseProducts').innerHTML,/data-browse-dec="a"/);
  assert.match(x.element('#browseProducts').innerHTML,/data-browse-inc="b"[^>]*disabled/);
  x.state.catalogView='list'; x.run();
  assert.match(x.element('#browseProducts').innerHTML,/3 en el carrito/);
});
test('cart count includes another catalog placement with the same SKU', () => {
  const x=setup();
  const duplicate={...x.state.catalog.products[0],id:'duplicate'};
  x.state.catalog.products.push(duplicate);
  x.state.productsById.set('duplicate',duplicate);
  x.state.cart.set('duplicate',2);
  x.run();
  assert.match(x.element('#browseProducts').innerHTML,/2 en el carrito/);
});
