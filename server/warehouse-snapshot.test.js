import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboard as buildLocalDashboard, buildProductOverview as buildLocalOverview } from './analytics.ts';
import {
  createSnapshotLoader as createLocalSnapshotLoader,
  loadSiapeProducts as loadLocalProducts,
  loadWarehouseNames as loadLocalWarehouseNames,
} from './siape.ts';
import {
  buildDashboard as buildVercelDashboard,
  buildProductOverview as buildVercelOverview,
  createSnapshotLoader as createVercelSnapshotLoader,
  loadBranchData as loadVercelBranchData,
  loadSiapeProducts as loadVercelProducts,
  loadWarehouseNames as loadVercelWarehouseNames,
} from '../api/_core.js';

const useBranchEnv = (t, suffix, baseUrl) => {
  const original = process.env;
  process.env = {
    ...original,
    [`SIAPE_API_BASE_URL${suffix}`]: baseUrl,
    [`SIAPE_API_USER${suffix}`]: 'user',
    [`SIAPE_API_PASSWORD${suffix}`]: 'password',
    SIAPE_AUTH_HEADER: 'Authorization',
    SIAPE_AUTH_PREFIX: 'Bearer',
  };
  t.after(() => { process.env = original; });
};

const inventory = [
  { codigo: 'A', descripcion: 'A', bodegas: [{ bodegaALMACEN: 'BODEGA GENERAL', stock: 4 }] },
];

const mockSiape = (t, counters, options = {}) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
    if (pathname === '/api/item/reporteinventario') {
      counters.inventory += 1;
      return Response.json(options.inventory ?? inventory);
    }
    if (pathname === '/api/item/search3') {
      counters.catalog += 1;
      return Response.json([]);
    }
    if (pathname === '/api/item/inventario') {
      counters.stock += 1;
      return Response.json([{ codigo: 'A', disponible: 4 }]);
    }
    if (pathname === '/api/item') {
      counters.probe += 1;
      return Response.json({ stockBodega: [{ txDescripcionBodega: 'BODEGA GENERAL', qnStock: 4 }, { txDescripcionBodega: 'GALPON CALDERON', qnStock: 0 }] });
    }
    if (pathname === '/api/factura/reporteventas') {
      counters.sales += 1;
      return Response.json([{ codigo: 'A', cantidad_vendida: 2, precio_costo: 1, precio_venta: 2, fecha_venta: '2026-01-01T12:00:00' }]);
    }
    throw new Error(`Unexpected path: ${pathname}`);
  });
};

const backends = [
  ['local', createLocalSnapshotLoader, loadLocalWarehouseNames, loadLocalProducts],
  ['vercel', createVercelSnapshotLoader, loadVercelWarehouseNames, loadVercelProducts],
];

for (const [backend, createSnapshot, loadNames, loadProducts] of backends) {
  test(`${backend}: warehouse columns include empty warehouses and probe only once`, async (t) => {
    useBranchEnv(t, '', `https://warehouse-${backend}.example`);
    const counters = { inventory: 0, catalog: 0, stock: 0, probe: 0, sales: 0 };
    mockSiape(t, counters);

    const loadSnapshot = createSnapshot('ALMACEN PAS');
    const first = await loadNames('ALMACEN PAS', { loadSnapshot, ttlMs: 60_000, probeLimit: 4 });
    const second = await loadNames('ALMACEN PAS', { loadSnapshot, ttlMs: 60_000, probeLimit: 4 });

    assert.deepEqual(first, ['BODEGA GENERAL', 'GALPON CALDERON']);
    assert.deepEqual(second, first);
    assert.equal(counters.inventory, 1);
    assert.equal(counters.probe, 1);
  });

  test(`${backend}: repeated product loads reuse one inventory snapshot`, async (t) => {
    useBranchEnv(t, '_SUCURSAL3', `https://snapshot-${backend}.example`);
    const counters = { inventory: 0, catalog: 0, stock: 0, probe: 0, sales: 0 };
    mockSiape(t, counters);

    const loadSnapshot = createSnapshot('STIHL');
    const first = await loadProducts('2026-01-01', '2026-01-02', 'week', 'STIHL', { loadSnapshot });
    const second = await loadProducts('2026-01-03', '2026-01-04', 'week', 'STIHL', { loadSnapshot });

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(counters.inventory, 1);
    assert.equal(counters.catalog, 1);
    assert.equal(counters.stock, 1);
    assert.equal(counters.sales, 2);
  });
}

test('vercel: loadBranchData shares one snapshot between products and warehouse columns', async (t) => {
  useBranchEnv(t, '_SUCURSAL3', 'https://branch-data.example');
  const counters = { inventory: 0, catalog: 0, stock: 0, probe: 0, sales: 0 };
  mockSiape(t, counters);

  const { products, warehouseNames } = await loadVercelBranchData('2026-01-01', '2026-01-02', 'week', 'STIHL');
  assert.equal(products.length, 1);
  assert.deepEqual(warehouseNames, ['BODEGA GENERAL', 'GALPON CALDERON']);
  assert.equal(counters.inventory, 1);
  assert.equal(counters.probe, 1);
});

test('dashboard and overview merge the discovered warehouse columns', () => {
  const warehouseNames = ['GALPON-MADERERA', 'MATRIZ'];

  const localDashboard = buildLocalDashboard([], [], {
    branch: 'STIHL', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS', line: 'TODAS',
    type: 'TODOS', productCode: 'TODOS', dateStart: null, dateEnd: null, warehouseNames,
  });
  assert.deepEqual(localDashboard.availableWarehouses, warehouseNames);

  const vercelDashboard = buildVercelDashboard([], {
    branch: 'STIHL', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS', line: 'TODAS',
    type: 'TODOS', productCode: 'TODOS', dateStart: null, dateEnd: null, warehouseNames,
  });
  assert.deepEqual(vercelDashboard.availableWarehouses, warehouseNames);

  const overviewParams = {
    branch: 'STIHL', periodMonths: 1, dateStart: '2026-01-01', dateEnd: '2026-01-31',
    cacheKey: 'test', generatedAt: '2026-01-31 12:00:00', warehouseNames,
  };
  assert.deepEqual(buildLocalOverview([], overviewParams).availableWarehouses, warehouseNames);
  assert.deepEqual(buildVercelOverview([], overviewParams).availableWarehouses, warehouseNames);
});

for (const [backend, loadProducts] of [['local', loadLocalProducts], ['vercel', loadVercelProducts]]) {
  test(`${backend}: stock missing from the warehouse report is exported under the main warehouse`, async (t) => {
    useBranchEnv(t, '', `https://fallback-${backend}.example`);
    t.mock.method(globalThis, 'fetch', async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
      if (pathname === '/api/item/reporteinventario') {
        return Response.json([{ codigo: 'A', descripcion: 'A', bodegas: [{ bodegaALMACEN: 'BODEGA GENERAL', stock: 3 }] }]);
      }
      if (pathname === '/api/item/search3') return Response.json([]);
      if (pathname === '/api/item/inventario') return Response.json([{ codigo: 'A', disponible: 3 }, { codigo: 'B', disponible: 5 }]);
      if (pathname === '/api/factura/reporteventas') return Response.json([]);
      throw new Error(`Unexpected path: ${pathname}`);
    });

    const products = await loadProducts('2026-01-01', '2026-01-02', 'week', 'ALMACEN PAS');
    const byCode = new Map(products.map((product) => [product.code, product]));
    assert.deepEqual(byCode.get('A').warehouseStocks, { 'BODEGA GENERAL': 3 });
    assert.deepEqual(byCode.get('B').warehouseStocks, { 'BODEGA GENERAL': 5 });
    assert.equal(byCode.get('B').stockTotal, 5);
    assert.equal(byCode.get('B').stock, 0);
  });
}
