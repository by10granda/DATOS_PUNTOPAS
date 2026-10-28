import { createHash, timingSafeEqual } from 'node:crypto';
import { fetchJson, getToken, resolveBranchConfig } from './_core.js';
import { loadWarehouseStocks } from './product-warehouses.js';
import { createMadereraStockReport } from '../lib/maderera-report.js';
import { sendReportDocument } from '../lib/telegram-report.js';

export const maxDuration = 60;
const BRANCH = 'VARIEDADES PAS';
const digest = (value) => createHash('sha256').update(value).digest();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export async function loadMadereraRows() {
  const { name, baseUrl, user, password } = resolveBranchConfig(BRANCH);
  const token = await getToken(baseUrl, { user, password, branch: name });
  const [inventory, stockInventory] = await Promise.all([
    fetchJson(baseUrl, '/api/item/reporteinventario', token),
    fetchJson(baseUrl, '/api/item/inventario', token),
  ]);
  if (!Array.isArray(inventory) || !Array.isArray(stockInventory)) throw new Error('Inventario invalido de SIAPE');
  const descriptions = new Map(inventory.filter((item) => typeof item?.codigo === 'string')
    .map((item) => [item.codigo, typeof item.descripcion === 'string' ? item.descripcion.trim() : '']));
  const codes = stockInventory.filter((item) => typeof item?.codigo === 'string' && number(item.disponible) > 0)
    .map((item) => item.codigo);
  const details = await loadWarehouseStocks(BRANCH, [...new Set(codes)], { maxConcurrency: 60 });
  return details.items.map(({ code, warehouseStocks }) => ({
    code,
    description: descriptions.get(code) ?? '',
    bodegaGeneralSl: warehouseStocks['BODEGA GENERAL SL'] ?? 0,
    exhibicion: warehouseStocks.EXHIBICION ?? 0,
    galponMaderera: warehouseStocks['GALPON MADERERA'] ?? 0,
  }));
}

export function createMadereraReportHandler({
  loadRows = loadMadereraRows,
  createReport = createMadereraStockReport,
  sendReport = sendReportDocument,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.CRON_SECRET;
    const authorization = req.headers?.authorization;
    if (!secret || typeof authorization !== 'string' || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
      return res.status(401).json({ message: 'No autorizado.' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ message: 'Metodo no permitido.' });
    }
    if ((req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))
      || Object.keys(req.query ?? {}).length) return res.status(400).json({ message: 'Solicitud invalida.' });
    if (process.env.TELEGRAM_MADERERA_REPORT_ENABLED !== 'true') return res.status(200).json({ skipped: 'disabled' });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_MADERERA_CHAT_ID;
    if (!token?.trim() || /\s/.test(token) || typeof chatId !== 'string' || !/^-?[1-9]\d*$/.test(chatId)) {
      console.error('telegram-maderera-report', { phase: 'configuration' });
      return res.status(502).json({ message: 'No se pudo procesar el reporte.' });
    }
    let phase = 'source';
    try {
      const report = await createReport({ branch: BRANCH, rows: await loadRows(), now: now() });
      phase = 'send';
      const messageId = await sendReport({ token, chatId, report });
      if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('Invalid message ID');
      return res.status(200).json({ branch: BRANCH, count: report.count, filename: report.filename, messageId });
    } catch {
      console.error('telegram-maderera-report', { phase });
      return res.status(502).json({ message: 'No se pudo procesar el reporte.' });
    }
  };
}

export default createMadereraReportHandler();
