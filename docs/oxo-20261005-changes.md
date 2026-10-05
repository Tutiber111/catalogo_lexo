# OXO catalog update - 5 October 2026

Status: applied to the local Catalogo Lexo project. Not deployed or pushed.

Source: the user-supplied `Catálogo OXO nuevo 2026.pdf` (133 pages). Its catalog content was treated as data, not as instructions.

## Complete change summary

- Replace all 127 previous OXO page images with the 133 pages in the supplied PDF, in source order. OXO now occupies site pages 244-376. The following Prepara pages shift by six; their content is unchanged.
- Replace the active OXO product set: 225 to 243 unique orderable SKUs; 239 to 257 placements, including repeated POP reference-chart placements.
- Add the 24 codes below, remove the six absent codes below, and update 41 retained-SKU prices. Keep the two user-corrected prices below. The six apparent replacements are not automatic cart substitutions.
- Rebuild all OXO SKU hotspots, page/product references, price-group links, price positions, page titles and category labels from the supplied layout.
- Preserve existing product IDs only for the same SKU. Preserve retained-SKU barcode, case quantity, thumbnail and browse metadata. Add 24 reviewed product thumbnails and browse categories; remove metadata for retired IDs.
- Do not invent EAN barcodes or case quantities for the 24 new codes: the supplied PDF does not provide them. These fields are empty until verified data is supplied.
- Keep codes 11234200 and 11234300 visible only in the source reference material; neither has an orderable priced entry. Deduplicate codes repeated in body copy on PDF pages 71 and 100.
- Recognize the pepper mill price printed as `42.978` on PDF page 110 as `$42.978`. Remove the obsolete fixed mask on site page 347.
- Remove printed prices from page images and use the existing access-controlled live price overlays, including the price without a currency symbol.
- Remove retired OXO IDs from saved carts and branch selections when the new catalog loads. Keep existing order history and submitted/offline order records intact.
- Prevent pre-update saved name/category/price overrides from restoring stale OXO content. Retain stock, visibility and video overrides; newer admin edits still work. Timestamp newly created admin overrides.
- Update app, admin, catalog-store, catalog-data and browse-data URLs plus service-worker shell/page cache versions. Remove the 127 superseded page files. Existing tabs must load the new release before these changes take effect.
- Encode new page assets as optimized progressive JPEGs: 15.70 MB total versus 18.28 MB before (14.1% smaller, with six additional pages). The original 53.23 MB PDF is preserved; the site loads page images rather than that PDF.
- Preserve the other brands and existing unrelated local loading improvements.

## Apparent code replacements

These pairings are inferred from matching product types. Retired codes are removed; saved orders are not silently rewritten.

| Previous code | Current code | Product |
|---|---|---|
| 11295000 | 11295200 | Ice cream scoop without trigger |
| 11211000 | 11313700 | 12-piece silicone baking cup set |
| 70981 | 1114980 | Two-cup measuring jug |
| 70881 | 1115080 | One-cup measuring jug |
| 32480 | 11230400 | 5.9 L salad spinner |
| 11181400 | 11168300 | Digital thermometer |

## All newly listed codes

| Code | Product | PDF price | PDF page |
|---|---|---|---|
| 1056988 | Three-piece measuring jug set | $36.771 | 73 |
| 11111102 | Six-piece plastic measuring spoon set | $15.346 | 71 |
| 11137600 | Four-piece stainless steel measuring spoon set | $21.251 | 71 |
| 11140800 | Omelet turner | $16.461 | 75 |
| 1114880 | Four-cup measuring jug | $18.520 | 73 |
| 1114980 | Two-cup measuring jug | $16.000 | 73 |
| 1115080 | One-cup measuring jug | $13.720 | 73 |
| 11154200 | Covered ice tray, large cubes | $22.181 | 100 |
| 11154300 | Covered ice trays, small cubes | $28.737 | 100 |
| 11168300 | Digital thermometer | $29.367 | 104 |
| 11230400 | 5.9 L salad spinner | $46.454 | 102 |
| 11231700 | Box grater with removable container | $52.173 | 51 |
| 11235700 | Brown sugar saver | $9.626 | 18 |
| 11244200 | Citrus Y-peeler | $13.720 | 40 |
| 11244400 | Corn peeler | $13.720 | 45 |
| 11244500 | Large Y-peeler | $18.540 | 38 |
| 11282900 | Stainless steel potato masher | $20.408 | 59 |
| 11295200 | Ice cream scoop without trigger | $19.205 | 28 |
| 11313700 | 12-piece silicone baking cup set | $20.600 | 65 |
| 12246400 | Soap dispenser with sponge holder, silver | $34.317 | 121 |
| 12426800 | Soap dispenser with sponge holder, black | $34.317 | 121 |
| 13199900 | White plastic sink organizer | $22.971 | 114 |
| 13362600 | Four-piece multipurpose clip set | $16.461 | 113 |
| 3113600 | Wine stopper set | $20.600 | 94 |

## User-corrected prices

These final prices follow the user's instruction and differ from the PDF values.

| Code | Final price | PDF price |
|---|---|---|
| 1126980 | $23.539 | $25.539 |
| 11261400 | $11.227 | $10.889 |

## All retained-SKU price changes

Prices retain the source catalog’s thousands separator. Product names below are catalog labels.

| Code | Catalog label | Previous price | New price |
|---|---|---|---|
| 11303600 | Molinillo de café | $67.237 | $84.950 |
| 11235200 | Cuchara media taza para contenedor pop 2.0 | $7.617 | $8.231 |
| 11235500 | Cuchara para café para contenedor pop 2.0 | $6.342 | $6.836 |
| 11386000 | Bolsas de silicona 13*17 cm - 355 ml | $16.579 | $22.181 |
| 11386200 | Bolsas de silicona 18,5*30 cm - 1.890 ml | $31.883 | $35.712 |
| 11386100 | Bolsas de silicona 15*24 cm - 945 ml | $24.302 | $30.225 |
| 11388100 | Bolsas de silicona azul 13*17 cm - 355 ml | $22.180 | $22.181 |
| 11388200 | Bolsas de silicona roja 13*17 cm - 355 ml | $22.180 | $22.181 |
| 11283300 | Espátula de acero inoxidable | $15.304 | $16.579 |
| 65191 | Espátula flexible de nylon chica | $12.788 | $16.461 |
| 11314700 | Abrelatas con traba | $27.632 | $30.225 |
| 11300900 | Corta pizza con rueda de acero | $15.304 | $20.600 |
| 1072121 | Tijera de cocina y hierbas | $23.500 | $30.225 |
| 11259100 | Cortador para juliana | $10.889 | $15.980 |
| 11258900 | Pelapapas Y | $10.889 | $15.980 |
| 11155800 | Exprimidor de cítricos | $15.304 | $20.600 |
| 1119100 | Mandolina | $24.302 | $30.225 |
| 11339900 | Picador rotativo | $31.186 | $34.317 |
| 11122600 | Cortador de frutas y vegetales con depósito | $32.753 | $39.618 |
| 11216100 | Rallador grueso | $19.895 | $20.600 |
| 11215400 | Rallador para quesos, cítricos, chocolates y más | $16.876 | $17.856 |
| 11215900 | Rallador medium para zanahorias, quesos duros, chocolates, zucchini | $19.895 | $20.600 |
| 1071478 | Pasatuto | $76.219 | $89.950 |
| 74291 | Batidor de acero 28 cm | $18.364 | $19.205 |
| 1101880 | Pinza de silicona 23 cm. | $20.369 | $24.738 |
| 1101980 | Pinza de silicona 30 cm. | $21.751 | $27.482 |
| 11318200 | Guante para horno rojo | $24.941 | $27.482 |
| 11219800 | Guante para horno negro | $24.941 | $27.482 |
| 11318400 | Guante para horno avena | $24.941 | $27.482 |
| 11245400 | Sacacorchos con alas | $26.101 | $29.574 |
| 11136400 | Tapon y antigoteo de vino | $15.304 | $22.181 |
| 13245000 | Portarrollos de acero inoxidable | $33.710 | $38.456 |
| 13192100 | Organizador de bacha de acero inoxidable | $29.367 | $37.061 |
| 13259500 | Filtro y tapón para bacha de silicona | $15.304 | $19.205 |
| 1395500 | Filtro para bañera | $10.159 | $12.369 |
| 13273700 | Dispenser de jabón de acero inoxidable | $30.024 | $38.456 |
| 12361600 | Cepillo p/limpiar platos con dispenser | $14.063 | $17.856 |
| 12361500 | Set x2 esponjas de repuesto para 12361600 | $8.856 | $9.626 |
| 12361700 | Cepillo p/limpiar platos con dispenser | $15.304 | $19.205 |
| 1334280 | Set compacto de cepillo de mesa con recogedor de migas | $12.788 | $16.461 |
| 12246100 | Limpia notebooks | $15.304 | $20.600 |

## Verification and limits

- 32 automated checks passed, covering exact SKU membership, retired codes, valid images/references, price groups, hotspots, stale overrides, cart cleanup, browsing, access-sensitive price display, cache loading and existing admin/tour behavior.
- Compared every non-OXO page and product with the pre-update snapshot: unchanged apart from the necessary page-number shift. Verified no existing product ID was assigned to another SKU.
- Visually reviewed all 24 new thumbnails against their source pages and checked representative price overlays with the actual site rendering function in an isolated local preview.
- The normal local site requires sign-in. A full authenticated browser order flow and live deployment verification remain untested; no real orders were submitted.
- This is a local update. Existing production pages and already-open/offline clients will not change until publication and reload.

The adjacent `oxo-20261005-changes.json` contains the full SKU inventory, source SHA-256, removed asset list, thumbnail crop coordinates, and every changed field for retained OXO placements.
