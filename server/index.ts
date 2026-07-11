import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import dayjs from 'dayjs';
import { buildDashboard, buildProductOverview } from './analytics';
import { loadSiapeProducts } from './siape';
import type { Branch, PeriodMonths } from './types';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

const branches: Branch[] = [{ name: 'ALMACEN PAS' }];

const maxRangeMonths = 3;
const overviewCache = new Map<string, { generatedAt: string; payload: unknown }>();

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

const resolveOverviewRange = (months: PeriodMonths) => {
  const end = dayjs().subtract(1, 'month').endOf('month');
  const start = end.subtract(months - 1, 'month').startOf('month');
  return { dateStart: start.format('YYYY-MM-DD'), dateEnd: end.format('YYYY-MM-DD') };
};

app.get('/api/product-overview', async (req, res) => {
  const periodMonths = Math.min(3, Math.max(1, Number(req.query.periodMonths ?? 3))) as PeriodMonths;
  const force = req.query.refresh === '1';
  const { dateStart, dateEnd } = resolveOverviewRange(periodMonths);
  const cacheKey = `ALMACEN PAS-${periodMonths}-${dateStart}-${dateEnd}-${dayjs().hour() >= 1 ? dayjs().format('YYYY-MM-DD') : dayjs().subtract(1, 'day').format('YYYY-MM-DD')}`;

  try {
    const cached = overviewCache.get(cacheKey);
    if (cached && !force) {
      res.json(cached.payload);
      return;
    }
    const generatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const products = await loadSiapeProducts(dateStart, dateEnd, 'week');
    const payload = buildProductOverview(products, { branch: 'ALMACEN PAS', periodMonths, dateStart, dateEnd, cacheKey, generatedAt });
    overviewCache.clear();
    overviewCache.set(cacheKey, { generatedAt, payload });
    res.json(payload);
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo cargar vista general de productos' });
  }
});

const buildAssistantContext = (payload: ReturnType<typeof buildProductOverview>) => {
  const topRows = payload.rows.slice(0, 30).map((row) => ({
    codigo: row.code,
    descripcion: row.description,
    proveedor: row.provider,
    unidadesVendidas: row.salesXMonths,
    valorVendido: Number(row.valueSold.toFixed(2)),
    utilidad: Number(row.totalProfit.toFixed(2)),
    margen: Number(row.marginPercent.toFixed(2)),
    stockTotal: row.stockTotal,
    rotacion: Number(row.rotation.toFixed(2)),
    coberturaDias: row.coverageDays >= 999 ? '999+' : Number(row.coverageDays.toFixed(0)),
    abc: row.abcClass,
    tendencia: row.trend,
    estado: row.inventoryState,
  }));

  return {
    titulo: payload.title,
    periodo: payload.periodLabel,
    sucursal: payload.branch,
    kpis: payload.kpis,
    productosRelevantes: topRows,
  };
};

const askAI = async (question: string, context: unknown) => {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const model = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterKey}`,
        'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173',
        'X-Title': 'Datos Punto PAS'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Eres un analista ejecutivo BI de ALMACEN PAS. Responde en español, claro, directo y basado únicamente en los datos enviados. Si falta un dato, dilo.' },
          { role: 'user', content: `Datos disponibles:\n${JSON.stringify(context)}\n\nPregunta: ${question}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenRouter respondió HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content?.trim() ?? 'No se pudo generar una respuesta.';
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Configure OPENROUTER_API_KEY u OPENAI_API_KEY.');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Eres un analista ejecutivo BI de ALMACEN PAS. Responde en español, claro, directo y basado únicamente en los datos enviados. Si falta un dato, dilo.' },
        { role: 'user', content: `Datos disponibles:\n${JSON.stringify(context)}\n\nPregunta: ${question}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() ?? 'No se pudo generar una respuesta.';
};

app.post('/api/assistant', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const periodMonths = Math.min(3, Math.max(1, Number(req.body?.periodMonths ?? 3))) as PeriodMonths;
  if (!question) {
    res.status(400).json({ message: 'Debe enviar una pregunta.' });
    return;
  }

  try {
    const { dateStart, dateEnd } = resolveOverviewRange(periodMonths);
    const products = await loadSiapeProducts(dateStart, dateEnd, 'week');
    const payload = buildProductOverview(products, { branch: 'ALMACEN PAS', periodMonths, dateStart, dateEnd, cacheKey: 'assistant', generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    const answer = await askAI(question, buildAssistantContext(payload));
    res.json({ answer, periodLabel: payload.periodLabel });
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el asistente.' });
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
