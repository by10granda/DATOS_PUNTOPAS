import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import dayjs from 'dayjs';
import { buildDashboard } from './analytics';
import { loadSiapeProducts } from './siape';
import type { Branch, PeriodMonths } from './types';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

const branches: Branch[] = [{ name: 'ALMACEN PAS' }];

const maxRangeMonths = 3;

const countInclusiveMonths = (dateStart: string, dateEnd: string) => {
  const start = dayjs(dateStart).startOf('month');
  const end = dayjs(dateEnd).startOf('month');
  return Math.max(1, end.diff(start, 'month') + 1);
};

const resolveDateRange = (req: express.Request, periodMonths: PeriodMonths) => {
  const dateStart = typeof req.query.dateStart === 'string' ? req.query.dateStart : null;
  const dateEnd = typeof req.query.dateEnd === 'string' ? req.query.dateEnd : null;

  if (dateStart || dateEnd) {
    if (!dateStart || !dateEnd || !dayjs(dateStart).isValid() || !dayjs(dateEnd).isValid()) {
      throw new Error('Debe enviar fecha inicial y fecha final válidas.');
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
  return { dateStart: today, dateEnd: today, effectivePeriodMonths: 1 as PeriodMonths };
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'DISTRIBUIDOR PUNTO PAS - ANÁLISIS DE DATOS' });
});

app.get('/api/branches', (_req, res) => {
  res.json(branches);
});

app.get('/api/dashboard', async (req, res) => {
  const branch = typeof req.query.branch === 'string' && req.query.branch.length > 0 ? req.query.branch : null;
  const periodMonths = Math.min(3, Math.max(1, Number(req.query.periodMonths ?? 3))) as PeriodMonths;
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const category = typeof req.query.category === 'string' && req.query.category.length > 0 ? req.query.category : 'TODOS';
  const brand = typeof req.query.brand === 'string' && req.query.brand.length > 0 ? req.query.brand : 'TODAS';
  const line = typeof req.query.line === 'string' && req.query.line.length > 0 ? req.query.line : 'TODAS';
  const type = typeof req.query.type === 'string' && req.query.type.length > 0 ? req.query.type : 'TODOS';
  const productCode = typeof req.query.productCode === 'string' && req.query.productCode.length > 0 ? req.query.productCode : 'TODOS';

  try {
    const { dateStart, dateEnd, effectivePeriodMonths } = resolveDateRange(req, periodMonths);

    if (!branch) {
      const payload = buildDashboard([], branches, { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd });
      res.json(payload);
      return;
    }

    if (branch !== 'ALMACEN PAS') {
      res.status(400).json({ message: 'Actualmente solo está habilitada la API de ALMACEN PAS.' });
      return;
    }

    const products = await loadSiapeProducts(dateStart, dateEnd);
    const payload = buildDashboard(products, branches, { branch, periodMonths: effectivePeriodMonths, search, category, brand, line, type, productCode, dateStart, dateEnd });
    res.json(payload);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar datos desde SIAPE' });
  }
});

app.get('/api/product/:id', (_req, res) => {
  res.status(410).json({ message: 'El detalle de producto ahora se obtiene desde la tabla cargada por SIAPE.' });
});

if (fs.existsSync(path.resolve(process.cwd(), 'dist'))) {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
