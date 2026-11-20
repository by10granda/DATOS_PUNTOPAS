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

type SiapeItemDetail = {
  txDescripcion?: string;
  stockBodega?: Array<{ txDescripcionBodega?: string; qnStock?: number | string }>;
};

type SiapeCatalogItem = {
  codigo: string;
  descripcionItem?: string;
  descripcionMarca?: string;
  descripcionCategoria?: string;
  precioVentaSinImpuestos?: number;
  precioVentaConImpuestos?: number;
  unidadesVenta?: Array<{
    tipo?: string;
    factor?: number;
    muldiv?: string;
    mulDiv?: string;
  }>;
};

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const hasNumber = (value: unknown) => value != null && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value));
const hasText = (value: unknown) => typeof value === 'string' && !!value.trim() && !/^SIN(?:\s+(?:MARCA|L[I\u00cd]NEA|CATEGOR[I\u00cd]A|TIPO|PROVEEDOR|DESCRIPCI[O\u00d3]N))?$/i.test(value.trim());
const textValue = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
let tokenCache: { baseUrl: string; token: string; expiresAt: number } | null = null;

const branchConfigs = {
  'ALMACEN PAS': {
    name: 'ALMACEN PAS',
    baseUrl: () => process.env.SIAPE_API_BASE_URL,
    user: () => process.env.SIAPE_API_USER,
    password: () => process.env.SIAPE_API_PASSWORD,
    detailStock: false
  },
  'VARIEDADES PAS': {
    name: 'VARIEDADES PAS',
    baseUrl: () => process.env.SIAPE_API_BASE_URL_SUCURSAL2 ?? 'https://api-sucursal2.distribuidor-puntopas.com',
    user: () => process.env.SIAPE_API_USER_SUCURSAL2 ?? process.env.SIAPE_API_USER,
    password: () => process.env.SIAPE_API_PASSWORD_SUCURSAL2 ?? process.env.SIAPE_API_PASSWORD,
    // Sucursal 2 reports some products with zero stock while /api/item?code still
    // holds units in GALPON MADERERA. Those products are verified one by one.
    detailStock: true
  },
  'STIHL': {
    name: 'STIHL',
    baseUrl: () => process.env.SIAPE_API_BASE_URL_SUCURSAL3 ?? 'https://api-sucursal3.distribuidor-puntopas.com',
    user: () => process.env.SIAPE_API_USER_SUCURSAL3,
    password: () => process.env.SIAPE_API_PASSWORD_SUCURSAL3,
    detailStock: false
  }
};

export const resolveBranchConfig = (branchName: string) => {
  const config = branchConfigs[branchName as keyof typeof branchConfigs];
  if (!config) throw new Error(`Sucursal no habilitada: ${branchName}`);
  const baseUrl = config.baseUrl();
  if (!baseUrl) throw new Error(`No está configurada la URL SIAPE para ${branchName}`);
  const user = config.user();
  const password = config.password();
  if (!user || !password) throw new Error(`Faltan credenciales SIAPE para ${branchName}`);
  return { name: config.name, baseUrl, user, password, detailStock: config.detailStock === true };
};

const buildUrl = (baseUrl: string, path: string) => {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return `${cleanBase}${cleanPath.slice(4)}`;
  }
  return `${cleanBase}${cleanPath}`;
};

const getToken = async (baseUrl: string, credentials: { user: string; password: string; branch: string }) => {
  if (tokenCache?.baseUrl === baseUrl && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const { user, password } = credentials;

  if (!user || !password) {
    throw new Error('Faltan credenciales SIAPE_API_USER o SIAPE_API_PASSWORD');
  }

  const response = await fetch(buildUrl(baseUrl, '/api/usuario/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: user, password })
  });

  if (!response.ok) {
    if (tokenCache?.baseUrl === baseUrl) {
      return tokenCache.token;
    }
    throw new Error(`No se pudo autenticar en SIAPE para ${credentials.branch}. Código ${response.status}`);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as string | { token?: string };
    const token = typeof parsed === 'string' ? parsed : parsed.token ?? text;
    tokenCache = { baseUrl, token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    return token;
  } catch {
    const token = text.replace(/^"|"$/g, '');
    tokenCache = { baseUrl, token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    return token;
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

const detailWarehouses = (stockBodega: SiapeItemDetail['stockBodega'] = []) => {
  const byName = new Map<string, number>();
  for (const warehouse of stockBodega) {
    const name = textValue(warehouse?.txDescripcionBodega, '').toUpperCase();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + Math.max(0, numberValue(warehouse?.qnStock)));
  }
  return Array.from(byName.entries()).map(([bodegaALMACEN, stock]) => ({ bodegaALMACEN, stock }));
};

const warehouseTotal = (bodegas: SiapeInventoryItem['bodegas'] = []) => bodegas.reduce(
  (sum, warehouse) => sum + Math.max(0, numberValue(warehouse?.stock)), 0,
);

type WarehouseDetail = {
  bodegas: NonNullable<SiapeInventoryItem['bodegas']>;
  description: string;
};

const detailStockCache = new Map<string, WarehouseDetail & { loadedAt: number }>();
const DETAIL_STOCK_TTL_MS = Number(process.env.SIAPE_DETAIL_STOCK_TTL_MS ?? 15 * 60 * 1000);

/**
 * `reporteinventario` and `/item/inventario` do not always expose every warehouse
 * of a product (e.g. units held in GALPON MADERERA while the report says zero).
 * `/api/item?code` is the source of truth for the per-warehouse breakdown, so every
 * known product is verified against it and the result is cached per branch.
 */
const enrichWarehouseStockFromDetail = async (
  baseUrl: string,
  token: string,
  inventory: SiapeInventoryItem[],
  stockInventory: Array<{ codigo: string; disponible: number | string }>,
  catalog: SiapeCatalogItem[],
) => {
  const inventoryByCode = new Map(inventory.map((item) => [item.codigo, item]));
  const stockByCode = new Map(stockInventory.map((item) => [item.codigo, item]));
  const codes = new Set<string>();
  for (const item of inventory) if (item.codigo) codes.add(item.codigo);
  for (const item of stockInventory) if (item.codigo) codes.add(item.codigo);
  for (const item of catalog) if (item.codigo) codes.add(item.codigo);
  if (!codes.size) return;

  const cachePrefix = `${baseUrl}\u0000`;
  const cachedDetails = new Map<string, WarehouseDetail>();
  const codesToFetch: string[] = [];
  const now = Date.now();

  for (const code of codes) {
    const cached = detailStockCache.get(`${cachePrefix}${code}`);
    if (cached && now - cached.loadedAt < DETAIL_STOCK_TTL_MS) cachedDetails.set(code, cached);
    else codesToFetch.push(code);
  }

  const maxCodes = Number(process.env.SIAPE_DETAIL_STOCK_MAX_CODES ?? 15000);
  const concurrency = Number(process.env.SIAPE_DETAIL_STOCK_CONCURRENCY ?? 60);
  const fetchCodes = codesToFetch.slice(0, Math.max(0, maxCodes));
  const fetchedDetails = new Map<string, WarehouseDetail>();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < fetchCodes.length) {
      const code = fetchCodes[nextIndex++];
      try {
        const detail = await fetchJson<SiapeItemDetail>(baseUrl, `/api/item?code=${encodeURIComponent(code)}`, token);
        if (!Array.isArray(detail?.stockBodega) || detail.stockBodega.length === 0) continue;
        const bodegas = detailWarehouses(detail.stockBodega);
        const record = { bodegas, description: textValue(detail?.txDescripcion) };
        fetchedDetails.set(code, record);
        detailStockCache.set(`${cachePrefix}${code}`, { ...record, loadedAt: Date.now() });
      } catch {
        // A failed detail probe keeps the aggregate stock; it must not break the dashboard.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), fetchCodes.length) }, worker));

  for (const [code, detail] of new Map([...cachedDetails, ...fetchedDetails])) {
    const total = warehouseTotal(detail.bodegas);
    const existing = inventoryByCode.get(code);

    if (existing) {
      existing.bodegas = detail.bodegas;
      existing.disponibilidad = total;
      if (!textValue(existing.descripcion) && detail.description) existing.descripcion = detail.description;
    } else if (total > 0) {
      const created: SiapeInventoryItem = {
        codigo: code,
        descripcion: detail.description,
        disponibilidad: total,
        dias_en_bodega: 0,
        bodegas: detail.bodegas,
        niveles_precio: [],
        proveedores: []
      };
      inventory.push(created);
      inventoryByCode.set(code, created);
    }

    const stockRow = stockByCode.get(code);
    if (stockRow) stockRow.disponible = total;
    else if (total > 0) stockInventory.push({ codigo: code, disponible: total });
  }
};

/**
 * Inventory, catalog and stock are independent from the sales date range and only
 * change a few times per day. Caching them per branch removes the three heaviest
 * SIAPE downloads from almost every request (dashboard, BI page, Excel export).
 */
export type SiapeSnapshot = {
  inventory: SiapeInventoryItem[];
  catalog: SiapeCatalogItem[];
  stockInventory: Array<{ codigo: string; disponible: number | string }>;
};

export type SiapeLoadOptions = {
  strictSalesPagination?: boolean;
  onRawSales?: (sales: SiapeSaleItem[]) => void;
  loadSnapshot?: () => Promise<SiapeSnapshot>;
};

const fetchSnapshot = async (baseUrl: string, token: string, options: { detailStock?: boolean } = {}): Promise<SiapeSnapshot> => {
  const [inventory, catalog, stockInventory] = await Promise.all([
    fetchJson<SiapeInventoryItem[]>(baseUrl, '/api/item/reporteinventario', token),
    fetchJson<SiapeCatalogItem[]>(baseUrl, '/api/item/search3', token),
    fetchJson<Array<{ codigo: string; disponible: number | string }>>(baseUrl, '/api/item/inventario', token)
  ]);
  if (!Array.isArray(stockInventory)) throw new Error('Respuesta invalida de /api/item/inventario');
  if (options.detailStock) await enrichWarehouseStockFromDetail(baseUrl, token, inventory, stockInventory, catalog);
  return { inventory, catalog, stockInventory };
};

const SNAPSHOT_TTL_MS = Number(process.env.SIAPE_SNAPSHOT_TTL_MS ?? 5 * 60 * 1000);

/**
 * Builds a memoized snapshot loader for one branch. Concurrent callers share the
 * same SIAPE request, so dashboard + BI + export never download the catalog twice.
 */
export const createSnapshotLoader = (branchName: string, ttlMs = SNAPSHOT_TTL_MS) => {
  let cached: { value: SiapeSnapshot; loadedAt: number } | null = null;
  let inFlight: Promise<SiapeSnapshot> | null = null;

  return async (): Promise<SiapeSnapshot> => {
    if (ttlMs > 0 && cached && Date.now() - cached.loadedAt < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { baseUrl, user, password, detailStock } = resolveBranchConfig(branchName);
      const token = await getToken(baseUrl, { user, password, branch: branchName });
      const value = await fetchSnapshot(baseUrl, token, { detailStock });
      if (ttlMs > 0) cached = { value, loadedAt: Date.now() };
      return value;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
};

const warehouseNamesCache = new Map<string, { names: string[]; loadedAt: number }>();

/**
 * Full warehouse column list for a branch. `reporteinventario` only lists the
 * warehouses that currently hold stock, so a handful of `/api/item` probes are
 * used once per TTL to discover the empty ones (e.g. GALPON-MADERERA).
 */
export const loadWarehouseNames = async (
  branchName: string,
  options: { loadSnapshot?: () => Promise<SiapeSnapshot>; ttlMs?: number; probeLimit?: number } = {},
): Promise<string[]> => {
  const ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
  const config = resolveBranchConfig(branchName);
  const cacheKey = `${config.baseUrl}\u0000${branchName}`;
  const cached = warehouseNamesCache.get(cacheKey);
  if (ttlMs > 0 && cached && Date.now() - cached.loadedAt < ttlMs) return cached.names;

  const loadSnapshot = options.loadSnapshot ?? createSnapshotLoader(branchName);
  const snapshot = await loadSnapshot();
  const names = new Set<string>();
  for (const item of snapshot.inventory) {
    for (const warehouse of item.bodegas ?? []) {
      const name = textValue(warehouse?.bodegaALMACEN, '').toUpperCase();
      if (name) names.add(name);
    }
  }

  const probeCodes = Array.from(new Set(
    snapshot.inventory
      .filter((item) => Array.isArray(item.bodegas) && item.bodegas.length > 0)
      .map((item) => item.codigo)
  )).slice(0, Math.max(0, options.probeLimit ?? 8));

  if (probeCodes.length) {
    const { baseUrl, user, password } = resolveBranchConfig(branchName);
    const token = await getToken(baseUrl, { user, password, branch: branchName });    await Promise.all(probeCodes.map(async (code) => {
      try {
        const detail = await fetchJson<{ stockBodega?: Array<{ txDescripcionBodega?: string }> }>(
          baseUrl, `/api/item?code=${encodeURIComponent(code)}`, token,
        );
        for (const warehouse of detail?.stockBodega ?? []) {
          const name = textValue(warehouse?.txDescripcionBodega, '').toUpperCase();
          if (name) names.add(name);
        }
      } catch {
        // A failed probe only hides an empty warehouse column; stock values come from the snapshot.
      }
    }));
  }

  const sorted = Array.from(names).sort((a, b) => a.localeCompare(b, 'es'));
  if (ttlMs > 0) warehouseNamesCache.set(cacheKey, { names: sorted, loadedAt: Date.now() });
  return sorted;
};

const getSaleUnitFactor = (item?: SiapeCatalogItem) => {
  const factors = item?.unidadesVenta
    ?.map((unit) => numberValue(unit.factor))
    .filter((factor) => factor > 1) ?? [];
  return factors.length ? Math.max(...factors) : 1;
};

const packageFactorsFromDescription = (description = '') => {
  const matches = [...description.matchAll(/(\d+(?:[.,]\d+)?)\s*(KG|KILO|KILOS|LB|LBS|MTS?|METROS?|UND|UNIDADES?)/gi)];
  return matches.map((match) => Number(match[1].replace(',', '.'))).filter((factor) => factor > 1 && factor <= 10000);
};

const saleWeightedAverageNoIva = (sales: Array<{ priceWithIva: number; quantity: number }>) => {
  const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
  if (totalQuantity <= 0) return 0;
  return sales.reduce((sum, sale) => sum + ((sale.priceWithIva / 1.15) * sale.quantity), 0) / totalQuantity;
};

const resolveFractionalFactor = (description: string, catalogItem: SiapeCatalogItem | undefined, publicPrice: number, salePrices: Array<{ priceWithIva: number; quantity: number }>) => {
  const sales = salePrices.filter((sale) => sale.quantity > 0 && sale.priceWithIva > 0);
  const averageSalePrice = saleWeightedAverageNoIva(sales);
  if (!publicPrice || !averageSalePrice || averageSalePrice >= publicPrice * 0.75) return 1;

  const candidates = Array.from(new Set([
    ...packageFactorsFromDescription(description),
    ...(catalogItem?.unidadesVenta?.map((unit) => numberValue(unit.factor)).filter((factor) => factor > 1 && factor <= 10000) ?? [])
  ]));

  const ranked = candidates.map((factor) => {
    const expectedUnitPrice = publicPrice / factor;
    return { factor, diff: Math.abs(expectedUnitPrice - averageSalePrice) / averageSalePrice };
  }).sort((a, b) => a.diff - b.diff);

  return ranked[0] && ranked[0].diff <= 0.35 ? ranked[0].factor : 1;
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

const salesCache = new Map<string, { loadedAt: number; sales: SiapeSaleItem[] }>();
const salesInflight = new Map<string, Promise<SiapeSaleItem[]>>();
const SALES_TTL_MS = Number(process.env.SIAPE_SALES_TTL_MS ?? 90 * 1000);

/**
 * Sales for a closed date range never change, and even the current day is only
 * appended to. Reusing the downloaded pages for a short window removes the
 * heaviest SIAPE round-trip when the same range is requested again (filters,
 * manual range re-apply, 30s auto-refresh).
 */
const fetchSalesCached = async (baseUrl: string, token: string, dateStart: string, dateEnd: string) => {
  const key = `${baseUrl}\u0000${dateStart}\u0000${dateEnd}`;
  const cached = salesCache.get(key);
  if (cached && Date.now() - cached.loadedAt < SALES_TTL_MS) return cached.sales;
  const pending = salesInflight.get(key);
  if (pending) return pending;

  const request = fetchSales(baseUrl, token, dateStart, dateEnd)
    .then((sales) => {
      salesCache.set(key, { loadedAt: Date.now(), sales });
      return sales;
    })
    .finally(() => {
      salesInflight.delete(key);
    });
  salesInflight.set(key, request);
  return request;
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
  return rows.sort((a, b) => dayjs(a.fecha_venta).valueOf() - dayjs(b.fecha_venta).valueOf()).filter((sale) => {
    const saleDate = dayjs(sale.fecha_venta);
    if (!saleDate.isValid() || saleDate.isBefore(start) || saleDate.isAfter(end)) {
      return false;
    }
    return true;
  });
};

export const loadSiapeProducts = async (
  dateStart: string,
  dateEnd: string,
  bucket: 'hour' | 'week' | 'day' = 'hour',
  branchName = 'ALMACEN PAS',
  options: SiapeLoadOptions = {},
): Promise<ProductRecord[]> => {
  const { name: branch, baseUrl, user, password, detailStock } = resolveBranchConfig(branchName);

  const token = await getToken(baseUrl, { user, password, branch });
  const loadSnapshot = options.loadSnapshot ?? (() => fetchSnapshot(baseUrl, token, { detailStock }));
  const [snapshot, sales] = await Promise.all([
    loadSnapshot(),
    fetchSalesCached(baseUrl, token, dateStart, dateEnd),
  ]);
  const { inventory, catalog, stockInventory } = snapshot;

  if (!Array.isArray(stockInventory)) throw new Error('Respuesta invalida de /api/item/inventario');
  const stockByProduct = new Map<string, number>();
  for (const item of stockInventory) {
    if (typeof item?.codigo !== 'string' || item.disponible == null || item.disponible === '' || !Number.isFinite(Number(item.disponible))) {
      throw new Error('Stock invalido en /api/item/inventario');
    }
    stockByProduct.set(item.codigo, Number(item.disponible));
  }

  const salesByProduct = new Map<string, Map<string, number>>();
  const hourlySalesByProduct = new Map<string, Map<string, number>>();
  const revenueByProductBucket = new Map<string, Map<string, number>>();
  const profitByProductBucket = new Map<string, Map<string, number>>();
  const revenueByProduct = new Map<string, number>();
  const saleDateByProduct = new Map<string, string>();
  const saleDescriptionByProduct = new Map<string, string>();
  const costByProduct = new Map<string, number>();
  const priceByProduct = new Map<string, number>();
  const salePricesWithIvaByProduct = new Map<string, Array<{ priceWithIva: number; quantity: number }>>();
  const catalogByProduct = new Map(catalog.map((item) => [item.codigo, item]));
  const sourceSalesByProduct = new Map<string, SiapeSaleItem[]>();

  for (const sale of sales) {
    const code = sale.codigo;
    const sourceSales = sourceSalesByProduct.get(code) ?? [];
    sourceSales.push(sale);
    sourceSalesByProduct.set(code, sourceSales);
    if (!saleDescriptionByProduct.has(code)) saleDescriptionByProduct.set(code, textValue(sale.descripcion));
    const saleDay = dayjs(sale.fecha_venta);
    const month = bucket === 'week' && saleDay.isValid()
      ? `Sem ${saleDay.startOf('week').add(1, 'day').format('DD/MM')}`
      : bucket === 'day' && saleDay.isValid()
        ? saleDay.format('DD/MM/YYYY')
        : saleDay.isValid() ? saleDay.format('HH:00') : '00:00';
    const hour = saleDay.isValid() ? saleDay.format('HH:00') : '00:00';
    const productSales = salesByProduct.get(code) ?? new Map<string, number>();
    const productHourlySales = hourlySalesByProduct.get(code) ?? new Map<string, number>();
    const productRevenue = revenueByProductBucket.get(code) ?? new Map<string, number>();
    const productProfit = profitByProductBucket.get(code) ?? new Map<string, number>();
    const quantity = numberValue(sale.cantidad_vendida);
    const saleCostWithIva = numberValue(sale.precio_costo) * 1.15;
    const salePriceWithIva = numberValue(sale.precio_venta) * 1.15;
    productSales.set(month, (productSales.get(month) ?? 0) + quantity);
    productHourlySales.set(hour, (productHourlySales.get(hour) ?? 0) + quantity);
    productRevenue.set(month, (productRevenue.get(month) ?? 0) + (salePriceWithIva * quantity));
    productProfit.set(month, (productProfit.get(month) ?? 0) + ((salePriceWithIva - saleCostWithIva) * quantity));
    salesByProduct.set(code, productSales);
    hourlySalesByProduct.set(code, productHourlySales);
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
    : bucket === 'day'
      ? Array.from({ length: Math.max(1, dayjs(dateEnd).diff(dayjs(dateStart), 'day') + 1) }, (_value, index) => {
        const day = dayjs(dateStart).add(index, 'day');
        return { label: day.format('DD/MM/YYYY'), weekStart: day.format('YYYY-MM-DD'), monthLabel: day.format('MMMM YYYY') };
      })
      : Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00` }));
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
  const inventoryRows = dedupeInventoryByCode(inventory);
  const inventoryCodes = new Set(inventoryRows.map((item) => item.codigo));
  // `reporteinventario` only contains products with a warehouse assignment; the rest
  // get their total from /api/item/inventario. SIAPE reports that remaining stock in
  // the branch's main warehouse, so it is used as a safe fallback instead of zeros.
  const warehouseTotals = new Map<string, number>();
  for (const item of inventory) {
    for (const warehouse of item.bodegas ?? []) {
      const name = textValue(warehouse?.bodegaALMACEN, '').toUpperCase();
      if (name) warehouseTotals.set(name, (warehouseTotals.get(name) ?? 0) + Math.max(0, numberValue(warehouse?.stock)));
    }
  }
  const primaryWarehouse = Array.from(warehouseTotals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const warehouseAvailabilityByProduct = new Map<string, boolean>();
  for (const item of inventory) {
    if (Array.isArray(item.bodegas)) {
      warehouseAvailabilityByProduct.set(item.codigo, (warehouseAvailabilityByProduct.get(item.codigo) ?? true) && item.bodegas.every((warehouse) => hasNumber(warehouse.stock)));
    }
  }
  const supplementalCodes = new Set([...catalogByProduct.keys(), ...stockByProduct.keys(), ...salesByProduct.keys()]);
  const supplementalRows: SiapeInventoryItem[] = Array.from(supplementalCodes).filter((code) => !inventoryCodes.has(code)).map((code) => {
    const catalogItem = catalogByProduct.get(code);
    return {
      codigo: code,
      descripcion: textValue(catalogItem?.descripcionItem, textValue(saleDescriptionByProduct.get(code))),
      marca: textValue(catalogItem?.descripcionMarca),
      linea: '',
      categoria: textValue(catalogItem?.descripcionCategoria),
      tipo: '',
      disponibilidad: 0,
      dias_en_bodega: 0,
      bodegas: [],
      // Price levels are only valid when `reporteinventario` returns them; a catalog
      // price must never be shown as a PVP/PUNTO PAS level.
      niveles_precio: [],
      proveedores: []
    };
  });

  return [...inventoryRows, ...supplementalRows].map((item) => {
    const provider = item.proveedores?.[0];
    const catalogItem = catalogByProduct.get(item.codigo);
    const puntoPas = item.niveles_precio?.find((level) => textValue(level.nivel).toUpperCase().includes('PUNTO PAS'));
    const pvp = item.niveles_precio?.find((level) => textValue(level.nivel).toUpperCase().includes('PVP'));
    const priceLevel = puntoPas ?? item.niveles_precio?.[0];
    const providerCost = numberValue(provider?.costo_producto_proveedor ?? costByProduct.get(item.codigo));
    const price = numberValue(priceLevel?.precio ?? catalogItem?.precioVentaSinImpuestos ?? priceByProduct.get(item.codigo));
    const publicPriceWithIva = numberValue(catalogItem?.precioVentaConImpuestos ?? price * 1.15);
    const rawProviderCostWithIva = numberValue(provider?.costo_producto_proveedor_iva ?? providerCost * 1.15);
    const productSales = salesByProduct.get(item.codigo) ?? new Map<string, number>();
    const productHourlySales = hourlySalesByProduct.get(item.codigo) ?? new Map<string, number>();
    const productRevenue = revenueByProductBucket.get(item.codigo) ?? new Map<string, number>();
    const salePrices = salePricesWithIvaByProduct.get(item.codigo) ?? [];
    const fractionalFactor = resolveFractionalFactor(item.descripcion, catalogItem, price, salePrices);
    const providerCostWithIvaBase = normalizeProviderCostWithIva(rawProviderCostWithIva, providerCost, publicPriceWithIva, getSaleUnitFactor(catalogItem));
    const effectiveProviderCost = fractionalFactor > 1 ? providerCost / fractionalFactor : providerCost;
    const providerCostWithIva = fractionalFactor > 1 ? providerCostWithIvaBase / fractionalFactor : providerCostWithIvaBase;
    const effectivePrice = fractionalFactor > 1 ? price / fractionalFactor : price;
    const effectivePublicPriceWithIva = fractionalFactor > 1 ? publicPriceWithIva / fractionalFactor : publicPriceWithIva;
    const effectivePuntoPasPrice = puntoPas
      ? (fractionalFactor > 1 ? numberValue(puntoPas.precio) / fractionalFactor : numberValue(puntoPas.precio))
      : 0;
    const effectivePvpPrice = pvp ? (fractionalFactor > 1 ? numberValue(pvp.precio) / fractionalFactor : numberValue(pvp.precio)) : null;
    const marginSales = salePrices.filter((sale) => sale.quantity > 0 && sale.priceWithIva > 0);
    const soldQuantity = marginSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const salesProfitWithProviderCost = salePrices.reduce((sum, sale) => sum + ((sale.priceWithIva - providerCostWithIva) * sale.quantity), 0);
    const salesAverageMarginPercent = soldQuantity > 0
      ? marginSales.reduce((sum, sale) => sum + (((sale.priceWithIva - providerCostWithIva) / sale.priceWithIva) * 100 * sale.quantity), 0) / soldQuantity
      : undefined;
    const mappedWarehouseStocks = mapWarehouseStocks(item.bodegas);
    const stockTotal = stockByProduct.get(item.codigo) ?? 0;
    // Metrics keep using the warehouses reported by SIAPE (unchanged behaviour); only
    // the export map gets the primary-warehouse fallback so no stock is lost.
    const stock = Object.values(mappedWarehouseStocks).reduce((sum, value) => sum + value, 0);
    const warehouseStocks = Object.keys(mappedWarehouseStocks).length || stockTotal <= 0 || !primaryWarehouse
      ? mappedWarehouseStocks
      : { [primaryWarehouse]: stockTotal };
    const sourceSales = sourceSalesByProduct.get(item.codigo) ?? [];
    const latestSale = sourceSales.at(-1);
    const costAvailable = hasNumber(provider?.costo_producto_proveedor ?? latestSale?.precio_costo);
    const costIvaAvailable = hasNumber(provider?.costo_producto_proveedor_iva) || costAvailable;
    const priceAvailable = hasNumber(priceLevel?.precio ?? catalogItem?.precioVentaSinImpuestos ?? latestSale?.precio_venta);
    const salePriceAvailable = sourceSales.length > 0 && sourceSales.every((sale) => hasNumber(sale.precio_venta) && hasNumber(sale.cantidad_vendida));
    const rowSalePrice = productSales.size > 0 ? numberValue(priceByProduct.get(item.codigo)) : 0;
    const quantity = Array.from(productSales.values()).reduce((sum, value) => sum + value, 0);
    const rowSaleAverage = quantity > 0 && revenueByProduct.get(item.codigo)
      ? numberValue(revenueByProduct.get(item.codigo)) / quantity / 1.15 : rowSalePrice;
    const publicIvaAvailable = rowSaleAverage ? salePriceAvailable : priceAvailable;
    const currentPriceAvailable = hasNumber(puntoPas?.precio) || hasNumber(pvp?.precio) || priceAvailable;
    const quantitiesAvailable = sourceSales.every((sale) => hasNumber(sale.cantidad_vendida));
    const warehouseStockAvailable = warehouseAvailabilityByProduct.get(item.codigo) ?? false;
    const profitAvailable = quantitiesAvailable && costIvaAvailable && (sourceSales.length > 0 ? salePriceAvailable : publicIvaAvailable);
    // These are ProductRow keys; numeric fallbacks remain available to the existing formulas.
    const availability: Record<string, boolean> = {
      description: hasText(item.descripcion), brand: hasText(item.marca), line: hasText(item.linea),
      category: hasText(item.categoria), type: hasText(item.tipo), provider: hasText(provider?.nombre_proveedor),
      costProvider: costAvailable, costWithIva: costIvaAvailable, publicCost: priceAvailable,
      publicCostWithIva: publicIvaAvailable, currentPriceWithIva: currentPriceAvailable,
      pricePuntoPas: hasNumber(puntoPas?.precio), pricePvp: hasNumber(pvp?.precio),
      salePrice: salePriceAvailable, saleDate: hasText(saleDateByProduct.get(item.codigo)),
      lastPurchase: hasText(provider?.fecha_ultima_compra) && dayjs(provider?.fecha_ultima_compra).isValid(),
      lastPurchaseQuantity: hasNumber(provider?.cantidad_ultima_compra_proveedor), stockTotal: stockByProduct.has(item.codigo),
      unitProfit: profitAvailable, totalProfit: profitAvailable && quantitiesAvailable,
      marginPercent: costIvaAvailable && publicIvaAvailable, currentMarginPercent: costIvaAvailable && currentPriceAvailable,
      rotation: warehouseStockAvailable && quantitiesAvailable, estimatedDaysInventory: warehouseStockAvailable && quantitiesAvailable,
      inventoryState: quantitiesAvailable && (quantity === 0 || warehouseStockAvailable),
      inventorySignal: warehouseStockAvailable && quantitiesAvailable,
      recommendation: quantitiesAvailable && (quantity === 0 || warehouseStockAvailable)
    };
    const missingFields = Object.keys(availability).filter((key) => !availability[key]);

    return {
      missingFields,
      id: `${branch}-${item.codigo}`,
      branch,
      code: item.codigo,
      description: textValue(item.descripcion),
      brand: item.marca ?? 'SIN MARCA',
      line: item.linea ?? 'SIN LÍNEA',
      category: item.categoria ?? 'SIN CATEGORÍA',
      type: item.tipo ?? 'SIN TIPO',
      provider: provider?.nombre_proveedor ?? (inventoryCodes.has(item.codigo) ? 'SIN PROVEEDOR' : ''),
      cost: effectiveProviderCost,
      costWithIva: providerCostWithIva,
      price: effectivePrice,
      priceWithIva: effectivePublicPriceWithIva,
      salePrice: productSales.size > 0 ? numberValue(priceByProduct.get(item.codigo)) : 0,
      pricePuntoPas: effectivePuntoPasPrice,
      pricePvp: effectivePvpPrice,
      stock: Object.values(mappedWarehouseStocks).reduce((sum, value) => sum + value, 0),
      stockTotal,
      warehouseStocks,
      lastPurchase: provider?.fecha_ultima_compra ? dayjs(provider.fecha_ultima_compra).format('YYYY-MM-DD') : '',
      saleDate: saleDateByProduct.get(item.codigo) ?? '',
      lastPurchaseQuantity: numberValue(provider?.cantidad_ultima_compra_proveedor),
      monthlySales: months.map((month) => {
        const quantity = productSales.get(month.label) ?? 0;
        const revenue = productRevenue.get(month.label) ?? 0;
        return { month: month.label, quantity, revenue, profit: revenue - (providerCostWithIva * quantity), weekStart: month.weekStart, monthLabel: month.monthLabel };
      }),
      hourlySales: hours.map((hour) => ({ month: hour, quantity: productHourlySales.get(hour) ?? 0 })),
      salesRevenueWithIva: revenueByProduct.get(item.codigo) ?? 0,
      salesProfitWithIva: salesProfitWithProviderCost,
      salesAverageMarginPercent
    };
  });
};
