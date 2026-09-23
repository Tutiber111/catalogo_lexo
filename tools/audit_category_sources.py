"""Compare catalog browse categories with cached Lexo product breadcrumbs."""
import argparse
import csv
import html
import json
from collections import Counter
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
cli = argparse.ArgumentParser()
cli.add_argument('--csv', type=Path, required=True)
args = cli.parse_args()
CACHE = ROOT / 'tmp/product-pages'
catalog = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))['products']
metadata = json.loads((ROOT / 'web/data/product-browse-data.js').read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
rows = list(csv.DictReader(args.csv.open(encoding='cp1252'), delimiter=';'))
sku_to_slug = {row['SKU'].strip().upper(): row['Identificador de URL'].strip() for row in rows if row['SKU'].strip()}

def breadcrumb(slug):
    source = CACHE / (slug + '.html')
    if not source.exists():
        return None
    page = source.read_text(encoding='utf-8')
    match = re.search(r'"breadcrumb"\s*:\s*(\{[\s\S]*?\]\s*\})', page)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        return [html.unescape(entry['name']) for entry in data['itemListElement'][1:-1]]
    except (ValueError, KeyError):
        return None

output = []
for product in catalog:
    slug = sku_to_slug.get(product['sku'].upper())
    source_path = breadcrumb(slug) if slug else None
    current = [path for path in metadata[product['id']].get('categories', []) if path not in {'Lexo', 'Estia', 'Magefesa', 'Dreamfarm', 'Leifheit', 'OXO', 'Prepara', 'Soehnle'}]
    output.append({'sku': product['sku'], 'name': product['name'], 'brand': product['section'], 'current': current, 'source': source_path})

stats = Counter((tuple(item['source']) if item['source'] else None) for item in output)
print('Catalog placements:', len(output))
print('With product breadcrumb:', sum(bool(item['source']) for item in output))
print('Source paths:')
for path, count in stats.most_common():
    print(count, ' > '.join(path) if path else '(no breadcrumb)')
print('Top-level mismatch:', sum(bool(item['source']) and not any(path.split(' > ')[0] == item['source'][0] for path in item['current']) for item in output))
(ROOT / 'tmp/category-source-audit.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
