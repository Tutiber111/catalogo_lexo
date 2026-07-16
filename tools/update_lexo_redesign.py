from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "web" / "data" / "catalog-data.js"
DATA_JSON = ROOT / "web" / "data" / "catalog.json"
PAGE_DIR = ROOT / "web" / "assets" / "pages"
SOURCE_DIR = Path(r"C:\Users\Lenovo\Downloads\Catálogo Lexo brand")
SOURCE_OVERRIDES = {
    17: Path(r"C:\Users\Lenovo\Downloads\Catálogo Lexo brand.png"),
}
ASSET_VERSION = "20260716-prepara"
IMAGE_WIDTH = 1414
IMAGE_HEIGHT = 2000


def source_page(page: int) -> Path:
    return SOURCE_OVERRIDES.get(page, SOURCE_DIR / f"{page}.png")


PAGE_PRODUCTS = {
    1: [],
    2: [],
    3: ["p003-1", "p003-2"],
    4: ["p004-1", "p004-2", "p004-5", "p004-6", "p004-7", "p004-8", "p004-9", "p004-10", "p004-11", "p004-12", "p004-3", "p004-4"],
    5: ["p005-1", "p005-2", "p005-3"],
    6: ["p006-1", "p006-2"],
    7: ["p007-1", "p007-2"],
    8: ["p008-1", "p008-2"],
    9: ["p010-4", "p010-1", "p010-3", "p010-2"],
    10: ["p011-4", "p011-1", "p011-3", "p011-2", "p011-5"],
    11: ["p013-1", "p013-2", "p013-5", "p013-6", "p013-3", "p013-4"],
    12: [],
    13: ["p015-1", "p015-2", "p015-3"],
    14: ["p016-1", "p016-2", "p016-3", "p016-4", "p016-5", "p016-6", "p016-7", "p016-8"],
    15: ["p017-1", "p017-2"],
    16: ["p018-1", "p018-2", "p018-3", "p018-4"],
    17: ["p019-1", "p019-2", "p019-3"],
    18: [],
    19: ["p021-1"],
    20: ["p022-1", "p022-2"],
    21: ["p023-1"],
    22: ["p024-1", "p024-2"],
    23: ["p025-1", "p025-2", "p025-3", "p025-4"],
}

PAGE_TITLES = {
    1: "Catálogo",
    2: "BOTELLAS TÉRMICAS",
    3: "Botellas térmicas",
    4: "Botellas térmicas",
    5: "Botellas térmicas",
    6: "Botellas térmicas",
    7: "Botellas térmicas",
    8: "Botellas térmicas",
    9: "Tumblers",
    10: "Tumblers",
    11: "Termos",
    12: "CAFETERAS",
    13: "Cafeteras",
    14: "Cafeteras",
    15: "Cafeteras",
    16: "Cafeteras",
    17: "Cafeteras",
    18: "ACCESORIOS",
    19: "Accesorios",
    20: "Accesorios",
    21: "Accesorios",
    22: "Accesorios",
    23: "Accesorios",
}

# OCR-derived SKU bounds in the supplied 1414 x 2000 artwork.
SKU_BOUNDS = {
    "p003-1": (366, 1574, 91, 32), "p003-2": (921, 1574, 101, 32),
    "p004-1": (290, 1440, 93, 28), "p004-2": (291, 1491, 90, 27),
    "p004-5": (437, 1440, 89, 28), "p004-6": (437, 1491, 86, 28),
    "p004-7": (584, 1440, 90, 28), "p004-8": (584, 1491, 88, 28),
    "p004-9": (731, 1440, 89, 28), "p004-10": (731, 1491, 87, 27),
    "p004-11": (878, 1440, 90, 28), "p004-12": (878, 1491, 88, 28),
    "p004-3": (1024, 1440, 90, 28), "p004-4": (1024, 1491, 88, 28),
    "p005-1": (247, 1486, 98, 32), "p005-2": (631, 1486, 84, 32), "p005-3": (1027, 1486, 95, 32),
    "p006-1": (339, 1566, 81, 28), "p006-2": (977, 1566, 68, 27),
    "p007-1": (369, 1538, 88, 28), "p007-2": (958, 1538, 75, 27),
    "p008-1": (367, 1488, 89, 28), "p008-2": (944, 1488, 88, 28),
    "p010-4": (211, 1447, 89, 28), "p010-1": (501, 1447, 77, 28),
    "p010-3": (781, 1447, 86, 28), "p010-2": (1058, 1447, 86, 28),
    "p011-4": (137, 1463, 90, 28), "p011-1": (406, 1463, 78, 28),
    "p011-3": (666, 1463, 88, 28), "p011-2": (931, 1463, 87, 28), "p011-5": (1193, 1463, 92, 28),
    "p013-1": (382, 1322, 85, 28), "p013-2": (382, 1373, 85, 28),
    "p013-5": (661, 1322, 72, 28), "p013-6": (660, 1373, 74, 28),
    "p013-3": (934, 1322, 81, 28), "p013-4": (933, 1373, 83, 28),
    "p015-1": (111, 1614, 158, 28), "p015-2": (522, 1613, 168, 29), "p015-3": (934, 1614, 167, 28),
    "p016-1": (225, 915, 170, 38), "p016-2": (229, 969, 170, 38),
    "p016-3": (763, 914, 170, 38), "p016-4": (767, 969, 170, 38),
    "p016-5": (224, 1730, 170, 38), "p016-6": (228, 1784, 170, 38),
    "p016-7": (754, 1730, 170, 38), "p016-8": (758, 1784, 170, 38),
    "p017-1": (248, 1699, 150, 33), "p017-2": (732, 1699, 145, 33),
    "p018-1": (32, 1463, 74, 25), "p018-2": (376, 1463, 77, 25),
    "p018-3": (703, 1463, 78, 25), "p018-4": (1050, 1463, 78, 25),
    "p019-1": (30, 1587, 104, 32), "p019-2": (505, 1585, 102, 33), "p019-3": (980, 1584, 101, 33),
    "p021-1": (633, 1608, 144, 32),
    "p022-1": (275, 1138, 129, 28), "p022-2": (979, 1138, 143, 28),
    "p023-1": (610, 1538, 194, 37),
    "p024-1": (299, 1347, 165, 35), "p024-2": (895, 1347, 165, 35),
    "p025-1": (44, 1255, 122, 25), "p025-2": (379, 1255, 130, 25),
    "p025-3": (715, 1255, 130, 25), "p025-4": (1050, 1255, 135, 25),
}


def read_catalog() -> dict:
    text = DATA_JS.read_text(encoding="utf-8")
    prefix = "window.CATALOG_DATA = "
    if not text.startswith(prefix) or not text.rstrip().endswith(";"):
        raise ValueError("Unexpected catalog-data.js wrapper")
    return json.loads(text[len(prefix):].rstrip()[:-1])


def normalized_box(bounds: tuple[int, int, int, int], pad_x: int = 6, pad_y: int = 5) -> dict:
    x, y, width, height = bounds
    return {
        "x": round(max(0, x - pad_x) / IMAGE_WIDTH, 7),
        "y": round(max(0, y - pad_y) / IMAGE_HEIGHT, 7),
        "w": round((width + 2 * pad_x) / IMAGE_WIDTH, 7),
        "h": round((height + 2 * pad_y) / IMAGE_HEIGHT, 7),
    }


def price_style(font_size: int, min_width: int, font_weight: int = 950) -> dict:
    return {
        "background": "#f5f5f5",
        "color": "#111111",
        "borderColor": "rgba(0, 0, 0, 0.16)",
        "fontSize": round(font_size / 7.6, 3),
        "fontSizeUnit": "cqw",
        "fontWeight": font_weight,
        "minWidth": 0,
        "minHeight": 0,
        "padX": 1,
        "padY": 0,
        "radius": 2,
    }


def price_group(
    page: int,
    index: int,
    label: str,
    price: str,
    product_ids: list[str],
    bounds: tuple[int, int, int, int],
    *,
    font_size: int = 18,
    min_width: int = 58,
    font_weight: int = 950,
    variant: str = "lexo-redesign",
) -> dict:
    x, y, width, height = bounds
    group = {
        "id": f"lexo-20260706-pg{page:03d}-{index}",
        "page": page,
        "label": label,
        "price": price,
        "productIds": product_ids,
        "position": {
            "x": round((x + width / 2) / IMAGE_WIDTH, 7),
            "y": round(max(0, y - 2) / IMAGE_HEIGHT, 7),
        },
        "cover": {
            "w": round((width + 8) / IMAGE_WIDTH, 7),
            "h": round((height + 4) / IMAGE_HEIGHT, 7),
        },
        "positionSource": "lexo-20260706-ocr",
        "style": price_style(font_size, min_width, font_weight),
        "variant": variant,
    }
    return group


def build_price_groups() -> dict[int, list[dict]]:
    groups: dict[int, list[dict]] = {page: [] for page in PAGE_PRODUCTS}
    add = lambda page, *args, **kwargs: groups[page].append(price_group(page, len(groups[page]) + 1, *args, **kwargs))

    add(3, "Botella Electro 500ml", "$13.057", ["p003-1", "p003-2"], (620, 371, 176, 44))
    add(4, "500ML", "$13.057", ["p004-1", "p004-5", "p004-7", "p004-9", "p004-11", "p004-3"], (1175, 1428, 176, 44))
    add(4, "750ML", "$14.820", ["p004-2", "p004-6", "p004-8", "p004-10", "p004-12", "p004-4"], (1172, 1490, 179, 44))
    add(5, "Botella Oreo 500ml", "$13.057", ["p005-1", "p005-2", "p005-3"], (620, 371, 176, 44))
    add(6, "Botella Altros 940ml", "$18.285", ["p006-1", "p006-2"], (620, 371, 175, 44))
    add(7, "Vaso Cocoa 280ml", "$14.352", ["p007-1", "p007-2"], (621, 371, 172, 44))
    add(8, "Vaso Moka 380ml", "$11.950", ["p008-1", "p008-2"], (624, 371, 165, 44))
    add(9, "Tumbler Hydro 1200ml", "$15.700", ["p010-4", "p010-1", "p010-3", "p010-2"], (618, 371, 177, 44))
    add(10, "Tumbler Nomad 900ml", "$12.390", ["p011-4", "p011-1", "p011-3", "p011-2", "p011-5"], (620, 371, 173, 44))
    add(11, "500ML", "$11.187", ["p013-1", "p013-5", "p013-3"], (1121, 1311, 156, 44))
    add(11, "1 Litro", "$15.743", ["p013-2", "p013-6", "p013-4"], (1111, 1367, 174, 44))

    add(13, "Cafetera French Press 350ml", "$8.843", ["p015-1"], (267, 1655, 125, 37), font_size=16, min_width=45, font_weight=700)
    add(13, "Cafetera French Press 600ml", "$11.990", ["p015-2"], (684, 1655, 128, 37), font_size=16, min_width=46, font_weight=700)
    add(13, "Cafetera French Press 1000ml", "$14.712", ["p015-3"], (1081, 1655, 127, 37), font_size=16, min_width=46, font_weight=700)
    add(14, "350ML", "$8.843", ["p016-1", "p016-3", "p016-5", "p016-7"], (613, 1116, 127, 36), font_size=17, min_width=46)
    add(14, "1 Litro", "$14.712", ["p016-2", "p016-4", "p016-6", "p016-8"], (611, 1215, 131, 36), font_size=17, min_width=47)
    add(15, "Cafetera Acero French Press 350ml", "$13.739", ["p017-1"], (431, 1748, 153, 43), font_size=17, min_width=54, font_weight=700)
    add(15, "Cafetera Acero French Press 1000ml", "$20.189", ["p017-2"], (906, 1748, 160, 43), font_size=17, min_width=56, font_weight=700)

    # Page 16 intentionally has no printed prices. Place each current price in the blank area after its capacity dash.
    add(16, "Cafetera Aluminio 3 Tazas Marca Lexo", "$11.935", ["p018-1"], (205, 1495, 145, 40), font_size=16, min_width=52)
    add(16, "Cafetera Aluminio 6 Tazas Marca Lexo", "$15.017", ["p018-2"], (540, 1495, 145, 40), font_size=16, min_width=52)
    add(16, "Cafetera Aluminio 9 Tazas Marca Lexo", "$20.429", ["p018-3"], (870, 1495, 145, 40), font_size=16, min_width=52)
    add(16, "Cafetera Aluminio 12 Tazas Marca Lexo", "$24.079", ["p018-4"], (1215, 1495, 145, 40), font_size=16, min_width=52)
    add(17, "Cafetera Acero 4 Tazas Marca Lexo", "$19.679", ["p019-1"], (280, 1634, 154, 43), font_size=17, min_width=55, font_weight=700)
    add(17, "Cafetera Acero 6 Tazas Marca Lexo", "$22.825", ["p019-2"], (749, 1633, 163, 43), font_size=17, min_width=57, font_weight=700)
    add(17, "Cafetera Acero 9 Tazas Marca Lexo", "$28.578", ["p019-3"], (1223, 1633, 164, 42), font_size=17, min_width=58, font_weight=700)

    add(19, "Molinillo De Café", "$19.722", ["p021-1"], (608, 449, 198, 51), font_size=20, min_width=69)
    add(20, "Tetera 800Ml", "$20.866", ["p022-1"], (263, 1237, 154, 36), font_size=16, min_width=55)
    add(20, "Tetera 1 Litro", "$18.245", ["p022-2"], (980, 1237, 143, 36), font_size=16, min_width=51)
    add(21, "Jarra Medidora 500Ml", "$12.094", ["p023-1"], (617, 445, 178, 44), font_size=18, min_width=62)
    add(22, "Pack X 2 Vasos Dobles 80Ml", "$12.457", ["p024-1"], (317, 1472, 178, 45), font_size=18, min_width=62)
    add(22, "Pack X 2 Vasos Dobles 250Ml", "$16.247", ["p024-2"], (922, 1472, 181, 45), font_size=18, min_width=63)
    add(23, "Frasco Con Tapa De Bamboo 450Ml", "$7.578", ["p025-1"], (182, 1291, 101, 32), font_size=15, min_width=37, font_weight=700)
    add(23, "Frasco Con Tapa De Bamboo 800Ml", "$8.279", ["p025-2"], (519, 1292, 106, 32), font_size=15, min_width=39, font_weight=700)
    add(23, "Frasco Con Tapa De Bamboo 1 litro", "$10.641", ["p025-3"], (842, 1291, 110, 32), font_size=15, min_width=40, font_weight=700)
    add(23, "Frasco Con Tapa De Bamboo 1.3 litros", "$11.574", ["p025-4"], (1221, 1291, 107, 32), font_size=15, min_width=39, font_weight=700)
    return groups


def page_for_product(product_id: str) -> int:
    for page, product_ids in PAGE_PRODUCTS.items():
        if product_id in product_ids:
            return page
    raise KeyError(product_id)


def build_pages(price_groups: dict[int, list[dict]]) -> list[dict]:
    pages = []
    for page in range(1, 24):
        pages.append({
            "number": page,
            "title": PAGE_TITLES[page],
            "section": "Lexo",
            "showPriceOverlays": True,
            "image": {
                "src": f"assets/pages/lexo-20260706-page-{page:03d}.png?v={ASSET_VERSION}",
                "width": IMAGE_WIDTH,
                "height": IMAGE_HEIGHT,
            },
            "products": PAGE_PRODUCTS[page],
            "priceGroups": price_groups[page],
        })
    return pages


def write_catalog(catalog: dict) -> None:
    json_text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    DATA_JSON.write_text(json_text, encoding="utf-8")
    DATA_JS.write_text(f"window.CATALOG_DATA = {json_text.rstrip()};\n", encoding="utf-8")


def main() -> None:
    missing_assets = [page for page in range(1, 24) if not source_page(page).is_file()]
    if missing_assets:
        raise FileNotFoundError(f"Missing supplied pages: {missing_assets}")

    catalog = read_catalog()
    products_by_id = {product["id"]: product for product in catalog["products"]}
    existing_lexo_ids = {product["id"] for product in catalog["products"] if product.get("section") == "Lexo"}
    redesigned_ids = {product_id for product_ids in PAGE_PRODUCTS.values() for product_id in product_ids}
    if existing_lexo_ids != redesigned_ids:
        missing = sorted(existing_lexo_ids - redesigned_ids)
        extra = sorted(redesigned_ids - existing_lexo_ids)
        raise ValueError(f"Lexo reconciliation failed. Missing={missing}; extra={extra}")
    if len(redesigned_ids) != sum(len(ids) for ids in PAGE_PRODUCTS.values()):
        raise ValueError("A Lexo product was assigned to more than one redesigned page")
    if set(SKU_BOUNDS) != redesigned_ids:
        raise ValueError("Every redesigned Lexo product must have exactly one SKU bound")

    non_lexo_pages = [page for page in catalog["pages"] if page.get("section") != "Lexo"]
    page_number_map = {page["number"]: index + 24 for index, page in enumerate(non_lexo_pages)}

    for product in catalog["products"]:
        if product.get("section") == "Lexo":
            product["page"] = page_for_product(product["id"])
            product["hotspot"] = normalized_box(SKU_BOUNDS[product["id"]])
            product["hotspotStyle"] = {"borderColor": "rgba(0, 0, 0, 0.34)"}
        elif product.get("page") in page_number_map:
            product["page"] = page_number_map[product["page"]]

    price_groups = build_price_groups()
    for page, groups in price_groups.items():
        for group in groups:
            for product_id in group["productIds"]:
                products_by_id[product_id]["pricePosition"] = dict(group["position"])

    later_pages = []
    for page in non_lexo_pages:
        old_page_number = page["number"]
        page["number"] = page_number_map[old_page_number]
        for group in page.get("priceGroups", []):
            group["page"] = page["number"]
        later_pages.append(page)

    catalog["pages"] = build_pages(price_groups) + later_pages
    catalog["source"] = str(SOURCE_DIR)
    catalog["totalPagesInPdf"] = len(catalog["pages"])
    catalog["samplePageCount"] = len(catalog["pages"])
    catalog["assetVersion"] = ASSET_VERSION

    page_numbers = [page["number"] for page in catalog["pages"]]
    if page_numbers != list(range(1, len(catalog["pages"]) + 1)):
        raise ValueError("Catalog pages are not contiguous after the Lexo replacement")
    if any(product["page"] not in page_numbers for product in catalog["products"]):
        raise ValueError("A product references a page that no longer exists")

    for page in range(1, 24):
        shutil.copy2(source_page(page), PAGE_DIR / f"lexo-20260706-page-{page:03d}.png")
    write_catalog(catalog)

    print(f"Updated 23 Lexo pages and {len(redesigned_ids)} Lexo products")
    print(f"Catalog now has {len(catalog['pages'])} pages and {len(catalog['products'])} products")


if __name__ == "__main__":
    main()
