import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { resolveReportRange, parseSaleDate, aggregateReportSales, forecastDemand, selectReportRows, createReplenishmentReport } from '../lib/replenishment.js';

const now = new Date('2026-10-17T12:00:00Z');
const range = resolveReportRange(now);
const product = (code, stockTotal = 0, extra = {}) => ({
  code, stockTotal, description: `Producto ${code}`, provider: 'Proveedor',
  costWithIva: 1.23456789, currentPriceWithIva: 9.87654321, currentMarginPercent: 40,
  missingFields: [], ...extra,
});
const sale = (codigo, cantidad_vendida = 1, fecha_venta = '2026-10-17 07:00:00') => ({ codigo, cantidad_vendida, fecha_venta });
const report = (rows, sales, options = {}) => createReplenishmentReport({ branch: 'ALMACEN PAS', rows, sales, now, ...options });
const read = (result) => {
  assert.ok(Buffer.isBuffer(result.buffer));
  const book = XLSX.read(result.buffer, { type: 'buffer', cellNF: true });
  assert.deepEqual(book.SheetNames, ['Reposicion']);
  const sheet = book.Sheets.Reposicion;
  return { sheet, table: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) };
};
const select = (rows, sales, branch = 'ALMACEN PAS') => selectReportRows({ branch, rows, aggregatedSales: aggregateReportSales(sales, range) });

test('four calendar months, year rollover, leap day and Ecuador midnight', () => {
  assert.equal(range.dateStart, '2026-07-01');
  assert.equal(range.dateEnd, '2026-10-17');
  assert.deepEqual(range.months, [
    { key: '2026-07', label: 'julio 2026' }, { key: '2026-08', label: 'agosto 2026' },
    { key: '2026-09', label: 'septiembre 2026' }, { key: '2026-10', label: 'octubre 2026' },
  ]);
  const before = resolveReportRange(new Date('2024-03-01T04:59:59Z'));
  assert.equal(before.dateStart, '2023-11-01');
  assert.equal(before.dateEnd, '2024-02-29');
  assert.equal(before.dayKeys.length, 121);
  assert.equal(before.dayKeys.at(-1), '2024-02-29');
  const after = resolveReportRange(new Date('2024-03-01T05:00:00Z'));
  assert.equal(after.dateStart, '2023-12-01');
  assert.equal(after.dateEnd, '2024-03-01');
  assert.equal(new Set(after.dayKeys).size, after.dayKeys.length);
  assert.throws(() => resolveReportRange(new Date('invalid')), /now/);
});

test('naive dates are Ecuador; explicit offsets and Z are instants', () => {
  assert.equal(parseSaleDate('2026-10-17 07:00:00').toISOString(), now.toISOString());
  assert.equal(parseSaleDate('2026-10-17').toISOString(), '2026-10-17T05:00:00.000Z');
  assert.equal(parseSaleDate('2026-10-17T14:00:00+02:00').toISOString(), now.toISOString());
  assert.equal(parseSaleDate('2026-10-17T07:00:00.123-0500').toISOString(), '2026-10-17T12:00:00.123Z');
  const totals = aggregateReportSales([
    sale('001', 10, '2026-07-01T05:00:00Z'), sale('001', -3, '2026-08-01'),
    sale('001', 5, '2026-09-01T00:30:00+02:00'),
    sale('001', 2), sale('001', 999, '2026-07-01T04:59:59Z'),
    sale('001', 999, '2026-10-17T12:00:00.001Z'), sale('001', 999, '2026-10-18'),
  ], range).get('001');
  assert.equal(totals.total, 14);
  assert.deepEqual(totals.monthly, [10, 2, 0, 2]);
  assert.equal(totals.daily.reduce((a, b) => a + b, 0), 14);
});

test('three branch files; excluded code only applies to VARIEDADES PAS', () => {
  for (const branch of ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL']) {
    const result = report([product('00000609'), product('00000001')], [sale('00000609'), sale('00000001')], { branch });
    assert.equal(result.count, branch === 'VARIEDADES PAS' ? 1 : 2);
    assert.equal(result.filename, `Reposicion_${branch.replaceAll(' ', '_')}_2026-10-17.xlsx`);
    assert.equal(result.branch, branch);
    assert.equal(result.generatedAt, now.toISOString());
    assert.equal(result.dateStart, range.dateStart);
    assert.equal(result.dateEnd, range.dateEnd);
    read(result);
  }
});

test('only net-positive rotating products, negative stock, unknown stock never zero', () => {
  const rows = [product('negative', -2), product('empty'), product('returns'), product('netzero'),
    product('missing', 0, { missingFields: ['stockTotal'] }), product('null', null), product('blank', ''),
    product('nan', NaN), product('infinite', Infinity), product('string', '0'), product('idle-missing', null)];
  const sales = [sale('negative'), sale('returns', 2), sale('returns', -3), sale('netzero'), sale('netzero', -1),
    ...['missing', 'null', 'blank', 'nan', 'infinite', 'string'].map((code) => sale(code))];
  const result = select(rows, sales);
  assert.deepEqual(result.selected.map(({ row }) => row.code), ['negative']);
  assert.equal(result.skippedUnknownStock, 6);
  assert.equal(report(rows, sales).skippedUnknownStock, 6);
});

test('strict 15-day threshold, stockout precedence, ties and no top-N truncation', () => {
  const rows = [product('exact', 15), product('below', 14.999), product('above', 16),
    product('zero-low'), product('zero-high'), product('tie-b', 1), product('tie-a', 1), product('negative', -1)];
  const sales = range.dayKeys.flatMap((date) => rows.map((row) => sale(row.code, row.code === 'zero-high' ? 2 : 1, date)));
  const result = select(rows, sales);
  assert.deepEqual(result.selected.map(({ row }) => row.code), ['negative', 'zero-high', 'zero-low', 'tie-a', 'tie-b', 'below']);
  const many = Array.from({ length: 350 }, (_, i) => product(String(i).padStart(8, '0')));
  assert.equal(report(many, many.map((row) => sale(row.code))).count, 350);
});

test('historical net mean is a floor even when recent demand disappears', () => {
  const daily = range.dayKeys.map((_, i) => i < 30 ? 10 : 0);
  const prediction = forecastDemand(daily);
  assert.ok(prediction.forecast < prediction.mean);
  assert.equal(prediction.demandDaily, prediction.mean);
  const stock = prediction.mean * 14;
  const sales = range.dayKeys.map((date, i) => sale('001', daily[i], date));
  assert.equal(select([product('001', stock)], sales).selected.length, 1);
});

test('forecast constant, intermittent, short series and returns', () => {
  const constant = forecastDemand(Array(100).fill(4));
  assert.equal(constant.demandDaily, 4);
  assert.equal(constant.model, 'SMA28');
  assert.deepEqual(constant.mae, { SMA28: 0, SES: 0, TSB: 0 });
  const intermittent = forecastDemand(Array.from({ length: 100 }, (_, i) => i % 20 === 0 ? 5 : 0));
  assert.ok(Number.isFinite(intermittent.demandDaily));
  assert.ok(intermittent.demandDaily >= intermittent.mean);
  assert.ok(['SMA28', 'SES', 'TSB'].includes(intermittent.model));
  assert.deepEqual(forecastDemand([5, -3, 0]).demandDaily, 2 / 3);
  assert.equal(forecastDemand(Array(55).fill(2)).model, 'mean');
  const returns = forecastDemand(Array.from({ length: 80 }, (_, i) => i % 2 ? -3 : 5));
  assert.equal(returns.mean, 1);
  assert.ok(returns.validation.every(({ actual }) => actual >= 0));
  for (const bad of [[], null, [NaN], ['2']]) assert.throws(() => forecastDemand(bad));
});

test('holdout is exactly 28 days, predict then update, no future leakage; lowest MAE wins', () => {
  const daily = Array.from({ length: 90 }, (_, i) => i < 62 ? 2 : 10);
  const result = forecastDemand(daily);
  assert.equal(result.validation.length, 28);
  assert.equal(result.validation[0].index, 62);
  assert.deepEqual(result.validation[0].predictions, { SMA28: 2, SES: 2, TSB: 2 });
  assert.equal(result.validation[1].predictions.SES, 3.6);
  assert.equal(result.validation[1].predictions.SMA28, (27 * 2 + 10) / 28);
  assert.equal(result.validation[1].predictions.TSB, 3.6);
  const changed = [...daily];
  changed[80] = 1000;
  const other = forecastDemand(changed);
  for (let i = 0; i <= 18; i++) assert.deepEqual(result.validation[i].predictions, other.validation[i].predictions);
  assert.notEqual(result.validation[19].predictions.SES, other.validation[19].predictions.SES);
  for (const model of ['SMA28', 'SES', 'TSB']) {
    const mae = result.validation.reduce((sum, day) => sum + Math.abs(day.predictions[model] - day.actual) / 28, 0);
    assert.equal(result.mae[model], mae);
  }
  assert.equal(result.mae[result.model], Math.min(...Object.values(result.mae)));
  assert.equal(result.model, 'SES');
});

test('invalid critical sources abort, including invalid records outside range', () => {
  for (const quantity of [null, undefined, '', '  ', NaN, Infinity, -Infinity, 'bad', {}, true]) {
    assert.throws(() => report([], [{ ...sale('001', 1, '2030-01-01'), cantidad_vendida: quantity }]), /cantidad_vendida/);
  }
  for (const date of [null, '', 'bad', '2026-02-29', '2024-02-30', '2026-13-01', '2026-10-17T24:00:00', '2026-10-17T07:60:00', '2026-10-17T07:00:60', '2026-10-17T07:00:00+25:00']) {
    assert.throws(() => report([], [sale('001', 1, date)]), /fecha_venta/);
  }
  for (const sales of [null, undefined, {}]) assert.throws(() => report([], sales), /sales/);
  assert.throws(() => report([], [sale('', 1)]), /codigo/);
  assert.throws(() => report(null, []), /rows/);
  assert.throws(() => report([], [], { branch: '' }), /branch/);
  assert.equal(report([product('001')], [sale('001', '2')]).count, 1);
});

test('real XLSX: exact columns, string codes, net monthly totals, raw finance and local cutoff', () => {
  const rows = [product('00000001')];
  const sales = [sale('00000001', 4, '2026-07-01'), sale('00000001', -1, '2026-08-01'),
    sale('00000001', 2, '2026-09-01'), sale('00000001', 3)];
  const snapshot = structuredClone({ rows, sales });
  const { sheet, table } = read(report(rows, sales));
  assert.deepEqual(table[6], ['Codigo', 'Descripcion', 'Cantidad vendida', 'julio 2026', 'agosto 2026',
    'septiembre 2026', 'octubre 2026 (parcial)', 'Proveedor', 'Costo+IVA', 'PrecioActual', 'StockTotal', 'MargenActual%']);
  assert.deepEqual(table[7], ['00000001', 'Producto 00000001', 8, 4, -1, 2, 3, 'Proveedor', 1.23456789, 9.87654321, 0, 0.4]);
  assert.equal(sheet.A8.t, 's');
  assert.equal(sheet.I8.z, '"$"#,##0.00');
  assert.equal(sheet.J8.z, '"$"#,##0.00');
  assert.equal(sheet.L8.z, '0.00%');
  assert.equal(sheet.L8.w, '40.00%');
  assert.match(table[2][1], /2026-10-17 07:00:00 -05:00/);
  assert.match(table[3][1], /< 15 dias/);
  assert.equal(sheet['!ref'], 'A1:L8');
  assert.deepEqual({ rows, sales }, snapshot);
});

test('00013617 margin uses a standard Excel percentage without multiplying it twice', () => {
  for (const [margin, displayed] of [[32.999936357576665, '33.00%'], [0, '0.00%'], [-12.5, '-12.50%'], [150, '150.00%']]) {
    const row = product('00013617', 0, { currentMarginPercent: margin });
    const { sheet } = read(report([row], [sale(row.code)]));
    assert.equal(sheet.L8.t, 'n');
    assert.equal(sheet.L8.v, margin / 100);
    assert.equal(sheet.L8.z, '0.00%');
    assert.equal(sheet.L8.w, displayed);
    assert.equal(row.currentMarginPercent, margin);
  }
});

test('NO HAY respects missingFields, zero is valid, no price/margin recalculation', () => {
  const rows = [product('001', 0, { costWithIva: 0, currentPriceWithIva: 0, currentMarginPercent: 0 }),
    product('002', 0, { missingFields: ['description', 'provider', 'costWithIva', 'currentPriceWithIva', 'currentMarginPercent'] }),
    product('003', 0, { description: '', provider: null, costWithIva: NaN, currentPriceWithIva: null, currentMarginPercent: Infinity })];
  const { sheet, table } = read(report(rows, rows.map((row) => sale(row.code))));
  assert.deepEqual(table[7].slice(8), [0, 0, 0, 0]);
  assert.equal(sheet.I8.w, '$0.00');
  for (const index of [8, 9]) {
    for (const col of [1, 7, 8, 9, 11]) assert.equal(table[index][col], 'NO HAY');
  }
});

test('empty workbook still has all twelve headers and metadata on one sheet', () => {
  const result = report([], []);
  assert.equal(result.count, 0);
  assert.equal(result.skippedUnknownStock, 0);
  const { sheet, table } = read(result);
  assert.equal(table.length, 7);
  assert.equal(table[6].length, 12);
  assert.equal(sheet['!ref'], 'A1:L7');
  assert.equal(sheet['!autofilter'].ref, 'A7:L7');
  assert.match(table[1][1], /2026-07-01 a 2026-10-17/);
});
