import type { DashboardResponse, PeriodMonths, ProductRecord, ProductRow } from './types';

export const normalizeText = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const excludedProductCodes = new Set(['00002018', '00002019']);

export const buildRow = (product: ProductRecord, periodMonths: PeriodMonths): ProductRow => {
  const selectedSales = product.monthlySales;
  const salesXMonths = selectedSales.reduce((sum, item) => sum + item.quantity, 0);
  const averageMonthlySales = salesXMonths;
  const rotation = product.stock > 0 ? salesXMonths / product.stock : salesXMonths;
  const costWithIva = product.costWithIva || product.cost;
  const publicCost = product.price;
  const publicCostWithIva = product.priceWithIva ?? publicCost * 1.15;
  const unitProfit = publicCostWithIva - costWithIva;
  const marginPercent = publicCostWithIva > 0 ? (unitProfit / publicCostWithIva) * 100 : 0;
  const totalProfit = unitProfit * salesXMonths;
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
    salesXMonths,
    unitProfit,
    totalProfit,
    lastPurchase: product.lastPurchase,
    costProvider: product.cost,
    costWithIva,
    publicCost,
    publicCostWithIva,
    marginPercent,
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
  const productsForDashboard = products.filter((product) => !excludedProductCodes.has(product.code));

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
  const averageMargin = rows.length ? rows.reduce((sum, row) => sum + row.marginPercent, 0) / rows.length : 0;

  const donutSeries = monthLabels.map((month) => ({
    name: month,
    value: rows.reduce((sum, row) => sum + (row.monthlySales.find((sale) => sale.month === month)?.quantity ?? 0), 0)
  })).filter((item) => item.value > 0);

  const categories = Array.from(new Set(facetProducts.map((row) => row.category))).sort((a, b) => a.localeCompare(b, 'es'));
  const brands = Array.from(new Set(facetProducts.map((row) => row.brand))).sort((a, b) => a.localeCompare(b, 'es'));
  const lines = Array.from(new Set(facetProducts.map((row) => row.line))).sort((a, b) => a.localeCompare(b, 'es'));
  const types = Array.from(new Set(facetProducts.map((row) => row.type))).sort((a, b) => a.localeCompare(b, 'es'));
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
