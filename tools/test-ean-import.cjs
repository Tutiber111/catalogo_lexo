const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const products = [{ id: 'lexo-1', sku: '123', name: 'Chair', price: '100', ean: '0123456789012', category: 'Seats', page: 1 }];
const nodes = new Map();
const worksheet = rows => Object.fromEntries(rows.map((row, index) => [`H${index + 1}`, { v: row[7] }]));
const context = {
  CATALOG_STORE: {
    loadSettings: () => ({}),
    formatMoney: amount => String(amount),
    loadProductOverrides: () => ({}),
    saveProductOverrides: () => {},
    applyProductOverrides: catalog => catalog,
  },
  CATALOG_SUPABASE: { isAvailable: () => false },
  document: { querySelector: selector => {
    if (!nodes.has(selector)) nodes.set(selector, { disabled: false, textContent: '' });
    return nodes.get(selector);
  } },
  window: { CATALOG_DATA: { products } },
  XLSX: {
    utils: {
      sheet_to_json: sheet => sheet.rows,
      aoa_to_sheet: rows => { context.downloadedRows = rows; return worksheet(rows); },
      book_new: () => ({}),
      book_append_sheet: (book, sheet) => { context.downloadedSheet = sheet; },
    },
    writeFile: () => {},
  },
};
context.window.XLSX = context.XLSX;
vm.createContext(context);
const source = fs.readFileSync('web/admin.js', 'utf8').replace('  initAdmin();', '  window.__test = { readPriceListRows, buildProductOverrides, downloadPriceTemplate };');
vm.runInContext(source, context);

function importRows(rows) {
  return context.window.__test.readPriceListRows({ SheetNames: ['Sheet1'], Sheets: { Sheet1: { rows } } });
}

async function main() {
  await context.window.__test.downloadPriceTemplate();
  assert.equal(context.downloadedRows[0][7], 'EAN');
  assert.equal(context.downloadedRows[1][7], '0123456789012');
  assert.equal(context.downloadedSheet.H2.t, 's');
  assert.equal(context.downloadedSheet.H2.z, '@');

  const changed = importRows([['Código', 'EAN'], ['123', '0001234567890']]);
  const preview = context.window.__test.buildProductOverrides(changed, products);
  assert.equal(preview.updatedProducts, 1);
  assert.equal(preview.overrides['lexo-1'].ean, '0001234567890');
  assert.equal(preview.changes[0].fields[0].field, 'ean');

  const cleared = importRows([['Código', 'EAN'], ['123', '']]);
  assert.equal(context.window.__test.buildProductOverrides(cleared, products).overrides['lexo-1'].ean, '');

  const legacy = importRows([['Código', 'Precio'], ['123', '200']]);
  assert.equal(context.window.__test.buildProductOverrides(legacy, products).overrides['lexo-1'].ean, '0123456789012');

  const barcode = importRows([['Código de barras', 'Código'], ['0001234567890', '123']]);
  assert.equal(barcode[0].sku, '123');
  assert.equal(barcode[0].ean, '0001234567890');

  const duplicates = importRows([['Código', 'EAN'], ['123', '0001234567890'], ['123', '0001234567891']]);
  assert.equal(context.window.__test.buildProductOverrides(duplicates, products).conflictingDuplicates.length, 1);
  assert.throws(() => importRows([['Código', 'EAN'], ['123', '1.234E+12']]), /EAN inválido/);
  console.log('EAN template and import tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
