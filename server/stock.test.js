import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSiapeProducts as loadLocalProducts } from './siape.ts';
import { loadSiapeProducts as loadVercelProducts } from '../api/_core.js';

for (const [backend, loadProducts] of [['local', loadLocalProducts], ['vercel', loadVercelProducts]]) {
  test(`${backend}: stock comes from the selected branch inventory`, async (t) => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, SIAPE_AUTH_HEADER: 'Authorization', SIAPE_AUTH_PREFIX: 'Bearer' };
    t.after(() => { process.env = originalEnv; });
    const branches = ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL'];
    const suffixes = ['', '_SUCURSAL2', '_SUCURSAL3'];
    for (const [index, suffix] of suffixes.entries()) {
      process.env[`SIAPE_API_BASE_URL${suffix}`] = `https://branch-${index}.example`;
      process.env[`SIAPE_API_USER${suffix}`] = 'test-user';
      process.env[`SIAPE_API_PASSWORD${suffix}`] = 'test-password';
    }
    let stockResponse;
    let stockStatus = 200;
    const inventoryRequests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const { origin, pathname } = new URL(url);
      if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (pathname === '/api/item/inventario') {
        inventoryRequests.push(origin);
        return Response.json(stockResponse, { status: stockStatus });
      }
      if (pathname === '/api/item/reporteinventario') {
        return Response.json(['001', 'ZERO', 'NEGATIVE', 'MISSING'].map((codigo) => ({
          codigo,
          descripcion: codigo,
          bodegas: [{ bodegaALMACEN: 'GENERAL', stock: 99 }]
        })));
      }
      if (pathname === '/api/factura/reporteventas') {
        return Response.json([{ codigo: 'SOLD', cantidad_vendida: 1, fecha_venta: '2026-10-16T12:00:00' }]);
      }
      if (pathname === '/api/item/search3') return Response.json([]);
      throw new Error(`Unexpected path: ${pathname}`);
    });

    for (const [index, branch] of branches.entries()) {
      stockResponse = [
        { codigo: '001', disponible: String(index + 1.5) },
        { codigo: 'ZERO', disponible: 0 },
        { codigo: 'NEGATIVE', disponible: -2 },
        { codigo: 'SOLD', disponible: 7 }
      ];
      const products = await loadProducts('2026-10-16', '2026-10-16', 'hour', branch);
      const byCode = new Map(products.map((product) => [product.code, product]));
      assert.equal(byCode.get('001').stockTotal, index + 1.5);
      assert.equal(byCode.get('ZERO').stockTotal, 0);
      assert.equal(byCode.get('NEGATIVE').stockTotal, -2);
      assert.equal(byCode.get('MISSING').stockTotal, 0);
      assert.equal(byCode.get('SOLD').stockTotal, 7);
      assert.equal(byCode.get('001').warehouseStocks.GENERAL, 99);
      assert.ok(products.every((product) => product.branch === branch));
      for (const code of ['001', 'ZERO', 'NEGATIVE', 'MISSING']) {
        assert.equal(byCode.get(code).stock, 99);
      }
      assert.equal(byCode.get('SOLD').stock, 0);
      assert.equal(inventoryRequests.at(-1), `https://branch-${index}.example`);
    }

    stockResponse = { invalid: true };
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Respuesta invalida/);
    stockResponse = [{ codigo: '001', disponible: null }];
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Stock invalido/);
    stockStatus = 503;
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Error SIAPE 503/);
  });
}
