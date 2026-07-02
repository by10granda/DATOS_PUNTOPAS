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
  bodegas?: Array<{ bodegaALMACEN?: string; stock?: number | string }>;
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
      bodegas: mergeWarehouses(existing.bodegas, item.bodegas),
      niveles_precio: item.niveles_precio?.length ? item.niveles_precio : existing.niveles_precio,
      proveedores: item.proveedores?.length ? item.proveedores : existing.proveedores,
      disponibilidad: Math.max(numberValue(existing.disponibilidad), numberValue(item.disponibilidad))
    });
  }
  return Array.from(byCode.values());
};

const mergeWarehouses = (current: SiapeInventoryItem['bodegas'] = [], next: SiapeInventoryItem['bodegas'] = []) => {
  const byName = new Map<string, number>();
  for (const warehouse of [...current, ...next]) {
    const name = textValue(warehouse?.bodegaALMACEN, 'SIN BODEGA').toUpperCase();
    byName.set(name, Math.max(byName.get(name) ?? 0, Math.max(0, numberValue(warehouse?.stock))));
  }
  return Array.from(byName.entries()).map(([bodegaALMACEN, stock]) => ({ bodegaALMACEN, stock }));
};

const mapWarehouseStocks = (warehouses: SiapeInventoryItem['bodegas'] = []) => Object.fromEntries(
  warehouses.map((warehouse) => [textValue(warehouse?.bodegaALMACEN, 'SIN BODEGA').toUpperCase(), Math.max(0, numberValue(warehouse?.stock))])
);

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
  return rows.sort((a, b) => dayjs(a.fecha_venta).valueOf() - dayjs(b.fecha_venta).valueOf()).filter((sale) => {
    const saleDate = dayjs(sale.fecha_venta);
    if (!saleDate.isValid() || saleDate.isBefore(start) || saleDate.isAfter(end)) {
      return false;
    }
    return true;
  });
};

export const loadSiapeProducts = async (dateStart: string, dateEnd: string, bucket: 'hour' | 'week' = 'hour'): Promise<ProductRecord[]> => {
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
  const revenueByProductBucket = new Map<string, Map<string, number>>();
  const profitByProductBucket = new Map<string, Map<string, number>>();
  const revenueByProduct = new Map<string, number>();
  const saleDateByProduct = new Map<string, string>();
  const costByProduct = new Map<string, number>();
  const priceByProduct = new Map<string, number>();
  const salePricesWithIvaByProduct = new Map<string, Array<{ priceWithIva: number; quantity: number }>>();
  const catalogByProduct = new Map(catalog.map((item) => [item.codigo, item]));

  for (const sale of sales) {
    const code = sale.codigo;
    const saleDay = dayjs(sale.fecha_venta);
    const month = bucket === 'week' && saleDay.isValid()
      ? `Sem ${saleDay.startOf('week').add(1, 'day').format('DD/MM')}`
      : saleDay.isValid() ? saleDay.format('HH:00') : '00:00';
    const productSales = salesByProduct.get(code) ?? new Map<string, number>();
    const productRevenue = revenueByProductBucket.get(code) ?? new Map<string, number>();
    const productProfit = profitByProductBucket.get(code) ?? new Map<string, number>();
    const quantity = numberValue(sale.cantidad_vendida);
    const saleCostWithIva = numberValue(sale.precio_costo) * 1.15;
    const salePriceWithIva = numberValue(sale.precio_venta) * 1.15;
    productSales.set(month, (productSales.get(month) ?? 0) + quantity);
    productRevenue.set(month, (productRevenue.get(month) ?? 0) + (salePriceWithIva * quantity));
    productProfit.set(month, (productProfit.get(month) ?? 0) + ((salePriceWithIva - saleCostWithIva) * quantity));
    salesByProduct.set(code, productSales);
    revenueByProductBucket.set(code, productRevenue);
    profitByProductBucket.set(code, productProfit);
    revenueByProduct.set(code, (revenueByProduct.get(code) ?? 0) + (salePriceWithIva * quantity));
    salePricesWithIvaByProduct.set(code, [...(salePricesWithIvaByProduct.get(code) ?? []), { priceWithIva: salePriceWithIva, quantity }]);
    const currentSaleDate = saleDateByProduct.get(code);
    if (!currentSaleDate || dayjs(sale.fecha_venta).isAfter(dayjs(currentSaleDate))) {
      saleDateByProduct.set(code, dayjs(sale.fecha_venta).isValid() ? dayjs(sale.fecha_venta).format('YYYY-MM-DD HH:mm:ss') : '');
    }
    costByProduct.set(code, numberValue(sale.precio_costo));
    priceByProduct.set(code, numberValue(sale.precio_venta));
  }

  const months: Array<{ label: string; weekStart?: string; monthLabel?: string }> = bucket === 'week'
    ? Array.from(new Set(Array.from({ length: Math.max(1, dayjs(dateEnd).diff(dayjs(dateStart), 'week') + 2) }, (_value, index) => {
      const weekStart = dayjs(dateStart).startOf('week').add(1 + index * 7, 'day');
      return JSON.stringify({ label: `Sem ${weekStart.format('DD/MM')}`, weekStart: weekStart.format('YYYY-MM-DD'), monthLabel: weekStart.format('MMMM YYYY') });
    }))).map((item) => JSON.parse(item) as { label: string; weekStart: string; monthLabel: string })
    : Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00` }));

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
    const productRevenue = revenueByProductBucket.get(item.codigo) ?? new Map<string, number>();
    const productProfit = profitByProductBucket.get(item.codigo) ?? new Map<string, number>();
    const salePrices = salePricesWithIvaByProduct.get(item.codigo) ?? [];
    const soldQuantity = salePrices.reduce((sum, sale) => sum + sale.quantity, 0);
    const salesProfitWithProviderCost = salePrices.reduce((sum, sale) => sum + ((sale.priceWithIva - providerCostWithIva) * sale.quantity), 0);
    const salesAverageMarginPercent = soldQuantity > 0
      ? salePrices.reduce((sum, sale) => sum + (sale.priceWithIva > 0 ? ((sale.priceWithIva - providerCostWithIva) / sale.priceWithIva) * 100 * sale.quantity : 0), 0) / soldQuantity
      : undefined;
    const warehouseStocks = mapWarehouseStocks(item.bodegas);
    const stockTotal = Object.values(warehouseStocks).reduce((sum, stock) => sum + stock, 0);

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
      stock: stockTotal,
      stockTotal,
      warehouseStocks,
      lastPurchase: provider?.fecha_ultima_compra ? dayjs(provider.fecha_ultima_compra).format('YYYY-MM-DD') : '',
      saleDate: saleDateByProduct.get(item.codigo) ?? '',
      lastPurchaseQuantity: numberValue(provider?.cantidad_ultima_compra_proveedor),
      monthlySales: months.map((month) => ({ month: month.label, quantity: productSales.get(month.label) ?? 0, revenue: productRevenue.get(month.label) ?? 0, profit: productProfit.get(month.label) ?? 0, weekStart: month.weekStart, monthLabel: month.monthLabel })),
      salesRevenueWithIva: revenueByProduct.get(item.codigo) ?? 0,
      salesProfitWithIva: salesProfitWithProviderCost,
      salesAverageMarginPercent
    };
  });
};
