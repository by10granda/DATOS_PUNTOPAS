import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWarehouseStocks } from '../api/product-warehouses.js';

test('loadWarehouseStocks normalizes names, sums duplicates and preserves negative stock', async () => {
  const result = await loadWarehouseStocks('VARIEDADES PAS', ['A', 'B'], {
    resolveBranchConfig: () => ({ name: 'VARIEDADES PAS', baseUrl: 'https://siape.example', user: 'user', password: 'password' }),
    getToken: async () => 'token',
    fetchJson: async (_baseUrl, path) => path.endsWith('A')
      ? { stockBodega: [{ txDescripcionBodega: ' Bodega General SL ', qnStock: '4' }, { txDescripcionBodega: 'BODEGA GENERAL SL', qnStock: -1 }] }
      : { stockBodega: [{ txDescripcionBodega: 'Exhibicion', qnStock: 2 }] }
  });
  assert.deepEqual(result.items, [
    { code: 'A', warehouseStocks: { 'BODEGA GENERAL SL': 3 } },
    { code: 'B', warehouseStocks: { EXHIBICION: 2 } }
  ]);
  assert.deepEqual(result.warehouseNames, ['BODEGA GENERAL SL', 'EXHIBICION']);
});

test('loadWarehouseStocks keeps product 404 unknown but fails malformed detail and server errors', async () => {
  const dependencies = {
    resolveBranchConfig: () => ({ name: 'ALMACEN PAS', baseUrl: 'https://siape.example', user: 'user', password: 'password' }),
    getToken: async () => 'token',
  };
  const missing = await loadWarehouseStocks('ALMACEN PAS', ['MISSING'], { ...dependencies, fetchJson: async () => { const error = new Error('not found'); error.status = 404; throw error; } });
  assert.deepEqual(missing.items, [{ code: 'MISSING', warehouseStocks: {} }]);
  assert.deepEqual(missing.missingCodes, ['MISSING']);
  await assert.rejects(loadWarehouseStocks('ALMACEN PAS', ['BAD'], { ...dependencies, fetchJson: async () => ({ stockBodega: null }) }), /stockBodega/);
  await assert.rejects(loadWarehouseStocks('ALMACEN PAS', ['FAIL'], { ...dependencies, fetchJson: async () => { const error = new Error('upstream'); error.status = 503; throw error; } }), /upstream/);
});
