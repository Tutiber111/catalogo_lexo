from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path

import fitz
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
DATA_JSON = WEB_DIR / "data" / "catalog.json"
DATA_JS = WEB_DIR / "data" / "catalog-data.js"
PAGE_DIR = WEB_DIR / "assets" / "pages"
ASSET_VERSION = "20260819-dreamfarm-new-products"
IMAGE_WIDTH = 1013
IMAGE_HEIGHT = 1432


PAGE_SPECS = {
    "jot": {
        "pdf_page": 0,
        "filename": "dreamfarm-20260819-jot.jpg",
        "title": "Jot",
    },
    "ortwo": {
        "pdf_page": 1,
        "filename": "dreamfarm-20260819-ortwo.jpg",
        "title": "Ortwo",
    },
    "nospilla": {
        "pdf_page": 2,
        "filename": "dreamfarm-20260819-nospilla.jpg",
        "title": "Nospilla",
    },
    "upcup": {
        "pdf_page": 3,
        "filename": "dreamfarm-20260819-upcup.jpg",
        "title": "Upcup",
    },
}


def render_pages(document: fitz.Document) -> dict[str, dict]:
    PAGE_DIR.mkdir(parents=True, exist_ok=True)
    images = {}
    for key, spec in PAGE_SPECS.items():
        page = document[spec["pdf_page"]]
        scale = max(IMAGE_WIDTH / page.rect.width, IMAGE_HEIGHT / page.rect.height)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        if image.size != (IMAGE_WIDTH, IMAGE_HEIGHT):
            image = image.resize((IMAGE_WIDTH, IMAGE_HEIGHT), Image.Resampling.LANCZOS)
        destination = PAGE_DIR / spec["filename"]
        image.save(destination, "JPEG", quality=92, optimize=True)
        images[key] = {
            "src": f"assets/pages/{spec['filename']}?v={ASSET_VERSION}",
            "width": IMAGE_WIDTH,
            "height": IMAGE_HEIGHT,
        }
    return images


def hotspot(x0: float, y0: float, x1: float, y1: float) -> dict:
    page_width = 595.5
    page_height = 842.2499787
    pad_x = 3.0
    pad_y = 2.0
    return {
        "x": round((x0 - pad_x) / page_width, 12),
        "y": round((y0 - pad_y) / page_height, 12),
        "w": round((x1 - x0 + 2 * pad_x) / page_width, 12),
        "h": round((y1 - y0 + 2 * pad_y) / page_height, 12),
    }


def price_position(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {
        "x": round(((x0 + x1) / 2) / 595.5, 12),
        "y": round(((y0 + y1) / 2) / 842.2499787, 12),
    }


def price_cover(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {
        "w": round((x1 - x0 + 5.0) / 595.5, 12),
        "h": round((y1 - y0 + 2.0) / 842.2499787, 12),
    }


PRICE_STYLE = {
    "fontSize": 11,
    "minWidth": 36,
    "minHeight": 14,
    "padX": 1,
    "padY": 0,
    "radius": 1,
    "shadow": "none",
    "color": "#00a6ce",
    "background": "#f5f5f5",
}


def product(
    *,
    product_id: str,
    page: int,
    sku: str,
    name: str,
    category: str,
    price: str,
    ean: str,
    bounds: tuple[float, float, float, float],
    price_bounds: tuple[float, float, float, float],
    price_source: str = "pdf-dreamfarm-20260819",
    video_url: str = "",
) -> dict:
    record = {
        "id": product_id,
        "page": page,
        "sku": sku,
        "skus": [sku],
        "name": name,
        "category": category,
        "price": price,
        "pdfPrice": price,
        "priceSource": price_source,
        "ean": ean,
        "unitsPerCase": 1,
        "sizeLabel": "",
        "hotspot": hotspot(*bounds),
        "pricePosition": price_position(*price_bounds),
        "section": "Dreamfarm",
    }
    if video_url:
        record["videoUrl"] = video_url
    return record


def price_group(
    *,
    group_id: str,
    page: int,
    label: str,
    price: str,
    product_ids: list[str],
    bounds: tuple[float, float, float, float],
) -> dict:
    return {
        "id": group_id,
        "page": page,
        "label": label,
        "price": price,
        "productIds": product_ids,
        "position": price_position(*bounds),
        "cover": price_cover(*bounds),
        "positionSource": "dreamfarm-20260819-pdf",
        "variant": "pdf-inline",
        "style": deepcopy(PRICE_STYLE),
        "pdfPriceHeight": round(bounds[3] - bounds[1], 3),
        "pdfPriceColor": "#00a6ce",
    }


def build_new_records(images: dict[str, dict], old_products: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    jot_page = 86
    nospilla_page = 87
    upcup_page = 88
    ortwo_page = 89

    jot_price = (519.7, 612.1, 562.5, 624.3)
    nospilla_price = (516.8, 612.1, 565.5, 624.3)
    upcup_price = (468.6, 612.1, 517.3, 624.3)
    big_upcup_price = (530.0, 612.1, 577.7, 624.3)
    ortwo_price = (479.1, 612.1, 529.2, 624.3)
    ortwo_jar_price = (541.9, 612.1, 585.0, 624.3)

    products = [
        product(
            product_id="dreamfarm-jot-8036",
            page=jot_page,
            sku="8036",
            name="Ganchos con ventosa Jot - Set x 4",
            category="Jot",
            price="$9.890",
            ean="9334084008036",
            bounds=(258.2, 612.1, 289.6, 624.3),
            price_bounds=jot_price,
        ),
        product(
            product_id="dreamfarm-nospilla-6100",
            page=nospilla_page,
            sku="6100",
            name="Cubetera antiderrame Nospilla - Blanca",
            category="Nospilla",
            price="$14.490",
            ean="9334084006100",
            bounds=(263.1, 612.1, 293.3, 624.3),
            price_bounds=nospilla_price,
        ),
        product(
            product_id="dreamfarm-nospilla-6117",
            page=nospilla_page,
            sku="6117",
            name="Cubetera antiderrame Nospilla - Azul Dreamfarm",
            category="Nospilla",
            price="$14.490",
            ean="9334084006117",
            bounds=(306.1, 612.1, 331.2, 624.3),
            price_bounds=nospilla_price,
        ),
    ]

    upcup = deepcopy(old_products["p069-1"])
    upcup.update(
        {
            "page": upcup_page,
            "name": "Taza medidora ajustable Upcup - 1 taza",
            "category": "Upcup",
            "pdfPrice": "$14.490",
            "hotspot": hotspot(202.2, 612.1, 232.6, 624.3),
            "pricePosition": price_position(*upcup_price),
        }
    )
    products.append(upcup)
    products.append(
        product(
            product_id="dreamfarm-big-upcup-2485",
            page=upcup_page,
            sku="2485",
            name="Taza medidora ajustable Big Upcup - 2 tazas",
            category="Upcup",
            price="$19.650",
            ean="9334084002485",
            bounds=(309.4, 612.1, 339.9, 624.3),
            price_bounds=big_upcup_price,
            video_url=upcup.get("videoUrl", ""),
        )
    )

    ortwo = deepcopy(old_products["p070-ortwo"])
    ortwo.update(
        {
            "page": ortwo_page,
            "pdfPrice": "$26.950",
            "hotspot": hotspot(216.1, 612.1, 243.1, 624.3),
            "pricePosition": price_position(*ortwo_price),
        }
    )
    products.append(ortwo)
    products.append(
        product(
            product_id="dreamfarm-ortwo-container-7299",
            page=ortwo_page,
            sku="7299",
            name="Repuesto contenedor Ortwo Lite",
            category="Ortwo",
            price="$4.650",
            ean="9334084007299",
            bounds=(255.9, 612.1, 381.6, 624.3),
            price_bounds=ortwo_jar_price,
            video_url=ortwo.get("videoUrl", ""),
        )
    )

    pages = [
        {
            "number": jot_page,
            "title": "Jot",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["jot"],
            "products": ["dreamfarm-jot-8036"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-jot-8036",
                    page=jot_page,
                    label="Jot set x4",
                    price="$9.890",
                    product_ids=["dreamfarm-jot-8036"],
                    bounds=jot_price,
                )
            ],
        },
        {
            "number": nospilla_page,
            "title": "Nospilla",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["nospilla"],
            "products": ["dreamfarm-nospilla-6100", "dreamfarm-nospilla-6117"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-nospilla",
                    page=nospilla_page,
                    label="Nospilla - 2 colores",
                    price="$14.490",
                    product_ids=["dreamfarm-nospilla-6100", "dreamfarm-nospilla-6117"],
                    bounds=nospilla_price,
                )
            ],
        },
        {
            "number": upcup_page,
            "title": "Upcup",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["upcup"],
            "products": ["p069-1", "dreamfarm-big-upcup-2485"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-upcup-2478",
                    page=upcup_page,
                    label="Upcup - 1 taza",
                    price="$14.490",
                    product_ids=["p069-1"],
                    bounds=upcup_price,
                ),
                price_group(
                    group_id="dreamfarm-pg-upcup-2485",
                    page=upcup_page,
                    label="Big Upcup - 2 tazas",
                    price="$19.650",
                    product_ids=["dreamfarm-big-upcup-2485"],
                    bounds=big_upcup_price,
                ),
            ],
        },
        {
            "number": ortwo_page,
            "title": "Ortwo",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["ortwo"],
            "products": ["p070-ortwo", "dreamfarm-ortwo-container-7299"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-ortwo-7213",
                    page=ortwo_page,
                    label="Molinillo todo terreno Ortwo Lite",
                    price="$26.950",
                    product_ids=["p070-ortwo"],
                    bounds=ortwo_price,
                ),
                price_group(
                    group_id="dreamfarm-pg-ortwo-7299",
                    page=ortwo_page,
                    label="Repuesto contenedor Ortwo Lite",
                    price="$4.650",
                    product_ids=["dreamfarm-ortwo-container-7299"],
                    bounds=ortwo_jar_price,
                ),
            ],
        },
    ]
    return pages, products


def validate_catalog(catalog: dict) -> None:
    pages = catalog["pages"]
    products = catalog["products"]
    numbers = [page["number"] for page in pages]
    if numbers != list(range(1, len(pages) + 1)):
        raise ValueError("Catalog pages are not contiguous")

    products_by_id = {product["id"]: product for product in products}
    if len(products_by_id) != len(products):
        raise ValueError("Duplicate product IDs found")

    referenced_ids = set()
    for page in pages:
        for product_id in page.get("products", []):
            product = products_by_id.get(product_id)
            if product is None:
                raise ValueError(f"Missing product {product_id} on page {page['number']}")
            if product["page"] != page["number"]:
                raise ValueError(f"Product {product_id} has an incorrect page number")
            referenced_ids.add(product_id)
        for group in page.get("priceGroups", []):
            if group["page"] != page["number"]:
                raise ValueError(f"Price group {group['id']} has an incorrect page number")
            for product_id in group.get("productIds", []):
                if product_id not in page.get("products", []):
                    raise ValueError(f"Price group {group['id']} references a product on another page")

    orphaned_ids = set(products_by_id) - referenced_ids
    if orphaned_ids:
        raise ValueError(f"Orphaned products found: {sorted(orphaned_ids)[:5]}")

    for page in pages:
        image_path = WEB_DIR / page["image"]["src"].split("?", 1)[0]
        if not image_path.exists():
            raise ValueError(f"Missing page image: {image_path}")


def write_catalog(catalog: dict) -> None:
    text = json.dumps(catalog, ensure_ascii=False, indent=2)
    DATA_JSON.write_text(text + "\n", encoding="utf-8")
    DATA_JS.write_text(f"window.CATALOG_DATA = {text};\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    if not args.pdf.exists():
        raise FileNotFoundError(args.pdf)

    document = fitz.open(args.pdf)
    if document.page_count != 4:
        raise ValueError(f"Expected four Dreamfarm pages, found {document.page_count}")
    images = render_pages(document)
    document.close()

    catalog = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    old_products = {product["id"]: product for product in catalog["products"]}
    old_upcup_index = next(
        index for index, page in enumerate(catalog["pages"])
        if page.get("section") == "Dreamfarm" and page.get("title") == "Upcup"
    )
    old_ortwo_index = next(
        index for index, page in enumerate(catalog["pages"])
        if page.get("section") == "Dreamfarm" and page.get("title") == "Ortwo"
    )
    if old_ortwo_index != old_upcup_index + 1:
        raise ValueError("Expected the existing Upcup and Ortwo pages to be consecutive")

    new_pages, new_products = build_new_records(images, old_products)
    retained_pages = deepcopy(catalog["pages"][:old_upcup_index])
    trailing_pages = deepcopy(catalog["pages"][old_ortwo_index + 1 :])
    for page in trailing_pages:
        page["number"] += 2
        for group in page.get("priceGroups", []):
            group["page"] = page["number"]
    catalog["pages"] = retained_pages + new_pages + trailing_pages

    removed_ids = {"p069-1", "p070-ortwo"}
    new_product_ids = {product["id"] for product in new_products}
    rebuilt_products = []
    inserted = False
    for old_product in catalog["products"]:
        if old_product["id"] in removed_ids:
            if not inserted:
                rebuilt_products.extend(new_products)
                inserted = True
            continue
        current = deepcopy(old_product)
        if current["page"] >= 88:
            current["page"] += 2
        rebuilt_products.append(current)
    if not inserted:
        raise ValueError("Could not find the existing Upcup and Ortwo products")
    if len(new_product_ids) != len(new_products):
        raise ValueError("Duplicate new product IDs")

    catalog["products"] = rebuilt_products
    catalog["totalPagesInPdf"] = len(catalog["pages"])
    catalog["samplePageCount"] = len(catalog["pages"])
    catalog["assetVersion"] = ASSET_VERSION
    validate_catalog(catalog)
    write_catalog(catalog)

    print(
        json.dumps(
            {
                "pages": len(catalog["pages"]),
                "products": len(catalog["products"]),
                "dreamfarmPages": [
                    {"page": page["number"], "title": page["title"], "products": page["products"]}
                    for page in new_pages
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
