from __future__ import annotations

import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog_sample import load_price_list  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
PAGE_DIR = WEB_DIR / "assets" / "pages"
DATA_JSON = WEB_DIR / "data" / "catalog.json"
DATA_JS = WEB_DIR / "data" / "catalog-data.js"
DOWNLOADS = Path.home() / "Downloads"

ASSET_VERSION = "20260716-prepara"
PDF_PATTERN = "Cat*logo Lexo.pdf"
ESTIA_START_PAGE = 24
RENDER_SCALE = 1.7

PRICE_RE = re.compile(r"^\$[\d.]+(?:,\d+)?$")
SKU_RE = re.compile(r"^\d{4,6}$")


def placement_sku(source_page: int, page: fitz.Page, word: tuple, printed_sku: str) -> str:
    if source_page == 25 and printed_sku == "23614":
        return "14537"
    if source_page == 32 and printed_sku == "21887" and (word[0] + word[2]) / 2 > page.rect.width / 2:
        return "21832"
    return printed_sku


def patch_known_page_artifacts(image: Image.Image, source_page: int) -> None:
    if source_page == 25:
        draw = ImageDraw.Draw(image)
        box = (
            round(image.width * 0.439),
            round(image.height * 0.272),
            round(image.width * 0.562),
            round(image.height * 0.302),
        )
        draw.rectangle(box, fill=(245, 245, 245))
        font_path = Path(r"C:\Windows\Fonts\arialbd.ttf")
        font = ImageFont.truetype(str(font_path), max(26, round(image.width * 0.0395)))
        draw.text(
            ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
            "14537",
            fill=(112, 114, 90),
            font=font,
            anchor="mm",
        )
        return

    if source_page != 32:
        return

    draw = ImageDraw.Draw(image)
    box = (
        round(image.width * 0.642),
        round(image.height * 0.628),
        round(image.width * 0.738),
        round(image.height * 0.657),
    )
    draw.rectangle(box, fill=(245, 245, 245))
    font_path = Path(r"C:\Windows\Fonts\arialbd.ttf")
    font = ImageFont.truetype(str(font_path), max(20, round(image.width * 0.0305)))
    draw.text(
        ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
        "21832",
        fill=(112, 114, 90),
        font=font,
        anchor="mm",
    )


@dataclass
class TextLine:
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


def read_catalog() -> dict:
    text = DATA_JSON.read_text(encoding="utf-8")
    return json.loads(text)


def write_catalog(catalog: dict) -> None:
    json_text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    DATA_JSON.write_text(json_text, encoding="utf-8")
    DATA_JS.write_text(f"window.CATALOG_DATA = {json_text.rstrip()};\n", encoding="utf-8")


def find_pdf() -> Path:
    matches = sorted(DOWNLOADS.glob(PDF_PATTERN), key=lambda item: item.stat().st_mtime, reverse=True)
    if not matches:
        raise FileNotFoundError(f"Could not find {PDF_PATTERN} in {DOWNLOADS}")
    return matches[0]


def clean_text(value: str) -> str:
    return " ".join(str(value).replace("\n", " ").split()).strip()


def normalize_sku(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return clean_text(str(value)).strip(".,;:()[]{}")


def word_text(word: tuple) -> str:
    return str(word[4]).strip()


def format_price(value) -> str:
    if not isinstance(value, (int, float)):
        return ""
    return "$" + f"{int(round(value)):,}".replace(",", ".")


def lines_for_page(page: fitz.Page) -> list[TextLine]:
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
            TextLine(
                words=words,
                text=text,
                x0=min(word[0] for word in words),
                y0=min(word[1] for word in words),
                x1=max(word[2] for word in words),
                y1=max(word[3] for word in words),
            )
        )
    return sorted(lines, key=lambda line: (line.y0, line.x0))


def title_for_page(page: fitz.Page, lines: list[TextLine]) -> str:
    candidates = []
    max_y = page.rect.height * 0.28
    for line in lines:
        if line.y0 > max_y or PRICE_RE.search(line.text):
            continue
        if not any(ch.isalpha() for ch in line.text):
            continue
        if SKU_RE.fullmatch(line.text.strip()):
            continue
        score = (line.height, -line.y0, len(line.text))
        candidates.append((score, line.text))
    if not candidates:
        return "Catalog"
    return max(candidates, key=lambda item: item[0])[1]


def token_set(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if token not in {"de", "del", "la", "el", "y", "con", "para", "x"}
    }


def line_for_word(lines: list[TextLine], word: tuple) -> TextLine | None:
    for line in lines:
        if word in line.words:
            return line
    return None


def line_without_codes(line: TextLine) -> str:
    parts = []
    for word in line.words:
        text = word_text(word).strip()
        if PRICE_RE.fullmatch(text) or SKU_RE.fullmatch(text) or text == "/":
            continue
        parts.append(text)
    return clean_text(" ".join(parts))


def pdf_name_for_sku(page: fitz.Page, lines: list[TextLine], sku_word: tuple, category: str) -> str:
    sku_line = line_for_word(lines, sku_word)
    pieces = []
    sx = (sku_word[0] + sku_word[2]) / 2
    sy = (sku_word[1] + sku_word[3]) / 2

    candidate_lines = []
    for line in lines:
        if line.cy >= sy:
            continue
        if line.y0 < page.rect.height * 0.06:
            continue
        if PRICE_RE.search(line.text) or SKU_RE.fullmatch(line.text):
            continue
        has_alpha = any(ch.isalpha() for ch in line.text)
        has_size = bool(re.search(r"\d+\s*(cm|ml|litro|litros|kgs?)\b", line.text, re.I))
        if not has_alpha and not has_size:
            continue
        y_distance = sy - line.cy
        x_distance = abs(sx - line.cx)
        overlaps = line.x0 - 35 <= sx <= line.x1 + 35
        if y_distance <= 140 and (overlaps or x_distance <= 190):
            candidate_lines.append((line.y0, line.text))

    if candidate_lines:
        for _, text in sorted(candidate_lines)[-3:]:
            if text not in pieces:
                pieces.append(text)

    if sku_line:
        same_line = line_without_codes(sku_line)
        if same_line and same_line not in pieces:
            pieces.append(same_line)

    name = clean_text(" ".join(pieces))
    if not name:
        name = category
    if category and category.lower() not in name.lower() and len(name) < 28:
        name = clean_text(f"{category} {name}")
    return name


def choose_name(pdf_name: str, price_description: str, old_name: str = "") -> str:
    if old_name:
        return old_name
    if not price_description:
        return pdf_name
    pdf_tokens = token_set(pdf_name)
    price_tokens = token_set(price_description)
    overlap = len(pdf_tokens & price_tokens)
    if len(pdf_tokens) <= 2 or overlap >= 2:
        return price_description
    if overlap == 1 and any(token for token in pdf_tokens & price_tokens if any(ch.isdigit() for ch in token)):
        return price_description
    return pdf_name


def price_color_map(page: fitz.Page) -> dict[tuple[str, int], dict]:
    result: dict[tuple[str, int], dict] = {}
    counters: dict[str, int] = {}
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = clean_text(span.get("text", ""))
                if not PRICE_RE.fullmatch(text):
                    continue
                index = counters.get(text, 0)
                counters[text] = index + 1
                color = f"#{int(span.get('color', 0)):06x}"
                result[(text, index)] = {
                    "color": color,
                    "fontSize": round(float(span.get("size", 14)), 3),
                }
    return result


def price_words_for_page(page: fitz.Page) -> list[dict]:
    colors = price_color_map(page)
    counters: dict[str, int] = {}
    prices = []
    for word in page.get_text("words"):
        text = word_text(word)
        if not PRICE_RE.fullmatch(text):
            continue
        index = counters.get(text, 0)
        counters[text] = index + 1
        style = colors.get((text, index), {"color": "#70725a", "fontSize": word[3] - word[1]})
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


def nearest_price(sku_word: tuple, prices: list[dict]) -> dict | None:
    if not prices:
        return None
    sx = (sku_word[0] + sku_word[2]) / 2
    sy = (sku_word[1] + sku_word[3]) / 2
    candidates = []
    for price in prices:
        y_distance = abs(price["y"] - sy)
        x_distance = abs(price["x"] - sx)
        if y_distance <= 115 and (x_distance <= 185 or y_distance <= 72):
            candidates.append((y_distance * 1.5 + x_distance * 0.2, price))
    if candidates:
        return min(candidates, key=lambda item: item[0])[1]
    if len(prices) == 1:
        return prices[0]
    fallback = min(prices, key=lambda price: abs(price["y"] - sy) + abs(price["x"] - sx) * 0.2)
    if abs(fallback["y"] - sy) <= 240:
        return fallback
    return None


def normalized_hotspot(page: fitz.Page, word: tuple) -> dict[str, float]:
    pad_x = 5
    pad_y = 4
    x = max(0, word[0] - pad_x) / page.rect.width
    y = max(0, word[1] - pad_y) / page.rect.height
    w = (word[2] - word[0] + pad_x * 2) / page.rect.width
    h = (word[3] - word[1] + pad_y * 2) / page.rect.height
    return {
        "x": round(x, 7),
        "y": round(y, 7),
        "w": round(min(w, 0.99 - x), 7),
        "h": round(min(h, 0.99 - y), 7),
    }


def normalized_price_position(page: fitz.Page, price: dict | None, sku_word: tuple) -> dict[str, float]:
    if price:
        return {
            "x": round(price["x"] / page.rect.width, 7),
            "y": round(price["y"] / page.rect.height, 7),
        }
    return {
        "x": round(((sku_word[0] + sku_word[2]) / 2) / page.rect.width, 7),
        "y": round(min(0.94, (sku_word[3] + 7) / page.rect.height), 7),
    }


def price_group_style(price: dict | None) -> dict:
    font_size = 14 if price is None else max(11, min(15, round(price["fontSize"] * 0.62)))
    return {
        "fontSize": font_size,
        "minWidth": 38,
        "minHeight": 15,
        "padX": 1,
        "padY": 0,
        "radius": 1,
        "shadow": "none",
        "color": (price or {}).get("color", "#70725a"),
        "background": "#f5f5f5",
    }


def price_cover(page: fitz.Page, price: dict | None) -> dict[str, float]:
    if not price:
        return {"w": 0.09, "h": 0.024}
    return {
        "w": round((price["w"] + 8) / page.rect.width, 7),
        "h": round((price["h"] + 4) / page.rect.height, 7),
    }


def render_page(page: fitz.Page, destination: Path, source_page: int) -> dict[str, int | str]:
    pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    patch_known_page_artifacts(image, source_page)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=88, optimize=True)
    return {
        "src": f"{destination.relative_to(WEB_DIR).as_posix()}?v={ASSET_VERSION}",
        "width": pix.width,
        "height": pix.height,
    }


def build_estia(pdf: Path, old_estia_products: list[dict], app_start: int) -> tuple[list[dict], list[dict], set[str]]:
    price_list = load_price_list()
    valid_skus = set(price_list)
    old_by_sku = {}
    old_skus = set()
    for product in old_estia_products:
        sku = normalize_sku(product.get("sku"))
        if sku:
            old_skus.add(sku)
            old_by_sku.setdefault(sku, product)

    doc = fitz.open(pdf)
    pages: list[dict] = []
    products: list[dict] = []
    found_skus: set[str] = set()

    for source_index in range(doc.page_count):
        source_page_number = source_index + 1
        app_page = app_start + source_index
        page = doc[source_index]
        lines = lines_for_page(page)
        category = title_for_page(page, lines)
        image = render_page(page, PAGE_DIR / f"estia-20260707-page-{source_page_number:03d}.jpg", source_page_number)
        prices = price_words_for_page(page)
        page_products = []
        price_assignments: dict[int, list[dict]] = {}
        seen_word_keys = set()

        for word in page.get_text("words"):
            printed_sku = normalize_sku(word_text(word))
            sku = placement_sku(source_page_number, page, word, printed_sku)
            if not SKU_RE.fullmatch(sku) or sku not in valid_skus:
                continue
            word_key = (round(word[0], 3), round(word[1], 3), sku)
            if word_key in seen_word_keys:
                continue
            seen_word_keys.add(word_key)

            found_skus.add(sku)
            price = nearest_price(word, prices)
            price_data = price_list.get(sku, {})
            old_product = old_by_sku.get(sku, {})
            pdf_name = pdf_name_for_sku(page, lines, word, category)
            product_id = f"estia-p{app_page:03d}-{len(page_products) + 1}"
            product_price = price_data.get("price") or (price or {}).get("text", "")
            product = {
                "id": product_id,
                "page": app_page,
                "sku": sku,
                "skus": [sku],
                "name": choose_name(pdf_name, price_data.get("description", ""), old_product.get("name", "")),
                "category": category,
                "price": product_price,
                "pdfPrice": (price or {}).get("text", ""),
                "priceSource": "excel" if price_data.get("price") else "pdf",
                "ean": price_data.get("ean") or old_product.get("ean", ""),
                "unitsPerCase": price_data.get("unitsPerCase") or old_product.get("unitsPerCase"),
                "sizeLabel": old_product.get("sizeLabel", ""),
                "hotspot": normalized_hotspot(page, word),
                "hotspotStyle": {"borderColor": "rgba(112, 114, 90, 0.55)"},
                "pricePosition": normalized_price_position(page, price, word),
                "section": "Estia",
            }
            if old_product.get("outOfStock"):
                product["outOfStock"] = True
            page_products.append(product)
            if price:
                price_assignments.setdefault(price["index"], []).append(product)

        price_groups = []
        for price_index, assigned in sorted(price_assignments.items(), key=lambda item: item[0]):
            price = prices[price_index]
            display_price = assigned[0]["price"] or price["text"]
            label = assigned[0]["name"] if len(assigned) == 1 else category
            price_groups.append(
                {
                    "id": f"estia-pg{app_page:03d}-{len(price_groups) + 1}",
                    "page": app_page,
                    "label": label,
                    "price": display_price,
                    "productIds": [product["id"] for product in assigned],
                    "position": normalized_price_position(page, price, assigned[0]["hotspot"]),
                    "cover": price_cover(page, price),
                    "positionSource": "estia-20260707-pdf",
                    "variant": "pdf-regular" if price["fontSize"] >= 18 else "pdf-medium",
                    "style": price_group_style(price),
                    "pdfPriceHeight": round(price["h"], 3),
                    "pdfPriceColor": price["color"],
                }
            )
            for product in assigned:
                product["pricePosition"] = dict(price_groups[-1]["position"])

        page_entry = {
            "number": app_page,
            "title": category,
            "section": "Estia",
            "showPriceOverlays": bool(page_products),
            "image": image,
            "products": [product["id"] for product in page_products],
            "priceGroups": price_groups,
        }
        pages.append(page_entry)
        products.extend(page_products)

    missing_old = old_skus - found_skus
    return pages, products, missing_old


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

    lexo_updater = ROOT / "tools" / "update_lexo_redesign.py"
    lexo_text = lexo_updater.read_text(encoding="utf-8")
    lexo_text = re.sub(r'(?m)^ASSET_VERSION = "[^"]+"', f'ASSET_VERSION = "{version}"', lexo_text)
    lexo_updater.write_text(lexo_text, encoding="utf-8")


def main() -> None:
    pdf = find_pdf()
    catalog = read_catalog()
    old_pages = catalog["pages"]
    old_estia_pages = [page for page in old_pages if page.get("section") == "Estia"]
    old_estia_numbers = {page["number"] for page in old_estia_pages}
    if not old_estia_pages:
        raise ValueError("No existing Estia pages found")

    old_estia_products = [product for product in catalog["products"] if product.get("section") == "Estia"]
    estia_pages, estia_products, missing_old = build_estia(pdf, old_estia_products, ESTIA_START_PAGE)

    old_estia_count = len(old_estia_pages)
    delta = len(estia_pages) - old_estia_count
    old_estia_last = max(old_estia_numbers)

    new_pages = []
    for page in old_pages:
        section = page.get("section")
        if section == "Estia":
            continue
        if page["number"] > old_estia_last:
            page = json.loads(json.dumps(page))
            page["number"] += delta
            for group in page.get("priceGroups", []):
                group["page"] += delta
            new_pages.append(page)
        else:
            new_pages.append(page)
    new_pages = [page for page in new_pages if page["number"] < ESTIA_START_PAGE] + estia_pages + [
        page for page in new_pages if page["number"] >= ESTIA_START_PAGE
    ]

    new_products = []
    for product in catalog["products"]:
        if product.get("section") == "Estia":
            continue
        product = json.loads(json.dumps(product))
        if product.get("page", 0) > old_estia_last:
            product["page"] += delta
        new_products.append(product)
    new_products.extend(estia_products)

    catalog["pages"] = sorted(new_pages, key=lambda page: page["number"])
    catalog["products"] = new_products
    catalog["source"] = str(pdf)
    catalog.setdefault("sources", {})["Estia"] = str(pdf)
    catalog.setdefault("sourcePageCounts", {})["Estia"] = len(estia_pages)
    catalog["totalPagesInPdf"] = len(catalog["pages"])
    catalog["samplePageCount"] = len(catalog["pages"])
    catalog["assetVersion"] = ASSET_VERSION

    page_numbers = [page["number"] for page in catalog["pages"]]
    expected_numbers = list(range(1, len(catalog["pages"]) + 1))
    if page_numbers != expected_numbers:
        raise ValueError(f"Catalog page numbers are not contiguous: {page_numbers[:80]}")

    product_ids = {product["id"] for product in catalog["products"]}
    missing_refs = [
        product_id
        for page in catalog["pages"]
        for product_id in page.get("products", [])
        if product_id not in product_ids
    ]
    if missing_refs:
        raise ValueError(f"Pages reference missing product ids: {missing_refs[:20]}")

    write_catalog(catalog)
    replace_version_references(ASSET_VERSION)

    print(f"Updated Estia from {pdf}")
    print(f"Replaced {old_estia_count} Estia pages with {len(estia_pages)} pages")
    print(f"Added {len(estia_products)} Estia product placements")
    if missing_old:
        print("Missing previous Estia SKUs:")
        print(", ".join(sorted(missing_old)))
    else:
        print("No previous Estia SKUs are missing")


if __name__ == "__main__":
    main()
