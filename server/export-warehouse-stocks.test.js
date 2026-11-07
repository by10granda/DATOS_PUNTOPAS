import assert from 'node:assert/strict';
import test from 'node:test';
import { createWarehouseExportHandler } from '../api/export-warehouse-stocks.js';

const invoke = async (handler, req) => {
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res);
  return res;
};

test('warehouse export accepts a large validated batch and uses export concurrency', async () => {
  let received;
  const handler = createWarehouseExportHandler({
    resolveBranch: (branch) => ({ name: branch }),
    loadStocks: async (...args) => { received = args; return { branch: args[0], items: [], warehouseNames: ['GALPON MADERERA'], missingCodes: [] }; },
  });
  const res = await invoke(handler, { method: 'POST', body: { branch: 'VARIEDADES PAS', codes: ['00000609', '00013617'] } });
  assert.equal(res.code, 200);
  assert.deepEqual(received, ['VARIEDADES PAS', ['00000609', '00013617'], { maxConcurrency: 60 }]);
  assert.deepEqual(res.body.warehouseNames, ['GALPON MADERERA']);
});

test('warehouse export rejects invalid methods and oversized or duplicate codes', async () => {
  const handler = createWarehouseExportHandler();
  assert.equal((await invoke(handler, { method: 'GET', body: {} })).code, 405);
  assert.equal((await invoke(handler, { method: 'POST', body: { branch: 'VARIEDADES PAS', codes: ['A', 'A'] } })).code, 400);
  assert.equal((await invoke(handler, { method: 'POST', body: { branch: 'VARIEDADES PAS', codes: Array.from({ length: 10_001 }, (_, index) => `A${index}`) } })).code, 400);
});
