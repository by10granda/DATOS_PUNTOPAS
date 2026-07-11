import dayjs from 'dayjs';
import { buildProductOverview, loadSiapeProducts } from './_core.js';

export const maxDuration = 60;

const resolveOverviewRange = (months) => {
  const end = dayjs().subtract(1, 'month').endOf('month');
  const start = end.subtract(months - 1, 'month').startOf('month');
  return { dateStart: start.format('YYYY-MM-DD'), dateEnd: end.format('YYYY-MM-DD') };
};

const buildAssistantContext = (payload) => ({
  titulo: payload.title,
  periodo: payload.periodLabel,
  sucursal: payload.branch,
  kpis: payload.kpis,
  productosRelevantes: payload.rows.slice(0, 30).map((row) => ({
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
  }))
});

const askAI = async (question, context) => {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) throw new Error('Configure OPENROUTER_API_KEY en Vercel para usar el asistente.');
  const model = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openRouterKey}`,
      'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://datos-puntopas.vercel.app',
      'X-Title': 'Datos Punto PAS'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Eres un analista ejecutivo BI de ALMACEN PAS. Responde en espanol, claro, directo y basado unicamente en los datos enviados. Si falta un dato, dilo.' },
        { role: 'user', content: `Datos disponibles:\n${JSON.stringify(context)}\n\nPregunta: ${question}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenRouter respondio HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return body.choices?.[0]?.message?.content?.trim() ?? 'No se pudo generar una respuesta.';
};

const formatMoney = (value) => value.toLocaleString('es-EC', { style: 'currency', currency: 'USD' });
const answerDirectly = async (question, periodMonths) => {
  const normalized = question.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  if (['hola', 'buenos dias', 'buenas tardes', 'buenas noches'].includes(normalized.trim())) {
    return 'Hola. Soy el asistente IA de ALMACEN PAS. Puedes preguntarme por ventas de hoy, inventario, proveedores, rotación, margen o productos con sobrestock.';
  }

  if (normalized.includes('hoy') && (normalized.includes('vend') || normalized.includes('venta'))) {
    const today = dayjs().format('YYYY-MM-DD');
    const products = await loadSiapeProducts(today, today);
    const rows = products
      .map((product) => ({
        code: product.code,
        description: product.description,
        provider: product.provider,
        quantity: product.monthlySales.reduce((sum, sale) => sum + sale.quantity, 0),
        revenue: product.salesRevenueWithIva ?? 0
      }))
      .filter((row) => row.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
    const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    if (rows.length === 0) return `Hoy ${today} no hay productos vendidos registrados en SIAPE para ALMACEN PAS.`;
    const detail = rows.slice(0, 15).map((row, index) => `${index + 1}. ${row.code} - ${row.description}: ${row.quantity} unidades, ${formatMoney(row.revenue)}, proveedor ${row.provider || 'N/D'}`).join('\n');
    return `Hoy ${today} se vendieron ${rows.length} productos distintos, con ${totalUnits} unidades y un total vendido de ${formatMoney(totalRevenue)}.\n\nProductos principales:\n${detail}`;
  }

  if (normalized.includes('sobrestock') || normalized.includes('sobre stock')) {
    const { dateStart, dateEnd } = resolveOverviewRange(periodMonths);
    const products = await loadSiapeProducts(dateStart, dateEnd, 'week');
    const payload = buildProductOverview(products, { branch: 'ALMACEN PAS', periodMonths, dateStart, dateEnd, cacheKey: 'assistant-direct', generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    const rows = payload.rows.filter((row) => row.inventoryState.toLowerCase().includes('sobrestock'));
    return `En el periodo ${payload.periodLabel} hay ${rows.length} productos con sobrestock.\n\nPrincipales por capital inmovilizado:\n${rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.code} - ${row.description}: stock ${row.stockTotal}, cobertura ${row.coverageDays >= 999 ? '999+' : row.coverageDays.toFixed(0)} días, capital ${formatMoney(row.immobilizedCapital)}`).join('\n')}`;
  }

  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Método no permitido.' });
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const periodMonths = Math.min(3, Math.max(1, Number(req.body?.periodMonths ?? 3)));
  if (!question) return res.status(400).json({ message: 'Debe enviar una pregunta.' });

  try {
    const directAnswer = await answerDirectly(question, periodMonths);
    if (directAnswer) return res.status(200).json({ answer: directAnswer, periodLabel: 'Respuesta directa con datos reales' });
    const { dateStart, dateEnd } = resolveOverviewRange(periodMonths);
    const products = await loadSiapeProducts(dateStart, dateEnd, 'week');
    const payload = buildProductOverview(products, { branch: 'ALMACEN PAS', periodMonths, dateStart, dateEnd, cacheKey: 'assistant', generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    const answer = await askAI(question, buildAssistantContext(payload));
    return res.status(200).json({ answer, periodLabel: payload.periodLabel });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el asistente.' });
  }
}
