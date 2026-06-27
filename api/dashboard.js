import dayjs from 'dayjs';
import { branches, buildDashboard, loadSiapeProducts } from './_core.js';

export const maxDuration = 60;

const queryValue = (value) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null;
const countInclusiveMonths = (dateStart, dateEnd) => Math.max(1, dayjs(dateEnd).startOf('month').diff(dayjs(dateStart).startOf('month'), 'month') + 1);

const resolveDateRange = (query, periodMonths) => {
  const dateStart = queryValue(query.dateStart);
  const dateEnd = queryValue(query.dateEnd);
  if (dateStart || dateEnd) {
    if (!dateStart || !dateEnd || !dayjs(dateStart).isValid() || !dayjs(dateEnd).isValid()) throw new Error('Debe enviar fecha inicial y fecha final validas.');
    if (dayjs(dateEnd).isBefore(dayjs(dateStart))) throw new Error('La fecha final no puede ser menor que la fecha inicial.');
    if (countInclusiveMonths(dateStart, dateEnd) > 3) throw new Error('La consulta manual no puede superar 3 meses.');
    return { dateStart, dateEnd, effectivePeriodMonths: countInclusiveMonths(dateStart, dateEnd) };
  }
  const today = dayjs().format('YYYY-MM-DD');
  return { dateStart: today, dateEnd: today, effectivePeriodMonths: periodMonths };
};

export default async function handler(req, res) {
  const query = req.query ?? {};
  const branch = queryValue(query.branch);
  const periodMonths = Math.min(3, Math.max(1, Number(queryValue(query.periodMonths) ?? 1)));
  const search = queryValue(query.search) ?? '';
  const category = queryValue(query.category) ?? 'TODOS';
  const brand = queryValue(query.brand) ?? 'TODAS';
  const line = queryValue(query.line) ?? 'TODAS';
  const type = queryValue(query.type) ?? 'TODOS';
  const productCode = queryValue(query.productCode) ?? 'TODOS';

  try {
    const { dateStart, dateEnd, effectivePeriodMonths } = resolveDateRange(query, periodMonths);
    const params = { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd };
    if (!branch) return res.status(200).json(buildDashboard([], params));
    if (branch !== 'ALMACEN PAS') return res.status(400).json({ message: 'Actualmente solo esta habilitada la API de ALMACEN PAS.' });
    const products = await loadSiapeProducts(dateStart, dateEnd);
    return res.status(200).json(buildDashboard(products, params));
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar datos desde SIAPE', branches });
  }
}
