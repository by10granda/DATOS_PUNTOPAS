import dayjs from 'dayjs';

export const maxDuration = 60;

const buildUrl = (baseUrl: string, path: string) => {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return `${cleanBase}${cleanPath.slice(4)}`;
  }
  return `${cleanBase}${cleanPath}`;
};

const safeText = async (response: Response) => {
  const text = await response.text();
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

export default async function handler(_req: any, res: any) {
  const baseUrl = process.env.SIAPE_API_BASE_URL;
  const user = process.env.SIAPE_API_USER;
  const password = process.env.SIAPE_API_PASSWORD;
  const header = process.env.SIAPE_AUTH_HEADER ?? 'Authorization';
  const prefix = process.env.SIAPE_AUTH_PREFIX ?? 'Bearer';

  const diagnostics: Record<string, unknown> = {
    env: {
      SIAPE_API_BASE_URL: Boolean(baseUrl),
      SIAPE_API_USER: Boolean(user),
      SIAPE_API_PASSWORD: Boolean(password),
      SIAPE_AUTH_HEADER: header,
      SIAPE_AUTH_PREFIX: prefix,
      SIAPE_PAGE_SIZE: process.env.SIAPE_PAGE_SIZE ?? null,
      SIAPE_DUPLICATE_WINDOW_SECONDS: process.env.SIAPE_DUPLICATE_WINDOW_SECONDS ?? null
    }
  };

  if (!baseUrl || !user || !password) {
    res.status(500).json({ ok: false, message: 'Faltan variables SIAPE en Vercel.', diagnostics });
    return;
  }

  try {
    const loginResponse = await fetch(buildUrl(baseUrl, '/api/usuario/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: user, password })
    });
    diagnostics.login = { status: loginResponse.status, ok: loginResponse.ok };

    if (!loginResponse.ok) {
      diagnostics.login = { status: loginResponse.status, ok: false, body: await safeText(loginResponse) };
      res.status(502).json({ ok: false, message: 'SIAPE no autentico desde Vercel.', diagnostics });
      return;
    }

    const rawToken = await loginResponse.text();
    const token = rawToken.replace(/^"|"$/g, '');
    const authHeaders = { [header]: prefix ? `${prefix} ${token}` : token };
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
    const salesQuery = new URLSearchParams({ fechaInicio: today, fechaFin: tomorrow, page: '1', pageSize: '10' });

    const [inventoryResponse, salesResponse] = await Promise.all([
      fetch(buildUrl(baseUrl, '/api/item/reporteinventario'), { headers: authHeaders }),
      fetch(buildUrl(baseUrl, `/api/factura/reporteventas?${salesQuery.toString()}`), { headers: authHeaders })
    ]);

    diagnostics.inventory = { status: inventoryResponse.status, ok: inventoryResponse.ok };
    diagnostics.sales = { status: salesResponse.status, ok: salesResponse.ok, dateStart: today, dateEnd: tomorrow };

    if (!inventoryResponse.ok || !salesResponse.ok) {
      res.status(502).json({ ok: false, message: 'SIAPE respondio error en inventario o ventas.', diagnostics });
      return;
    }

    const inventory = await inventoryResponse.json() as unknown[];
    const sales = await salesResponse.json() as unknown[];
    diagnostics.inventory = { ...diagnostics.inventory as object, count: Array.isArray(inventory) ? inventory.length : null };
    diagnostics.sales = { ...diagnostics.sales as object, count: Array.isArray(sales) ? sales.length : null };

    res.status(200).json({ ok: true, message: 'Conexion SIAPE correcta desde Vercel.', diagnostics });
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Error desconocido probando SIAPE.', diagnostics });
  }
}
