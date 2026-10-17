import { createHash, timingSafeEqual } from 'node:crypto';
import { loadSiapeProducts, buildDashboard } from './_core.js';
import { sendReportDocument } from '../lib/telegram-report.js';

export const maxDuration = 60;
const branches = ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL'];
const digest = (value) => createHash('sha256').update(value).digest();

export function createReportHandler({
  loadProducts = loadSiapeProducts,
  buildRows = (products, params) => buildDashboard(products, params).rows,
  resolveRange = async (now) => (await import('../lib/replenishment.js')).resolveReportRange(now),
  createReport = async (options) => (await import('../lib/replenishment.js')).createReplenishmentReport(options),
  sendReport = sendReportDocument,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.CRON_SECRET;
    const authorization = req.headers?.authorization;
    if (!secret || typeof authorization !== 'string'
      || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
      return res.status(401).json({ message: 'No autorizado.' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ message: 'Metodo no permitido.' });
    }
    if (process.env.TELEGRAM_REPORT_ENABLED !== 'true') {
      return res.status(200).json({ skipped: 'disabled' });
    }
    const query = req.query ?? {};
    const branch = query.branch;
    if (!branches.includes(branch) || Object.keys(query).some((key) => key !== 'branch')
      || (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))) {
      return res.status(400).json({ message: 'Solicitud invalida; indique una sola sucursal.' });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = [...new Set((process.env.TELEGRAM_CHAT_ID ?? '').split(','))];
    if (!token?.trim() || /\s/.test(token) || chatIds.some((chatId) => !/^-?[1-9]\d*$/.test(chatId))) {
      console.error('telegram-report', { branch, phase: 'configuration' });
      return res.status(502).json({ message: 'No se pudo procesar el reporte.' });
    }
    let phase = 'source';
    try {
      const instant = now();
      const range = await resolveRange(instant);
      let raw;
      const products = await loadProducts(range.dateStart, range.dateEnd, 'week', branch, {
        onRawSales: (sales) => { raw = sales; }, strictSalesPagination: true,
      });
      if (!Array.isArray(raw)) throw new Error('Raw sales callback required');
      phase = 'build';
      const rows = await buildRows(products, {
        branch, periodMonths: 4, dateStart: range.dateStart, dateEnd: range.dateEnd,
        search: '', category: 'TODOS', brand: 'TODAS', line: 'TODAS', type: 'TODOS', productCode: 'TODOS',
      });
      const report = await createReport({ branch, rows, sales: raw, now: instant });
      phase = 'send';
      const deliveries = await Promise.allSettled(chatIds.map(async (chatId) => {
        const messageId = await sendReport({ token, chatId, report });
        if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('Invalid message ID');
        return messageId;
      }));
      const messageIds = deliveries.filter((delivery) => delivery.status === 'fulfilled').map((delivery) => delivery.value);
      if (messageIds.length !== chatIds.length) {
        if (chatIds.length === 1) throw new Error('Delivery failed');
        console.error('telegram-report', { branch, phase });
        return res.status(502).json({ message: 'No se pudo entregar a todos los destinatarios.', branch,
          delivered: messageIds.length, failed: chatIds.length - messageIds.length, messageIds });
      }
      const result = { branch, count: report.count, filename: report.filename, messageId: messageIds[0] };
      if (chatIds.length > 1) Object.assign(result, { recipients: chatIds.length, messageIds });
      return res.status(200).json(result);
    } catch {
      console.error('telegram-report', { branch, phase });
      return res.status(502).json({ message: 'No se pudo procesar el reporte.' });
    }
  };
}

export default createReportHandler();
