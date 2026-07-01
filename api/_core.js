import dayjs from 'dayjs';

export const branches = [{ name: 'ALMACEN PAS' }];

const numberValue = (value) => Number(value ?? 0) || 0;
const textValue = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const normalizeText = (value) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

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
  const user = process.env.SIAPE_API_USER;
  const password = process.env.SIAPE_API_PASSWORD;
  if (!user || !password) throw new Error('Faltan credenciales SIAPE_API_USER o SIAPE_API_PASSWORD');

  const response = await fetch(buildUrl(baseUrl, '/api/usuario/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: user, password })
  });
  if (!response.ok) throw new Error(`No se pudo autenticar en SIAPE. Codigo ${response.status}`);

  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : parsed.token ?? text;
  } catch {
    return text.replace(/^"|"$/g, '');
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

const saleDuplicateKey = (sale) => [
  sale.codigo,
  numberValue(sale.cantidad_vendida).toFixed(4),
  numberValue(sale.precio_costo).toFixed(4),
  numberValue(sale.precio_venta).toFixed(4)
].join('|');

const saleDocumentSignature = (sales) => sales
  .map((sale) => saleDuplicateKey(sale))
  .sort((a, b) => a.localeCompare(b))
  .join('||');

const dedupeEquivalentSaleDocuments = (rows) => {
  const duplicateDocumentWindowSeconds = Number(process.env.SIAPE_DUPLICATE_DOCUMENT_WINDOW_SECONDS ?? 1800);
  const documentsByTimestamp = new Map();

  for (const row of rows) {
    const timestamp = dayjs(row.fecha_venta).isValid() ? dayjs(row.fecha_venta).format('YYYY-MM-DDTHH:mm:ss') : 'SIN_FECHA';
    const documentRows = documentsByTimestamp.get(timestamp) ?? [];
    documentRows.push(row);
    documentsByTimestamp.set(timestamp, documentRows);
  }

  const acceptedDocuments = new Map();
  const dedupedRows = [];

  for (const [timestamp, documentRows] of Array.from(documentsByTimestamp.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const saleDate = dayjs(timestamp);
    const signature = saleDocumentSignature(documentRows);
    const lastAcceptedDate = acceptedDocuments.get(signature);

    if (lastAcceptedDate && saleDate.isValid() && Math.abs(saleDate.diff(lastAcceptedDate, 'second')) <= duplicateDocumentWindowSeconds) continue;
    if (saleDate.isValid()) acceptedDocuments.set(signature, saleDate);
    dedupedRows.push(...documentRows);
  }

  return dedupedRows;
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
      niveles_precio: item.niveles_precio?.length ? item.niveles_precio : existing.niveles_precio,
      proveedores: item.proveedores?.length ? item.proveedores : existing.proveedores,
      disponibilidad: Math.max(numberValue(existing.disponibilidad), numberValue(item.disponibilidad))
    });
  }
  return Array.from(byCode.values());
};

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
  const duplicateWindowSeconds = Number(process.env.SIAPE_DUPLICATE_WINDOW_SECONDS ?? 300);
  const lastAcceptedBySaleKey = new Map();

  return dedupeEquivalentSaleDocuments(rows).sort((a, b) => dayjs(a.fecha_venta).valueOf() - dayjs(b.fecha_venta).valueOf()).filter((sale) => {
    const saleDate = dayjs(sale.fecha_venta);
    if (!saleDate.isValid() || saleDate.isBefore(start) || saleDate.isAfter(end)) return false;
    const saleKey = saleDuplicateKey(sale);
    const lastAcceptedDate = lastAcceptedBySaleKey.get(saleKey);
    if (lastAcceptedDate && Math.abs(saleDate.diff(lastAcceptedDate, 'second')) <= duplicateWindowSeconds) return false;
    lastAcceptedBySaleKey.set(saleKey, saleDate);
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

export const loadSiapeProducts = async (dateStart, dateEnd) => {
  const baseUrl = process.env.SIAPE_API_BASE_URL;
  if (!baseUrl) throw new Error('SIAPE_API_BASE_URL no esta configurado');
  const token = await getToken(baseUrl);
  const [inventory, sales, catalog] = await Promise.all([
    fetchJson(baseUrl, '/api/item/reporteinventario', token),
    fetchSales(baseUrl, token, dateStart, dateEnd),
    fetchOptionalJson(baseUrl, '/api/item/search3', token, [])
  ]);

  const salesByProduct = new Map();
  const revenueByProduct = new Map();
  const profitByProduct = new Map();
  const costByProduct = new Map();
  const priceByProduct = new Map();
  const catalogByProduct = new Map(catalog.map((item) => [item.codigo, item]));

  for (const sale of sales) {
    const code = sale.codigo;
    const hour = dayjs(sale.fecha_venta).isValid() ? dayjs(sale.fecha_venta).format('HH:00') : '00:00';
    const productSales = salesByProduct.get(code) ?? new Map();
    const quantity = numberValue(sale.cantidad_vendida);
    const saleCostWithIva = numberValue(sale.precio_costo) * 1.15;
    const salePriceWithIva = numberValue(sale.precio_venta) * 1.15;
    productSales.set(hour, (productSales.get(hour) ?? 0) + quantity);
    salesByProduct.set(code, productSales);
    revenueByProduct.set(code, (revenueByProduct.get(code) ?? 0) + (salePriceWithIva * quantity));
    profitByProduct.set(code, (profitByProduct.get(code) ?? 0) + ((salePriceWithIva - saleCostWithIva) * quantity));
    costByProduct.set(code, numberValue(sale.precio_costo));
    priceByProduct.set(code, numberValue(sale.precio_venta));
  }

  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);

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
      stock: Math.max(0, numberValue(item.disponibilidad)),
      lastPurchase: provider?.fecha_ultima_compra ? dayjs(provider.fecha_ultima_compra).format('YYYY-MM-DD') : '',
      lastPurchaseQuantity: numberValue(provider?.cantidad_ultima_compra_proveedor),
      monthlySales: hours.map((hour) => ({ month: hour, quantity: productSales.get(hour) ?? 0 })),
      salesRevenueWithIva: revenueByProduct.get(item.codigo) ?? 0,
      salesProfitWithIva: profitByProduct.get(item.codigo) ?? 0
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
  const publicCostWithIva = product.priceWithIva ?? publicCost * 1.15;
  const catalogUnitProfit = publicCostWithIva - costWithIva;
  const totalProfit = product.salesProfitWithIva ?? catalogUnitProfit * salesXMonths;
  const unitProfit = salesXMonths > 0 ? totalProfit / salesXMonths : catalogUnitProfit;
  const marginBase = product.salesRevenueWithIva && product.salesRevenueWithIva > 0 ? product.salesRevenueWithIva : publicCostWithIva;
  const marginPercent = marginBase > 0 ? ((product.salesProfitWithIva ?? catalogUnitProfit) / marginBase) * 100 : 0;
  const estimatedDaysInventory = averageMonthlySales > 0 ? Math.round((product.stock / averageMonthlySales) * 30) : 999;
  const inventoryState = salesXMonths === 0 ? 'Sin ventas' : rotation > 1.25 ? 'Alta rotacion' : product.stock > averageMonthlySales * 3 ? 'Sobrestock' : 'Normal';
  const inventorySignal = product.stock > averageMonthlySales * 3 ? 'Sobrestock' : salesXMonths === 0 ? 'Atención' : rotation > 1 ? 'Normal' : 'Atención';
  const recommendation = salesXMonths === 0 ? 'Se recomienda detener compras y revisar portafolio.' : product.stock > averageMonthlySales * 3 ? `Este producto tiene sobrestock para aproximadamente ${Math.max(1, Math.round(estimatedDaysInventory / 30))} meses.` : estimatedDaysInventory <= 30 ? `Este producto tiene alta rotacion y se agotara en ${Math.max(1, estimatedDaysInventory)} dias.` : 'Se recomienda mantener el nivel actual de inventario.';

  return { ...product, salesXMonths, unitProfit, totalProfit, lastPurchase: product.lastPurchase, costProvider: product.cost, costWithIva, publicCost, salePrice, publicCostWithIva, marginPercent, rotation, inventoryState, inventorySignal, recommendation, averageMonthlySales, estimatedDaysInventory };
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
  const averageMargin = rows.length ? rows.reduce((sum, row) => sum + row.marginPercent, 0) / rows.length : 0;
  const donutSeries = monthLabels.map((month) => ({ name: month, value: rows.reduce((sum, row) => sum + (row.monthlySales.find((sale) => sale.month === month)?.quantity ?? 0), 0) })).filter((item) => item.value > 0);

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
