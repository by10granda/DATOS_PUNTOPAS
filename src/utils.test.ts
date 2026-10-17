import assert from 'node:assert/strict';
import test from 'node:test';
import { productValue } from './utils';
import type { ProductRow } from './types';

test('missing product data displays NO HAY without hiding real zeros', () => {
  const row = {
    stockTotal: 0, salePrice: 0, pricePvp: null, brand: '', provider: 'SIN PROVEEDOR',
    description: 'Product', missingFields: ['salePrice', 'provider']
  } as ProductRow;
  assert.equal(productValue(row, 'stockTotal'), 0);
  assert.equal(productValue(row, 'stockTotal', '0.00'), '0.00');
  assert.equal(productValue(row, 'salePrice', '$0.00'), 'NO HAY');
  assert.equal(productValue(row, 'pricePvp'), 'NO HAY');
  assert.equal(productValue(row, 'brand'), 'NO HAY');
  assert.equal(productValue(row, 'provider'), 'NO HAY');
  assert.equal(productValue(row, 'description'), 'Product');
});
