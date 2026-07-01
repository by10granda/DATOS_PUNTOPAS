import dayjs from 'dayjs';
import type { ProductRecord } from './types';

type SiapeInventoryItem = {
  codigo: string;
  descripcion: string;
  marca?: string;
  linea?: string;
  categoria?: string;
  tipo?: string;
  disponibilidad?: number;
  dias_en_bodega?: number;
  niveles_precio?: Array<{ nivel: string; precio: number }>;
  proveedores?: Array<{
    nombre_proveedor?: string;
    costo_producto_proveedor?: number;
    costo_producto_proveedor_iva?: number;
    fecha_ultima_compra?: string;
    cantidad_ultima_compra_proveedor?: number;
  }>;
};

type SiapeSaleItem = {
  codigo: string;
  descripcion?: string;
  cantidad_vendida?: number | string;
  precio_costo?: number | string;
  precio_venta?: number | string;
  fecha_venta?: string;
};

type SiapeCatalogItem = {
  codigo: string;
  precioVentaSinImpuestos?: number;
  precioVentaConImpuestos?: number;
  unidadesVenta?: Array<{
    tipo?: string;
    factor?: number;
    muldiv?: string;
    mulDiv?: string;
  }>;
};

const numberValue = (value: unknown) => Number(value ?? 0) || 0;
const textValue = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const buildUrl = (baseUrl: string, path: string) => {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return `${cleanBase}${cleanPath.slice(4)}`;
  }
  return `${cleanBase}${cleanPath}`;
};

const getToken = async (baseUrl: string) => {
  const user = process.env.SIAPE_API_USER;
  const password = process.env.SIAPE_API_PASSWORD;

  if (!user || !password) {
    throw new Error('Faltan credenciales SIAPE_API_USER o SIAPE_API_PASSWORD');
  }

  const response = await fetch(buildUrl(baseUrl, '/api/usuario/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: user, password })
  });

  if (!response.ok) {
    throw new Error(`No se pudo autenticar en SIAPE. Código ${response.status}`);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as string | { token?: string };
    return typeof parsed === 'string' ? parsed : parsed.token ?? text;
  } catch {
    return text.replace(/^"|"$/g, '');
  }
};

const authHeaders = (token: string) => {
  const header = process.env.SIAPE_AUTH_HEADER ?? 'Authorization';
  const prefix = process.env.SIAPE_AUTH_PREFIX ?? 'Bearer';
  const value = prefix ? `${prefix} ${token}` : token;
  return { [header]: value };
};

const fetchJson = async <T>(baseUrl: string, path: string, token: string): Promise<T> => {
  const response = await fetch(buildUrl(baseUrl, path), { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`Error SIAPE ${response.status} en ${path}`);
  }
  return response.json() as Promise<T>;
};

const fetchOptionalJson = async <T>(baseUrl: string, path: string, token: string, fallback: T): Promise<T> => {
  try {
    return await fetchJson<T>(baseUrl, path, token);
  } catch (error) {
    console.warn(`No se pudo cargar ${path}. Se usará fallback.`, error);
    return fallback;
  }
};

const getSaleUnitFactor = (item?: SiapeCatalogItem) => {
  const factors = item?.unidadesVenta
    ?.map((unit) => numberValue(unit.factor))
    .filter((factor) => factor > 1) ?? [];
  return factors.length ? Math.max(...factors) : 1;
};

const normalizeProviderCostWithIva = (rawCostWithIva: number, providerCost: number, publicPriceWithIva: number, unitFactor: number) => {
  const fallbackUnitCostWithIva = providerCost > 0 ? providerCost * 1.15 : rawCostWithIva;

  if (unitFactor > 1 && rawCostWithIva > publicPriceWithIva) {
    const dividedCost = rawCostWithIva / unitFactor;
    const dividedLooksLikeCostWithoutIva = providerCost > 0 && Math.abs(dividedCost - providerCost) / providerCost <= 0.02;
    return dividedLooksLikeCostWithoutIva ? fallbackUnitCostWithIva : dividedCost;
  }

  return rawCostWithIva || fallbackUnitCostWithIva;
};

const saleDuplicateKey = (sale: SiapeSaleItem) => [
  sale.codigo,
  numberValue(sale.cantidad_vendida).toFixed(4),
  numberValue(sale.precio_costo).toFixed(4),
  numberValue(sale.precio_venta).toFixed(4)
].join('|');

const saleDocumentSignature = (sales: SiapeSaleItem[]) => sales
  .map((sale) => saleDuplicateKey(sale))
  .sort((a, b) => a.localeCompare(b))
  .join('||');

const dedupeEquivalentSaleDocuments = (rows: SiapeSaleItem[]) => {
  const documentsByTimestamp = new Map<string, SiapeSaleItem[]>();

  for (const row of rows) {
    const timestamp = dayjs(row.fecha_venta).isValid() ? dayjs(row.fecha_venta).format('YYYY-MM-DDTHH:mm:ss') : 'SIN_FECHA';
    const documentRows = documentsByTimestamp.get(timestamp) ?? [];
    documentRows.push(row);
    documentsByTimestamp.set(timestamp, documentRows);
  }

  const acceptedDocumentsByDay = new Map<string, Set<string>>();
  const dedupedRows: SiapeSaleItem[] = [];

  for (const [timestamp, documentRows] of Array.from(documentsByTimestamp.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const saleDate = dayjs(timestamp);
    const signature = saleDocumentSignature(documentRows);
    const saleDay = saleDate.isValid() ? saleDate.format('YYYY-MM-DD') : 'SIN_FECHA';
    const acceptedSignatures = acceptedDocumentsByDay.get(saleDay) ?? new Set<string>();

    if (acceptedSignatures.has(signature)) {
      continue;
    }

    acceptedSignatures.add(signature);
    acceptedDocumentsByDay.set(saleDay, acceptedSignatures);
    dedupedRows.push(...documentRows);
  }

  return dedupedRows;
};

const dedupeInventoryByCode = (inventory: SiapeInventoryItem[]) => {
  const byCode = new Map<string, SiapeInventoryItem>();
  for (const item of inventory) {
    const existing = byCode.get(item.codigo);
    if (!existing) {
      byCode.set(item.codigo, item);
      continue;
    }

    byCode.set(item.codigo, {
      ...existing,
      ...item,
      niveles_precio: item.niveles_precio?.length ? item.niveles_precio : existing.niveles_precio,
      proveedores: item.proveedores?.length ? item.proveedores : existing.proveedores,
      disponibilidad: Math.max(numberValue(existing.disponibilidad), numberValue(item.disponibilidad))
    });
  }
  return Array.from(byCode.values());
};

const fetchSales = async (baseUrl: string, token: string, dateStart: string, dateEnd: string) => {
  const pageSize = Number(process.env.SIAPE_PAGE_SIZE ?? 5000);
  const rows: SiapeSaleItem[] = [];
  const pageSignatures = new Set<string>();
  let page = 1;
  const queryDateEnd = dayjs(dateEnd).add(1, 'day').format('YYYY-MM-DD');

  while (page <= 20) {
    const query = new URLSearchParams({
      fechaInicio: dateStart,
      fechaFin: queryDateEnd,
      page: String(page),
      pageSize: String(pageSize)
    });
    const batch = await fetchJson<SiapeSaleItem[]>(baseUrl, `/api/factura/reporteventas?${query.toString()}`, token);
    const pageSignature = JSON.stringify(batch);
    if (pageSignatures.has(pageSignature)) {
      console.warn(`SIAPE devolvió una página repetida en reporteventas. Se detuvo la paginación en page=${page}.`);
      break;
    }
    pageSignatures.add(pageSignature);
    rows.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }

  const start = dayjs(dateStart).startOf('day');
  const end = dayjs(dateEnd).endOf('day');
  const duplicateWindowSeconds = Number(process.env.SIAPE_DUPLICATE_WINDOW_SECONDS ?? 300);
  const lastAcceptedBySaleKey = new Map<string, dayjs.Dayjs>();

  return dedupeEquivalentSaleDocuments(rows).sort((a, b) => dayjs(a.fecha_venta).valueOf() - dayjs(b.fecha_venta).valueOf()).filter((sale) => {
    const saleDate = dayjs(sale.fecha_venta);
    if (!saleDate.isValid() || saleDate.isBefore(start) || saleDate.isAfter(end)) {
      return false;
    }

    const saleKey = saleDuplicateKey(sale);
    const lastAcceptedDate = lastAcceptedBySaleKey.get(saleKey);
    if (lastAcceptedDate && Math.abs(saleDate.diff(lastAcceptedDate, 'second')) <= duplicateWindowSeconds) {
      return false;
    }
    lastAcceptedBySaleKey.set(saleKey, saleDate);
    return true;
  });
};

export const loadSiapeProducts = async (dateStart: string, dateEnd: string): Promise<ProductRecord[]> => {
  const baseUrl = process.env.SIAPE_API_BASE_URL;
  if (!baseUrl) {
    throw new Error('SIAPE_API_BASE_URL no está configurado');
  }

  const token = await getToken(baseUrl);
  const [inventory, sales, catalog] = await Promise.all([
    fetchJson<SiapeInventoryItem[]>(baseUrl, '/api/item/reporteinventario', token),
    fetchSales(baseUrl, token, dateStart, dateEnd),
    fetchOptionalJson<SiapeCatalogItem[]>(baseUrl, '/api/item/search3', token, [])
  ]);

  const salesByProduct = new Map<string, Map<string, number>>();
  const revenueByProduct = new Map<string, number>();
  const profitByProduct = new Map<string, number>();
  const costByProduct = new Map<string, number>();
  const priceByProduct = new Map<string, number>();
  const catalogByProduct = new Map(catalog.map((item) => [item.codigo, item]));

  for (const sale of sales) {
    const code = sale.codigo;
    const month = dayjs(sale.fecha_venta).isValid() ? dayjs(sale.fecha_venta).format('HH:00') : '00:00';
    const productSales = salesByProduct.get(code) ?? new Map<string, number>();
    const quantity = numberValue(sale.cantidad_vendida);
    const saleCostWithIva = numberValue(sale.precio_costo) * 1.15;
    const salePriceWithIva = numberValue(sale.precio_venta) * 1.15;
    productSales.set(month, (productSales.get(month) ?? 0) + quantity);
    salesByProduct.set(code, productSales);
    revenueByProduct.set(code, (revenueByProduct.get(code) ?? 0) + (salePriceWithIva * quantity));
    profitByProduct.set(code, (profitByProduct.get(code) ?? 0) + ((salePriceWithIva - saleCostWithIva) * quantity));
    costByProduct.set(code, numberValue(sale.precio_costo));
    priceByProduct.set(code, numberValue(sale.precio_venta));
  }

  const months = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);

  return dedupeInventoryByCode(inventory).map((item) => {
    const provider = item.proveedores?.[0];
    const catalogItem = catalogByProduct.get(item.codigo);
    const puntoPas = item.niveles_precio?.find((level) => textValue(level.nivel).toUpperCase().includes('PUNTO PAS'));
    const pvp = item.niveles_precio?.find((level) => textValue(level.nivel).toUpperCase().includes('PVP'));
    const priceLevel = puntoPas ?? item.niveles_precio?.[0];
    const providerCost = numberValue(provider?.costo_producto_proveedor ?? costByProduct.get(item.codigo));
    const price = numberValue(priceLevel?.precio ?? catalogItem?.precioVentaSinImpuestos ?? priceByProduct.get(item.codigo));
    const publicPriceWithIva = numberValue(catalogItem?.precioVentaConImpuestos ?? price * 1.15);
    const rawProviderCostWithIva = numberValue(provider?.costo_producto_proveedor_iva ?? providerCost * 1.15);
    const providerCostWithIva = normalizeProviderCostWithIva(rawProviderCostWithIva, providerCost, publicPriceWithIva, getSaleUnitFactor(catalogItem));
    const productSales = salesByProduct.get(item.codigo) ?? new Map<string, number>();

    return {
      id: `ALMACEN PAS-${item.codigo}`,
      branch: 'ALMACEN PAS',
      code: item.codigo,
      description: item.descripcion,
      brand: item.marca ?? 'SIN MARCA',
      line: item.linea ?? 'SIN LÍNEA',
      category: item.categoria ?? 'SIN CATEGORÍA',
      type: item.tipo ?? 'SIN TIPO',
      provider: provider?.nombre_proveedor ?? 'SIN PROVEEDOR',
      cost: providerCost,
      costWithIva: providerCostWithIva,
      price,
      priceWithIva: publicPriceWithIva,
      salePrice: productSales.size > 0 ? numberValue(priceByProduct.get(item.codigo)) : 0,
      pricePuntoPas: numberValue(puntoPas?.precio ?? priceLevel?.precio),
      pricePvp: pvp ? numberValue(pvp.precio) : null,
      stock: Math.max(0, numberValue(item.disponibilidad)),
      lastPurchase: provider?.fecha_ultima_compra ? dayjs(provider.fecha_ultima_compra).format('YYYY-MM-DD') : '',
      lastPurchaseQuantity: numberValue(provider?.cantidad_ultima_compra_proveedor),
      monthlySales: months.map((month) => ({ month, quantity: productSales.get(month) ?? 0 })),
      salesRevenueWithIva: revenueByProduct.get(item.codigo) ?? 0,
      salesProfitWithIva: profitByProduct.get(item.codigo) ?? 0
    };
  });
};
