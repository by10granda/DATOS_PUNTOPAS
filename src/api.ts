import type {
  DashboardResponse,
  CompactDashboardResponse,
  MonthlySale,
  Branch,
  ProductOverviewResponse,
  DataDashboardResponse,
  CompactDataDashboardResponse,
  DataDashboardRow,
} from './types';

const apiUrl = (path: string) => `${path}`;

export function rehydrateDataDashboard(payload: DataDashboardResponse | CompactDataDashboardResponse): DataDashboardResponse {
  if (!('compact' in payload) || payload.compact !== true) return payload as DataDashboardResponse;
  const { compact: _compact, dictionaries, rows, ...meta } = payload;
  const axis = payload.weeklyUnitsSeries;
  const restoreSales = (flat: number[]): MonthlySale[] => {
    const points: MonthlySale[] = axis.map((point) => ({
      month: point.week,
      quantity: 0,
      revenue: 0,
      profit: 0,
      ...(point.weekStart ? { weekStart: point.weekStart } : {}),
      ...(point.monthLabel ? { monthLabel: point.monthLabel } : {}),
    }));
    for (let index = 0; index + 3 < flat.length; index += 4) {
      const bucket = flat[index];
      const base = points[bucket];
      if (!base) continue;
      points[bucket] = { ...base, quantity: flat[index + 1], revenue: flat[index + 2], profit: flat[index + 3] };
    }
    return points;
  };
  const restoredRows: DataDashboardRow[] = rows.map((tuple) => {
    const [
      code,
      description,
      line,
      category,
      brand,
      type,
      stockTotal,
      warehousePairs,
      lastPurchase,
      lastPurchaseQuantity,
      costWithIva,
      provider,
      missingFields,
      pricePuntoPas,
      publicCost,
      currentPriceWithIva,
      currentMarginPercent,
      sparseSales,
    ] = tuple;
    const warehouseStocks: Record<string, number> = {};
    for (let index = 0; index + 1 < warehousePairs.length; index += 2) {
      const name = dictionaries.warehouse[warehousePairs[index]];
      if (name !== undefined) warehouseStocks[name] = warehousePairs[index + 1];
    }
    return {
      code,
      description,
      line: dictionaries.line[line] ?? '',
      category: dictionaries.category[category] ?? '',
      brand: dictionaries.brand[brand] ?? '',
      type: dictionaries.type[type] ?? '',
      stockTotal,
      warehouseStocks,
      lastPurchase: dictionaries.lastPurchase[lastPurchase] ?? '',
      lastPurchaseQuantity,
      costWithIva,
      provider: dictionaries.provider[provider] ?? '',
      missingFields: [...(dictionaries.missing[missingFields] ?? [])],
      pricePuntoPas,
      publicCost,
      currentPriceWithIva,
      currentMarginPercent,
      monthlySales: restoreSales(sparseSales),
    };
  });
  return { ...meta, weeklyUnitsSeries: axis, rows: restoredRows };
}

export function rehydrateDashboard(payload: DashboardResponse | CompactDashboardResponse): DashboardResponse {
  if (!('compact' in payload) || payload.compact !== true) return payload as DashboardResponse;
  const { compact: _compact, seriesTemplates, ...dashboard } = payload;
  const restore = (template: MonthlySale[], points: [number, MonthlySale][]) => {
    const series = template.map((point) => ({ ...point }));
    for (const [index, point] of points) series[index] = { ...point };
    return series;
  };
  const rows = payload.rows.map((row) => ({
    ...row,
    monthlySales: restore(seriesTemplates.monthlySales, row.monthlySales),
    hourlySales: restore(seriesTemplates.hourlySales, row.hourlySales),
  }));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const restoreList = (ids: string[]) => ids.map((id) => {
    const row = rowsById.get(id);
    if (!row) throw new Error(`Dashboard transport: unknown row ${id}`);
    return row;
  });
  return {
    ...dashboard,
    rows,
    lowStockHighRotationRows: restoreList(payload.lowStockHighRotationRows),
    topRotationRows: restoreList(payload.topRotationRows),
    noSalesRows: restoreList(payload.noSalesRows),
    overstockRows: restoreList(payload.overstockRows),
  };
}

export async function fetchBranches(): Promise<Branch[]> {
  const response = await fetch(apiUrl('/api/branches'));
  if (!response.ok) throw new Error('No se pudieron cargar las sucursales');
  return response.json();
}

export async function fetchDashboard(params: {
  branch: string | null;
  periodMonths: number;
  search: string;
  category: string;
  brand: string;
  line: string;
  type: string;
  productCode: string;
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<DashboardResponse> {
  const query = new URLSearchParams();
  query.set('compact', '1');
  if (params.branch) query.set('branch', params.branch);
  query.set('periodMonths', String(params.periodMonths));
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.brand) query.set('brand', params.brand);
  if (params.line) query.set('line', params.line);
  if (params.type) query.set('type', params.type);
  if (params.productCode) query.set('productCode', params.productCode);
  if (params.dateStart) query.set('dateStart', params.dateStart);
  if (params.dateEnd) query.set('dateEnd', params.dateEnd);
  const response = await fetch(apiUrl(`/api/dashboard?${query.toString()}`));
  if (!response.ok) {
    const body = await response.text();
    try {
      const error = JSON.parse(body) as { message?: string };
      throw new Error(error?.message ? `${error.message} (HTTP ${response.status})` : `No se pudo cargar el dashboard (HTTP ${response.status})`);
    } catch {
      throw new Error(`No se pudo cargar el dashboard (HTTP ${response.status}): ${body.slice(0, 180)}`);
    }
  }
  return rehydrateDashboard(await response.json());
}

export async function fetchProductOverview(periodMonths: number, refresh = false, branch = 'ALMACEN PAS'): Promise<ProductOverviewResponse> {
  const query = new URLSearchParams({ periodMonths: String(periodMonths) });
  query.set('branch', branch);
  if (refresh) query.set('refresh', '1');
  const response = await fetch(apiUrl(`/api/product-overview?${query.toString()}`));
  if (!response.ok) {
    const body = await response.text();
    try {
      const error = JSON.parse(body) as { message?: string };
      throw new Error(error?.message ? `${error.message} (HTTP ${response.status})` : `No se pudo cargar Total de Productos (HTTP ${response.status})`);
    } catch {
      throw new Error(`No se pudo cargar Total de Productos (HTTP ${response.status}): ${body.slice(0, 180)}`);
    }
  }
  return response.json();
}

export async function fetchDataDashboard(params: {
  branch: string;
  bucket: 'week' | 'day';
  months?: number;
  days?: number;
  refresh?: boolean;
}): Promise<DataDashboardResponse> {
  const query = new URLSearchParams({ branch: params.branch, bucket: params.bucket });
  if (params.bucket === 'day') query.set('days', String(params.days ?? 7));
  else query.set('months', String(params.months ?? 12));
  if (params.refresh) query.set('refresh', '1');
  const response = await fetch(apiUrl(`/api/data-dashboard?${query.toString()}`), { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.text();
    try {
      const error = JSON.parse(body) as { message?: string };
      throw new Error(error?.message ? `${error.message} (HTTP ${response.status})` : `No se pudo cargar el Dashboard de Datos (HTTP ${response.status})`);
    } catch {
      throw new Error(`No se pudo cargar el Dashboard de Datos (HTTP ${response.status}): ${body.slice(0, 180)}`);
    }
  }
  return rehydrateDataDashboard(await response.json());
}

export async function askAssistant(params: { question: string; periodMonths: number; branch?: string | null }): Promise<{ answer: string; periodLabel: string }> {
  const response = await fetch(apiUrl('/api/assistant'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = await response.text();
    try {
      const error = JSON.parse(body) as { message?: string };
      throw new Error(error?.message ? `${error.message} (HTTP ${response.status})` : `No se pudo consultar el asistente (HTTP ${response.status})`);
    } catch {
      throw new Error(`No se pudo consultar el asistente (HTTP ${response.status}): ${body.slice(0, 180)}`);
    }
  }
  return response.json();
}
