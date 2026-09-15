from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
DATA_JSON = WEB_DIR / "data" / "catalog.json"
DATA_JS = WEB_DIR / "data" / "catalog-data.js"

CORRECTED_PAGE = 33
REMOVED_PAGE = 86
CORRECTED_IMAGE = "assets/pages/estia-20260915-page-033.jpg?v=20260915-estia-measures"
ASSET_VERSION = "20260915-estia-page33-remove-fledge"

CORRECTED_NAMES = {
    "estia-p033-2": "Canasta organizadora de jacinto 31 x 21 x 14 cm",
    "estia-p033-3": "Canasta organizadora de jacinto 35 x 25 x 16 cm",
}


def validate_catalog(catalog: dict) -> None:
    pages = catalog["pages"]
    products = catalog["products"]
    expected_numbers = list(range(1, len(pages) + 1))
    if [page["number"] for page in pages] != expected_numbers:
        raise ValueError("Catalog page numbers are not contiguous")

    products_by_id = {product["id"]: product for product in products}
    if len(products_by_id) != len(products):
        raise ValueError("Duplicate product IDs found")

    referenced_ids: set[str] = set()
    for page in pages:
        if page.get("title") == "Fledge" and page.get("section") == "Dreamfarm":
            raise ValueError("The Dreamfarm Fledge page is still present")
        for product_id in page.get("products", []):
            product = products_by_id.get(product_id)
            if product is None:
                raise ValueError(f"Page {page['number']} references missing product {product_id}")
            if product["page"] != page["number"]:
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


def main() -> None:
    catalog = json.loads(DATA_JSON.read_text(encoding="utf-8"))

    corrected_page = next(page for page in catalog["pages"] if page["number"] == CORRECTED_PAGE)
    if corrected_page.get("section") != "Estia":
        raise ValueError("Catalog page 33 is no longer the expected Estia page")
    corrected_page["image"] = {
        "src": CORRECTED_IMAGE,
        "width": 1013,
        "height": 1432,
    }

    for group in corrected_page.get("priceGroups", []):
        product_id = next(iter(group.get("productIds", [])), "")
        if product_id in CORRECTED_NAMES:
            group["label"] = CORRECTED_NAMES[product_id]

    removed_page = next(page for page in catalog["pages"] if page["number"] == REMOVED_PAGE)
    if removed_page.get("section") != "Dreamfarm" or removed_page.get("title") != "Fledge":
        raise ValueError("Catalog page 86 is no longer the expected Dreamfarm Fledge page")
    removed_product_ids = set(removed_page.get("products", []))
    catalog["pages"].remove(removed_page)

    for page in catalog["pages"]:
        if page["number"] > REMOVED_PAGE:
            page["number"] -= 1
            for group in page.get("priceGroups", []):
                group["page"] = page["number"]

    retained_products = []
    for product in catalog["products"]:
        if product["id"] in removed_product_ids:
            continue
        if product["id"] in CORRECTED_NAMES:
            product["name"] = CORRECTED_NAMES[product["id"]]
        if product["page"] > REMOVED_PAGE:
            product["page"] -= 1
        retained_products.append(product)
    catalog["products"] = retained_products

    catalog["totalPagesInPdf"] = len(catalog["pages"])
    catalog["samplePageCount"] = len(catalog["pages"])
    catalog["assetVersion"] = ASSET_VERSION

    validate_catalog(catalog)
    json_text = json.dumps(catalog, ensure_ascii=False, indent=2)
    DATA_JSON.write_text(json_text + "\n", encoding="utf-8")
    DATA_JS.write_text(f"window.CATALOG_DATA = {json_text};\n", encoding="utf-8")

    print(json.dumps({
        "pages": len(catalog["pages"]),
        "products": len(catalog["products"]),
        "removedProducts": sorted(removed_product_ids),
        "newPage86": next(page["title"] for page in catalog["pages"] if page["number"] == 86),
    }, indent=2))


if __name__ == "__main__":
    main()
