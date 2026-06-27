import dayjs from 'dayjs';
import { authHeaders, buildUrl, getToken } from './_core.js';

export const maxDuration = 60;

const safeText = async (response) => {
  const text = await response.text();
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

export default async function handler(_req, res) {
  const baseUrl = process.env.SIAPE_API_BASE_URL;
  const diagnostics = {
    env: {
      SIAPE_API_BASE_URL: Boolean(baseUrl),
      SIAPE_API_USER: Boolean(process.env.SIAPE_API_USER),
      SIAPE_API_PASSWORD: Boolean(process.env.SIAPE_API_PASSWORD),
      SIAPE_AUTH_HEADER: process.env.SIAPE_AUTH_HEADER ?? 'Authorization',
      SIAPE_AUTH_PREFIX: process.env.SIAPE_AUTH_PREFIX ?? 'Bearer',
      SIAPE_PAGE_SIZE: process.env.SIAPE_PAGE_SIZE ?? null,
      SIAPE_DUPLICATE_WINDOW_SECONDS: process.env.SIAPE_DUPLICATE_WINDOW_SECONDS ?? null
    }
  };

  if (!baseUrl || !process.env.SIAPE_API_USER || !process.env.SIAPE_API_PASSWORD) {
    return res.status(500).json({ ok: false, message: 'Faltan variables SIAPE en Vercel.', diagnostics });
  }

  try {
    const token = await getToken(baseUrl);
    diagnostics.login = { ok: true };
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
    const salesQuery = new URLSearchParams({ fechaInicio: today, fechaFin: tomorrow, page: '1', pageSize: '10' });
    const [inventoryResponse, salesResponse] = await Promise.all([
      fetch(buildUrl(baseUrl, '/api/item/reporteinventario'), { headers: authHeaders(token) }),
      fetch(buildUrl(baseUrl, `/api/factura/reporteventas?${salesQuery.toString()}`), { headers: authHeaders(token) })
    ]);
    diagnostics.inventory = { status: inventoryResponse.status, ok: inventoryResponse.ok };
    diagnostics.sales = { status: salesResponse.status, ok: salesResponse.ok, dateStart: today, dateEnd: tomorrow };
    if (!inventoryResponse.ok || !salesResponse.ok) return res.status(502).json({ ok: false, message: 'SIAPE respondio error en inventario o ventas.', diagnostics });
    const inventory = await inventoryResponse.json();
    const sales = await salesResponse.json();
    diagnostics.inventory.count = Array.isArray(inventory) ? inventory.length : null;
    diagnostics.sales.count = Array.isArray(sales) ? sales.length : null;
    return res.status(200).json({ ok: true, message: 'Conexion SIAPE correcta desde Vercel.', diagnostics });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Error desconocido probando SIAPE.', diagnostics });
  }
}
