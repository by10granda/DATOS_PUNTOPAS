export type PeriodMonths = 1 | 2 | 3;

export type Branch = { name: string };

export type MonthlySale = { month: string; quantity: number; revenue?: number; profit?: number; weekStart?: string; monthLabel?: string };

export type ProductRow = {
  id: string;
  code: string;
  description: string;
  stock: number;
  stockTotal: number;
  warehouseStocks: Record<string, number>;
  salesXMonths: number;
  unitProfit: number;
  totalProfit: number;
  lastPurchase: string;
  saleDate: string;
  costProvider: number;
  costWithIva: number;
  publicCost: number;
  salePrice: number;
  publicCostWithIva: number;
  currentPriceWithIva: number;
  marginPercent: number;
  currentMarginPercent: number;
  provider: string;
  rotation: number;
  inventoryState: string;
  inventorySignal: 'Normal' | 'Atención' | 'Sobrestock';
  recommendation: string;
  branch: string;
  brand: string;
  line: string;
  category: string;
  type: string;
  pricePuntoPas: number;
  pricePvp: number | null;
  lastPurchaseQuantity: number;
  averageMonthlySales: number;
  estimatedDaysInventory: number;
  monthlySales: MonthlySale[];
  salesAverageMarginPercent?: number;
};

export type DashboardResponse = {
  branch: string | null;
  periodMonths: PeriodMonths;
  periodLabel: string;
  search: string;
  category: string;
  brand: string;
  dateStart: string | null;
  dateEnd: string | null;
  branches: Branch[];
  availableCategories: string[];
  availableBrands: string[];
  availableLines: string[];
  availableTypes: string[];
  availableWarehouses: string[];
  availableProducts: { code: string; description: string }[];
  kpis: {
    totalProducts: number;
    totalUnitsSold: number;
    totalStock: number;
    totalProfit: number;
    highRotation: number;
    noSales: number;
    overstock: number;
    averageMargin: number;
  };
  monthlySeries: { month: string; quantity: number }[];
  donutSeries: { name: string; value: number }[];
  barSeries: { name: string; ventas: number }[];
  rows: ProductRow[];
  lowStockHighRotationRows: ProductRow[];
  topRotationRows: ProductRow[];
  noSalesRows: ProductRow[];
  overstockRows: ProductRow[];
};

export type ProductOverviewRow = ProductRow & {
  valueSold: number;
  averageDailySales: number;
  coverageDays: number;
  daysSinceLastSale: number;
  abcClass: 'A' | 'B' | 'C';
  xyzClass: 'X' | 'Y' | 'Z';
  pareto: boolean;
  trend: 'Creciente' | 'Estable' | 'Decreciente';
  trendPercent: number;
  smartScore: number;
  immobilizedCapital: number;
};

export type ProductOverviewResponse = {
  branch: string;
  periodMonths: PeriodMonths;
  title: string;
  dateStart: string;
  dateEnd: string;
  periodLabel: string;
  generatedAt: string;
  cacheKey: string;
  kpis: {
    totalProductsSold: number;
    totalUnitsSold: number;
    totalRevenue: number;
    totalProfit: number;
    averageMargin: number;
    activeProducts: number;
    noMovementProducts: number;
    highRotationProducts: number;
    criticalStockProducts: number;
  };
  weeklyUnitsSeries: { week: string; quantity: number; weekStart?: string; monthLabel?: string }[];
  weeklyRevenueSeries: { week: string; revenue: number; weekStart?: string; monthLabel?: string }[];
  availableLines: string[];
  availableCategories: string[];
  availableTypes: string[];
  availableBrands: string[];
  availableWarehouses: string[];
  rows: ProductOverviewRow[];
};
