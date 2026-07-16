import dayjs from 'dayjs';
import type { DashboardResponse, PeriodMonths, ProductOverviewResponse, ProductOverviewRow, ProductRecord, ProductRow } from './types';

export const normalizeText = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const dedupeProductsByCode = (products: ProductRecord[]) => Array.from(new Map(products.map((product) => [product.code, product])).values());
const averageValidMargins = (rows: ProductRow[]) => {
  const margins = rows.map((row) => row.marginPercent).filter((margin) => Number.isFinite(margin));
  return margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : 0;
};

export const buildRow = (product: ProductRecord, periodMonths: PeriodMonths): ProductRow => {
  const selectedSales = product.monthlySales;
  const salesXMonths = selectedSales.reduce((sum, item) => sum + item.quantity, 0);
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
  const marginBase = product.salesRevenueWithIva && product.salesRevenueWithIva > 0 ? product.salesRevenueWithIva : publicCostWithIva;
  const marginPercent = product.salesAverageMarginPercent ?? (marginBase > 0 ? ((product.salesProfitWithIva ?? catalogUnitProfit) / marginBase) * 100 : 0);
  const currentMarginPercent = costWithIva > 0 ? ((currentPriceWithIva - costWithIva) / costWithIva) * 100 : 0;
  const estimatedDaysInventory = averageMonthlySales > 0 ? Math.round((product.stock / averageMonthlySales) * 30) : 999;
  const inventoryState = salesXMonths === 0 ? 'Sin ventas' : rotation > 1.25 ? 'Alta rotación' : product.stock > averageMonthlySales * 3 ? 'Sobrestock' : 'Normal';
  const inventorySignal: ProductRow['inventorySignal'] = product.stock > averageMonthlySales * 3 ? 'Sobrestock' : salesXMonths === 0 ? 'Atención' : rotation > 1 ? 'Normal' : 'Atención';
  const recommendation = salesXMonths === 0
    ? 'Se recomienda detener compras y revisar portafolio.'
    : product.stock > averageMonthlySales * 3
      ? `Este producto tiene sobrestock para aproximadamente ${Math.max(1, Math.round(estimatedDaysInventory / 30))} meses.`
      : estimatedDaysInventory <= 30
        ? `Este producto tiene alta rotación y se agotará en ${Math.max(1, estimatedDaysInventory)} días.`
        : 'Se recomienda mantener el nivel actual de inventario.';

  return {
    id: product.id,
    code: product.code,
    description: product.description,
    stock: product.stock,
    stockTotal: product.stockTotal,
    warehouseStocks: product.warehouseStocks,
    salesXMonths,
    unitProfit,
    totalProfit,
    lastPurchase: product.lastPurchase,
    saleDate: product.saleDate,
    costProvider: product.cost,
    costWithIva,
    publicCost,
    salePrice,
    publicCostWithIva,
    currentPriceWithIva,
    marginPercent,
    currentMarginPercent,
    provider: product.provider,
    rotation,
    inventoryState,
    inventorySignal,
    recommendation,
    branch: product.branch,
    brand: product.brand,
    line: product.line,
    category: product.category,
    type: product.type,
    pricePuntoPas: product.pricePuntoPas,
    pricePvp: product.pricePvp,
    lastPurchaseQuantity: product.lastPurchaseQuantity,
    averageMonthlySales,
    estimatedDaysInventory,
    monthlySales: product.monthlySales,
  };
};

export const buildDashboard = (
  products: ProductRecord[],
  branches: { name: string }[],
  params: {
    branch: string | null;
    periodMonths: PeriodMonths;
    search: string;
    category: string;
    brand: string;
    line: string;
    type: string;
    productCode: string;
    dateStart: string | null;
    dateEnd: string | null;
  }
): DashboardResponse => {
  const searchTerm = normalizeText(params.search);
  const selectedBranch = params.branch;
  const productsForDashboard = dedupeProductsByCode(products);

  const facetProducts = productsForDashboard.filter((product) => {
    const branchMatch = !selectedBranch || product.branch === selectedBranch;
    const searchMatch = !searchTerm || [product.code, product.description, product.brand, product.line, product.category, product.type, product.provider]
      .some((field) => normalizeText(field).includes(searchTerm));
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

  const rows = filtered.map((product) => buildRow(product, params.periodMonths));
  const monthLabels = Array.from(new Set(filtered.flatMap((product) => product.monthlySales.map((sale) => sale.month))));

  const totalsByMonth = monthLabels.map((month) => {
    const quantity = rows.reduce((sum, row) => {
      const item = row.monthlySales.find((sale) => sale.month === month);
      return sum + (item?.quantity ?? 0);
    }, 0);
    return { month, quantity };
  });

  const totalUnitsSold = rows.reduce((sum, row) => sum + row.salesXMonths, 0);
  const totalStock = rows.reduce((sum, row) => sum + row.stock, 0);
  const totalProfit = rows.reduce((sum, row) => sum + row.totalProfit, 0);
  const averageGeneralSales = rows.length ? rows.reduce((acc, row) => acc + row.salesXMonths, 0) / rows.length : 0;
  const highRotation = rows.filter((row) => row.salesXMonths > averageGeneralSales).length;
  const noSales = rows.filter((row) => row.salesXMonths === 0).length;
  const overstock = rows.filter((row) => row.stock > row.averageMonthlySales * 3).length;
  const soldRows = rows.filter((row) => row.salesXMonths > 0);
  const averageMargin = averageValidMargins(soldRows);

  const donutSeries = monthLabels.map((month) => ({
    name: month,
    value: rows.reduce((sum, row) => sum + (row.monthlySales.find((sale) => sale.month === month)?.quantity ?? 0), 0)
  })).filter((item) => item.value > 0);

  const categories = Array.from(new Set(facetProducts.map((row) => row.category))).sort((a, b) => a.localeCompare(b, 'es'));
  const brands = Array.from(new Set(facetProducts.map((row) => row.brand))).sort((a, b) => a.localeCompare(b, 'es'));
  const lines = Array.from(new Set(facetProducts.map((row) => row.line))).sort((a, b) => a.localeCompare(b, 'es'));
  const types = Array.from(new Set(facetProducts.map((row) => row.type))).sort((a, b) => a.localeCompare(b, 'es'));
  const warehouses = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks)))).sort((a, b) => a.localeCompare(b, 'es'));
  const availableProducts = facetProducts
    .map((row) => ({ code: row.code, description: row.description }))
    .sort((a, b) => a.description.localeCompare(b.description, 'es'));

  const topRotationRows = [...rows]
    .sort((a, b) => b.salesXMonths - a.salesXMonths)
    .slice(0, 20);

  const lowStockHighRotationRows = rows
    .filter((row) => row.salesXMonths > averageGeneralSales && row.stock <= Math.max(row.averageMonthlySales, 1))
    .sort((a, b) => a.estimatedDaysInventory - b.estimatedDaysInventory || b.salesXMonths - a.salesXMonths)
    .slice(0, 20);

  const noSalesRows = rows.filter((row) => row.salesXMonths === 0 || row.rotation < 0.1).slice(0, 20);
  const overstockRows = rows.filter((row) => row.stock > row.averageMonthlySales * 3).slice(0, 20);

  return {
    branch: selectedBranch,
    periodMonths: params.periodMonths,
    periodLabel: `${params.periodMonths} MES${params.periodMonths > 1 ? 'ES' : ''}`,
    search: params.search,
    category: params.category,
    brand: params.brand,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    branches,
    availableCategories: categories,
    availableBrands: brands,
    availableLines: lines,
    availableTypes: types,
    availableWarehouses: warehouses,
    availableProducts,
    kpis: {
      totalProducts: rows.length,
      totalUnitsSold,
      totalStock,
      totalProfit,
      highRotation,
      noSales,
      overstock,
      averageMargin,
    },
    monthlySeries: totalsByMonth,
    donutSeries,
    barSeries: totalsByMonth.map((item) => ({ name: item.month, ventas: item.quantity })),
    rows,
    lowStockHighRotationRows,
    topRotationRows,
    noSalesRows,
    overstockRows,
  };
};

const safeDivide = (value: number, max: number) => max > 0 ? value / max : 0;
const slope = (values: number[]) => {
  const n = values.length;
  if (n < 2) return 0;
  const avgX = (n - 1) / 2;
  const avgY = values.reduce((sum, value) => sum + value, 0) / n;
  const numerator = values.reduce((sum, value, index) => sum + ((index - avgX) * (value - avgY)), 0);
  const denominator = values.reduce((sum, _value, index) => sum + ((index - avgX) ** 2), 0);
  return denominator > 0 ? numerator / denominator : 0;
};

export const buildProductOverview = (
  products: ProductRecord[],
  params: { branch: string; periodMonths: PeriodMonths; dateStart: string; dateEnd: string; cacheKey: string; generatedAt: string }
): ProductOverviewResponse => {
  const periodDays = Math.max(1, dayjs(params.dateEnd).diff(dayjs(params.dateStart), 'day') + 1);
  const baseRows = products.map((product) => buildRow(product, params.periodMonths));
  const productByCode = new Map(products.map((product) => [product.code, product]));
  const revenueForRow = (row: ProductRow) => productByCode.get(row.code)?.salesRevenueWithIva ?? row.publicCostWithIva * row.salesXMonths;
  const rowsByRevenue = [...baseRows].sort((a, b) => revenueForRow(b) - revenueForRow(a));
  const totalRevenue = rowsByRevenue.reduce((sum, row) => sum + revenueForRow(row), 0);
  let cumulativeRevenue = 0;
  const abcByCode = new Map<string, { abcClass: 'A' | 'B' | 'C'; pareto: boolean }>();

  rowsByRevenue.forEach((row) => {
    cumulativeRevenue += revenueForRow(row);
    const cumulativePercent = totalRevenue > 0 ? cumulativeRevenue / totalRevenue : 0;
    abcByCode.set(row.code, { abcClass: cumulativePercent <= 0.8 ? 'A' : cumulativePercent <= 0.95 ? 'B' : 'C', pareto: cumulativePercent <= 0.8 });
  });

  const enrichedRows: ProductOverviewRow[] = baseRows.map((row) => {
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
    const abc = abcByCode.get(row.code) ?? { abcClass: 'C' as const, pareto: false };

    return {
      ...row,
      valueSold,
      soldPrice,
      providerPurchaseValue,
      providerPurchaseValueWithIva,
      averageDailySales,
      coverageDays,
      daysSinceLastSale,
      abcClass: abc.abcClass,
      xyzClass: coefficientVariation <= 0.35 ? 'X' : coefficientVariation <= 0.8 ? 'Y' : 'Z',
      pareto: abc.pareto,
      trend: trendSlope > 0.2 ? 'Creciente' : trendSlope < -0.2 ? 'Decreciente' : 'Estable',
      trendPercent,
      smartScore: 0,
      immobilizedCapital: row.stock * row.costWithIva,
    };
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
    return {
      ...row,
      smartScore: Math.round((
        safeDivide(row.rotation, maxRotation) * 25 +
        safeDivide(row.totalProfit, maxProfit) * 25 +
        coverageScore * 15 +
        safeDivide(frequency, maxFrequency) * 15 +
        safeDivide(row.valueSold, maxRevenue) * 15 +
        stockScore * 5
      ) * 100) / 100,
    };
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
  const availableWarehouses = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks)))).sort((a, b) => a.localeCompare(b, 'es'));

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
      criticalStockProducts: rows.filter((row) => row.salesXMonths > 0 && row.coverageDays <= 15).length,
    },
    weeklyUnitsSeries,
    weeklyRevenueSeries,
    availableLines: Array.from(new Set(rows.map((row) => row.line))).sort((a, b) => a.localeCompare(b, 'es')),
    availableCategories: Array.from(new Set(rows.map((row) => row.category))).sort((a, b) => a.localeCompare(b, 'es')),
    availableTypes: Array.from(new Set(rows.map((row) => row.type))).sort((a, b) => a.localeCompare(b, 'es')),
    availableBrands: Array.from(new Set(rows.map((row) => row.brand))).sort((a, b) => a.localeCompare(b, 'es')),
    availableWarehouses,
    rows,
  };
};
