import { fetchJson, getToken, resolveBranchConfig } from './_core.js';

const CACHE_TTL_MS = 25 * 1000;
const MAX_CODES = 40;
const MAX_CONCURRENCY = 6;
const CODE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const successfulCache = new Map();
const inFlight = new Map();

const normalizeWarehouseName = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';

const mapWarehouseStocks = (stockBodega) => {
  if (!Array.isArray(stockBodega)) throw new Error('Respuesta invalida de /api/item: stockBodega debe ser una lista');
  const warehouseStocks = {};
  for (const warehouse of stockBodega) {
    const name = normalizeWarehouseName(warehouse?.txDescripcionBodega);
    const stock = Number(warehouse?.qnStock);
    if (!name || !Number.isFinite(stock)) throw new Error('Respuesta invalida de /api/item: bodega o stock invalido');
    warehouseStocks[name] = (warehouseStocks[name] ?? 0) + stock;
  }
  return warehouseStocks;
};

export const loadWarehouseStocks = async (branch, codes, dependencies = {}) => {
  const resolveConfig = dependencies.resolveBranchConfig ?? resolveBranchConfig;
  const getTokenFn = dependencies.getToken ?? getToken;
  const fetchJsonFn = dependencies.fetchJson ?? fetchJson;
  const { name, baseUrl, user, password } = resolveConfig(branch);
  const token = await getTokenFn(baseUrl, { user, password, branch: name });
  const items = new Array(codes.length);
  const missingCodes = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < codes.length) {
      const index = nextIndex++;
      const code = codes[index];
      try {
        const product = await fetchJsonFn(baseUrl, `/api/item?code=${encodeURIComponent(code)}`, token);
        items[index] = { code, warehouseStocks: mapWarehouseStocks(product?.stockBodega) };
      } catch (error) {
        if (error?.status === 404) {
          items[index] = { code, warehouseStocks: {} };
          missingCodes.push(code);
          continue;
        }
        throw error;
      }
    }
  };

  const maxConcurrency = Number.isInteger(dependencies.maxConcurrency) && dependencies.maxConcurrency > 0
    ? dependencies.maxConcurrency : MAX_CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, codes.length) }, worker));
  const warehouseNames = Array.from(new Set(items.flatMap((item) => Object.keys(item.warehouseStocks)))).sort((a, b) => a.localeCompare(b, 'es'));
  return { branch: name, items, warehouseNames, missingCodes };
};

const cacheKey = (branch, code) => `${branch}\u0000${code}`;

const loadCachedWarehouseStocks = async (branch, codes) => {
  const results = new Map();
  const newCodes = [];
  for (const code of codes) {
    const key = cacheKey(branch, code);
    const cached = successfulCache.get(key);
    if (cached?.expiresAt > Date.now()) results.set(code, cached);
    else if (!inFlight.has(key)) newCodes.push(code);
  }

  if (newCodes.length) {
    const batch = loadWarehouseStocks(branch, newCodes).then(({ items, missingCodes }) => {
      const missing = new Set(missingCodes);
      const records = new Map(items.map((item) => [item.code, { item, missing: missing.has(item.code) }]));
      // A 404 is an unknown product, not a successful stock snapshot.
      for (const [code, record] of records) {
        if (!record.missing) successfulCache.set(cacheKey(branch, code), { ...record, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return records;
    });
    for (const code of newCodes) {
      const key = cacheKey(branch, code);
      const request = batch.then((records) => records.get(code)).finally(() => inFlight.delete(key));
      inFlight.set(key, request);
    }
  }

  await Promise.all(codes.map(async (code) => {
    if (results.has(code)) return;
    const cached = await inFlight.get(cacheKey(branch, code));
    results.set(code, cached);
  }));
  return codes.map((code) => results.get(code));
};

const validRequest = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('branch') || !keys.includes('codes')) return null;
  if (typeof body.branch !== 'string' || !Array.isArray(body.codes) || body.codes.length === 0 || body.codes.length > MAX_CODES) return null;
  if (body.codes.some((code) => typeof code !== 'string' || !code || code.length > 25 || !CODE_PATTERN.test(code))) return null;
  const codes = [...new Set(body.codes)];
  if (codes.length !== body.codes.length) return null;
  return { branch: body.branch, codes };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Metodo no permitido' });
  const request = validRequest(req.body);
  if (!request) return res.status(400).json({ message: 'Solicitud invalida' });
  try {
    // Validate the public branch selector before any SIAPE call.
    resolveBranchConfig(request.branch);
    const cachedItems = await loadCachedWarehouseStocks(request.branch, request.codes);
    const items = cachedItems.map((cached) => cached.item);
    const warehouseNames = Array.from(new Set(items.flatMap((item) => Object.keys(item.warehouseStocks)))).sort((a, b) => a.localeCompare(b, 'es'));
    const missingCodes = cachedItems.filter((cached) => cached.missing).map((cached) => cached.item.code);
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({ branch: request.branch, items, warehouseNames, missingCodes });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar bodegas desde SIAPE' });
  }
}
