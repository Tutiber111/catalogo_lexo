"""Build supplemental browse metadata without changing catalog prices or SKUs."""
import argparse
import concurrent.futures
import csv
import html
import json
from pathlib import Path
import re
import urllib.request
import time
import threading

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', required=True)
    parser.add_argument('--photos', required=True)
    args = parser.parse_args()
    products = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))['products']
    rows = list(csv.DictReader(Path(args.csv).open(encoding='cp1252'), delimiter=';'))
    by_sku = {}
    categories = {}
    for row in rows:
        slug = row['Identificador de URL'].strip()
        if row['Categorías'].strip():
            categories[slug] = [v.strip() for v in row['Categorías'].split(',') if v.strip()]
        if row['SKU'].strip():
            by_sku[row['SKU'].strip().upper()] = row
    photos = {}
    for path in sorted(Path(args.photos).rglob('*')):
        if path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
            photos.setdefault(path.stem.upper(), path)
    output = ROOT / 'web/assets/products'
    output.mkdir(exist_ok=True)
    cache = ROOT / 'tmp/product-pages'
    cache.mkdir(exist_ok=True)
    data_path = ROOT / 'web/data/product-browse-data.js'
    metadata = json.loads(data_path.read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n')) if data_path.exists() else {}
    pending = {}
    from PIL import Image, ImageOps
    for product in products:
        sku = product['sku'].strip().upper()
        row = by_sku.get(sku, {})
        slug = row.get('Identificador de URL', '')
        item = metadata.get(product['id'], {})
        if not item.get('categories'):
            item['categories'] = categories.get(slug, [product.get('category', '')])
        if item.get('image'):
            pass
        elif sku in photos:
            target = output / (product['id'] + '.jpg')
            with Image.open(photos[sku]) as original:
                im = ImageOps.exif_transpose(original).convert('RGBA')
                im.thumbnail((640, 640))
                bg = Image.new('RGB', im.size, 'white')
                bg.paste(im, mask=im.getchannel('A'))
                bg.save(target, quality=85, optimize=True)
            item.update(image='assets/products/' + target.name, imageSource='local-sku')
        elif slug:
            pending.setdefault(slug, []).append((product['id'], sku))
        metadata[product['id']] = item

    rate_limited = threading.Event()
    def fetch(slug):
        if rate_limited.is_set(): return {'slug': slug, 'error': 'Deferred after rate limit'}
        url = 'https://www.lexo.com.ar/productos/' + urllib.parse.quote(slug) + '/'
        file = cache / (slug + '.html')
        try:
            if file.exists():
                page = file.read_text(encoding='utf-8')
            else:
                time.sleep(1.2)
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                page = urllib.request.urlopen(req, timeout=25).read().decode('utf-8')
                file.write_text(page, encoding='utf-8')
            match = re.search(r'LS\.variants\s*=\s*(\[.*?\]);', page)
            variants = json.loads(match.group(1)) if match else []
            og = re.search(r'<meta property="og:image:secure_url" content="([^"]+)"', page)
            for product_id, sku in pending[slug]:
                variant = next((v for v in variants if str(v.get('sku', '')).upper() == sku), None)
                src = variant.get('image_url') if variant else None
                if not src and len(pending[slug]) == 1 and og:
                    src = html.unescape(og.group(1))
                if src:
                    if src.startswith('//'): src = 'https:' + src
                    metadata[product_id].update(image=src, imageSource=url)
        except Exception as error:
            if getattr(error, 'code', None) == 429: rate_limited.set()
            return {'slug': slug, 'error': str(error)}
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        errors = [error for error in pool.map(fetch, pending) if error]
    (ROOT / 'web/data/product-browse-data.js').write_text('window.PRODUCT_BROWSE_DATA = ' + json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    report = {'total': len(products), 'localImages': sum(v.get('imageSource') == 'local-sku' for v in metadata.values()), 'images': sum(bool(v.get('image')) for v in metadata.values()), 'csvMatches': sum(p['sku'].upper() in by_sku for p in products), 'missingImages': [p['sku'] for p in products if not metadata[p['id']].get('image')], 'errors': errors}
    (ROOT / 'tmp/product-browse-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
