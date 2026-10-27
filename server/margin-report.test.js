import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import XLSX from 'xlsx';
import { createLowMarginStockReport } from '../lib/replenishment.js';
import { createMarginReportHandler } from '../api/telegram-margin-report.js';
import { sendReportDocument } from '../lib/telegram-report.js';

const instant = new Date('2026-10-17T12:00:00Z');
const range = { dateStart: '2026-07-01', dateEnd: '2026-10-17' };
const product = (code, stockTotal, currentMarginPercent, extra = {}) => ({
  code, stockTotal, currentMarginPercent, description: `Producto ${code}`, provider: 'Proveedor',
  costWithIva: 1.23456789, currentPriceWithIva: 9.87654321, missingFields: [], ...extra,
});
const sale = (codigo, cantidad_vendida = 1, fecha_venta = '2026-10-17 07:00:00') => ({ codigo, cantidad_vendida, fecha_venta });
const create = (rows, sales = [], branch = 'VARIEDADES PAS') => createLowMarginStockReport({ branch, rows, sales, now: instant });
const read = (report) => {
  const book = XLSX.read(report.buffer, { type: 'buffer', cellNF: true });
  assert.deepEqual(book.SheetNames, ['Margen 1 a 10']);
  const sheet = book.Sheets['Margen 1 a 10'];
  return { sheet, table: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) };
};

test('real XLSX applies inclusive margin and positive known-stock boundaries without requiring sales', () => {
  const rows = [
    product('below-margin', 2, 0.999), product('margin-1-low-stock', 2, 1),
    product('margin-1-high-stock', 8, 1), product('00000609', 4, 1), product('margin-10', 3, 10),
    product('above-margin', 2, 10.001), product('stock-zero', 0, 5), product('stock-negative', -1, 5),
    product('stock-unknown', null, 5), product('stock-missing', 2, 5, { missingFields: ['stockTotal'] }),
    product('margin-unknown', 2, null), product('margin-missing', 2, 5, { missingFields: ['currentMarginPercent'] }),
  ];
  const result = create(rows, [sale('margin-10', 4, '2026-07-01'), sale('margin-10', -1, '2026-08-01')]);
  const { sheet, table } = read(result);
  assert.equal(result.filename, 'Margen_1_A_10_VARIEDADES_PAS_2026-10-17.xlsx');
  assert.equal(result.count, 4);
  assert.deepEqual(table[6], ['Codigo', 'Descripcion', 'Cantidad vendida', 'julio 2026', 'agosto 2026',
    'septiembre 2026', 'octubre 2026 (parcial)', 'Proveedor', 'Costo+IVA', 'PrecioActual', 'StockTotal', 'MargenActual%']);
  assert.deepEqual(table.slice(7).map((row) => row[0]), ['margin-1-high-stock', '00000609', 'margin-1-low-stock', 'margin-10']);
  assert.deepEqual(table[7].slice(2, 7), [0, 0, 0, 0, 0]);
  assert.deepEqual(table[10].slice(2, 7), [3, 4, -1, 0, 0]);
  assert.match(table[3][1], /> 0/);
  assert.match(table[3][1], /1% y 10% inclusive/);
  assert.match(table[3][1], /ventas no requeridas/);
  assert.equal(sheet.L8.v, 0.01);
  assert.equal(sheet.L8.z, '0.00%');
  assert.equal(sheet.L11.v, 0.1);
  assert.equal(sheet['!autofilter'].ref, 'A7:L11');
});

test('financial values remain raw, missing display fields are NO HAY and numeric zero is valid', () => {
  const exact = product('exact', 5, 7.125, { costWithIva: 1.23456789, currentPriceWithIva: 9.87654321 });
  const missing = product('missing', 4, 8, {
    costWithIva: 0, currentPriceWithIva: 0,
    missingFields: ['description', 'provider'], description: '', provider: null,
  });
  const { sheet, table } = read(create([exact, missing]));
  assert.deepEqual(table[7].slice(8), [1.23456789, 9.87654321, 5, 0.07125]);
  assert.deepEqual(table[8].slice(7), ['NO HAY', 0, 0, 4, 0.08]);
  assert.equal(sheet.I9.w, '$0.00');
  assert.equal(sheet.J9.w, '$0.00');
  assert.equal(sheet.L8.z, '0.00%');
});

test('invalid raw sales fail closed even when irrelevant or outside the range', () => {
  assert.throws(() => create([product('included', 1, 5)], [sale('other', 'bad', '2030-01-01')]), /cantidad_vendida/);
  assert.throws(() => create([product('included', 1, 5)], [sale('other', 1, 'invalid')]), /fecha_venta/);
  assert.throws(() => create([], null), /sales/);
});

const envKeys = ['CRON_SECRET', 'TELEGRAM_MARGIN_REPORT_ENABLED', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_MARGIN_CHAT_ID', 'TELEGRAM_CHAT_ID', 'TELEGRAM_REPORT_ENABLED'];
let previous;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CRON_SECRET: 'margin-secret', TELEGRAM_MARGIN_REPORT_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456:test-token', TELEGRAM_MARGIN_CHAT_ID: '987654321',
    TELEGRAM_CHAT_ID: '111111111', TELEGRAM_REPORT_ENABLED: 'false',
  });
});
afterEach(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

const request = (overrides = {}) => ({
  method: 'GET', headers: { authorization: 'Bearer margin-secret' }, query: { branch: 'ALMACEN PAS' }, ...overrides,
});
const invoke = async (handler, req = request()) => {
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res);
  return res;
};
const fixture = (overrides = {}) => {
  const calls = [];
  const products = [{ code: 'source-row' }];
  const rows = [{ code: 'dashboard-row', currentMarginPercent: 5 }];
  const raw = [{ codigo: 'dashboard-row', cantidad_vendida: 2, fecha_venta: '2026-10-01' }];
  const report = { branch: 'ALMACEN PAS', count: 1, filename: 'margin.xlsx', buffer: Buffer.from('xlsx') };
  const handler = createMarginReportHandler({
    now: () => instant,
    resolveRange: (value) => { assert.equal(value, instant); return range; },
    loadProducts: async (...args) => { calls.push(['load', ...args]); args[4].onRawSales(raw); return products; },
    buildRows: (value, params) => { assert.equal(value, products); calls.push(['build', params]); return rows; },
    createReport: (options) => { calls.push(['report', options]); return { ...report, branch: options.branch }; },
    sendReport: async (options) => { calls.push(['send', options]); return 77; },
    ...overrides,
  });
  return { handler, calls, rows, raw, report };
};

test('margin endpoint authenticates before gate and accepts only GET/POST with one exact branch', async () => {
  const { handler, calls } = fixture();
  for (const authorization of [undefined, 'Bearer wrong', ['Bearer margin-secret']]) {
    assert.equal((await invoke(handler, request({ headers: { authorization } }))).code, 401);
  }
  process.env.TELEGRAM_MARGIN_REPORT_ENABLED = 'false';
  assert.deepEqual((await invoke(handler)).body, { skipped: 'disabled' });
  process.env.TELEGRAM_MARGIN_REPORT_ENABLED = 'true';
  for (const query of [{}, { branch: 'stihl' }, { branch: ['STIHL'] }, { branch: 'STIHL', chatId: '1' }]) {
    assert.equal((await invoke(handler, request({ query }))).code, 400);
  }
  const method = await invoke(handler, request({ method: 'PUT' }));
  assert.equal(method.code, 405);
  assert.equal(method.headers.Allow, 'GET, POST');
  assert.deepEqual(calls, []);
});

test('margin endpoint reads only its single numeric destination and configuration at request time', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { handler, calls } = fixture();
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_MARGIN_CHAT_ID']) {
    const value = process.env[key];
    delete process.env[key];
    assert.equal((await invoke(handler)).code, 502);
    process.env[key] = value;
  }
  for (const chatId of ['1,2', '@name', '+593999', '0', ' 123']) {
    process.env.TELEGRAM_MARGIN_CHAT_ID = chatId;
    assert.equal((await invoke(handler)).code, 502);
  }
  delete process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_MARGIN_CHAT_ID = '987654321';
  assert.equal((await invoke(handler)).code, 200);
  assert.deepEqual(calls.at(-1)[1].chatId, '987654321');
});

test('each branch performs one strict raw load, builds neutral dashboard rows and sends one report', async () => {
  for (const branch of ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL']) {
    const { handler, calls, rows, raw, report } = fixture();
    const res = await invoke(handler, request({ method: 'POST', query: { branch } }));
    assert.deepEqual(res.body, { branch, count: 1, filename: 'margin.xlsx', messageId: 77 });
    assert.deepEqual(calls.map(([name]) => name), ['load', 'build', 'report', 'send']);
    assert.deepEqual(calls[0].slice(1, 5), [range.dateStart, range.dateEnd, 'week', branch]);
    assert.equal(calls[0][5].strictSalesPagination, true);
    assert.deepEqual(calls[1][1], { branch, periodMonths: 4, ...range, search: '', category: 'TODOS',
      brand: 'TODAS', line: 'TODAS', type: 'TODOS', productCode: 'TODOS' });
    assert.deepEqual(calls[2][1], { branch, rows, sales: raw, now: instant });
    assert.equal(calls[3][1].report.buffer, report.buffer);
    assert.equal(calls[3][1].chatId, '987654321');
  }
});

test('missing raw callback and source/build/send failures fail closed', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  assert.equal((await invoke(fixture({ loadProducts: async () => [] }).handler)).code, 502);
  for (const [dependency, phase] of [['loadProducts', 'source'], ['buildRows', 'build'], ['createReport', 'build'], ['sendReport', 'send']]) {
    const res = await invoke(fixture({ [dependency]: () => { throw new Error('private'); } }).handler);
    assert.equal(res.code, 502);
    assert.deepEqual(res.body, { message: 'No se pudo procesar el reporte.' });
    assert.deepEqual(logs.at(-1), ['telegram-margin-report', { branch: 'ALMACEN PAS', phase }]);
  }
});

test('custom caption describes margin report without replenishment claims', async () => {
  const report = create([product('001', 2, 5)]);
  const messageId = await sendReportDocument({ token: '123456:test-token', chatId: '987654321', report,
    fetchImpl: async (_url, { body }) => {
      const caption = body.get('caption');
      assert.ok(caption.includes('Productos con stock y margen 1%-10%: 1'));
      assert.ok(caption.includes('4 meses, actual incluido'));
      assert.ok(caption.includes(report.generatedAt));
      assert.equal(caption.includes('Productos criticos'), false);
      assert.equal(caption.includes('Cobertura: 15 dias'), false);
      return Response.json({ ok: true, result: { message_id: 88 } });
    } });
  assert.equal(messageId, 88);
});

test('Vercel schedules three distinct margin paths at 07:00 Ecuador and preserves existing crons', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const marginCrons = config.crons.filter(({ path }) => path.startsWith('/api/telegram-margin-report'));
  assert.deepEqual(marginCrons, [
    { path: '/api/telegram-margin-report?branch=ALMACEN%20PAS', schedule: '0 12 * * *' },
    { path: '/api/telegram-margin-report?branch=VARIEDADES%20PAS', schedule: '0 12 * * *' },
    { path: '/api/telegram-margin-report?branch=STIHL', schedule: '0 12 * * *' },
  ]);
  assert.equal(config.crons.length, 9);
  assert.deepEqual(config.functions['api/telegram-margin-report.js'], { maxDuration: 60 });
});
