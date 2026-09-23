"""Extract embedded photos near exact SKU labels; leave ambiguous matches unassigned."""
import json
from pathlib import Path
import sys
from collections import Counter
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tmp/pdf-deps'))
import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]
data_file = ROOT / 'web/data/product-browse-data.js'
metadata = json.loads(data_file.read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
for item in metadata.values():
    if '.pdf, page ' in item.get('imageSource', ''):
        item.pop('image', None)
        item.pop('imageSource', None)
products = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))['products']
sources = ['Catalogo Estia nuevo 2026.pdf', 'Catálogo OXO nuevo 2026.pdf', 'Catálogo Lexo - Magefesa.pdf', 'Catalogo Prepara.pdf', 'Catálogo completo.pdf']
# Visual QA: these labels sit below promotional badges, not product photos.
rejected_skus = {'1072292', '3110200', '1242700', '1223700', '12155000'}
wanted = {p['sku'].upper(): p for p in products if not metadata[p['id']].get('image') or p['sku'] == '1401'}
matched = []
for source in sources:
    doc = fitz.open(Path.home() / 'Downloads' / source)
    frequency = Counter(i[0] for page in doc for i in page.get_images())
    for page in doc:
        images = [i for i in page.get_image_info(xrefs=True) if i['xref'] and frequency[i['xref']] < 3 and i['width'] > 70 and i['height'] > 70 and (i['bbox'][2]-i['bbox'][0]) < page.rect.width * .85 and (i['bbox'][3]-i['bbox'][1]) > 35]
        for word in page.get_text('words'):
            sku = word[4].strip().upper()
            if sku not in wanted or sku in rejected_skus: continue
            x = (word[0]+word[2])/2
            y = word[1]
            candidates = []
            for info in images:
                a,b,c,d = info['bbox']
                gap = y-d
                if a-12 <= x <= c+12 and -10 <= gap < page.rect.height*.18 and b < y:
                    score = max(0,gap) + abs(x-(a+c)/2)*.25
                    candidates.append((score,info))
            candidates.sort(key=lambda item:item[0])
            if not candidates or (len(candidates)>1 and candidates[1][0]-candidates[0][0]<12): continue
            info = candidates[0][1]
            p = wanted[sku]
            # Render only the embedded image, without page text or printed prices.
            pix = fitz.Pixmap(doc, info['xref'])
            smask = next((i[1] for i in page.get_images() if i[0] == info['xref']), 0)
            if smask: pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
            from PIL import Image, ImageStat
            import io
            check = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
            if max(ImageStat.Stat(check).stddev) < 15: continue
            wanted.pop(sku)
            target = ROOT / 'web/assets/products' / (p['id']+'.png')
            pix.save(target)
            metadata[p['id']].update(image='assets/products/'+target.name, imageSource=f'{source}, page {page.number+1}, SKU {sku}')
            matched.append({'sku':sku,'id':p['id'],'source':source,'page':page.number+1})
output_file = Path(sys.argv[1]) if len(sys.argv) > 1 else data_file
output_file.write_text('window.PRODUCT_BROWSE_DATA = '+json.dumps(metadata,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(ROOT/'tmp/extracted-browse-photos.json').write_text(json.dumps(matched,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'extracted':len(matched),'remaining':list(wanted)}))
