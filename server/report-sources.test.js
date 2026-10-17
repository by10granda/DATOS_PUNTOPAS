import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSiapeProducts } from '../api/_core.js';

test('report observes raw sales without changing dashboard results or repeating requests', async (t) => {
  const originalEnv = process.env;
  process.env = { ...originalEnv, SIAPE_API_BASE_URL: 'https://report-sources.example', SIAPE_API_USER: 'user', SIAPE_API_PASSWORD: 'password', SIAPE_PAGE_SIZE: '5000' };
  t.after(() => { process.env = originalEnv; });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
    if (pathname === '/api/item/reporteinventario') return Response.json([{ codigo: '001', descripcion: 'Product' }]);
    if (pathname === '/api/item/search3') return Response.json([]);
    if (pathname === '/api/item/inventario') return Response.json([{ codigo: '001', disponible: 0 }]);
    assert.equal(pathname, '/api/factura/reporteventas');
    requests++;
    return Response.json([
      { codigo: '001', cantidad_vendida: 9, precio_costo: 1, precio_venta: 2, fecha_venta: '2026-06-30T23:30:00' },
      { codigo: '001', cantidad_vendida: 3, precio_costo: 1, precio_venta: 2, fecha_venta: '2026-07-01T01:00:00' }
    ]);
  });
  const before = await loadSiapeProducts('2026-07-01', '2026-10-17', 'week');
  let observed;
  const after = await loadSiapeProducts('2026-07-01', '2026-10-17', 'week', 'ALMACEN PAS', {
    strictSalesPagination: true,
    onRawSales(sales) {
      observed = structuredClone(sales);
      sales[0].cantidad_vendida = 9999;
      sales[1].cantidad_vendida = 9999;
    }
  });
  assert.deepEqual(after, before);
  assert.equal(requests, 2);
  assert.equal(observed.length, 2);
  assert.equal(observed[0].cantidad_vendida, 9);
  assert.equal(after[0].monthlySales.reduce((sum, sale) => sum + sale.quantity, 0), 3);
});

test('report refuses repeated or truncated sales pages before observing or sending data', async (t) => {
  const originalEnv = process.env;
  process.env = { ...originalEnv, SIAPE_API_BASE_URL: 'https://report-pagination.example', SIAPE_API_USER: 'user', SIAPE_API_PASSWORD: 'password', SIAPE_PAGE_SIZE: '1' };
  t.after(() => { process.env = originalEnv; });
  let repeat = true;
  let observed = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
    if (pathname === '/api/item/reporteinventario' || pathname === '/api/item/search3' || pathname === '/api/item/inventario') return Response.json([]);
    const page = Number(searchParams.get('page'));
    return Response.json([{ codigo: '001', cantidad_vendida: repeat ? 1 : page, fecha_venta: '2026-10-01T12:00:00' }]);
  });
  const options = { strictSalesPagination: true, onRawSales() { observed = true; } };
  await assert.rejects(loadSiapeProducts('2026-07-01', '2026-10-17', 'week', 'ALMACEN PAS', options), /pagina repetida/);
  repeat = false;
  await assert.rejects(loadSiapeProducts('2026-07-01', '2026-10-17', 'week', 'ALMACEN PAS', options), /limite de paginacion/);
  assert.equal(observed, false);
});
