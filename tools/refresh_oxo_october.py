"""Rebuild OXO from the October PDF; dry-run by default, --apply to publish locally."""
from __future__ import annotations
import argparse, copy, hashlib, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Optional local dependency directory; otherwise use the installed PyMuPDF.
import os
if os.environ.get('OXO_PDF_DEPS'):
    sys.path.insert(0, os.environ['OXO_PDF_DEPS'])
import pymupdf as fitz
import update_oxo_catalog as helpers
from PIL import Image, ImageDraw, ImageFont

VERSION = '20261005-oxo-r1'
SOURCE = Path.home() / 'Downloads/Catálogo OXO nuevo 2026.pdf'
NEW_NAMES = {
 '11235700':'Conservador de azúcar rubia', '11295200':'Cuchara de helado sin gatillo',
 '11244500':'Pelador en Y Large', '11244200':'Pelador en Y de cítricos',
 '11244400':'Pelador de choclo', '11231700':'Rallador con desmontable',
 '11282900':'Pisapapas de acero inoxidable', '11313700':'Set x12 moldes de silicona',
 '11111102':'Set cucharas medidoras de plástico x6', '11137600':'Set cucharas medidoras de acero inoxidable x4',
 '1114980':'Jarra medidora 2 tazas', '1114880':'Jarra medidora 4 tazas',
 '1115080':'Jarra medidora 1 taza', '1056988':'Set x3 jarras medidoras',
 '11140800':'Espátula para omelets', '3113600':'Set de tapones para vino',
 '11154200':'Cubetera con tapa - cubos grandes', '11154300':'Cubetera con tapa - cubos pequeños',
 '11230400':'Centrifugador de verduras 5.9L', '11168300':'Termómetro digital',
 '13362600':'Clips multiuso - set x4', '13199900':'Organizador de bacha plástico blanco',
 '12246400':'Dispenser de jabón con porta esponja 12246400',
 '12426800':'Dispenser de jabón con porta esponja 12426800',
}
REPLACEMENTS = {'11295000':'11295200','11211000':'11313700','70981':'1114980',
                '70881':'1115080','32480':'11230400','11181400':'11168300'}
PRICE_CORRECTIONS = {'1126980':'$23.539', '11261400':'$11.227'}
INFORMATIONAL = {'11234200','11234300'}
MANUAL_PRICES = {32:{'1136000':'$14.433','38891':'$26.459','38991':'$31.269'},
                 100:{'11154200':'$22.181','11154300':'$28.737'}}
# Normalized product-only crops visually reviewed against the supplied PDF.
PHOTO_CROPS = {
 '11235700':(.18,.307,.51,.495), '11295200':(.06,.30,.46,.57),
 '11244500':(.35,.21,.65,.49), '11244200':(.57,.215,.8,.50),
 '11244400':(.205,.345,.45,.615), '11231700':(.105,.16,.34,.50),
 '11282900':(.41,.28,.60,.68), '11313700':(.15,.265,.80,.66),
 '11111102':(.07,.30,.43,.515), '11137600':(.47,.31,.92,.44),
 '1115080':(.46,.165,.755,.262), '1114980':(.46,.27,.79,.412),
 '1114880':(.43,.43,.82,.58), '1056988':(.43,.16,.82,.58),
 '11140800':(.10,.27,.635,.60), '3113600':(.005,.32,.44,.59),
 '11154200':(.285,.265,.70,.45), '11154300':(.26,.455,.70,.62),
 '11230400':(.20,.30,.79,.66), '11168300':(.23,.30,.73,.70),
 '13362600':(.435,.14,.74,.34), '13199900':(.62,.35,.89,.69),
 '12246400':(.09,.28,.45,.45), '12426800':(.52,.28,.86,.45),
}

def read_metadata():
    return json.loads((ROOT/'web/data/product-browse-data.js').read_text(encoding='utf-8').split(' = ',1)[1].rstrip(';\n'))

def labels(page):
    by_sku = defaultdict(list)
    for w in page.get_text('words'):
        if re.fullmatch(r'\d{5,9}',w[4]) and w[3]-w[1]>=11.5:
            by_sku[w[4]].append(w)
    # Larger labels win over repeated codes inside descriptive body copy.
    return sorted([max(ws,key=lambda w:w[3]-w[1]) for ws in by_sku.values()],key=lambda w:(w[5],w[6],w[7]))

def get_prices(page):
    prices = helpers.price_words_for_page(page)
    if page.number == 109:
        w = next(w for w in page.get_text('words') if w[4]=='42.978')
        prices.append(helpers.PriceWord('$42.978',w,len(prices),'#111111',23.4))
    return prices

def category(name):
    name = name.lower()
    if 'conservador' in name: return 'Frascos > POP OXO'
    if any(x in name for x in ['bacha','dispenser']): return 'Limpieza > Accesorios de limpieza'
    if 'rallador' in name: return 'Cocina > Ralladores'
    if any(x in name for x in ['pelador','espátula','pisapapas']): return 'Cocina > Utensilios'
    return 'Cocina > Accesorios de cocina'

def render(page,prices,destination):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.7,1.7),alpha=False)
    image = Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    helpers.erase_printed_prices(image,prices)
    image.save(destination,'JPEG',quality=84,optimize=True,progressive=True)
    return {'src':f'assets/pages/{destination.name}?v={VERSION}','width':pix.width,'height':pix.height}

def photo(page,word,path):
    a,b,c,d=PHOTO_CROPS[word[4]]
    rect=fitz.Rect(a*page.rect.width,b*page.rect.height,c*page.rect.width,d*page.rect.height)
    pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=rect,alpha=False)
    image=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    image.thumbnail((700,700))
    image.save(path,'JPEG',quality=88,optimize=True)
    return list(rect)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--apply',action='store_true'); args=parser.parse_args()
    old=json.loads((ROOT/'web/data/catalog.json').read_text(encoding='utf-8'))
    if old.get('oxoRevision',{}).get('version') == VERSION:
        print('This OXO revision is already applied; original change audit retained.')
        return
    old_products=[p for p in old['products'] if p.get('section')=='OXO']
    old_pages=[p for p in old['pages'] if p.get('section')=='OXO']
    by_sku=defaultdict(list)
    for p in old_products: by_sku[p['sku']].append(p)
    metadata=read_metadata(); new_metadata={k:v for k,v in metadata.items() if k not in {p['id'] for p in old_products}}
    doc=fitz.open(SOURCE); start=min(p['number'] for p in old_pages)
    products=[]; pages=[]; used=set(); photo_audit=[]
    for n,page in enumerate(doc,1):
        title=helpers.title_for_page(page); prices=get_prices(page); words=labels(page)
        members=defaultdict(list); page_products=[]
        for w in words:
            sku=w[4]
            if sku in INFORMATIONAL: continue
            candidates=by_sku.get(sku,[])
            prev=next((p for p in candidates if p['id'] not in used),None)
            base=copy.deepcopy(prev or (candidates[0] if candidates else {}))
            if not candidates and sku not in NEW_NAMES: raise ValueError(f'Unreviewed new SKU {sku}')
            product_id=prev['id'] if prev else f'oxo-sku-{sku}-p{n:03d}'
            used.add(product_id)
            price=helpers.nearest_price(w,prices)
            if n in MANUAL_PRICES:
                price=next(v for v in prices if v.text==MANUAL_PRICES[n][sku])
            if not price and not candidates: raise ValueError(f'Missing price {sku}')
            value=price.text if price else candidates[0]['price']
            value=PRICE_CORRECTIONS.get(sku,value)
            base.update(id=product_id,page=start+n-1,sku=sku,skus=[sku],
                        name=NEW_NAMES.get(sku,base.get('name','')),category=title,
                        price=value,pdfPrice=price.text if price else '',priceSource='oxo-pdf-2026-10-05',
                        hotspot=helpers.normalized_hotspot(page,w),pricePosition=helpers.price_position(page,price,w),
                        section='OXO',sourcePage=n,hotspotSource=VERSION+'-sku-text',
                        contentUpdatedAt='2026-10-05T15:00:00Z')
            for stale in ['printedSku','originalName','originalCategory','originalPrice']: base.pop(stale,None)
            base.setdefault('ean',''); base.setdefault('unitsPerCase',None); base.setdefault('sizeLabel','')
            base.setdefault('hotspotStyle',{'borderColor':'rgba(215, 25, 32, 0.42)'})
            page_products.append(base)
            if price: members[price.index].append(base)
            old_meta=metadata.get((prev or (candidates[0] if candidates else {})).get('id',''))
            new_metadata[product_id]=copy.deepcopy(old_meta) if old_meta else {'categories':[category(base['name'])]}
            if not old_meta:
                rel=f'assets/products/oxo-20261005-{sku}.jpg'
                new_metadata[product_id].update(image=rel,imageSource=f'October OXO PDF, page {n}, SKU {sku}')
                if args.apply:
                    crop=photo(page,w,ROOT/'web'/rel)
                    photo_audit.append({'sku':sku,'page':n,'crop':crop,'image':rel})
        groups=[]
        for i,items in sorted(members.items()):
            price=prices[i]; value=' / '.join(dict.fromkeys(p['price'] for p in items))
            groups.append({'id':f'oxo-20261005-pg{n:03d}-{i+1}','page':start+n-1,'label':title,
              'price':value,'productIds':[p['id'] for p in items],
              'position':helpers.price_position(page,price,words[0]),'positionSource':VERSION+'-pdf',
              'cover':helpers.price_cover(page,price,value),'variant':'pdf-regular',
              'style':helpers.price_style(page,price),'pdfPriceHeight':round(price.height,3),'pdfPriceColor':price.color})
        if prices and len(members)!=len(prices): raise ValueError(f'Unassigned price on page {n}: {len(members)}/{len(prices)}')
        dest=ROOT/f'web/assets/pages/oxo-20261005-page-{n:03d}.jpg'
        img=render(page,prices,dest) if args.apply else {'src':f'assets/pages/{dest.name}?v={VERSION}'}
        pages.append({'number':start+n-1,'title':title,'section':'OXO','showPriceOverlays':bool(groups),
                      'image':img,'products':[p['id'] for p in page_products],'priceGroups':groups,'sourcePage':n})
        products.extend(page_products)
    new_skus={p['sku'] for p in products}; old_skus=set(by_sku)
    catalog=copy.deepcopy(old); delta=len(pages)-len(old_pages); end=max(p['number'] for p in old_pages)
    for p in catalog['pages']:
        if p['number']>end:
            p['number']+=delta
            for g in p.get('priceGroups',[]):
                if 'page' in g: g['page']+=delta
    for p in catalog['products']:
        if p['page']>end: p['page']+=delta
    catalog['pages']=sorted([p for p in catalog['pages'] if p.get('section')!='OXO']+pages,key=lambda p:p['number'])
    combined=[]; inserted=False
    for p in catalog['products']:
        if p.get('section')=='OXO':
            if not inserted: combined.extend(products); inserted=True
        else: combined.append(p)
    catalog['products']=combined
    catalog['sourcePageCounts']['OXO']=len(pages)
    catalog.update(assetVersion=VERSION,totalPagesInPdf=len(catalog['pages']),samplePageCount=len(catalog['pages']))
    catalog['oxoRevision']={'version':VERSION,'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                            'retiredProductIds':[p['id'] for p in old_products if p['id'] not in used],
                            'retiredSkus':sorted(old_skus-new_skus)}
    helpers.validate_catalog(catalog)
    unique={p['sku']:p for p in products}
    price_changes=[{'sku':sku,'name':p['name'],'before':by_sku[sku][0]['price'],'after':p['price']}
                   for sku,p in unique.items() if sku in by_sku and p['price']!=by_sku[sku][0]['price']]
    report={'source':str(SOURCE),'sourceSha256':catalog['oxoRevision']['sourceSha256'],
        'oldPages':len(old_pages),'newPages':len(pages),'oldUniqueSkus':len(old_skus),'newUniqueSkus':len(new_skus),
        'oldPlacements':len(old_products),'newPlacements':len(products),
        'added':[{'sku':sku,'name':unique[sku]['name'],'price':unique[sku]['price'],'sourcePage':unique[sku]['sourcePage']} for sku in sorted(new_skus-old_skus)],
        'removed':[{'sku':sku,'name':by_sku[sku][0]['name']} for sku in sorted(old_skus-new_skus)],
        'apparentCodeReplacements':REPLACEMENTS,'priceChanges':price_changes,
        'userPriceCorrections':[{'sku':sku,'price':price,'pdfPrice':next(p['pdfPrice'] for p in products if p['sku']==sku)} for sku,price in PRICE_CORRECTIONS.items()],
        'informationalOnly':sorted(INFORMATIONAL),'photos':photo_audit,
        'inventory':[{'sku':sku,'name':p['name'],'price':p['price'],'sourcePage':p['sourcePage'],'id':p['id']} for sku,p in sorted(unique.items())]}
    (ROOT/'tmp/oxo-oct-plan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['inventory','photos']},ensure_ascii=False,indent=2))
    if args.apply:
        (ROOT/'tmp/oxo-before-october.json').write_text(json.dumps(old,ensure_ascii=False),encoding='utf-8')
        helpers.write_catalog(catalog)
        (ROOT/'web/data/product-browse-data.js').write_text('window.PRODUCT_BROWSE_DATA = '+json.dumps(new_metadata,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
        (ROOT/'docs/oxo-20261005-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
