"""Rebuild browsing categories from Lexo's storefront taxonomy and reviewed gaps."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'web/data/product-browse-data.js'
AUDIT = ROOT / 'tmp/category-source-audit.json'

# The non-brand branches in the current lexo.com.ar Products menu.
CATEGORY_TREE = {
    'Frascos': ('De vidrio', 'POP OXO', 'Fresh & Easy', 'EVAK'),
    'Cocina': ('Utensilios', 'Mandolinas', 'Cuchillos', 'Accesorios de cocina', 'Ralladores', 'Portarrollos', 'Gadgets', 'Organización'),
    'Cafetería': ('OXO', 'Lexo', 'Magefesa', 'Accesorios de café'),
    'Balanzas': ('De cocina', 'De baño', 'De equipaje'),
    'Tenders': ('De pie', 'De pared', 'Accesorios para tenders'),
    'Hidratación': ('Botellas', 'Termos', 'Accesorios de botellas', 'Tumblers'),
    'Planchado': ('Tablas de planchar', 'Accesorios de planchado', 'Fundas de tablas'),
    'Limpieza': ('Accesorios de limpieza', 'Repuestos', 'Mopas', 'Sets', 'Limpiavidrios', 'Organizadores de duchas', 'Escobillones y plumeros'),
    'Cuchillos': ('OXO', 'Magefesa', 'Dreamfarm'),
}

REVIEWED = {}
def assign(path, skus):
    for sku in skus.split():
        if sku in REVIEWED:
            raise ValueError(f'Duplicate reviewed SKU: {sku}')
        REVIEWED[sku] = path

# Storefront exceptions: Clip Top replacement rings are not Fresh & Easy jars.
assign('Frascos', '3215 3216')
assign('Frascos > De vidrio', '3208')
assign('Cocina > Accesorios de cocina', '25021 25038 25045')
assign('Cocina > Cuchillos', '24826')

# Products absent from the public storefront, grouped into its published branches.
assign('Cocina > Utensilios', '2478 2485 8418 8425 3703 3505 3536 2607 2638 2744 5622 5356 3129')
assign('Cocina > Accesorios de cocina', '2551 7510 7527 6100 6117 7299 3055 6759 34061 24987 26752 26769 21771 7546 24093 11332200 1049953 1072292 11387100 11318400 3110200 11242400 11242500 11242300 11330800 11187100 4025 4019 11388100 11388200 11388300 11388500')
assign('Cocina > Organización', '8036 34146 34139 30100 27995 27988 27971 34603 23614 13028 17613 17569 17576 17552 17545 24901 30087 30933 18146 24932 27575 12426900')
assign('Cocina > Cuchillos', '36812 12946')
assign('Cocina > Accesorios de cocina', '14537 13295800')
assign('Cocina > Ralladores', '11273000')
assign('Cocina > Accesorios de cocina', '29814 26455 26448 26462 26479 11272600 11272700 11272800')
assign('Frascos > De vidrio', '31497 31503 21832 21887')
assign('Frascos > POP OXO', '3118700 3118200 13382400 11241000')
assign('Cafetería > OXO', '8722500')
assign('Balanzas > De cocina', '30766')
assign('Hidratación > Termos', '28346')
assign('Hidratación > Botellas', '31558 31541 31626 31589 31664 31534 31640 31572 31596 31602')
assign('Hidratación > Tumblers', '32098 35181 31886 31916 25595')
assign('Limpieza > Repuestos', '55386')
assign('Limpieza > Accesorios de limpieza', '5653 45310 14339 14254 14360 12237300 12155000 12331200 12427000')
assign('Limpieza > Limpiavidrios', '14346 14261 1062122')
assign('Cocina > Organización', '14933')

def valid(path):
    parts = path.split(' > ')
    return len(parts) == 1 and parts[0] in CATEGORY_TREE or len(parts) == 2 and parts[0] in CATEGORY_TREE and parts[1] in CATEGORY_TREE[parts[0]]

metadata = json.loads(DATA.read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
catalog = json.loads((ROOT / 'web/data/catalog.json').read_text(encoding='utf-8'))['products']
source_by_sku = {item['sku']: item for item in json.loads(AUDIT.read_text(encoding='utf-8'))}
report = {'storefrontBreadcrumb': 0, 'reviewedAssignment': 0, 'retainedPublishedPath': 0, 'skus': {}}
for product in catalog:
    sku = product['sku']
    source = source_by_sku[sku]
    breadcrumb = [html.unescape(part) for part in (source['source'] or [])]
    published_path = ' > '.join(breadcrumb)
    existing = [path for path in source['current'] if valid(path)]
    if sku in REVIEWED:
        path, provenance = REVIEWED[sku], 'reviewedAssignment'
    elif valid(published_path):
        path, provenance = published_path, 'storefrontBreadcrumb'
    elif existing:
        path, provenance = existing[0], 'retainedPublishedPath'
    else:
        raise ValueError(f'No canonical category for {sku}: {product["name"]}')
    if path == 'Cuchillos' and product['section'] in CATEGORY_TREE['Cuchillos']:
        path += ' > ' + product['section']
    if not valid(path):
        raise ValueError(f'Invalid category for {sku}: {path}')
    metadata[product['id']]['categories'] = [path]
    report[provenance] += 1
    report['skus'][sku] = path

if len(report['skus']) != len({product['sku'] for product in catalog}):
    raise ValueError('Some catalog SKUs were not categorized')
DATA.write_text('window.PRODUCT_BROWSE_DATA = ' + json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
(ROOT / 'docs/product-browse-category-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'skus'}, ensure_ascii=False))
