import dayjs from 'dayjs';
import { branches, buildDashboard, compactCatalog, compactDashboard, loadBranchData, resolveBranchConfig } from './_core.js';

export const maxDuration = 60;

const queryValue = (value) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null;
const countInclusiveMonths = (dateStart, dateEnd) => Math.max(1, dayjs(dateEnd).startOf('month').diff(dayjs(dateStart).startOf('month'), 'month') + 1);

// Building a dashboard costs several seconds of CPU even with SIAPE cached, so
// identical requests (autorefresh, re-applying a range, toggling filters) reuse the
// last payload for a short window. Closed date ranges get a longer TTL.
const dashboardCache = new Map();
const dashboardInflight = new Map();
const DASHBOARD_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 45 * 1000);
const DASHBOARD_HISTORY_TTL_MS = Number(process.env.DASHBOARD_HISTORY_CACHE_TTL_MS ?? 10 * 60 * 1000);
// The public catalog only publishes prices, which do not change every minute.
const CATALOG_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 10 * 60 * 1000);
const DASHBOARD_CACHE_ENTRIES = Number(process.env.DASHBOARD_CACHE_ENTRIES ?? 3);

const dashboardTtl = (dateEnd) => dayjs(dateEnd).isBefore(dayjs().format('YYYY-MM-DD')) ? DASHBOARD_HISTORY_TTL_MS : DASHBOARD_TTL_MS;

const readDashboardCache = (key) => {
  const cached = dashboardCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.loadedAt >= cached.ttlMs) {
    dashboardCache.delete(key);
    return null;
  }
  return cached.payload;
};

const rememberDashboard = (key, payload, ttlMs) => {
  dashboardCache.set(key, { loadedAt: Date.now(), ttlMs, payload });
  while (dashboardCache.size > Math.max(1, DASHBOARD_CACHE_ENTRIES)) {
    const oldest = dashboardCache.keys().next().value;
    if (oldest === undefined) break;
    dashboardCache.delete(oldest);
  }
};

const resolveDateRange = (query, periodMonths) => {
  const dateStart = queryValue(query.dateStart);
  const dateEnd = queryValue(query.dateEnd);
  if (dateStart || dateEnd) {
    if (!dateStart || !dateEnd || !dayjs(dateStart).isValid() || !dayjs(dateEnd).isValid()) throw new Error('Debe enviar fecha inicial y fecha final validas.');
    if (dayjs(dateEnd).isBefore(dayjs(dateStart))) throw new Error('La fecha final no puede ser menor que la fecha inicial.');
    if (dayjs(dateEnd).isAfter(dayjs(dateStart).add(1, 'year'))) throw new Error('La consulta manual no puede superar 1 año.');
    return { dateStart, dateEnd, effectivePeriodMonths: Math.min(12, countInclusiveMonths(dateStart, dateEnd)) };
  }
  const today = dayjs().format('YYYY-MM-DD');
  return { dateStart: today, dateEnd: today, effectivePeriodMonths: periodMonths };
};

export default async function handler(req, res) {
  const query = req.query ?? {};
  const branch = queryValue(query.branch);
  const periodMonths = Math.min(12, Math.max(1, Number(queryValue(query.periodMonths) ?? 1)));
  const search = queryValue(query.search) ?? '';
  const category = queryValue(query.category) ?? 'TODOS';
  const brand = queryValue(query.brand) ?? 'TODAS';
  const line = queryValue(query.line) ?? 'TODAS';
  const type = queryValue(query.type) ?? 'TODOS';
  const productCode = queryValue(query.productCode) ?? 'TODOS';

  try {
    const { dateStart, dateEnd, effectivePeriodMonths } = resolveDateRange(query, periodMonths);
    const params = { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd };
    const compact = queryValue(query.compact) === '1';
    const catalog = queryValue(query.catalog) === '1';
    const transport = (payload) => catalog ? compactCatalog(payload) : compact ? compactDashboard(payload) : payload;
    if (!branch) return res.status(200).json(transport(buildDashboard([], params)));
    resolveBranchConfig(branch);
    const cacheKey = JSON.stringify([branch, effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd, compact, catalog]);
    const cached = readDashboardCache(cacheKey);
    if (cached) return res.status(200).json(cached);
    const pending = dashboardInflight.get(cacheKey);
    if (pending) return res.status(200).json(await pending);

    const request = (async () => {
      const { products, warehouseNames } = await loadBranchData(dateStart, dateEnd, dateStart === dateEnd ? 'hour' : 'week', branch);
      const payload = buildDashboard(products, { ...params, warehouseNames });
      const transported = transport(payload);
      rememberDashboard(cacheKey, transported, catalog ? CATALOG_TTL_MS : dashboardTtl(dateEnd));
      return transported;
    })().finally(() => {
      dashboardInflight.delete(cacheKey);
    });
    dashboardInflight.set(cacheKey, request);
    return res.status(200).json(await request);
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar datos desde SIAPE', branches });
  }
}
