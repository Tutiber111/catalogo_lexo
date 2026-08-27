from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from copy import deepcopy
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
DATA_JSON = WEB_DIR / "data" / "catalog.json"
DATA_JS = WEB_DIR / "data" / "catalog-data.js"
PAGE_DIR = WEB_DIR / "assets" / "pages"
ASSET_VERSION = "20260826-dreamfarm-fledge-oileroo-garject"
IMAGE_WIDTH = 1013
IMAGE_HEIGHT = 1432

PAGE_SPECS = {
    "fledge": {"pdf_page": 1, "filename": "dreamfarm-20260826-fledge.jpg"},
    "oileroo": {"pdf_page": 2, "filename": "dreamfarm-20260826-oileroo.jpg"},
    "garject": {"pdf_page": 3, "filename": "dreamfarm-20260826-garject.jpg"},
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


def render_pages(pdf_path: Path, pdftoppm: Path) -> dict[str, dict]:
    PAGE_DIR.mkdir(parents=True, exist_ok=True)
    images: dict[str, dict] = {}
    for key, spec in PAGE_SPECS.items():
        destination = PAGE_DIR / spec["filename"]
        output_prefix = destination.with_suffix("")
        subprocess.run(
            [
                str(pdftoppm),
                "-f",
                str(spec["pdf_page"]),
                "-l",
                str(spec["pdf_page"]),
                "-singlefile",
                "-jpeg",
                "-jpegopt",
                "quality=92,optimize=y",
                "-scale-to-x",
                str(IMAGE_WIDTH),
                "-scale-to-y",
                str(IMAGE_HEIGHT),
                str(pdf_path),
                str(output_prefix),
            ],
            check=True,
        )
        with Image.open(destination) as image:
            if image.size != (IMAGE_WIDTH, IMAGE_HEIGHT):
                raise ValueError(f"Unexpected image dimensions for {destination}: {image.size}")
        images[key] = {
            "src": f"assets/pages/{spec['filename']}?v={ASSET_VERSION}",
            "width": IMAGE_WIDTH,
            "height": IMAGE_HEIGHT,
        }
    return images


def hotspot(bounds: tuple[float, float, float, float]) -> dict:
    x0, y0, x1, y1 = bounds
    pad_x = 3.0
    pad_y = 2.0
    return {
        "x": round((x0 - pad_x) / 595.5, 12),
        "y": round((y0 - pad_y) / 842.2499787, 12),
        "w": round((x1 - x0 + 2 * pad_x) / 595.5, 12),
        "h": round((y1 - y0 + 2 * pad_y) / 842.2499787, 12),
    }


def price_position(bounds: tuple[float, float, float, float]) -> dict:
    x0, y0, x1, y1 = bounds
    return {
        "x": round(((x0 + x1) / 2) / 595.5, 12),
        "y": round(((y0 + y1) / 2) / 842.2499787, 12),
    }


def price_cover(bounds: tuple[float, float, float, float]) -> dict:
    x0, y0, x1, y1 = bounds
    return {
        "w": round((x1 - x0 + 5.0) / 595.5, 12),
        "h": round((y1 - y0 + 2.0) / 842.2499787, 12),
    }


def product(
    *,
    product_id: str,
    page: int,
    sku: str,
    name: str,
    category: str,
    price: str,
    bounds: tuple[float, float, float, float],
    price_bounds: tuple[float, float, float, float],
    units_per_case: int = 1,
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
        "priceSource": "pdf-dreamfarm-20260826",
        "ean": f"933408400{sku}",
        "unitsPerCase": units_per_case,
        "sizeLabel": "",
        "hotspot": hotspot(bounds),
        "pricePosition": price_position(price_bounds),
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
        "position": price_position(bounds),
        "cover": price_cover(bounds),
        "positionSource": "dreamfarm-20260826-pdf",
        "variant": "pdf-inline",
        "style": deepcopy(PRICE_STYLE),
        "pdfPriceHeight": round(bounds[3] - bounds[1], 3),
        "pdfPriceColor": "#00a6ce",
    }


def build_inserted_pages(images: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    fledge_small_price = (484.4, 612.1, 529.1, 624.3)
    fledge_big_price = (541.8, 612.1, 583.9, 624.3)
    oileroo_price = (510.4, 612.1, 557.9, 624.3)

    products = [
        product(
            product_id="dreamfarm-fledge-small-4786",
            page=86,
            sku="4786",
            name="Tabla de cortar Fledge Bamboo - Small",
            category="Fledge",
            price="$15.910",
            bounds=(222.8, 612.1, 253.7, 624.3),
            price_bounds=fledge_small_price,
        ),
        product(
            product_id="dreamfarm-fledge-big-4793",
            page=86,
            sku="4793",
            name="Tabla de cortar Big Fledge Bamboo",
            category="Fledge",
            price="$29.850",
            bounds=(311.1, 612.1, 341.9, 624.3),
            price_bounds=fledge_big_price,
        ),
        product(
            product_id="dreamfarm-oileroo-black-7510",
            page=87,
            sku="7510",
            name="Rociador de aceite Oileroo - Negro",
            category="Oileroo",
            price="$21.990",
            bounds=(212.0, 612.1, 240.5, 624.3),
            price_bounds=oileroo_price,
        ),
        product(
            product_id="dreamfarm-oileroo-white-7527",
            page=87,
            sku="7527",
            name="Rociador de aceite Oileroo - Blanco",
            category="Oileroo",
            price="$21.990",
            bounds=(302.2, 612.1, 331.7, 624.3),
            price_bounds=oileroo_price,
        ),
    ]
    pages = [
        {
            "number": 86,
            "title": "Fledge",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["fledge"],
            "products": ["dreamfarm-fledge-small-4786", "dreamfarm-fledge-big-4793"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-fledge-small-4786",
                    page=86,
                    label="Fledge Bamboo - Small",
                    price="$15.910",
                    product_ids=["dreamfarm-fledge-small-4786"],
                    bounds=fledge_small_price,
                ),
                price_group(
                    group_id="dreamfarm-pg-fledge-big-4793",
                    page=86,
                    label="Big Fledge Bamboo",
                    price="$29.850",
                    product_ids=["dreamfarm-fledge-big-4793"],
                    bounds=fledge_big_price,
                ),
            ],
        },
        {
            "number": 87,
            "title": "Oileroo",
            "section": "Dreamfarm",
            "showPriceOverlays": True,
            "image": images["oileroo"],
            "products": ["dreamfarm-oileroo-black-7510", "dreamfarm-oileroo-white-7527"],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-oileroo",
                    page=87,
                    label="Oileroo - 2 colores",
                    price="$21.990",
                    product_ids=["dreamfarm-oileroo-black-7510", "dreamfarm-oileroo-white-7527"],
                    bounds=oileroo_price,
                )
            ],
        },
    ]
    return pages, products


def replace_garject_page(catalog: dict, images: dict[str, dict]) -> dict:
    garject_page = next(
        page for page in catalog["pages"]
        if page.get("section") == "Dreamfarm" and page.get("title") == "Garject"
    )
    black = next(product for product in catalog["products"] if product["id"] == "p097-1")
    price_bounds = (515.8, 612.1, 566.5, 624.3)
    black.update(
        {
            "name": "Prensa ajos Garject Lite - Negro",
            "category": "Garject",
            "price": "$24.540",
            "pdfPrice": "$24.540",
            "priceSource": "pdf-dreamfarm-20260826",
            "hotspot": hotspot((240.7, 610.4, 276.2, 626.0)),
            "pricePosition": price_position(price_bounds),
        }
    )
    red = product(
        product_id="dreamfarm-garject-red-5622",
        page=garject_page["number"],
        sku="5622",
        name="Prensa ajos Garject Lite - Rojo",
        category="Garject",
        price="$24.540",
        bounds=(292.4, 610.4, 330.9, 626.0),
        price_bounds=price_bounds,
        units_per_case=black.get("unitsPerCase", 1),
        video_url=black.get("videoUrl", ""),
    )
    garject_page.update(
        {
            "image": images["garject"],
            "products": [black["id"], red["id"]],
            "priceGroups": [
                price_group(
                    group_id="dreamfarm-pg-garject-5615-5622",
                    page=garject_page["number"],
                    label="Garject Lite - 2 colores",
                    price="$24.540",
                    product_ids=[black["id"], red["id"]],
                    bounds=price_bounds,
                )
            ],
        }
    )
    return red


def validate_catalog(catalog: dict) -> None:
    pages = catalog["pages"]
    products = catalog["products"]
    if [page["number"] for page in pages] != list(range(1, len(pages) + 1)):
        raise ValueError("Catalog pages are not contiguous")

    products_by_id = {product["id"]: product for product in products}
    if len(products_by_id) != len(products):
        raise ValueError("Duplicate product IDs found")

    referenced_ids = set()
    for page in pages:
        for product_id in page.get("products", []):
            product_record = products_by_id.get(product_id)
            if product_record is None:
                raise ValueError(f"Missing product {product_id} on page {page['number']}")
            if product_record["page"] != page["number"]:
                raise ValueError(f"Product {product_id} has an incorrect page number")
            referenced_ids.add(product_id)
        for group in page.get("priceGroups", []):
            if group["page"] != page["number"]:
                raise ValueError(f"Price group {group['id']} has an incorrect page number")
            for product_id in group.get("productIds", []):
                if product_id not in page.get("products", []):
                    raise ValueError(f"Price group {group['id']} references another page")

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


def resolve_pdftoppm(value: str) -> Path:
    candidate = Path(value) if value else Path(shutil.which("pdftoppm") or "")
    if not candidate.is_file():
        raise FileNotFoundError("pdftoppm was not found; pass it with --pdftoppm")
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pdftoppm", default="")
    args = parser.parse_args()
    if not args.pdf.exists():
        raise FileNotFoundError(args.pdf)

    images = render_pages(args.pdf, resolve_pdftoppm(args.pdftoppm))
    catalog = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    inserted_pages, inserted_products = build_inserted_pages(images)

    dreamfarm_cover_index = next(
        index for index, page in enumerate(catalog["pages"])
        if page.get("section") == "Dreamfarm" and page.get("title") == "Catalog"
    )
    first_product_page = catalog["pages"][dreamfarm_cover_index]["number"] + 1
    if first_product_page != 86:
        raise ValueError(f"Expected Dreamfarm products to begin on page 86, found {first_product_page}")

    shifted_pages = deepcopy(catalog["pages"])
    for page_record in shifted_pages[dreamfarm_cover_index + 1 :]:
        page_record["number"] += 2
        for group in page_record.get("priceGroups", []):
            group["page"] = page_record["number"]
    catalog["pages"] = (
        shifted_pages[: dreamfarm_cover_index + 1]
        + inserted_pages
        + shifted_pages[dreamfarm_cover_index + 1 :]
    )

    shifted_products = deepcopy(catalog["products"])
    for product_record in shifted_products:
        if product_record["page"] >= first_product_page:
            product_record["page"] += 2
        if product_record.get("sku") in {"8418", "8425"}:
            product_record["price"] = "$14.190"
            product_record["pdfPrice"] = "$8.190"
            product_record["priceSource"] = "manual-20260826"

    first_dreamfarm_product_index = next(
        index for index, product_record in enumerate(shifted_products)
        if product_record.get("section") == "Dreamfarm"
        and product_record["page"] >= first_product_page + 2
    )
    shifted_products[first_dreamfarm_product_index:first_dreamfarm_product_index] = inserted_products
    catalog["products"] = shifted_products

    fladle_page = next(
        page for page in catalog["pages"]
        if page.get("section") == "Dreamfarm" and page.get("title") == "Fladle"
    )
    for group in fladle_page.get("priceGroups", []):
        group["price"] = "$14.190"

    red_garject = replace_garject_page(catalog, images)
    black_index = next(index for index, item in enumerate(catalog["products"]) if item["id"] == "p097-1")
    catalog["products"].insert(black_index + 1, red_garject)

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
                "insertedPages": [page["number"] for page in inserted_pages],
                "garjectPage": next(
                    page["number"] for page in catalog["pages"]
                    if page.get("section") == "Dreamfarm" and page.get("title") == "Garject"
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
