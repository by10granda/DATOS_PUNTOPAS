import dayjs from 'dayjs';
import { buildProductOverview, loadSiapeProducts } from './_core.js';

export const maxDuration = 60;

const cache = new Map();
const queryValue = (value) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null;

const resolveOverviewRange = (months) => {
  const end = dayjs().subtract(1, 'month').endOf('month');
  const start = end.subtract(months - 1, 'month').startOf('month');
  return { dateStart: start.format('YYYY-MM-DD'), dateEnd: end.format('YYYY-MM-DD') };
};

export default async function handler(req, res) {
  const periodMonths = Math.min(3, Math.max(1, Number(queryValue(req.query?.periodMonths) ?? 3)));
  const force = queryValue(req.query?.refresh) === '1';
  const { dateStart, dateEnd } = resolveOverviewRange(periodMonths);
  const cacheDay = dayjs().hour() >= 1 ? dayjs().format('YYYY-MM-DD') : dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const cacheKey = `ALMACEN PAS-${periodMonths}-${dateStart}-${dateEnd}-${cacheDay}`;

  try {
    const cached = cache.get(cacheKey);
    if (cached && !force) return res.status(200).json(cached);
    const generatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const products = await loadSiapeProducts(dateStart, dateEnd, 'week');
    const payload = buildProductOverview(products, { branch: 'ALMACEN PAS', periodMonths, dateStart, dateEnd, cacheKey, generatedAt });
    cache.clear();
    cache.set(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar vista general de productos' });
  }
}
