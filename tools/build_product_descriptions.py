"""Import published Lexo product descriptions by Tiendanube slug and keep source URLs."""
import argparse
import csv
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'web/data/product-browse-data.js'
CACHE = ROOT / 'tmp/product-pages'

class DescriptionParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_section = False
        self.section_depth = 0
        self.capturing = False
        self.capture_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div' and str(attrs.get('data-store', '')).startswith('product-description-'):
            self.in_section = True
            self.section_depth = 1
            return
        if self.in_section and tag == 'div':
            self.section_depth += 1
            if not self.capturing and 'user-content' in attrs.get('class', '').split():
                self.capturing = True
                self.capture_depth = self.section_depth
                return
        if self.capturing and tag in ('br', 'p', 'li', 'h2', 'h3', 'h4'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if self.in_section and tag == 'div':
            if self.capturing and self.section_depth == self.capture_depth:
                self.capturing = False
            self.section_depth -= 1
            if self.section_depth == 0:
                self.in_section = False

    def handle_data(self, data):
        if self.capturing:
            self.parts.append(data)

def extract_description(page):
    parser = DescriptionParser()
    parser.feed(page)
    return re.sub(r'\s+', ' ', html.unescape(''.join(parser.parts))).strip()

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--csv', required=True)
    cli.add_argument('--fetch-missing', action='store_true')
    args = cli.parse_args()
    rows = list(csv.DictReader(Path(args.csv).open(encoding='cp1252'), delimiter=';'))
    sku_to_slug = {row['SKU'].strip().upper(): row['Identificador de URL'].strip()
                   for row in rows if row['SKU'].strip() and row['Identificador de URL'].strip()}
    catalog = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))
    metadata = json.loads(DATA.read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
    slugs = sorted({sku_to_slug[product['sku'].upper()] for product in catalog['products']
                    if product['sku'].upper() in sku_to_slug})
    descriptions = {}
    errors = []
    fetched = 0
    CACHE.mkdir(exist_ok=True)
    for slug in slugs:
        source = CACHE / (slug + '.html')
        url = 'https://www.lexo.com.ar/productos/' + urllib.parse.quote(slug) + '/'
        try:
            if source.exists():
                page = source.read_text(encoding='utf-8')
            elif args.fetch_missing:
                time.sleep(1.2)
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                page = urllib.request.urlopen(request, timeout=30).read().decode('utf-8')
                source.write_text(page, encoding='utf-8')
                fetched += 1
            else:
                continue
            description = extract_description(page)
            if description:
                descriptions[slug] = description
        except Exception as error:
            errors.append({'slug': slug, 'error': str(error)})
            if getattr(error, 'code', None) == 429:
                break
        if fetched and fetched % 25 == 0 and slug not in descriptions:
            print(f'Fetched {fetched} pages', flush=True)
    for product in catalog['products']:
        slug = sku_to_slug.get(product['sku'].upper())
        if slug in descriptions:
            metadata[product['id']]['description'] = descriptions[slug]
            metadata[product['id']]['descriptionSource'] = 'https://www.lexo.com.ar/productos/' + urllib.parse.quote(slug) + '/'
    DATA.write_text('window.PRODUCT_BROWSE_DATA = ' + json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    missing = [
        {'sku': product['sku'], 'name': product['name'], 'brand': product['section']}
        for product in catalog['products'] if not metadata[product['id']].get('description')
    ]
    (ROOT / 'docs/product-browse-description-gaps.json').write_text(
        json.dumps({'missingCount': len(missing), 'products': missing}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    report = {'products': len(catalog['products']), 'descriptionRecords': sum(bool(v.get('description')) for v in metadata.values()),
              'missingRecords': len(missing), 'sourceSlugs': len(slugs), 'fetchedPages': fetched, 'errors': errors}
    (ROOT / 'tmp/product-description-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True), flush=True)

if __name__ == '__main__':
    main()
