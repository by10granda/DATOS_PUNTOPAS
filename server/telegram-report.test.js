import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createReportHandler } from '../api/telegram-stock-report.js';
import { sendReportDocument } from '../lib/telegram-report.js';

const envKeys = ['CRON_SECRET', 'TELEGRAM_REPORT_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
let previous;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CRON_SECRET: 'test-only-secret', TELEGRAM_REPORT_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456:test-only-token', TELEGRAM_CHAT_ID: '123456789',
  });
});
afterEach(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

const instant = new Date('2026-10-17T12:00:00Z');
const range = { dateStart: '2026-07-01', dateEnd: '2026-10-17' };
const report = {
  branch: 'ALMACEN PAS', filename: 'replenishment.xlsx', buffer: Buffer.from('mock-excel'),
  count: 2, skippedUnknownStock: 3, ...range, generatedAt: '2026-10-17 07:00:00 America/Guayaquil',
};
const request = (overrides = {}) => ({
  method: 'GET', headers: { authorization: 'Bearer test-only-secret' }, query: { branch: 'ALMACEN PAS' }, ...overrides,
});
async function invoke(handler, req = request()) {
  const res = {
    headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
}
function fixture(overrides = {}) {
  const calls = [];
  const products = [{ code: 'product' }];
  const rows = [{ code: 'exact-dashboard-row', price: 123.45 }];
  const raw = [{ raw: 'unfiltered' }];
  const handler = createReportHandler({
    now: () => instant,
    resolveRange: (value) => { assert.equal(value, instant); return range; },
    loadProducts: async (...args) => {
      calls.push(['load', ...args]); args[4].onRawSales(raw); return products;
    },
    buildRows: (value, params) => { assert.equal(value, products); calls.push(['build', params]); return rows; },
    createReport: (options) => { calls.push(['report', options]); return { ...report, branch: options.branch }; },
    sendReport: async (options) => { calls.push(['send', options]); return 42; },
    ...overrides,
  });
  return { handler, calls, rows, raw };
}

test('auth rejects missing, wrong, array and query secrets before any source or delivery', async () => {
  const { handler, calls } = fixture();
  for (const authorization of [undefined, 'Bearer wrong', ['Bearer test-only-secret'], 'bearer test-only-secret']) {
    const res = await invoke(handler, request({ headers: { authorization }, query: { token: 'test-only-secret' } }));
    assert.equal(res.code, 401);
    assert.deepEqual(res.body, { message: 'No autorizado.' });
  }
  delete process.env.CRON_SECRET;
  assert.equal((await invoke(handler)).code, 401);
  assert.deepEqual(calls, []);
});

test('disabled requires auth, returns skipped and has no side effects even without configuration', async () => {
  const { handler, calls } = fixture();
  delete process.env.TELEGRAM_BOT_TOKEN;
  for (const value of ['false', 'TRUE', '1', '']) {
    process.env.TELEGRAM_REPORT_ENABLED = value;
    const res = await invoke(handler);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { skipped: 'disabled' });
  }
  assert.equal((await invoke(handler, request({ headers: {} }))).code, 401);
  assert.deepEqual(calls, []);
});

test('only GET/POST, one exact branch and no request credentials/destinations', async () => {
  const { handler, calls } = fixture();
  const invalid = [{}, { branch: 'ALL' }, { branch: ['STIHL'] }, { branch: 'stihl' },
    ...['phone', 'token', 'chatId', 'chat_id', 'refresh', 'now'].map((key) => ({ branch: 'STIHL', [key]: 'untrusted' }))];
  for (const query of invalid) assert.equal((await invoke(handler, request({ query }))).code, 400);
  for (const body of [{ phone: '+593000000' }, { token: 'other' }, { chatId: 'other' }, 'body', []]) {
    assert.equal((await invoke(handler, request({ method: 'POST', body }))).code, 400);
  }
  const res = await invoke(handler, request({ method: 'PUT' }));
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
  assert.deepEqual(calls, []);
});

test('configuration is read at request time and fails before SIAPE', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { handler, calls } = fixture();
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    const value = process.env[key];
    delete process.env[key];
    assert.equal((await invoke(handler)).code, 502);
    process.env[key] = value;
  }
  for (const chatId of ['@name', '+593999999999', ' 123', '0', '1.5']) {
    process.env.TELEGRAM_CHAT_ID = chatId;
    assert.equal((await invoke(handler)).code, 502);
  }
  assert.deepEqual(calls, []);
});

test('all three branches: one fetch, strict raw callback, neutral dashboard and mock Excel Buffer', async () => {
  for (const branch of ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL']) {
    const { handler, calls, rows, raw } = fixture();
    const res = await invoke(handler, request({ method: 'POST', query: { branch } }));
    assert.equal(res.code, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(res.body, { branch, count: 2, filename: report.filename, messageId: 42 });
    assert.deepEqual(calls.map(([name]) => name), ['load', 'build', 'report', 'send']);
    assert.deepEqual(calls[0].slice(1, 5), [range.dateStart, range.dateEnd, 'week', branch]);
    assert.equal(calls[0][5].strictSalesPagination, true);
    assert.deepEqual(calls[1][1], {
      branch, periodMonths: 4, ...range, search: '', category: 'TODOS', brand: 'TODAS',
      line: 'TODAS', type: 'TODOS', productCode: 'TODOS',
    });
    assert.deepEqual(calls[2][1], { branch, rows, sales: raw, now: instant });
    assert.equal(calls[3][1].report.buffer, report.buffer);
    assert.equal(calls[3][1].chatId, process.env.TELEGRAM_CHAT_ID);
  }
});

test('source/build/send errors are sanitized and logs contain only branch and phase', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const unsafe = new Error(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument commercial-data`);
  for (const [dependency, phase] of [['loadProducts', 'source'], ['buildRows', 'build'], ['createReport', 'build'], ['sendReport', 'send']]) {
    const { handler, calls } = fixture({ [dependency]: () => { throw unsafe; } });
    const res = await invoke(handler);
    assert.equal(res.code, 502);
    assert.deepEqual(res.body, { message: 'No se pudo procesar el reporte.' });
    assert.deepEqual(logs.at(-1), ['telegram-report', { branch: 'ALMACEN PAS', phase }]);
    if (dependency !== 'sendReport') assert.equal(calls.some(([name]) => name === 'send'), false);
  }
});

test('multiple confirmed chats receive the same workbook with one SIAPE load', async () => {
  process.env.TELEGRAM_CHAT_ID = '123456789,987654321';
  const { handler, calls } = fixture({ sendReport: async (options) => {
    calls.push(['send', options]);
    return options.chatId === '123456789' ? 101 : 202;
  } });
  const res = await invoke(handler);
  assert.equal(res.code, 200);
  assert.equal(res.body.recipients, 2);
  assert.equal(res.body.messageId, 101);
  assert.deepEqual(res.body.messageIds, [101, 202]);
  assert.equal(calls.filter(([name]) => name === 'load').length, 1);
  assert.equal(calls.filter(([name]) => name === 'report').length, 1);
  const sends = calls.filter(([name]) => name === 'send');
  assert.deepEqual(sends.map(([, options]) => options.chatId), ['123456789', '987654321']);
  assert.equal(sends[0][1].report, sends[1][1].report);
});

test('duplicate chat IDs do not cause duplicate documents', async () => {
  process.env.TELEGRAM_CHAT_ID = '123456789,123456789';
  const { handler, calls } = fixture();
  const res = await invoke(handler);
  assert.equal(res.code, 200);
  assert.equal(calls.filter(([name]) => name === 'send').length, 1);
  assert.equal(res.body.messageId, 42);
});

test('an invalid recipient prevents any data load or delivery', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const value of ['123456789,', ',123456789', '123456789,,987654321', '123456789, 987654321', '123456789,@untrusted']) {
    process.env.TELEGRAM_CHAT_ID = value;
    const { handler, calls } = fixture();
    assert.equal((await invoke(handler)).code, 502);
    assert.deepEqual(calls, []);
  }
});

test('one blocked chat does not prevent the other delivery or trigger automatic resends', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  process.env.TELEGRAM_CHAT_ID = '123456789,987654321';
  const delivered = [];
  const { handler } = fixture({ sendReport: async ({ chatId }) => {
    delivered.push(chatId);
    if (chatId === '123456789') throw new Error('private remote error');
    return 202;
  } });
  const res = await invoke(handler);
  assert.equal(res.code, 502);
  assert.deepEqual(res.body, { message: 'No se pudo entregar a todos los destinatarios.', branch: 'ALMACEN PAS',
    delivered: 1, failed: 1, messageIds: [202] });
  assert.deepEqual(delivered, ['123456789', '987654321']);
  assert.deepEqual(logs, [['telegram-report', { branch: 'ALMACEN PAS', phase: 'send' }]]);
});

test('missing raw callback fails closed and invalid delivery IDs cannot report success', async (t) => {
  t.mock.method(console, 'error', () => {});
  const missing = fixture({ loadProducts: async () => [] });
  assert.equal((await invoke(missing.handler)).code, 502);
  assert.deepEqual(missing.calls, []);
  for (const id of [undefined, '42', 0, -1, NaN]) {
    assert.equal((await invoke(fixture({ sendReport: async () => id }).handler)).code, 502);
  }
});

test('real range, dashboard and Excel builder integrate locally without SIAPE or Telegram', async () => {
  const handler = createReportHandler({
    now: () => instant,
    loadProducts: async (start, end, bucket, branch, options) => {
      assert.deepEqual([start, end, bucket, branch], [range.dateStart, range.dateEnd, 'week', 'ALMACEN PAS']);
      options.onRawSales([]);
      return [];
    },
    sendReport: async ({ report: actual }) => {
      assert.equal(actual.branch, 'ALMACEN PAS');
      assert.equal(actual.dateStart, range.dateStart);
      assert.equal(actual.dateEnd, range.dateEnd);
      assert.equal(actual.count, 0);
      assert.equal(actual.generatedAt, instant.toISOString());
      assert.ok(Buffer.isBuffer(actual.buffer));
      assert.equal(actual.buffer.subarray(0, 2).toString(), 'PK');
      return 55;
    },
  });
  const res = await invoke(handler);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { branch: 'ALMACEN PAS', count: 0, filename: 'Reposicion_ALMACEN_PAS_2026-10-17.xlsx', messageId: 55 });
});

const delivery = (options = {}) => sendReportDocument({
  token: '123456:test-only-token', chatId: '123456789', report, ...options,
});
test('sendDocument uses native multipart, exact Excel bytes, env destination and informative caption', async () => {
  const id = await delivery({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bot123456:test-only-token/sendDocument');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('chat_id'), '123456789');
    const file = options.body.get('document');
    assert.equal(file.name, report.filename);
    assert.equal(file.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), report.buffer);
    const caption = options.body.get('caption');
    for (const text of [report.branch, range.dateStart, range.dateEnd, 'criticos: 2', '15 dias', report.generatedAt, 'omitido: 3']) {
      assert.ok(caption.includes(text));
    }
    return Response.json({ ok: true, result: { message_id: 123 } });
  } });
  assert.equal(id, 123);
});

test('429 explicit rejection retries once only for short numeric retry_after', async () => {
  for (const retryAfter of [0, 1, 5]) {
    let calls = 0;
    const sleeps = [];
    assert.equal(await delivery({
      sleep: async (ms) => sleeps.push(ms),
      fetchImpl: async () => ++calls === 1
        ? Response.json({ ok: false, error_code: 429, parameters: { retry_after: retryAfter } }, { status: 429 })
        : Response.json({ ok: true, result: { message_id: 12 } }),
    }), 12);
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [retryAfter * 1000]);
  }
  let calls = 0;
  await assert.rejects(delivery({ sleep: async () => {}, fetchImpl: async () => {
    calls += 1;
    return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, { status: 429 });
  } }));
  assert.equal(calls, 2);
});

test('400/5xx, ambiguous 429, invalid JSON, 2xx ok:false and malformed success never retry', async () => {
  const cases = [
    () => new Response('remote secret body', { status: 400 }),
    () => new Response('remote secret body', { status: 503 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ ok: false, description: 'remote secret body' }),
    ...[undefined, 0, -1, '123', 1.5, Number.MAX_SAFE_INTEGER + 1].map((message_id) => () => Response.json({ ok: true, result: { message_id } })),
    ...[undefined, -1, 6, '1', 0.5].map((retry_after) => () => Response.json({ ok: false, error_code: 429, parameters: { retry_after } }, { status: 429 })),
    () => Response.json({ ok: true, parameters: { retry_after: 1 } }, { status: 429 }),
    () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, { status: 500 }),
    () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }),
  ];
  for (const response of cases) {
    let calls = 0;
    await assert.rejects(delivery({ fetchImpl: async () => { calls += 1; return response(); } }),
      { message: 'No se pudo enviar el reporte a Telegram.' });
    assert.equal(calls, 1);
  }
});

test('network and timeout failures are sanitized, never retried and preserve no secret cause', async () => {
  for (const error of [new Error('https://api.telegram.org/bot123456:test-only-token/sendDocument'), new DOMException('secret', 'TimeoutError')]) {
    let calls = 0;
    await assert.rejects(delivery({ fetchImpl: async () => { calls += 1; throw error; } }), (failure) => {
      assert.equal(failure.message, 'No se pudo enviar el reporte a Telegram.');
      assert.equal(failure.cause, undefined);
      return true;
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  // Keep the event loop alive: AbortSignal.timeout itself uses an unref'ed timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(delivery({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } }), { message: 'No se pudo enviar el reporte a Telegram.' });
    assert.equal(calls, 1);
  } finally { clearTimeout(keepAlive); }
});
