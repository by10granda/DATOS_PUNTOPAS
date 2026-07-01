export type PeriodMonths = 1 | 2 | 3;

export type Branch = { name: string };

export type MonthlySale = { month: string; quantity: number };

export type ProductRow = {
  id: string;
  code: string;
  description: string;
  stock: number;
  salesXMonths: number;
  unitProfit: number;
  totalProfit: number;
  lastPurchase: string;
  saleDate: string;
  costProvider: number;
  costWithIva: number;
  publicCost: number;
  salePrice: number;
  advancesTotal: number;
  publicCostWithIva: number;
  marginPercent: number;
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
  availableProducts: { code: string; description: string }[];
  kpis: {
    totalProducts: number;
    totalUnitsSold: number;
    totalStock: number;
    totalProfit: number;
    totalAdvances: number;
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
