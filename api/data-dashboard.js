import dayjs from 'dayjs';
import { buildProductOverview, compactProductOverview, loadBranchData, resolveBranchConfig } from './_core.js';

export const maxDuration = 60;

const cache = new Map();
const queryValue = (value) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null;

export default async function handler(req, res) {
  const branch = queryValue(req.query?.branch) ?? 'ALMACEN PAS';
  const bucket = queryValue(req.query?.bucket) === 'day' ? 'day' : 'week';
  const months = Math.min(12, Math.max(1, Number(queryValue(req.query?.months) ?? 12)));
  const days = Math.min(31, Math.max(1, Number(queryValue(req.query?.days) ?? 7)));
  const force = queryValue(req.query?.refresh) === '1';

  const end = dayjs();
  const start = bucket === 'day'
    ? end.subtract(days - 1, 'day')
    : end.subtract(months, 'month').add(1, 'day');
  const dateStart = start.format('YYYY-MM-DD');
  const dateEnd = end.format('YYYY-MM-DD');
  const cacheKey = `${branch}-${bucket}-${bucket === 'day' ? days : months}-${dateStart}-${dateEnd}`;

  try {
    resolveBranchConfig(branch);
    const cached = cache.get(cacheKey);
    if (cached && !force) return res.status(200).json(cached);

    const generatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const { products, warehouseNames } = await loadBranchData(dateStart, dateEnd, bucket, branch);
    const payload = compactProductOverview(buildProductOverview(products, {
      branch,
      periodMonths: bucket === 'day' ? 1 : months,
      dateStart,
      dateEnd,
      cacheKey,
      generatedAt,
      warehouseNames
    }));
    cache.clear();
    cache.set(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar el dashboard de datos' });
  }
}
