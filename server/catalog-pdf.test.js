import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogPdf, catalogImageUrl, catalogPdfImageUrl } from '../src/catalog.ts';

const row = (code, description, line, price = 10) => ({ code, description, line, category: 'HOGAR', type: 'DECORACION', price, priceAvailable: true, stockTotal: 0, warehouseStocks: {} });

test('catalog images only resolve numeric codes', () => {
  assert.equal(catalogImageUrl('41'), 'https://assets.distribuidor-puntopas.com/PRODUCTOS_ESMERALDAS2/00000041_E.png');
  assert.equal(catalogImageUrl('00000166'), 'https://assets.distribuidor-puntopas.com/PRODUCTOS_ESMERALDAS2/00000166_E.png');
  assert.equal(catalogImageUrl('PAS054'), null);
  assert.equal(catalogImageUrl(''), null);
  assert.equal(catalogPdfImageUrl('41'), '/api/catalog-image?file=00000041_E.png');
  assert.equal(catalogPdfImageUrl('PAS054'), null);
});

test('catalog pdf keeps code, description and price grouped by line', async () => {
  const { doc, fileName } = await buildCatalogPdf(
    [row('00000166', 'RELOJ DE MESA', 'HOGAR', 23), row('00000200', 'TALADRO', 'FERRETERIA', 45.5)],
    { branch: 'ALMACEN PAS', grouping: 'line', filterLabel: 'Línea: TODAS' },
  );

  assert.equal(fileName, 'catalogo-almacen-pas-por-linea.pdf');
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const raw = bytes.toString('latin1');
  assert.match(raw, /PUNTO PAS/);
  assert.match(raw, /CATALOGO DE PRODUCTOS/);
  assert.match(raw, /ALMACEN PAS/);
  assert.match(raw, /00000166/);
  assert.match(raw, /RELOJ DE MESA/);
  assert.ok(doc.getNumberOfPages() >= 1);
});

test('catalog pdf repeats the header on every page', async () => {
  const rows = Array.from({ length: 220 }, (_value, index) => row(String(index + 1).padStart(8, '0'), `PRODUCTO ${index + 1}`, 'HOGAR', index + 1));
  const { doc } = await buildCatalogPdf(rows, { branch: 'ALMACEN PAS', grouping: 'none', filterLabel: '' });
  const pages = doc.getNumberOfPages();
  assert.ok(pages > 1, `expected multiple pages, got ${pages}`);
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.equal((raw.match(/PUNTO PAS/g) ?? []).length, pages + 1);
  assert.equal((raw.match(/PRODUCTO 220/g) ?? []).length, 1);
});

test('visual catalog builds a cover and a product grid respecting the limit', async () => {
  const rows = Array.from({ length: 12 }, (_value, index) => row(String(index + 1).padStart(8, '0'), `PRODUCTO ${index + 1}`, index < 6 ? 'HOGAR' : 'FERRETERIA', index + 1));
  const { doc, fileName } = await buildCatalogPdf(rows, {
    branch: 'ALMACEN PAS',
    grouping: 'line',
    filterLabel: 'Línea: TODAS',
    mode: 'visual',
    includeImages: false,
    limit: 8,
    totalRows: 12,
  });

  assert.equal(fileName, 'catalogo-visual-almacen-pas-por-linea.pdf');
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const raw = bytes.toString('latin1');
  assert.match(raw, /DE PRODUCTOS/);
  assert.match(raw, /Muestra de 8 de 12 productos/);
  assert.match(raw, /SIN IMAGEN/);
  assert.match(raw, /PRODUCTO 8/);
  assert.equal((raw.match(/PRODUCTO 9/g) ?? []).length, 0);
  assert.ok(doc.getNumberOfPages() >= 2, 'the cover and product grid need at least two pages');
});
