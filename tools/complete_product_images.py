"""Recover SKU-suffixed source photos and reviewed catalog crops, without touching product data."""
import json
import re
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'web/data/product-browse-data.js'
PHOTO_ROOT = Path.home() / 'Desktop/Fotos Productos Global'

def save_photo(source, destination, crop=None):
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        if crop:
            # Coordinates use the reviewed 396 x 560 catalog-page previews.
            image = image.crop(tuple(round(v * (image.width / 396 if i % 2 == 0 else image.height / 560)) for i, v in enumerate(crop)))
        image.thumbnail((800, 800), Image.Resampling.LANCZOS)
        background = Image.new('RGB', image.size, 'white')
        background.paste(image, mask=image.getchannel('A'))
        background.save(destination, quality=90, optimize=True)

def main():
    catalog = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))
    data = json.loads(DATA.read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
    files = [path for path in PHOTO_ROOT.rglob('*') if path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')]
    recovered = []
    for product in catalog['products']:
        item = data[product['id']]
        if item.get('image'): continue
        sku = product['sku']
        candidates = [path for path in files if re.search(r'(?<!\d)' + re.escape(sku) + r'(?!\d)', path.stem)]
        candidates.sort(key=lambda p: ('sin fondo' not in str(p), not bool(re.fullmatch(re.escape(sku)+r'[-_.]1', p.stem)), len(p.stem), str(p)))
        if not candidates: continue
        source = candidates[0]
        target = ROOT / 'web/assets/products' / (product['id'] + '-photo.jpg')
        save_photo(source, target)
        item.update(image='assets/products/' + target.name, imageSource=str(source.relative_to(PHOTO_ROOT)), imageSourceType='local-sku-suffix')
        recovered.append({'id': product['id'], 'sku': sku, 'name': product['name'], 'source': str(source), 'image': str(target)})
    DATA.write_text('window.PRODUCT_BROWSE_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    (ROOT / 'tmp/recovered-suffix-images.json').write_text(json.dumps(recovered,ensure_ascii=False,indent=2),encoding='utf-8')
    for offset in range(0,len(recovered),24):
        sheet = Image.new('RGB',(1200,900),'white'); draw=ImageDraw.Draw(sheet)
        for n,row in enumerate(recovered[offset:offset+24]):
            image=Image.open(row['image']); image.thumbnail((185,185))
            x=(n%6)*200; y=(n//6)*225
            sheet.paste(image,(x+(190-image.width)//2,y)); draw.text((x+5,y+188),row['sku'],fill='black')
            draw.text((x+5,y+203),row['name'][:26],fill='black')
        sheet.save(ROOT/f'tmp/recovered-suffix-{offset//24}.jpg')
    print(json.dumps({'recovered':len(recovered),'remaining':[{'sku':p['sku'],'name':p['name'],'page':p['page']} for p in catalog['products'] if not data[p['id']].get('image')]},ensure_ascii=False))

if __name__ == '__main__': main()
