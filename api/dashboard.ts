import dayjs from 'dayjs';
import { buildDashboard } from '../server/analytics';
import { loadSiapeProducts } from '../server/siape';
import type { Branch, PeriodMonths } from '../server/types';

const branches: Branch[] = [{ name: 'ALMACEN PAS' }];
const maxRangeMonths = 3;

const queryValue = (value: unknown) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null;

const countInclusiveMonths = (dateStart: string, dateEnd: string) => {
  const start = dayjs(dateStart).startOf('month');
  const end = dayjs(dateEnd).startOf('month');
  return Math.max(1, end.diff(start, 'month') + 1);
};

const resolveDateRange = (query: Record<string, unknown>, periodMonths: PeriodMonths) => {
  const dateStart = queryValue(query.dateStart);
  const dateEnd = queryValue(query.dateEnd);

  if (dateStart || dateEnd) {
    if (!dateStart || !dateEnd || !dayjs(dateStart).isValid() || !dayjs(dateEnd).isValid()) {
      throw new Error('Debe enviar fecha inicial y fecha final validas.');
    }
    if (dayjs(dateEnd).isBefore(dayjs(dateStart))) {
      throw new Error('La fecha final no puede ser menor que la fecha inicial.');
    }
    if (countInclusiveMonths(dateStart, dateEnd) > maxRangeMonths) {
      throw new Error('La consulta manual no puede superar 3 meses.');
    }
    return { dateStart, dateEnd, effectivePeriodMonths: countInclusiveMonths(dateStart, dateEnd) as PeriodMonths };
  }

  const today = dayjs().format('YYYY-MM-DD');
  return { dateStart: today, dateEnd: today, effectivePeriodMonths: periodMonths };
};

export default async function handler(req: any, res: any) {
  const query = req.query as Record<string, unknown>;
  const branch = queryValue(query.branch);
  const periodMonths = Math.min(3, Math.max(1, Number(queryValue(query.periodMonths) ?? 1))) as PeriodMonths;
  const search = queryValue(query.search) ?? '';
  const category = queryValue(query.category) ?? 'TODOS';
  const brand = queryValue(query.brand) ?? 'TODAS';
  const line = queryValue(query.line) ?? 'TODAS';
  const type = queryValue(query.type) ?? 'TODOS';
  const productCode = queryValue(query.productCode) ?? 'TODOS';

  try {
    const { dateStart, dateEnd, effectivePeriodMonths } = resolveDateRange(query, periodMonths);

    if (!branch) {
      const payload = buildDashboard([], branches, { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd });
      res.status(200).json(payload);
      return;
    }

    if (branch !== 'ALMACEN PAS') {
      res.status(400).json({ message: 'Actualmente solo esta habilitada la API de ALMACEN PAS.' });
      return;
    }

    const products = await loadSiapeProducts(dateStart, dateEnd);
    const payload = buildDashboard(products, branches, { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd });
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar datos desde SIAPE' });
  }
}
