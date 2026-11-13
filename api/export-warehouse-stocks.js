import { loadWarehouseStocks } from './product-warehouses.js';
import { resolveBranchConfig } from './_core.js';

export const maxDuration = 60;
const MAX_CODES = 10_000;
const CODE_PATTERN = /^[^\u0000-\u001F\u007F]+$/;

const validRequest = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2) return null;
  if (typeof body.branch !== 'string' || !Array.isArray(body.codes) || !body.codes.length || body.codes.length > MAX_CODES) return null;
  if (body.codes.some((code) => typeof code !== 'string' || !code || code.length > 25 || !CODE_PATTERN.test(code))) return null;
  const codes = [...new Set(body.codes)];
  return codes.length === body.codes.length ? { branch: body.branch, codes } : null;
};

export function createWarehouseExportHandler({
  loadStocks = loadWarehouseStocks,
  resolveBranch = resolveBranchConfig,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Metodo no permitido' });
    const request = validRequest(req.body);
    if (!request) return res.status(400).json({ message: 'Solicitud invalida' });
    try {
      resolveBranch(request.branch);
      const result = await loadStocks(request.branch, request.codes, { maxConcurrency: 60 });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json(result);
    } catch (error) {
      return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar bodegas desde SIAPE' });
    }
  };
}

export default createWarehouseExportHandler();
