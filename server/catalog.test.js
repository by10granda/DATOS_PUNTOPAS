import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboard as buildLocal, compactCatalog as catalogLocal } from './analytics.ts';
import { buildDashboard as buildVercel, compactCatalog as catalogVercel } from '../api/_core.js';

const params = {
  branch: 'ALMACEN PAS', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS',
  line: 'TODAS', type: 'TODOS', productCode: 'TODOS', dateStart: '2026-11-25', dateEnd: '2026-11-25',
};

const product = (code, overrides = {}) => ({
  id: `ALMACEN PAS-${code}`, code, description: `Producto ${code}`, branch: 'ALMACEN PAS',
  brand: 'Marca', line: 'Linea', category: 'Categoria', type: 'Tipo', provider: 'Proveedor',
  cost: 2, costWithIva: 2.3, price: 4, salePrice: 4, pricePuntoPas: 10, pricePvp: 12,
  stock: 5, stockTotal: 5, warehouseStocks: { GENERAL: 5 },
  lastPurchase: '', saleDate: '', lastPurchaseQuantity: 0, missingFields: [],
  monthlySales: [], hourlySales: [], ...overrides,
});

const backends = [
  ['local', (products) => buildLocal(products, [], params), catalogLocal],
  ['vercel', (products) => buildVercel(products, params), catalogVercel],
];

for (const [backend, build, compact] of backends) {
  test(`${backend}: catalog exposes only code, description and price`, () => {
    const catalog = compact(build([
      product('00000002', { description: 'Zapato', line: 'CALZADO' }),
      product('00000001', { description: 'Alfombra', line: 'HOGAR' }),
    ]));

    assert.deepEqual(Object.keys(catalog.rows[0]).sort(), ['category', 'code', 'description', 'line', 'price', 'priceAvailable', 'type']);
    assert.deepEqual(catalog.rows.map((row) => row.code), ['00000001', '00000002']);
    assert.equal(catalog.rows[0].price, 11.5);
    assert.equal(catalog.rows[0].priceAvailable, true);
    assert.equal(catalog.lines.includes(''), false);
    assert.equal(catalog.branch, 'ALMACEN PAS');
    assert.ok(typeof catalog.generatedAt === 'string' && catalog.generatedAt.length > 0);
  });

  test(`${backend}: catalog flags a missing price instead of inventing one`, () => {
    const catalog = compact(build([product('00000003', { pricePuntoPas: 0, pricePvp: null, price: 0, missingFields: ['currentPriceWithIva'] })]));
    assert.equal(catalog.rows[0].priceAvailable, false);
    assert.equal(catalog.rows[0].price, 0);
  });

  test(`${backend}: catalog never leaks cost, stock or sales fields`, () => {
    const [row] = compact(build([product('00000004')])).rows;
    for (const key of ['cost', 'costWithIva', 'stock', 'stockTotal', 'warehouseStocks', 'salesXMonths', 'totalProfit', 'monthlySales']) {
      assert.equal(key in row, false, `${key} must not travel in the catalog`);
    }
  });
}
