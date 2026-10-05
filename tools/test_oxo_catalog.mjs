import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const catalog=JSON.parse(read('web/data/catalog.json'));
const report=JSON.parse(read('docs/oxo-20261005-changes.json'));
const context={window:{},localStorage:{getItem:()=>null,setItem(){}}};
vm.createContext(context); vm.runInContext(read('web/catalog-store.js'),context);
const store=context.window.CATALOG_STORE;

test('OXO contains exactly the reviewed current SKU set and no retired codes',()=>{
  const products=catalog.products.filter(p=>p.section==='OXO');
  assert.equal(products.length,257);
  assert.deepEqual([...new Set(products.map(p=>p.sku))].sort(),report.inventory.map(p=>p.sku).sort());
  for(const {sku} of report.removed) assert.ok(!products.some(p=>p.sku===sku));
  for(const sku of report.informationalOnly) assert.ok(!products.some(p=>p.sku===sku));
  assert.equal(catalog.pages.filter(p=>p.section==='OXO').length,133);
});
test('page, image, hotspot and price-group references are valid',()=>{
  const ids=new Map(catalog.products.map(p=>[p.id,p]));
  assert.equal(ids.size,catalog.products.length);
  catalog.pages.forEach((page,i)=>{
    assert.equal(page.number,i+1);
    assert.ok(existsSync(new URL('../web/'+page.image.src.split('?')[0],import.meta.url)));
    for(const id of page.products) assert.equal(ids.get(id)?.page,page.number);
    for(const group of page.priceGroups||[]) for(const id of group.productIds){
      assert.equal(ids.get(id)?.page,page.number);
      if(page.section==='OXO') assert.equal(ids.get(id).price,group.price);
    }
  });
  for(const p of catalog.products.filter(p=>p.section==='OXO')) {
    assert.match(p.price,/^\$[\d.]+$/);
    for(const key of ['x','y','w','h']) assert.ok(p.hotspot[key]>=0 && p.hotspot[key]<=1);
    assert.ok(p.hotspot.x+p.hotspot.w<=1 && p.hotspot.y+p.hotspot.h<=1);
  }
});
test('stale OXO copy/prices cannot overwrite the PDF; stock and new admin edits survive',()=>{
  const product=catalog.products.find(p=>p.sku==='11303600'&&p.section==='OXO');
  const apply=override=>store.applyProductOverrides({products:[{...product}]},{[product.id]:override}).products[0];
  const stale=apply({sku:product.sku,name:'Old name',price:'$1',outOfStock:true,hidden:true,videoUrl:'video',updatedAt:'2026-09-01T00:00:00Z'});
  assert.equal(stale.price,product.price); assert.equal(stale.name,product.name);
  assert.equal(stale.outOfStock,true); assert.equal(stale.hidden,true); assert.equal(stale.videoUrl,'video');
  assert.equal(apply({price:'$1'}).price,product.price);
  assert.equal(apply({sku:product.sku,price:'$99',updatedAt:'2026-10-06T00:00:00Z'}).price,'$99');
  assert.equal(apply({sku:'wrong',price:'$99',updatedAt:'2026-10-06T00:00:00Z'}).price,product.price);
  const other=store.applyProductOverrides({products:[{id:'other',sku:'x',price:'$5'}]},{other:{price:'$7'}});
  assert.equal(other.products[0].price,'$7');
});
test('retired cart/branch selections are removed without mapping to a different product',()=>{
  const retired=catalog.oxoRevision.retiredProductIds[0];
  const retained=catalog.products.find(p=>p.section==='OXO').id;
  let saved;
  const sandbox={state:{catalog,cart:new Map([[retired,3],[retained,4],['other',1]]),branchOrderQuantities:{[retired]:{a:3},[retained]:{a:4}}},localStorage:{setItem:(key,value)=>{saved=JSON.parse(value);}}};
  const source=read('web/app.js');
  vm.runInNewContext(source.slice(source.indexOf('function removeRetiredCatalogSelections()'),source.indexOf('async function refreshRemoteCatalogData(')),sandbox);
  sandbox.removeRetiredCatalogSelections();
  assert.equal(sandbox.state.cart.has(retired),false);
  assert.equal(sandbox.state.cart.get(retained),4);
  assert.equal(sandbox.state.cart.get('other'),1);
  assert.equal(sandbox.state.branchOrderQuantities[retired],undefined);
  assert.ok(saved.every(([id])=>id!==retired));
});
test('JSON and script catalog copies agree; obsolete browse metadata cannot revive products',()=>{
  const ctx={window:{}};vm.runInNewContext(read('web/data/catalog-data.js'),ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.CATALOG_DATA)),catalog);
  vm.runInNewContext(read('web/data/product-browse-data.js'),ctx);
  for(const id of catalog.oxoRevision.retiredProductIds) assert.equal(ctx.window.PRODUCT_BROWSE_DATA[id],undefined);
});
test('legacy absolute-page price masking is removed and cache versions match the release',()=>{
  const app=read('web/app.js');
  assert.ok(!app.includes('[347, [{'));
  const html=read('web/index.html'),worker=read('web/service-worker.js');
  for(const asset of ['app.js','admin.js','catalog-store.js','data/catalog-data.js','data/product-browse-data.js']) {
    assert.ok(html.includes(asset+'?v=20261005-oxo-r1'),asset);
    assert.ok(worker.includes(asset+'?v=20261005-oxo-r1'),asset);
  }
  assert.ok(worker.includes('lexo-catalog-pages-v20261005-oxo-r1'));
});
test('the two requested OXO price corrections appear in products and clickable overlays',()=>{
  for(const [sku,price] of [['1126980','$23.539'],['11261400','$11.227']]) {
    const matches=catalog.products.filter(p=>p.section==='OXO'&&p.sku===sku);
    assert.ok(matches.length>0,sku);
    assert.ok(matches.every(p=>p.price===price),sku);
    for(const product of matches) {
      const page=catalog.pages.find(p=>p.number===product.page);
      const group=page.priceGroups.find(g=>g.productIds.includes(product.id));
      assert.equal(group?.price,price,sku);
    }
  }
});
