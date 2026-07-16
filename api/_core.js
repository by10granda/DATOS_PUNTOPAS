import dayjs from 'dayjs';

export const branches = [{ name: 'ALMACEN PAS' }];

const numberValue = (value) => Number(value ?? 0) || 0;
const textValue = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const normalizeText = (value) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
let tokenCache = null;
const averageValidMargins = (rows) => {
  const margins = rows.map((row) => row.marginPercent).filter((margin) => Number.isFinite(margin));
  return margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : 0;
};

export const buildUrl = (baseUrl, path) => {
  const normalizedBaseUrl = baseUrl.replace(/^\/+/, '').match(/^https?:\/\//)
    ? baseUrl.replace(/^\/+/, '')
    : `https://${baseUrl.replace(/^\/+/, '')}`;
  const cleanBase = normalizedBaseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase.endsWith('/api') && cleanPath.startsWith('/api/')) return `${cleanBase}${cleanPath.slice(4)}`;
  return `${cleanBase}${cleanPath}`;
};

export const getToken = async (baseUrl) => {
  if (tokenCache?.baseUrl === baseUrl && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const user = process.env.SIAPE_API_USER;
  const password = process.env.SIAPE_API_PASSWORD;
  if (!user || !password) throw new Error('Faltan credenciales SIAPE_API_USER o SIAPE_API_PASSWORD');

  const response = await fetch(buildUrl(baseUrl, '/api/usuario/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: user, password })
  });
  if (!response.ok) {
    if (tokenCache?.baseUrl === baseUrl) return tokenCache.token;
    throw new Error(`No se pudo autenticar en SIAPE. Codigo ${response.status}`);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    const token = typeof parsed === 'string' ? parsed : parsed.token ?? text;
    tokenCache = { baseUrl, token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    return token;
  } catch {
    const token = text.replace(/^"|"$/g, '');
    tokenCache = { baseUrl, token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    return token;
  }
};

export const authHeaders = (token) => {
  const header = process.env.SIAPE_AUTH_HEADER ?? 'Authorization';
  const prefix = process.env.SIAPE_AUTH_PREFIX ?? 'Bearer';
  return { [header]: prefix ? `${prefix} ${token}` : token };
};

const fetchJson = async (baseUrl, path, token) => {
  const response = await fetch(buildUrl(baseUrl, path), { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`Error SIAPE ${response.status} en ${path}`);
  return response.json();
};

const fetchOptionalJson = async (baseUrl, path, token, fallback) => {
  try {
    return await fetchJson(baseUrl, path, token);
  } catch {
    return fallback;
  }
};

const dedupeInventoryByCode = (inventory) => {
  const byCode = new Map();
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

const mergeWarehouses = (current = [], next = []) => {
  const byName = new Map();
  for (const warehouse of [...current, ...next]) {
    const name = textValue(warehouse?.bodegaALMACEN, 'SIN BODEGA').toUpperCase();
    byName.set(name, Math.max(byName.get(name) ?? 0, Math.max(0, numberValue(warehouse?.stock))));
  }
  return Array.from(byName.entries()).map(([bodegaALMACEN, stock]) => ({ bodegaALMACEN, stock }));
};

const mapWarehouseStocks = (warehouses = []) => Object.fromEntries(
  warehouses.map((warehouse) => [textValue(warehouse?.bodegaALMACEN, 'SIN BODEGA').toUpperCase(), Math.max(0, numberValue(warehouse?.stock))])
);

const fetchSales = async (baseUrl, token, dateStart, dateEnd) => {
  const pageSize = Number(process.env.SIAPE_PAGE_SIZE ?? 5000);
  const rows = [];
  const pageSignatures = new Set();
  const queryDateEnd = dayjs(dateEnd).add(1, 'day').format('YYYY-MM-DD');

  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({ fechaInicio: dateStart, fechaFin: queryDateEnd, page: String(page), pageSize: String(pageSize) });
    const batch = await fetchJson(baseUrl, `/api/factura/reporteventas?${query.toString()}`, token);
    const pageSignature = JSON.stringify(batch);
    if (pageSignatures.has(pageSignature)) break;
    pageSignatures.add(pageSignature);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const start = dayjs(dateStart).startOf('day');
  const end = dayjs(dateEnd).endOf('day');
  return rows.sort((a, b) => dayjs(a.fecha_venta).valueOf() - dayjs(b.fecha_venta).valueOf()).filter((sale) => {
    const saleDate = dayjs(sale.fecha_venta);
    if (!saleDate.isValid() || saleDate.isBefore(start) || saleDate.isAfter(end)) return false;
    return true;
  });
};

const getSaleUnitFactor = (item) => {
  const factors = item?.unidadesVenta?.map((unit) => numberValue(unit.factor)).filter((factor) => factor > 1) ?? [];
  return factors.length ? Math.max(...factors) : 1;
};

const normalizeProviderCostWithIva = (rawCostWithIva, providerCost, publicPriceWithIva, unitFactor) => {
  const fallbackUnitCostWithIva = providerCost > 0 ? providerCost * 1.15 : rawCostWithIva;
  if (unitFactor > 1 && rawCostWithIva > publicPriceWithIva) {
    const dividedCost = rawCostWithIva / unitFactor;
    const dividedLooksLikeCostWithoutIva = providerCost > 0 && Math.abs(dividedCost - providerCost) / providerCost <= 0.02;
    return dividedLooksLikeCostWithoutIva ? fallbackUnitCostWithIva : dividedCost;
  }
  return rawCostWithIva || fallbackUnitCostWithIva;
};

export const loadSiapeProducts = async (dateStart, dateEnd, bucket = 'hour') => {
  const baseUrl = process.env.SIAPE_API_BASE_URL;
  if (!baseUrl) throw new Error('SIAPE_API_BASE_URL no esta configurado');
  const token = await getToken(baseUrl);
  const [inventory, sales, catalog] = await Promise.all([
    fetchJson(baseUrl, '/api/item/reporteinventario', token),
    fetchSales(baseUrl, token, dateStart, dateEnd),
    fetchOptionalJson(baseUrl, '/api/item/search3', token, [])
  ]);

  const salesByProduct = new Map();
  const revenueByProductBucket = new Map();
  const profitByProductBucket = new Map();
  const revenueByProduct = new Map();
  const saleDateByProduct = new Map();
  const costByProduct = new Map();
  const priceByProduct = new Map();
  const salePricesWithIvaByProduct = new Map();
  const catalogByProduct = new Map(catalog.map((item) => [item.codigo, item]));

  for (const sale of sales) {
    const code = sale.codigo;
    const saleDay = dayjs(sale.fecha_venta);
    const hour = bucket === 'week' && saleDay.isValid() ? `Sem ${saleDay.startOf('week').add(1, 'day').format('DD/MM')}` : saleDay.isValid() ? saleDay.format('HH:00') : '00:00';
    const productSales = salesByProduct.get(code) ?? new Map();
    const productRevenue = revenueByProductBucket.get(code) ?? new Map();
    const productProfit = profitByProductBucket.get(code) ?? new Map();
    const quantity = numberValue(sale.cantidad_vendida);
    const saleCostWithIva = numberValue(sale.precio_costo) * 1.15;
    const salePriceWithIva = numberValue(sale.precio_venta) * 1.15;
    productSales.set(hour, (productSales.get(hour) ?? 0) + quantity);
    productRevenue.set(hour, (productRevenue.get(hour) ?? 0) + (salePriceWithIva * quantity));
    productProfit.set(hour, (productProfit.get(hour) ?? 0) + ((salePriceWithIva - saleCostWithIva) * quantity));
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

  const hours = bucket === 'week'
    ? Array.from(new Set(Array.from({ length: Math.max(1, dayjs(dateEnd).diff(dayjs(dateStart), 'week') + 2) }, (_value, index) => {
      const weekStart = dayjs(dateStart).startOf('week').add(1 + index * 7, 'day');
      return JSON.stringify({ label: `Sem ${weekStart.format('DD/MM')}`, weekStart: weekStart.format('YYYY-MM-DD'), monthLabel: weekStart.format('MMMM YYYY') });
    }))).map((item) => JSON.parse(item))
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
    const productSales = salesByProduct.get(item.codigo) ?? new Map();
    const productRevenue = revenueByProductBucket.get(item.codigo) ?? new Map();
    const productProfit = profitByProductBucket.get(item.codigo) ?? new Map();
    const salePrices = salePricesWithIvaByProduct.get(item.codigo) ?? [];
    const marginSales = salePrices.filter((sale) => sale.quantity > 0 && sale.priceWithIva > 0);
    const soldQuantity = marginSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const salesProfitWithProviderCost = salePrices.reduce((sum, sale) => sum + ((sale.priceWithIva - providerCostWithIva) * sale.quantity), 0);
    const salesAverageMarginPercent = soldQuantity > 0 ? marginSales.reduce((sum, sale) => sum + (((sale.priceWithIva - providerCostWithIva) / sale.priceWithIva) * 100 * sale.quantity), 0) / soldQuantity : undefined;
    const warehouseStocks = mapWarehouseStocks(item.bodegas);
    const stockTotal = Object.values(warehouseStocks).reduce((sum, stock) => sum + stock, 0);

    return {
      id: `ALMACEN PAS-${item.codigo}`,
      branch: 'ALMACEN PAS',
      code: item.codigo,
      description: item.descripcion,
      brand: item.marca ?? 'SIN MARCA',
      line: item.linea ?? 'SIN LINEA',
      category: item.categoria ?? 'SIN CATEGORIA',
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
      monthlySales: hours.map((hour) => ({ month: hour.label, quantity: productSales.get(hour.label) ?? 0, revenue: productRevenue.get(hour.label) ?? 0, profit: productProfit.get(hour.label) ?? 0, weekStart: hour.weekStart, monthLabel: hour.monthLabel })),
      salesRevenueWithIva: revenueByProduct.get(item.codigo) ?? 0,
      salesProfitWithIva: salesProfitWithProviderCost,
      salesAverageMarginPercent
    };
  });
};

const buildRow = (product) => {
  const salesXMonths = product.monthlySales.reduce((sum, item) => sum + item.quantity, 0);
  const averageMonthlySales = salesXMonths;
  const rotation = product.stock > 0 ? salesXMonths / product.stock : salesXMonths;
  const costWithIva = product.costWithIva || product.cost;
  const publicCost = product.price;
  const salePrice = salesXMonths > 0 && product.salesRevenueWithIva ? product.salesRevenueWithIva / salesXMonths / 1.15 : product.salePrice || 0;
  const publicCostWithIva = (salePrice || publicCost) * 1.15;
  const currentPriceWithIva = (product.pricePuntoPas || publicCost) * 1.15;
  const catalogUnitProfit = publicCostWithIva - costWithIva;
  const totalProfit = product.salesProfitWithIva ?? catalogUnitProfit * salesXMonths;
  const unitProfit = salesXMonths > 0 ? totalProfit / salesXMonths : catalogUnitProfit;
  const marginPercent = costWithIva > 0 ? ((publicCostWithIva - costWithIva) / costWithIva) * 100 : 0;
  const currentMarginPercent = costWithIva > 0 ? ((currentPriceWithIva - costWithIva) / costWithIva) * 100 : 0;
  const estimatedDaysInventory = averageMonthlySales > 0 ? Math.round((product.stock / averageMonthlySales) * 30) : 999;
  const inventoryState = salesXMonths === 0 ? 'Sin ventas' : rotation > 1.25 ? 'Alta rotacion' : product.stock > averageMonthlySales * 3 ? 'Sobrestock' : 'Normal';
  const inventorySignal = product.stock > averageMonthlySales * 3 ? 'Sobrestock' : salesXMonths === 0 ? 'Atención' : rotation > 1 ? 'Normal' : 'Atención';
  const recommendation = salesXMonths === 0 ? 'Se recomienda detener compras y revisar portafolio.' : product.stock > averageMonthlySales * 3 ? `Este producto tiene sobrestock para aproximadamente ${Math.max(1, Math.round(estimatedDaysInventory / 30))} meses.` : estimatedDaysInventory <= 30 ? `Este producto tiene alta rotacion y se agotara en ${Math.max(1, estimatedDaysInventory)} dias.` : 'Se recomienda mantener el nivel actual de inventario.';

  return { ...product, salesXMonths, unitProfit, totalProfit, lastPurchase: product.lastPurchase, saleDate: product.saleDate, costProvider: product.cost, costWithIva, publicCost, salePrice, publicCostWithIva, currentPriceWithIva, marginPercent, currentMarginPercent, rotation, inventoryState, inventorySignal, recommendation, averageMonthlySales, estimatedDaysInventory };
};

export const buildDashboard = (products, params) => {
  const searchTerm = normalizeText(params.search);
  const available = Array.from(new Map(products.map((product) => [product.code, product])).values());
  const facetProducts = available.filter((product) => {
    const branchMatch = !params.branch || product.branch === params.branch;
    const searchMatch = !searchTerm || [product.code, product.description, product.brand, product.line, product.category, product.type, product.provider].some((field) => normalizeText(field).includes(searchTerm));
    return branchMatch && searchMatch;
  });
  const filtered = facetProducts.filter((product) => {
    const categoryMatch = params.category === 'TODOS' || product.category === params.category;
    const brandMatch = params.brand === 'TODAS' || product.brand === params.brand;
    const lineMatch = params.line === 'TODAS' || product.line === params.line;
    const typeMatch = params.type === 'TODOS' || product.type === params.type;
    const productMatch = params.productCode === 'TODOS' || product.code === params.productCode;
    return categoryMatch && brandMatch && lineMatch && typeMatch && productMatch;
  });

  const rows = filtered.map(buildRow);
  const monthLabels = Array.from(new Set(filtered.flatMap((product) => product.monthlySales.map((sale) => sale.month))));
  const totalsByMonth = monthLabels.map((month) => ({ month, quantity: rows.reduce((sum, row) => sum + (row.monthlySales.find((sale) => sale.month === month)?.quantity ?? 0), 0) }));
  const totalUnitsSold = rows.reduce((sum, row) => sum + row.salesXMonths, 0);
  const totalStock = rows.reduce((sum, row) => sum + row.stock, 0);
  const totalProfit = rows.reduce((sum, row) => sum + row.totalProfit, 0);
  const averageGeneralSales = rows.length ? rows.reduce((acc, row) => acc + row.salesXMonths, 0) / rows.length : 0;
  const soldRows = rows.filter((row) => row.salesXMonths > 0);
  const averageMargin = averageValidMargins(soldRows);
  const donutSeries = monthLabels.map((month) => ({ name: month, value: rows.reduce((sum, row) => sum + (row.monthlySales.find((sale) => sale.month === month)?.quantity ?? 0), 0) })).filter((item) => item.value > 0);
  const availableWarehouses = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));

  return {
    branch: params.branch,
    periodMonths: params.periodMonths,
    periodLabel: `${params.periodMonths} MES${params.periodMonths > 1 ? 'ES' : ''}`,
    search: params.search,
    category: params.category,
    brand: params.brand,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    branches,
    availableCategories: Array.from(new Set(facetProducts.map((row) => row.category))).sort((a, b) => a.localeCompare(b, 'es')),
    availableBrands: Array.from(new Set(facetProducts.map((row) => row.brand))).sort((a, b) => a.localeCompare(b, 'es')),
    availableLines: Array.from(new Set(facetProducts.map((row) => row.line))).sort((a, b) => a.localeCompare(b, 'es')),
    availableTypes: Array.from(new Set(facetProducts.map((row) => row.type))).sort((a, b) => a.localeCompare(b, 'es')),
    availableWarehouses,
    availableProducts: facetProducts.map((row) => ({ code: row.code, description: row.description })).sort((a, b) => a.description.localeCompare(b.description, 'es')),
    kpis: { totalProducts: rows.length, totalUnitsSold, totalStock, totalProfit, highRotation: rows.filter((row) => row.salesXMonths > averageGeneralSales).length, noSales: rows.filter((row) => row.salesXMonths === 0).length, overstock: rows.filter((row) => row.stock > row.averageMonthlySales * 3).length, averageMargin },
    monthlySeries: totalsByMonth,
    donutSeries,
    barSeries: totalsByMonth.map((item) => ({ name: item.month, ventas: item.quantity })),
    rows,
    lowStockHighRotationRows: rows.filter((row) => row.salesXMonths > averageGeneralSales && row.stock <= Math.max(row.averageMonthlySales, 1)).sort((a, b) => a.estimatedDaysInventory - b.estimatedDaysInventory || b.salesXMonths - a.salesXMonths).slice(0, 20),
    topRotationRows: [...rows].sort((a, b) => b.salesXMonths - a.salesXMonths).slice(0, 20),
    noSalesRows: rows.filter((row) => row.salesXMonths === 0 || row.rotation < 0.1).slice(0, 20),
    overstockRows: rows.filter((row) => row.stock > row.averageMonthlySales * 3).slice(0, 20)
  };
};

const safeDivide = (value, max) => max > 0 ? value / max : 0;
const slope = (values) => {
  const n = values.length;
  if (n < 2) return 0;
  const avgX = (n - 1) / 2;
  const avgY = values.reduce((sum, value) => sum + value, 0) / n;
  const numerator = values.reduce((sum, value, index) => sum + ((index - avgX) * (value - avgY)), 0);
  const denominator = values.reduce((sum, _value, index) => sum + ((index - avgX) ** 2), 0);
  return denominator > 0 ? numerator / denominator : 0;
};

export const buildProductOverview = (products, params) => {
  const periodDays = Math.max(1, dayjs(params.dateEnd).diff(dayjs(params.dateStart), 'day') + 1);
  const baseRows = products.map(buildRow);
  const productByCode = new Map(products.map((product) => [product.code, product]));
  const revenueForRow = (row) => productByCode.get(row.code)?.salesRevenueWithIva ?? row.publicCostWithIva * row.salesXMonths;
  const rowsByRevenue = [...baseRows].sort((a, b) => revenueForRow(b) - revenueForRow(a));
  const totalRevenue = rowsByRevenue.reduce((sum, row) => sum + revenueForRow(row), 0);
  let cumulativeRevenue = 0;
  const abcByCode = new Map();

  rowsByRevenue.forEach((row) => {
    cumulativeRevenue += revenueForRow(row);
    const cumulativePercent = totalRevenue > 0 ? cumulativeRevenue / totalRevenue : 0;
    abcByCode.set(row.code, { abcClass: cumulativePercent <= 0.8 ? 'A' : cumulativePercent <= 0.95 ? 'B' : 'C', pareto: cumulativePercent <= 0.8 });
  });

  const enrichedRows = baseRows.map((row) => {
    const weeklyQuantities = row.monthlySales.map((sale) => sale.quantity);
    const weeklyAverage = weeklyQuantities.length ? weeklyQuantities.reduce((sum, value) => sum + value, 0) / weeklyQuantities.length : 0;
    const variance = weeklyQuantities.length ? weeklyQuantities.reduce((sum, value) => sum + ((value - weeklyAverage) ** 2), 0) / weeklyQuantities.length : 0;
    const coefficientVariation = weeklyAverage > 0 ? Math.sqrt(variance) / weeklyAverage : 0;
    const trendSlope = slope(weeklyQuantities);
    const firstHalf = weeklyQuantities.slice(0, Math.max(1, Math.floor(weeklyQuantities.length / 2))).reduce((sum, value) => sum + value, 0);
    const secondHalf = weeklyQuantities.slice(Math.floor(weeklyQuantities.length / 2)).reduce((sum, value) => sum + value, 0);
    const trendPercent = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : secondHalf > 0 ? 100 : 0;
    const averageDailySales = row.salesXMonths / periodDays;
    const coverageDays = averageDailySales > 0 ? row.stock / averageDailySales : 999;
    const daysSinceLastSale = row.saleDate ? Math.max(0, dayjs(params.dateEnd).diff(dayjs(row.saleDate), 'day')) : 999;
    const valueSold = revenueForRow(row);
    const soldPrice = row.salesXMonths > 0 ? valueSold / row.salesXMonths / 1.15 : 0;
    const providerPurchaseValue = row.costProvider * row.salesXMonths;
    const providerPurchaseValueWithIva = row.costWithIva * row.salesXMonths;
    const abc = abcByCode.get(row.code) ?? { abcClass: 'C', pareto: false };
    return { ...row, valueSold, soldPrice, providerPurchaseValue, providerPurchaseValueWithIva, averageDailySales, coverageDays, daysSinceLastSale, abcClass: abc.abcClass, xyzClass: coefficientVariation <= 0.35 ? 'X' : coefficientVariation <= 0.8 ? 'Y' : 'Z', pareto: abc.pareto, trend: trendSlope > 0.2 ? 'Creciente' : trendSlope < -0.2 ? 'Decreciente' : 'Estable', trendPercent, smartScore: 0, immobilizedCapital: row.stock * row.costWithIva };
  });

  const maxRotation = Math.max(...enrichedRows.map((row) => row.rotation), 1);
  const maxProfit = Math.max(...enrichedRows.map((row) => row.totalProfit), 1);
  const maxRevenue = Math.max(...enrichedRows.map((row) => row.valueSold), 1);
  const maxFrequency = Math.max(...enrichedRows.map((row) => row.monthlySales.filter((sale) => sale.quantity > 0).length), 1);
  const maxStock = Math.max(...enrichedRows.map((row) => row.stock), 1);
  const rows = enrichedRows.map((row) => {
    const frequency = row.monthlySales.filter((sale) => sale.quantity > 0).length;
    const coverageScore = row.coverageDays <= 45 ? 1 : row.coverageDays <= 90 ? 0.65 : row.coverageDays <= 180 ? 0.35 : 0.1;
    const stockScore = 1 - safeDivide(row.stock, maxStock) * 0.35;
    return { ...row, smartScore: Math.round((safeDivide(row.rotation, maxRotation) * 25 + safeDivide(row.totalProfit, maxProfit) * 25 + coverageScore * 15 + safeDivide(frequency, maxFrequency) * 15 + safeDivide(row.valueSold, maxRevenue) * 15 + stockScore * 5) * 100) / 100 };
  }).sort((a, b) => b.smartScore - a.smartScore);

  const weeklyLabels = Array.from(new Set(products.flatMap((product) => product.monthlySales.map((sale) => sale.month))));
  const weeklyUnitsSeries = weeklyLabels.map((week) => {
    const sale = products.flatMap((product) => product.monthlySales).find((item) => item.month === week);
    return { week, weekStart: sale?.weekStart, monthLabel: sale?.monthLabel, quantity: rows.reduce((sum, row) => sum + (row.monthlySales.find((item) => item.month === week)?.quantity ?? 0), 0) };
  });
  const weeklyRevenueSeries = weeklyLabels.map((week) => {
    const sale = products.flatMap((product) => product.monthlySales).find((item) => item.month === week);
    return { week, weekStart: sale?.weekStart, monthLabel: sale?.monthLabel, revenue: rows.reduce((sum, row) => sum + (row.monthlySales.find((item) => item.month === week)?.revenue ?? 0), 0) };
  });
  const soldRows = rows.filter((row) => row.salesXMonths > 0);
  const availableWarehouses = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));

  return {
    branch: params.branch,
    periodMonths: params.periodMonths,
    title: params.periodMonths === 3 ? 'TOTAL DE PRODUCTOS - VISTA GENERAL' : `TOTAL DE PRODUCTOS - ULTIMO${params.periodMonths > 1 ? 'S' : ''} ${params.periodMonths} MES${params.periodMonths > 1 ? 'ES' : ''}`,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    periodLabel: `${dayjs(params.dateStart).format('DD MMMM YYYY')} - ${dayjs(params.dateEnd).format('DD MMMM YYYY')}`,
    generatedAt: params.generatedAt,
    cacheKey: params.cacheKey,
    kpis: {
      totalProductsSold: soldRows.length,
      totalUnitsSold: rows.reduce((sum, row) => sum + row.salesXMonths, 0),
      totalRevenue,
      totalProfit: rows.reduce((sum, row) => sum + row.totalProfit, 0),
      averageMargin: averageValidMargins(soldRows),
      activeProducts: soldRows.length,
      noMovementProducts: rows.filter((row) => row.salesXMonths === 0).length,
      highRotationProducts: rows.filter((row) => row.rotation >= 1 || row.averageDailySales >= 1).length,
      criticalStockProducts: rows.filter((row) => row.salesXMonths > 0 && row.coverageDays <= 15).length
    },
    weeklyUnitsSeries,
    weeklyRevenueSeries,
    availableLines: Array.from(new Set(rows.map((row) => row.line))).sort((a, b) => a.localeCompare(b, 'es')),
    availableCategories: Array.from(new Set(rows.map((row) => row.category))).sort((a, b) => a.localeCompare(b, 'es')),
    availableTypes: Array.from(new Set(rows.map((row) => row.type))).sort((a, b) => a.localeCompare(b, 'es')),
    availableBrands: Array.from(new Set(rows.map((row) => row.brand))).sort((a, b) => a.localeCompare(b, 'es')),
    availableWarehouses,
    rows
  };
};
