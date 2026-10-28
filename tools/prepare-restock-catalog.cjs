/* Product metadata only. No client records, prices or credentials enter these files. */
const fs=require('node:fs'),path=require('node:path');
const source=JSON.parse(fs.readFileSync('web/data/catalog.json','utf8'));
const products=new Map();
for(const p of source.products){
 if(!p.id||!String(p.sku||'').trim())continue;
 const row={id:String(p.id),sku:String(p.sku).trim().toUpperCase(),brand:String(p.section||p.brand||''),name:String(p.name||''),active:!p.hidden,baseOut:Boolean(p.outOfStock)};
 if(products.has(row.id)&&JSON.stringify(products.get(row.id))!==JSON.stringify(row))throw new Error('Conflicting catalog ID: '+row.id);
 products.set(row.id,row);
}
const quote=v=>typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const target=path.resolve('tmp/sales-dashboard/restock-release');fs.mkdirSync(target,{recursive:true});
const values=[...products.values()].map(p=>'('+[p.id,p.sku,p.brand,p.name,p.active,p.baseOut].map(quote).join(',')+')');
const sql="begin;\nupdate public.sales_catalog_products set active=false;\ninsert into public.sales_catalog_products(product_id,sku,brand,name,active,base_out_of_stock) values\n"+values.join(',\n')+'\non conflict(product_id) do update set sku=excluded.sku,brand=excluded.brand,name=excluded.name,active=excluded.active,base_out_of_stock=excluded.base_out_of_stock;\ncommit;\n';
fs.writeFileSync(path.join(target,'catalog-products.sql'),sql);
const mappings=[...products.values()].map(p=>"('lexo',"+quote(p.sku)+','+quote(p.id)+')');
fs.writeFileSync(path.join(target,'warehouse-catalog-map.sql'),"begin;\ndelete from private.catalog_sku_map where company='lexo';\ninsert into private.catalog_sku_map(company,sku,product_id) values\n"+mappings.join(',\n')+'\non conflict do nothing;\ncommit;\n');
console.log(`Prepared exact metadata for ${products.size} products and the Lexo-only warehouse map. No production changes.`);
