import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRow as buildLocalRow } from './analytics.ts';
import { buildDashboard as buildVercelDashboard } from '../api/_core.js';

// "Precio Actual" must use the levels returned by reporteinventario:
// PUNTO PAS + 15%, then PVP + 15%, and only then the catalog price.
const product = (overrides = {}) => ({
  missingFields: [], id: 'ALMACEN PAS-0001', branch: 'ALMACEN PAS', code: '0001',
  description: 'Producto', brand: 'Marca', line: 'Linea', category: 'Categoria', type: 'Tipo', provider: 'Proveedor',
  cost: 2, costWithIva: 2.3, price: 10, salePrice: 0, pricePuntoPas: 0, pricePvp: null,
  stock: 5, stockTotal: 5, warehouseStocks: {}, lastPurchase: '', saleDate: '', lastPurchaseQuantity: 0,
  monthlySales: [], hourlySales: [], ...overrides,
});

const params = {
  branch: 'ALMACEN PAS', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS',
  line: 'TODAS', type: 'TODOS', productCode: 'TODOS', dateStart: '2026-11-20', dateEnd: '2026-11-20',
};

const localCurrentPrice = (levels) => buildLocalRow(product(levels), 1).currentPriceWithIva;
const vercelCurrentPrice = (levels) => buildVercelDashboard([product(levels)], params).rows[0].currentPriceWithIva;
const assertPrice = (value, expected, message) => assert.ok(Math.abs(value - expected) < 1e-9, `${message}: ${value} !== ${expected}`);

for (const [backend, currentPrice] of [['local', localCurrentPrice], ['vercel', vercelCurrentPrice]]) {
  test(`${backend}: Precio Actual adds 15% to PUNTO PAS when both levels exist`, () => {
    assertPrice(currentPrice({ pricePuntoPas: 20, pricePvp: 25 }), 20 * 1.15, 'PUNTO PAS base');
  });

  test(`${backend}: Precio Actual adds 15% to PVP when PUNTO PAS is missing`, () => {
    assertPrice(currentPrice({ pricePuntoPas: 0, pricePvp: 25 }), 25 * 1.15, 'PVP base');
  });

  test(`${backend}: Precio Actual keeps the catalog fallback without price levels`, () => {
    assertPrice(currentPrice({ pricePuntoPas: 0, pricePvp: null }), 10 * 1.15, 'catalog base');
  });
}
