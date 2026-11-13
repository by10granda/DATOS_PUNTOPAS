import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductOverview as buildLocal, compactProductOverview as compactLocal } from './analytics.ts';
import { buildProductOverview as buildVercel, compactProductOverview as compactVercel } from '../api/_core.js';
import { rehydrateDataDashboard, fetchDataDashboard } from '../src/api.ts';

const params = {
  branch: 'ALMACEN PAS',
  periodMonths: 1,
  dateStart: '2026-10-01',
  dateEnd: '2026-10-24',
  cacheKey: 'test-cache',
  generatedAt: '2026-10-25 08:00:00',
};
const json = (value) => JSON.parse(JSON.stringify(value));

const buckets = Array.from({ length: 24 }, (_, index) => ({
  month: `Sem ${String(index + 1).padStart(2, '0')}/10`,
  weekStart: `2026-10-${String(index + 1).padStart(2, '0')}`,
  monthLabel: 'October 2026',
}));

const product = (index) => ({
  missingFields: index % 3 === 0 ? ['pricePvp'] : [],
  id: `ALMACEN PAS-code-${index}`,
  branch: 'ALMACEN PAS',
  code: `code-${index}`,
  description: `Product ${index}`,
  brand: `Brand ${index % 4}`,
  line: `Line ${index % 3}`,
  category: `Category ${index % 5}`,
  type: `Type ${index % 6}`,
  provider: `Provider ${index % 2}`,
  cost: 2 + index / 100,
  costWithIva: 2.3 + index / 100,
  price: 4 + index / 100,
  salePrice: 4,
  pricePuntoPas: 4 + index / 100,
  pricePvp: null,
  stock: index === 0 ? 0 : 10,
  stockTotal: 10,
  warehouseStocks: index % 2 === 0 ? { 'BODEGA GENERAL': 7, 'BODEGA NORTE': 3 } : { 'BODEGA GENERAL': 10 },
  lastPurchase: index % 2 === 0 ? '2026-09-26' : '',
  saleDate: '2026-10-20 12:30:00',
  lastPurchaseQuantity: index % 4,
  monthlySales: buckets.map((bucket, bucketIndex) => ({
    ...bucket,
    quantity: index === 0 ? 0 : (bucketIndex + index) % 3,
    revenue: (bucketIndex + index) % 3 === 0 ? 0 : 12.5 + index,
    profit: (bucketIndex + index) % 3 === 0 ? 0 : 2.25 + index,
  })),
  hourlySales: Array.from({ length: 24 }, (_, hour) => ({ month: `${String(hour).padStart(2, '0')}:00`, quantity: 0 })),
  salesRevenueWithIva: index * 10,
  salesProfitWithIva: index * 2,
  salesAverageMarginPercent: 20,
});

const slim = (row) => ({
  code: row.code,
  description: row.description,
  line: row.line,
  category: row.category,
  brand: row.brand,
  type: row.type,
  stockTotal: row.stockTotal,
  warehouseStocks: row.warehouseStocks,
  lastPurchase: row.lastPurchase,
  lastPurchaseQuantity: row.lastPurchaseQuantity,
  costWithIva: row.costWithIva,
  provider: row.provider,
  missingFields: row.missingFields ?? [],
  pricePuntoPas: row.pricePuntoPas,
  publicCost: row.publicCost,
  currentPriceWithIva: row.currentPriceWithIva,
  currentMarginPercent: row.currentMarginPercent,
  monthlySales: row.monthlySales,
});

const backends = [
  ['local', (products) => buildLocal(products, params), compactLocal],
  ['vercel', (products) => buildVercel(products, params), compactVercel],
];

for (const [name, build, compact] of backends) {
  test(`${name}: compact overview roundtrip keeps every rendered field`, () => {
    const full = build(Array.from({ length: 12 }, (_, index) => product(index)));
    const before = json(full);
    const transport = compact(full);
    assert.equal(transport.compact, true);
    assert.deepEqual(json(full), before);
    assert.deepEqual(compactLocal(full), compactVercel(full));

    const restored = rehydrateDataDashboard(json(transport));
    assert.equal('compact' in restored, false);
    assert.equal('dictionaries' in restored, false);
    assert.deepEqual(restored, {
      branch: full.branch,
      periodMonths: full.periodMonths,
      dateStart: full.dateStart,
      dateEnd: full.dateEnd,
      periodLabel: full.periodLabel,
      generatedAt: full.generatedAt,
      weeklyUnitsSeries: full.weeklyUnitsSeries,
      rows: full.rows.map(slim),
    });
    assert.equal(rehydrateDataDashboard(full), full);
  });

  test(`${name}: empty payload and zero-only series`, () => {
    const empty = build([]);
    const transport = compact(empty);
    assert.equal(transport.compact, true);
    assert.deepEqual(transport.rows, []);
    assert.deepEqual(rehydrateDataDashboard(json(transport)).rows, []);

    const zero = build([product(0)]);
    assert.deepEqual(rehydrateDataDashboard(json(compact(zero))), {
      branch: zero.branch,
      periodMonths: zero.periodMonths,
      dateStart: zero.dateStart,
      dateEnd: zero.dateEnd,
      periodLabel: zero.periodLabel,
      generatedAt: zero.generatedAt,
      weeklyUnitsSeries: zero.weeklyUnitsSeries,
      rows: zero.rows.map(slim),
    });
  });

  test(`${name}: payload is drastically smaller than the full overview`, (t) => {
    const full = build(Array.from({ length: 900 }, (_, index) => product(index)));
    const transport = compact(full);
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    const compactBytes = Buffer.byteLength(JSON.stringify(transport));
    t.diagnostic(`overview fixture: full=${fullBytes} bytes, compact=${compactBytes} bytes, reduction=${((1 - compactBytes / fullBytes) * 100).toFixed(2)}%`);
    assert.ok(compactBytes / fullBytes < 0.15);
    assert.deepEqual(
      rehydrateDataDashboard(json(transport)).rows.map((row) => row.code),
      full.rows.map((row) => row.code),
    );
  });
}

test('fetchDataDashboard requests the right range and returns hydrated rows', async (t) => {
  const full = buildLocal([product(1), product(2)], params);
  const transport = compactLocal(full);
  const seen = [];
  let response = transport;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const query = new URL(url, 'https://example.test').searchParams;
    seen.push(query);
    return Response.json(response);
  });

  const weekly = await fetchDataDashboard({ branch: 'ALMACEN PAS', bucket: 'week', months: 12 });
  assert.equal(seen[0].get('branch'), 'ALMACEN PAS');
  assert.equal(seen[0].get('bucket'), 'week');
  assert.equal(seen[0].get('months'), '12');
  assert.equal(seen[0].get('refresh'), null);
  assert.deepEqual(weekly.rows.map(slim), full.rows.map(slim));

  const daily = await fetchDataDashboard({ branch: 'ALMACEN PAS', bucket: 'day', days: 7, refresh: true });
  assert.equal(seen[1].get('bucket'), 'day');
  assert.equal(seen[1].get('days'), '7');
  assert.equal(seen[1].get('months'), null);
  assert.equal(seen[1].get('refresh'), '1');
  assert.deepEqual(daily.rows.map(slim), full.rows.map(slim));

  response = full;
  const legacy = await fetchDataDashboard({ branch: 'ALMACEN PAS', bucket: 'week', months: 12 });
  assert.deepEqual(legacy.rows.map(slim), full.rows.map(slim));
});
