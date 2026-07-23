from __future__ import annotations

import json
import math
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

import fitz
from PIL import Image

import update_oxo_catalog as oxo


APP_PAGE = 245
SOURCE_PAGE = 4
INPUT_PDF = Path.home() / "Downloads" / "Catálogo OXO nuevo 2026.pdf"
PDFTOPPM = (
    Path.home()
    / ".cache"
    / "codex-runtimes"
    / "codex-primary-runtime"
    / "dependencies"
    / "native"
    / "poppler"
    / "Library"
    / "bin"
    / "pdftoppm.exe"
)


def render_replacement(page: fitz.Page, destination: Path, prices: list[oxo.PriceWord]) -> dict:
    if not PDFTOPPM.exists():
        raise FileNotFoundError(PDFTOPPM)

    width = math.ceil(page.rect.width * oxo.RENDER_SCALE)
    height = math.ceil(page.rect.height * oxo.RENDER_SCALE)
    with tempfile.TemporaryDirectory(prefix="oxo-page-") as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            [
                str(PDFTOPPM),
                "-f",
                "1",
                "-l",
                "1",
                "-singlefile",
                "-png",
                "-scale-to-x",
                str(width),
                "-scale-to-y",
                str(height),
                str(INPUT_PDF),
                str(prefix),
            ],
            check=True,
        )
        image = Image.open(prefix.with_suffix(".png")).convert("RGB")
        oxo.erase_printed_prices(image, prices)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=89, optimize=True)

    return {
        "src": f"{destination.relative_to(oxo.WEB_DIR).as_posix()}?v={oxo.ASSET_VERSION}",
        "width": width,
        "height": height,
    }


def build_replacement(page: fitz.Page, price_aliases: dict[str, dict]) -> tuple[dict, list[dict]]:
    title = oxo.title_for_page(page)
    prices = oxo.price_words_for_page(page)
    hits, unpriced_hits = oxo.product_hits(page, price_aliases)
    unpriced_prices = {
        nearest.index
        for hit in unpriced_hits
        if (nearest := oxo.nearest_price(hit["word"], prices)) is not None
    }
    image = render_replacement(
        page,
        oxo.PAGE_DIR / f"{oxo.ASSET_PREFIX}-{SOURCE_PAGE:03d}.jpg",
        prices,
    )

    products = []
    price_members: dict[int, list[dict]] = defaultdict(list)
    for hit in hits:
        nearest = oxo.nearest_price(hit["word"], prices)
        product = {
            "id": f"oxo-p{SOURCE_PAGE:03d}-{len(products) + 1}",
            "page": APP_PAGE,
            "sku": hit["sku"],
            "skus": [hit["sku"]],
            "name": hit["priceData"]["description"],
            "category": title,
            "price": hit["priceData"]["price"],
            "pdfPrice": nearest.text if nearest else "",
            "priceSource": "excel-july-2026",
            "ean": hit["priceData"]["ean"],
            "unitsPerCase": hit["priceData"]["unitsPerCase"],
            "sizeLabel": "",
            "hotspot": oxo.normalized_hotspot(page, hit["word"]),
            "hotspotStyle": {"borderColor": "rgba(215, 25, 32, 0.42)"},
            "pricePosition": oxo.price_position(page, nearest, hit["word"]),
            "section": oxo.BRAND,
            "sourcePage": SOURCE_PAGE,
            "hotspotSource": "oxo-20260722-sku-text",
        }
        if hit["printedSku"] != hit["sku"]:
            product["printedSku"] = hit["printedSku"]
        products.append(product)
        if nearest and nearest.index not in unpriced_prices:
            price_members[nearest.index].append(product)

    price_groups = []
    for price_index, members in sorted(price_members.items()):
        printed_price = prices[price_index]
        distinct_prices = list(dict.fromkeys(product["price"] for product in members))
        display_price = " / ".join(distinct_prices)
        price_groups.append(
            {
                "id": f"oxo-pg{SOURCE_PAGE:03d}-{len(price_groups) + 1}",
                "page": APP_PAGE,
                "label": title if len(members) == 1 else f"{title} - {len(members)} productos",
                "price": display_price,
                "productIds": [product["id"] for product in members],
                "position": oxo.price_position(page, printed_price, members[0]["hotspot"]),
                "positionSource": "oxo-20260722-pdf",
                "cover": oxo.price_cover(page, printed_price, display_price),
                "variant": "pdf-regular",
                "style": oxo.price_style(page, printed_price),
                "pdfPriceHeight": round(printed_price.height, 3),
                "pdfPriceColor": printed_price.color,
            }
        )

    page_record = {
        "number": APP_PAGE,
        "title": title,
        "section": oxo.BRAND,
        "showPriceOverlays": bool(price_groups),
        "image": image,
        "products": [product["id"] for product in products],
        "priceGroups": price_groups,
        "sourcePage": SOURCE_PAGE,
    }
    return page_record, products


def main() -> None:
    if not INPUT_PDF.exists():
        raise FileNotFoundError(INPUT_PDF)

    document = fitz.open(INPUT_PDF)
    if document.page_count != 1:
        raise ValueError(f"Expected a one-page replacement PDF, found {document.page_count} pages")

    price_aliases, _, _ = oxo.load_oxo_price_list()
    replacement_page, replacement_products = build_replacement(document[0], price_aliases)
    document.close()

    catalog = json.loads(oxo.DATA_JSON.read_text(encoding="utf-8"))
    page_index = next(
        index
        for index, page in enumerate(catalog["pages"])
        if page.get("section") == oxo.BRAND and page.get("number") == APP_PAGE
    )
    old_product_ids = set(catalog["pages"][page_index].get("products", []))
    catalog["pages"][page_index] = replacement_page

    rebuilt_products = []
    inserted = False
    for product in catalog["products"]:
        if product.get("id") in old_product_ids:
            if not inserted:
                rebuilt_products.extend(replacement_products)
                inserted = True
            continue
        rebuilt_products.append(product)
    if not inserted:
        raise ValueError("Could not locate the existing page products")

    catalog["products"] = rebuilt_products
    catalog["assetVersion"] = oxo.ASSET_VERSION
    oxo.validate_catalog(catalog)
    oxo.write_catalog(catalog)
    oxo.update_cache_versions()

    report = {
        "appPage": APP_PAGE,
        "sourcePage": SOURCE_PAGE,
        "title": replacement_page["title"],
        "products": [
            {"sku": product["sku"], "name": product["name"], "price": product["price"]}
            for product in replacement_products
        ],
        "image": replacement_page["image"],
    }
    report_path = oxo.ROOT / "tmp" / "oxo-page245-replacement-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
