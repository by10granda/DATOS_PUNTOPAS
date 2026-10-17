import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboard as buildLocal, compactDashboard as compactLocal } from './analytics.ts';
import { buildDashboard as buildVercel, compactDashboard as compactVercel } from '../api/_core.js';
import handler from '../api/dashboard.js';
import { rehydrateDashboard, fetchDashboard } from '../src/api.ts';

const params = {
  branch: 'ALMACEN PAS', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS',
  line: 'TODAS', type: 'TODOS', productCode: 'TODOS', dateStart: '2026-10-01', dateEnd: '2026-10-17',
};
const json = (value) => JSON.parse(JSON.stringify(value));
const product = (index) => ({
  id: `id-${index}`, code: `code-${index}`, description: `Product ${index}`, branch: 'ALMACEN PAS',
  brand: 'Brand', line: 'Line', category: 'Category', type: 'Type', provider: 'Provider',
  cost: 2, costWithIva: 2.3, price: 4, salePrice: 4, pricePuntoPas: 4, pricePvp: null,
  stock: index === 0 ? 0 : 10, stockTotal: 10, warehouseStocks: { GENERAL: 10 },
  lastPurchase: '', saleDate: '', lastPurchaseQuantity: 0,
  monthlySales: Array.from({ length: 24 }, (_, i) => ({
    month: `bucket-${i}`, quantity: 0, revenue: 0, profit: 0,
    ...(i % 2 === 0 ? { weekStart: `2026-10-${String(i + 1).padStart(2, '0')}`, monthLabel: 'October' } : {}),
  })),
  hourlySales: Array.from({ length: 24 }, (_, i) => ({ month: `${String(i).padStart(2, '0')}:00`, quantity: 0 })),
});
const backends = [
  ['local', (products) => buildLocal(products, [], params), compactLocal],
  ['vercel', (products) => buildVercel(products, params), compactVercel],
];

for (const [name, build, compact] of backends) {
  test(`${name}: exact JSON roundtrip, sparse money/negative values, metadata and shared lists`, () => {
    const products = Array.from({ length: 4 }, (_, i) => product(i));
    products[0].monthlySales[0].quantity = 5;
    products[1].monthlySales[3].revenue = -12.5;
    products[1].monthlySales[4].profit = 3.25;
    products[1].hourlySales[23].quantity = -2;
    const full = build(products);
    const before = json(full);
    const transport = compact(full);
    assert.equal(transport.compact, true);
    assert.deepEqual(json(full), before);
    assert.deepEqual(compactLocal(full), compactVercel(full));
    assert.equal(transport.rows.find((row) => row.id === 'id-1').monthlySales.length, 2);
    assert.deepEqual(transport.rows.find((row) => row.id === 'id-2').monthlySales, []);
    assert.deepEqual(transport.seriesTemplates.hourlySales[0], { month: '00:00', quantity: 0 });
    const restored = rehydrateDashboard(json(transport));
    assert.deepEqual(restored, before);
    assert.equal('compact' in restored, false);
    assert.equal('seriesTemplates' in restored, false);
    assert.equal(rehydrateDashboard(full), full);
    for (const key of ['lowStockHighRotationRows', 'topRotationRows', 'noSalesRows', 'overstockRows']) {
      assert.deepEqual(transport[key], full[key].map((row) => row.id));
      for (const row of restored[key]) assert.equal(row, restored.rows.find((item) => item.id === row.id));
    }
    restored.rows[2].monthlySales[0].quantity = 99;
    assert.notEqual(restored.rows[3].monthlySales[0].quantity, 99);
  });

  test(`${name}: empty rows and empty series`, () => {
    for (const products of [[], [{ ...product(0), monthlySales: [], hourlySales: [] }]]) {
      const full = build(products);
      assert.equal(compact(full).compact, true);
      assert.deepEqual(rehydrateDashboard(json(compact(full))), json(full));
    }
  });

  test(`${name}: incompatible labels, metadata, optional keys or IDs safely retain full payload`, () => {
    const changes = [
      (rows) => { rows[1].monthlySales[0].month = 'different'; },
      (rows) => { rows[1].monthlySales[0].weekStart = 'different'; },
      (rows) => { delete rows[1].monthlySales[0].revenue; },
      (rows) => { rows[1].hourlySales[0].profit = 0; },
      (rows) => { rows[1].hourlySales.pop(); },
      (rows) => { rows[1].id = rows[0].id; },
    ];
    for (const change of changes) {
      const full = build([product(0), product(1)]);
      change(full.rows);
      assert.equal(compact(full), full);
      assert.deepEqual(rehydrateDashboard(json(compact(full))), json(full));
    }
    const full = build([product(0)]);
    full.topRotationRows = [{ ...full.rows[0], description: 'different' }];
    assert.equal(compact(full), full);
  });

  test(`${name}: optional numeric properties absent or explicitly zero stay exact`, () => {
    for (const keys of [[], ['revenue'], ['profit'], ['revenue', 'profit']]) {
      const products = [product(0), product(1)];
      for (const item of products) {
        item.monthlySales = [{ month: 'one', quantity: 0, ...Object.fromEntries(keys.map((key) => [key, 0])) }];
      }
      const full = build(products);
      assert.equal(compact(full).compact, true);
      assert.deepEqual(rehydrateDashboard(json(compact(full))), json(full));
    }
  });
}

test('Vercel route: only compact=1 opts in, default JSON unchanged', async () => {
  for (const flag of [undefined, '0', 'true', '1']) {
    let result;
    const query = { ...params, branch: undefined, periodMonths: '1', compact: flag };
    const res = { status(code) { assert.equal(code, 200); return this; }, json(value) { result = json(value); } };
    await handler({ query }, res);
    const full = json(buildVercel([], { ...params, branch: null }));
    assert.deepEqual(rehydrateDashboard(result), full);
    assert.equal(result.compact, flag === '1' ? true : undefined);
    if (flag !== '1') assert.deepEqual(result, full);
  }
});

test('fetchDashboard requests compact=1 and returns only hydrated data, with full fallback', async (t) => {
  const full = buildLocal([product(0)], [], params);
  let response = compactLocal(full);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const query = new URL(url, 'https://example.test').searchParams;
    assert.equal(query.get('compact'), '1');
    assert.equal(query.get('dateStart'), params.dateStart);
    return Response.json(response);
  });
  assert.deepEqual(await fetchDashboard(params), json(full));
  response = full;
  assert.deepEqual(await fetchDashboard(params), json(full));
});

test('8997 products with 48 zero points: exact roundtrip and size ratio', (t) => {
  const full = buildLocal(Array.from({ length: 8997 }, (_, i) => product(i)), [], params);
  const compact = compactLocal(full);
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  t.diagnostic(`fixture: full=${fullBytes} bytes, compact=${compactBytes} bytes, ratio=${(compactBytes / fullBytes).toFixed(4)}, reduction=${((1 - compactBytes / fullBytes) * 100).toFixed(2)}%`);
  assert.ok(compactBytes / fullBytes < 0.4);
  assert.deepEqual(rehydrateDashboard(json(compact)), json(full));
});
