import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import { createMadereraStockReport } from '../lib/maderera-report.js';
import { createMadereraReportHandler } from '../api/telegram-maderera-report.js';

const now = new Date('2026-10-28T12:00:00Z');

test('Maderera workbook includes only positive Maderera stock and the three requested columns', () => {
  const report = createMadereraStockReport({ branch: 'VARIEDADES PAS', now, rows: [
    { code: 'B', description: 'Producto B', bodegaGeneralSl: 2, exhibicion: 3, galponMaderera: 0 },
    { code: 'A', description: 'Producto A', bodegaGeneralSl: 4, exhibicion: 0, galponMaderera: 8 },
  ] });
  const sheet = XLSX.read(report.buffer, { type: 'buffer' }).Sheets['Stock Maderera'];
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  assert.equal(report.count, 1);
  assert.deepEqual(table[5], ['Codigo', 'Descripcion', 'Stock BODEGA GENERAL SL', 'Stock EXHIBICION', 'Stock GALPON MADERERA']);
  assert.deepEqual(table[6], ['A', 'Producto A', 4, 0, 8]);
});

test('Maderera endpoint sends only to its configured recipient', async () => {
  const previous = Object.fromEntries(['CRON_SECRET', 'TELEGRAM_MADERERA_REPORT_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_MADERERA_CHAT_ID'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { CRON_SECRET: 'secret', TELEGRAM_MADERERA_REPORT_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_MADERERA_CHAT_ID: '1906142962' });
  try {
    let sent;
    const handler = createMadereraReportHandler({
      now: () => now,
      loadRows: async () => [{ code: 'A', description: 'Producto A', bodegaGeneralSl: 4, exhibicion: 0, galponMaderera: 8 }],
      sendReport: async (options) => { sent = options; return 7; },
    });
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', headers: { authorization: 'Bearer secret' }, query: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.count, 1);
    assert.equal(sent.chatId, '1906142962');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
