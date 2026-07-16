from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog_sample import load_price_list  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
PAGE_DIR = WEB_DIR / "assets" / "pages"
DATA_JSON = WEB_DIR / "data" / "catalog.json"
DATA_JS = WEB_DIR / "data" / "catalog-data.js"
PDF_PATH = Path(r"C:\Users\Lenovo\Downloads\Catalogo Prepara.pdf")

BRAND = "Prepara"
ASSET_VERSION = "20260716-prepara"
RENDER_SCALE = 1.7
PRICE_RE = re.compile(r"^\$[\d.]+(?:,\d+)?$")
SKU_RE = re.compile(r"^\d{3,6}-?$")

EXTRA_SKUS = {
    "3715": {"description": "Spray gourmet de aluminio", "ean": "", "unitsPerCase": None},
}

NAME_OVERRIDES = {
    "2017": "Vertedor de aceite",
    "3041": "Frasco EVAK 11,8 x 13 cm",
    "3715": "Spray gourmet de aluminio",
}


@dataclass
class Line:
    words: list[tuple]
    text: str
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def clean_text(value: str) -> str:
    return " ".join(str(value).replace("\n", " ").split()).strip()


def read_catalog() -> dict:
    return json.loads(DATA_JSON.read_text(encoding="utf-8"))


def write_catalog(catalog: dict) -> None:
    json_text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    DATA_JSON.write_text(json_text, encoding="utf-8")
    DATA_JS.write_text(f"window.CATALOG_DATA = {json_text.rstrip()};\n", encoding="utf-8")


def normalize_sku(value: str) -> str:
    return clean_text(value).strip(".,;:()[]{}").rstrip("-").upper()


def word_text(word: tuple) -> str:
    return str(word[4]).strip()


def lines_for_page(page: fitz.Page) -> list[Line]:
    grouped: dict[tuple[int, int], list[tuple]] = {}
    for word in page.get_text("words"):
        grouped.setdefault((word[5], word[6]), []).append(word)
    lines = []
    for words in grouped.values():
        words = sorted(words, key=lambda item: item[0])
        text = clean_text(" ".join(word_text(word) for word in words))
        if not text:
            continue
        lines.append(
            Line(
                words=words,
                text=text,
                x0=min(word[0] for word in words),
                y0=min(word[1] for word in words),
                x1=max(word[2] for word in words),
                y1=max(word[3] for word in words),
            )
        )
    return sorted(lines, key=lambda line: (line.y0, line.x0))


def title_for_page(page: fitz.Page, lines: list[Line]) -> str:
    candidates = []
    for line in lines:
        if line.y0 > page.rect.height * 0.30:
            continue
        if not any(ch.isalpha() for ch in line.text) or PRICE_RE.search(line.text):
            continue
        if line.text.lower() == "prepara":
            continue
        candidates.append((line.height, -line.y0, line.text))
    if not candidates:
        return "Catalog"
    return max(candidates)[2]


def price_words_for_page(page: fitz.Page) -> list[dict]:
    span_styles: dict[tuple[str, int], dict] = {}
    counters: dict[str, int] = {}
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = clean_text(span.get("text", ""))
                if not PRICE_RE.fullmatch(text):
                    continue
                index = counters.get(text, 0)
                counters[text] = index + 1
                span_styles[(text, index)] = {
                    "color": f"#{int(span.get('color', 0)):06x}",
                    "fontSize": float(span.get("size", 14)),
                }

    counters = {}
    prices = []
    for word in page.get_text("words"):
        text = word_text(word)
        if not PRICE_RE.fullmatch(text):
            continue
        index = counters.get(text, 0)
        counters[text] = index + 1
        style = span_styles.get((text, index), {"color": "#588539", "fontSize": word[3] - word[1]})
        prices.append(
            {
                "text": text,
                "word": word,
                "index": len(prices),
                "x": (word[0] + word[2]) / 2,
                "y": word[1],
                "w": word[2] - word[0],
                "h": word[3] - word[1],
                "color": style["color"],
                "fontSize": style["fontSize"],
            }
        )
    return prices


def nearest_printed_price(sku_word: tuple, prices: list[dict]) -> dict | None:
    if not prices:
        return None
    sx = (sku_word[0] + sku_word[2]) / 2
    sy = (sku_word[1] + sku_word[3]) / 2
    below = [
        price
        for price in prices
        if price["y"] >= sy - 3 and abs(price["x"] - sx) <= 190 and price["y"] - sy <= 360
    ]
    if below:
        return min(below, key=lambda price: (price["y"] - sy) * 1.05 + abs(price["x"] - sx) * 0.35)
    return min(prices, key=lambda price: abs(price["y"] - sy) + abs(price["x"] - sx) * 0.35)


def same_line_price(lines: list[Line], sku_word: tuple, prices: list[dict]) -> dict | None:
    line = line_for_word(lines, sku_word)
    if not line:
        return None
    line_prices = [
        price
        for price in prices
        if any(price["word"] == word for word in line.words)
    ]
    if not line_prices:
        return None
    sx = (sku_word[0] + sku_word[2]) / 2
    after = [price for price in line_prices if price["x"] >= sx]
    return min(after or line_prices, key=lambda price: abs(price["x"] - sx))


def normalized_hotspot(page: fitz.Page, word: tuple) -> dict[str, float]:
    pad_x = 5
    pad_y = 4
    x = max(0, word[0] - pad_x) / page.rect.width
    y = max(0, word[1] - pad_y) / page.rect.height
    return {
        "x": round(x, 7),
        "y": round(y, 7),
        "w": round(min((word[2] - word[0] + pad_x * 2) / page.rect.width, 0.99 - x), 7),
        "h": round(min((word[3] - word[1] + pad_y * 2) / page.rect.height, 0.99 - y), 7),
    }


def normalized_price_position(page: fitz.Page, price: dict | None, word: tuple) -> dict[str, float]:
    if price:
        return {"x": round(price["x"] / page.rect.width, 7), "y": round(price["y"] / page.rect.height, 7)}
    return {
        "x": round(((word[0] + word[2]) / 2) / page.rect.width, 7),
        "y": round(min(0.94, (word[3] + 8) / page.rect.height), 7),
    }


def price_cover(page: fitz.Page, price: dict | None) -> dict[str, float]:
    if not price:
        return {"w": 0.10, "h": 0.028}
    return {
        "w": round((price["w"] + 9) / page.rect.width, 7),
        "h": round((price["h"] + 5) / page.rect.height, 7),
    }


def price_style(price: dict | None) -> dict:
    font_size = 14 if price is None else max(11, min(15, round(price["fontSize"] * 0.78)))
    return {
        "fontSize": font_size,
        "minWidth": 38,
        "minHeight": 15,
        "padX": 1,
        "padY": 0,
        "radius": 1,
        "shadow": "none",
        "color": (price or {}).get("color", "#588539"),
        "background": "#f5f5f5",
    }


def line_for_word(lines: list[Line], word: tuple) -> Line | None:
    for line in lines:
        if word in line.words:
            return line
    return None


def same_line_name(lines: list[Line], word: tuple) -> str:
    line = line_for_word(lines, word)
    if not line:
        return ""
    parts = []
    for item in line.words:
        text = word_text(item).strip()
        normalized = normalize_sku(text)
        if PRICE_RE.fullmatch(text) or normalized == normalize_sku(word_text(word)) or text == "-":
            continue
        parts.append(text)
    return clean_text(" ".join(parts))


def contextual_name(page: fitz.Page, lines: list[Line], word: tuple, title: str, price_data: dict) -> str:
    sku = normalize_sku(word_text(word))
    if sku in NAME_OVERRIDES:
        return NAME_OVERRIDES[sku]
    description = clean_text(price_data.get("description", ""))
    if description:
        return description

    sx = (word[0] + word[2]) / 2
    sy = (word[1] + word[3]) / 2
    pieces = []
    for line in lines:
        if line.cy >= sy - 2 or line.y0 < page.rect.height * 0.08:
            continue
        if PRICE_RE.search(line.text) or normalize_sku(line.text) == sku:
            continue
        if not any(ch.isalpha() for ch in line.text):
            continue
        if sy - line.cy <= 95 and line.x0 - 45 <= sx <= line.x1 + 45:
            pieces.append(line.text)
    inline = same_line_name(lines, word)
    if inline:
        pieces.append(inline)

    candidate = clean_text(" ".join(pieces[-3:]))
    if candidate and candidate.lower() not in {"set", "individual"}:
        if title and title.lower() not in candidate.lower() and len(candidate) < 24:
            return clean_text(f"{title} {candidate}")
        return candidate

    return title or f"Producto {sku}"


def clean_rendered_page_artifacts(image: Image.Image, source_page: int) -> None:
    if source_page == 18:
        draw = ImageDraw.Draw(image)
        # The PDF uses two unsupported icon glyphs before this subtitle; PyMuPDF
        # renders them as missing-character boxes, so cover just those boxes.
        scale_x = image.width / 1013
        scale_y = image.height / 1432
        box = (
            int(38 * scale_x),
            int(965 * scale_y),
            int(96 * scale_x),
            int(1045 * scale_y),
        )
        draw.rectangle(box, fill=(245, 245, 245))


def render_page(page: fitz.Page, destination: Path, source_page: int) -> dict:
    pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    clean_rendered_page_artifacts(image, source_page)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=88, optimize=True)
    return {
        "src": f"{destination.relative_to(WEB_DIR).as_posix()}?v={ASSET_VERSION}",
        "width": pix.width,
        "height": pix.height,
    }


def replace_version_references(version: str) -> None:
    index_path = WEB_DIR / "index.html"
    index_text = index_path.read_text(encoding="utf-8")
    index_text = re.sub(r"((?:styles|app)\.css\?v=)[^\"<]+", rf"\g<1>{version}", index_text)
    index_text = re.sub(r"((?:app|supabase-client)\.js\?v=)[^\"<]+", rf"\g<1>{version}", index_text)
    index_text = re.sub(r"(data/catalog-data\.js\?v=)[^\"<]+", rf"\g<1>{version}", index_text)
    index_path.write_text(index_text, encoding="utf-8")

    worker_path = WEB_DIR / "service-worker.js"
    worker_text = worker_path.read_text(encoding="utf-8")
    worker_text = re.sub(r'lexo-catalog-v[^"]+', f"lexo-catalog-v{version}", worker_text)
    worker_text = re.sub(r"(\./(?:styles|app)\.css\?v=)[^\"']+", rf"\g<1>{version}", worker_text)
    worker_text = re.sub(r"(\./app\.js\?v=)[^\"']+", rf"\g<1>{version}", worker_text)
    worker_text = re.sub(r"(\./supabase-client\.js\?v=)[^\"']+", rf"\g<1>{version}", worker_text)
    worker_text = re.sub(r"(\./data/catalog-data\.js\?v=)[^\"']+", rf"\g<1>{version}", worker_text)
    worker_path.write_text(worker_text, encoding="utf-8")

    for updater in [ROOT / "tools" / "update_lexo_redesign.py", ROOT / "tools" / "update_estia_catalog.py"]:
        if not updater.exists():
            continue
        text = updater.read_text(encoding="utf-8")
        text = re.sub(r'(?m)^ASSET_VERSION = "[^"]+"', f'ASSET_VERSION = "{version}"', text)
        updater.write_text(text, encoding="utf-8")


def build_prepara_pages(start_page: int) -> tuple[list[dict], list[dict]]:
    if not PDF_PATH.exists():
        raise FileNotFoundError(PDF_PATH)
    price_list = load_price_list()
    valid_skus = set(price_list) | set(EXTRA_SKUS)
    doc = fitz.open(PDF_PATH)
    pages = []
    products = []

    for page_index in range(doc.page_count):
        source_page = page_index + 1
        app_page = start_page + page_index
        page = doc[page_index]
        lines = lines_for_page(page)
        title = title_for_page(page, lines)
        image = render_page(page, PAGE_DIR / f"prepara-20260716-page-{source_page:03d}.jpg", source_page)
        prices = price_words_for_page(page)
        page_products = []
        price_groups = []
        seen = set()

        for word in page.get_text("words"):
            raw = word_text(word)
            if not SKU_RE.fullmatch(raw.strip(".,;:()[]{}")):
                continue
            sku = normalize_sku(raw)
            if sku not in valid_skus or (sku, round(word[0], 2), round(word[1], 2)) in seen:
                continue
            seen.add((sku, round(word[0], 2), round(word[1], 2)))
            price = same_line_price(lines, word, prices) or nearest_printed_price(word, prices)
            price_data = price_list.get(sku) or EXTRA_SKUS.get(sku, {})
            product_id = f"prepara-p{app_page:03d}-{len(page_products) + 1}"
            product = {
                "id": product_id,
                "page": app_page,
                "sku": sku,
                "skus": [sku],
                "name": contextual_name(page, lines, word, title, price_data),
                "category": title,
                "price": (price or {}).get("text", price_data.get("price", "")),
                "pdfPrice": (price or {}).get("text", ""),
                "priceSource": "pdf",
                "ean": price_data.get("ean", ""),
                "unitsPerCase": price_data.get("unitsPerCase"),
                "sizeLabel": "",
                "hotspot": normalized_hotspot(page, word),
                "hotspotStyle": {"borderColor": "rgba(88, 133, 57, 0.58)"},
                "pricePosition": normalized_price_position(page, price, word),
                "section": BRAND,
            }
            page_products.append(product)

            if price:
                price_groups.append(
                    {
                        "id": f"prepara-pg{app_page:03d}-{len(price_groups) + 1}",
                        "page": app_page,
                        "label": product["name"],
                        "price": product["price"],
                        "productIds": [product_id],
                        "position": dict(product["pricePosition"]),
                        "cover": price_cover(page, price),
                        "positionSource": "prepara-20260716-pdf",
                        "variant": "pdf-medium",
                        "style": price_style(price),
                        "pdfPriceHeight": round(price["h"], 3),
                        "pdfPriceColor": price["color"],
                    }
                )

        pages.append(
            {
                "number": app_page,
                "title": title,
                "section": BRAND,
                "showPriceOverlays": bool(page_products),
                "image": image,
                "products": [product["id"] for product in page_products],
                "priceGroups": price_groups,
            }
        )
        products.extend(page_products)

    return pages, products


def main() -> None:
    catalog = read_catalog()
    catalog["pages"] = [page for page in catalog["pages"] if page.get("section") != BRAND]
    catalog["products"] = [product for product in catalog["products"] if product.get("section") != BRAND]

    start_page = len(catalog["pages"]) + 1
    pages, products = build_prepara_pages(start_page)
    catalog["pages"].extend(pages)
    catalog["products"].extend(products)
    catalog.setdefault("sources", {})[BRAND] = str(PDF_PATH)
    catalog.setdefault("sourcePageCounts", {})[BRAND] = len(pages)
    catalog["totalPagesInPdf"] = len(catalog["pages"])
    catalog["samplePageCount"] = len(catalog["pages"])
    catalog["assetVersion"] = ASSET_VERSION

    page_numbers = [page["number"] for page in catalog["pages"]]
    if page_numbers != list(range(1, len(catalog["pages"]) + 1)):
        raise ValueError("Catalog pages are not contiguous")

    product_ids = {product["id"] for product in catalog["products"]}
    missing_refs = [
        product_id
        for page in catalog["pages"]
        for product_id in page.get("products", [])
        if product_id not in product_ids
    ]
    if missing_refs:
        raise ValueError(f"Missing product ids in pages: {missing_refs[:20]}")

    write_catalog(catalog)
    replace_version_references(ASSET_VERSION)
    print(f"Added {len(pages)} Prepara pages and {len(products)} product placements")
    print(f"Catalog now has {len(catalog['pages'])} pages and {len(catalog['products'])} products")
    print("Prepara SKUs:", ", ".join(product["sku"] for product in products))


if __name__ == "__main__":
    main()
