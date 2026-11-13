import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from 'recharts';
import { fetchDataDashboard } from './api';
import type { Branch, DataDashboardResponse, DataDashboardRow } from './types';
import { money, percent, twoDecimals } from './utils';

const rangeOptions = [
  { key: '12m', label: '1 año', short: '12 meses' },
  { key: '6m', label: '6 meses', short: '6 meses' },
  { key: '3m', label: '3 meses', short: '3 meses' },
  { key: '1m', label: '1 mes', short: '30 días' },
  { key: '1w', label: '1 semana', short: '7 días' }
] as const;

type RangeKey = (typeof rangeOptions)[number]['key'];
type DimKey = 'product' | 'line' | 'category' | 'brand' | 'type';

const dimensionOptions: Array<{ key: DimKey; label: string }> = [
  { key: 'product', label: 'Producto' },
  { key: 'line', label: 'Línea' },
  { key: 'category', label: 'Categoría' },
  { key: 'brand', label: 'Marca' },
  { key: 'type', label: 'Tipo' }
];

const palette = ['#1d4ed8', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#0369a1', '#4d7c0f', '#9f1239', '#475569', '#0e7490'];
const tooltipStyle = {
  background: '#0b1f3a',
  border: '1px solid rgba(37,99,235,0.35)',
  borderRadius: 14,
  color: '#fff',
  fontSize: 12,
  boxShadow: '0 18px 40px rgba(15,23,42,0.25)'
} as const;

const monthsForRange = (range: RangeKey) => range === '12m' ? 12 : range === '6m' ? 6 : range === '3m' ? 3 : 1;
const daysForRange = (range: RangeKey) => range === '12m' ? 365 : range === '6m' ? 183 : range === '3m' ? 91 : range === '1m' ? 30 : 7;
const rangeUsesDaily = (range: RangeKey) => range === '1m' || range === '1w';
const isBlank = (value: string | undefined | null) => !value || !value.trim() || /^SIN\s/i.test(value.trim());
const normalizeSearch = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const truncate = (value: string, length = 28) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

const recommendedBreakdown = (dim: DimKey): DimKey => {
  const order: DimKey[] = ['line', 'category', 'brand', 'type', 'product'];
  const index = order.indexOf(dim === 'product' ? 'line' : dim);
  return order[(index + 1) % order.length];
};

const valueForDim = (row: { code: string; label: string; line: string; category: string; brand: string; type: string }, dim: DimKey) => {
  if (dim === 'product') return row.code;
  if (dim === 'line') return row.line;
  if (dim === 'category') return row.category;
  if (dim === 'brand') return row.brand;
  return row.type;
};

type AxisPoint = { key: string; label: string; weekStart: string; monthLabel: string };

type RowMetrics = {
  row: DataDashboardRow;
  code: string;
  label: string;
  line: string;
  category: string;
  brand: string;
  type: string;
  stock: number;
  stockWarehouses: number;
  warehouseStocks: Record<string, number>;
  units: number;
  revenue: number;
  profit: number;
  rotation: number;
  margin: number;
  unitsByBucket: number[];
  revenueByBucket: number[];
  profitByBucket: number[];
};

type GroupMetrics = {
  key: string;
  label: string;
  units: number;
  stock: number;
  revenue: number;
  rotation: number;
  margin: number;
  count: number;
};

const buildAxis = (data: DataDashboardResponse | null, range: RangeKey): AxisPoint[] => {
  if (!data) return [];
  const seen = new Set<string>();
  const points: AxisPoint[] = [];
  for (const item of data.weeklyUnitsSeries) {
    const key = item.weekStart ?? item.week;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ key, label: item.week, weekStart: item.weekStart ?? '', monthLabel: item.monthLabel ?? '' });
  }
  if (rangeUsesDaily(range)) return points;
  const months = monthsForRange(range);
  const dated = points.filter((point) => point.weekStart);
  if (dated.length === 0) return points;
  const latest = dated.reduce((max, point) => point.weekStart > max ? point.weekStart : max, dated[0].weekStart);
  const cutoffDate = new Date(`${latest}T12:00:00`);
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoff = formatDate(cutoffDate);
  return points.filter((point) => !point.weekStart || point.weekStart >= cutoff);
};

const enrichRows = (data: DataDashboardResponse | null, axis: AxisPoint[]): RowMetrics[] => {
  if (!data) return [];
  const indexByKey = new Map(axis.map((point, index) => [point.key, index]));
  const seen = new Set<string>();
  const rows: RowMetrics[] = [];
  for (const row of data.rows) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    const unitsByBucket = new Array(axis.length).fill(0) as number[];
    const revenueByBucket = new Array(axis.length).fill(0) as number[];
    const profitByBucket = new Array(axis.length).fill(0) as number[];
    for (const sale of row.monthlySales) {
      const index = indexByKey.get(sale.weekStart ?? sale.month);
      if (index === undefined) continue;
      unitsByBucket[index] += Number(sale.quantity) || 0;
      revenueByBucket[index] += Number(sale.revenue) || 0;
      profitByBucket[index] += Number(sale.profit) || 0;
    }
    const warehouseStocks = row.warehouseStocks ?? {};
    const stockWarehouses = Object.values(warehouseStocks).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const globalStock = Math.max(0, Number(row.stockTotal) || 0);
    const stock = stockWarehouses > 0 ? stockWarehouses : globalStock;
    const units = unitsByBucket.reduce((sum, value) => sum + value, 0);
    const revenue = revenueByBucket.reduce((sum, value) => sum + value, 0);
    const profit = profitByBucket.reduce((sum, value) => sum + value, 0);
    const rotation = stock > 0 ? units / stock : 0;
    const periodMargin = revenue > 0 ? (profit / revenue) * 100 : Number(row.currentMarginPercent) || 0;
    const margin = Math.max(-100, Math.min(200, periodMargin));
    rows.push({
      row,
      code: row.code,
      label: row.description || row.code,
      line: isBlank(row.line) ? 'SIN LÍNEA' : row.line,
      category: isBlank(row.category) ? 'SIN CATEGORÍA' : row.category,
      brand: isBlank(row.brand) ? 'SIN MARCA' : row.brand,
      type: isBlank(row.type) ? 'SIN TIPO' : row.type,
      stock,
      stockWarehouses,
      warehouseStocks,
      units,
      revenue,
      profit,
      rotation,
      margin,
      unitsByBucket,
      revenueByBucket,
      profitByBucket
    });
  }
  return rows;
};

const groupRows = (rows: RowMetrics[], dim: DimKey): GroupMetrics[] => {
  const groups = new Map<string, GroupMetrics>();
  for (const row of rows) {
    const key = valueForDim(row, dim);
    const current = groups.get(key) ?? { key, label: dim === 'product' ? row.label : key, units: 0, stock: 0, revenue: 0, rotation: 0, margin: 0, count: 0 };
    current.units += row.units;
    current.stock += row.stock;
    current.revenue += row.revenue;
    current.margin += row.margin * Math.max(row.units, 1);
    current.count += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    rotation: group.stock > 0 ? group.units / group.stock : 0,
    margin: group.units > 0 ? group.margin / group.units : 0
  }));
};

function BiCard({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bi-card p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function BiKpi({ label, value, sub, accent = '#1d4ed8' }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bi-kpi p-3.5" style={{ ['--bi-accent' as string]: accent }}>
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1.5 text-2xl font-black leading-none text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-[11px] font-semibold text-slate-500">{sub}</div>}
    </div>
  );
}

function DetailTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black ${accent ? 'text-blue-800' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{sub}</div>}
    </div>
  );
}

export default function DataDashboard({ branches, initialBranch, onClose }: { branches: Branch[]; initialBranch: string | null; onClose: () => void }) {
  const [branch, setBranch] = useState(initialBranch ?? 'ALMACEN PAS');
  const [range, setRange] = useState<RangeKey>('3m');
  const [dim, setDim] = useState<DimKey>('product');
  const [selectedValue, setSelectedValue] = useState('TODOS');
  const [productQuery, setProductQuery] = useState('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [breakdownDim, setBreakdownDim] = useState<DimKey>('line');
  const [yearData, setYearData] = useState<DataDashboardResponse | null>(null);
  const [dayData, setDayData] = useState<Partial<Record<'1m' | '1w', DataDashboardResponse>>>({});
  const [yearLoading, setYearLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setYearLoading(true);
    setError(null);
    fetchDataDashboard({ branch, bucket: 'week', months: 12, refresh: refreshTick > 0 })
      .then((result) => {
        if (!active) return;
        setYearData(result);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
        setYearData(null);
      })
      .finally(() => {
        if (active) setYearLoading(false);
      });
    return () => { active = false; };
  }, [branch, refreshTick]);

  useEffect(() => {
    setDayData({});
    setSelectedValue('TODOS');
    setDim('product');
    setBreakdownDim('line');
    setProductQuery('');
    setProductSearchOpen(false);
  }, [branch]);

  useEffect(() => {
    setDayData({});
  }, [refreshTick]);

  useEffect(() => {
    if (!rangeUsesDaily(range)) return;
    const days = range === '1w' ? 7 : 30;
    let active = true;
    setDayLoading(true);
    setError(null);
    fetchDataDashboard({ branch, bucket: 'day', days, refresh: refreshTick > 0 })
      .then((result) => {
        if (active) setDayData((current) => ({ ...current, [range]: result }));
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setDayLoading(false);
      });
    return () => { active = false; };
  }, [branch, range, refreshTick]);

  const activeData = rangeUsesDaily(range) ? dayData[range] ?? null : yearData;
  const loading = rangeUsesDaily(range) ? dayLoading && !dayData[range] : yearLoading;

  const axis = useMemo(() => buildAxis(activeData, range), [activeData, range]);
  const rows = useMemo(() => enrichRows(activeData, axis), [activeData, axis]);
  const productMatches = useMemo(() => {
    const term = normalizeSearch(productQuery);
    const source = [...rows]
      .filter((row) => !term || normalizeSearch(`${row.code} ${row.label}`).includes(term))
      .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label, 'es'));
    return { items: source.slice(0, 12), total: source.length };
  }, [rows, productQuery]);
  const periodDays = daysForRange(range);

  const selectedOptions = useMemo(() => {
    if (dim === 'product') {
      return [...rows]
        .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label, 'es'))
        .map((row) => ({ key: row.code, label: `${row.code} · ${row.label}` }));
    }
    return groupRows(rows, dim)
      .sort((a, b) => b.rotation - a.rotation || a.label.localeCompare(b.label, 'es'))
      .map((group) => ({ key: group.key, label: group.label }));
  }, [rows, dim]);

  const scoped = useMemo(() => rows.filter((row) => selectedValue === 'TODOS' || valueForDim(row, dim) === selectedValue), [rows, dim, selectedValue]);
  const selectedProduct = dim === 'product' && selectedValue !== 'TODOS' ? scoped[0] ?? null : null;

  useEffect(() => {
    if (selectedValue === 'TODOS') return;
    if (!selectedOptions.some((option) => option.key === selectedValue)) setSelectedValue('TODOS');
  }, [selectedOptions, selectedValue]);

  const totals = useMemo(() => {
    const units = scoped.reduce((sum, row) => sum + row.units, 0);
    const revenue = scoped.reduce((sum, row) => sum + row.revenue, 0);
    const profit = scoped.reduce((sum, row) => sum + row.profit, 0);
    const stock = scoped.reduce((sum, row) => sum + row.stock, 0);
    const weightedMargin = scoped.reduce((sum, row) => sum + row.margin * Math.max(row.units, 1), 0);
    const weight = scoped.reduce((sum, row) => sum + Math.max(row.units, 1), 0);
    const rotation = stock > 0 ? units / stock : 0;
    const coverageDays = units > 0 ? stock / (units / periodDays) : 999;
    return {
      units,
      revenue,
      profit,
      stock,
      margin: revenue > 0 ? (profit / revenue) * 100 : (weight > 0 ? weightedMargin / weight : 0),
      rotation,
      coverageDays,
      products: scoped.length
    };
  }, [scoped, periodDays]);

  const timeline = useMemo(() => {
    let cumulativeUnits = 0;
    return axis.map((point, index) => {
      const units = scoped.reduce((sum, row) => sum + (row.unitsByBucket[index] ?? 0), 0);
      const revenue = scoped.reduce((sum, row) => sum + (row.revenueByBucket[index] ?? 0), 0);
      cumulativeUnits += units;
      return {
        ...point,
        units,
        revenue,
        rotation: totals.stock > 0 ? cumulativeUnits / totals.stock : 0
      };
    });
  }, [axis, scoped, totals.stock]);

  const warehouseDonut = useMemo(() => {
    if (!selectedProduct) return [];
    const entries = Object.entries(selectedProduct.warehouseStocks)
      .map(([name, value]) => ({ key: name, name, value: Number(value) || 0 }))
      .filter((item) => item.value !== 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0 && selectedProduct.row.stockTotal > 0) {
      return [{ key: 'INVENTARIO GLOBAL', name: 'Inventario global', value: selectedProduct.row.stockTotal }];
    }
    return entries;
  }, [selectedProduct]);

  const breakdownDonut = useMemo(() => {
    if (selectedProduct) return warehouseDonut;
    const groups = groupRows(scoped, breakdownDim).sort((a, b) => b.units - a.units);
    const top = groups.slice(0, 8).map((group) => ({ key: group.key, name: group.label, value: group.units }));
    const rest = groups.slice(8).reduce((sum, group) => sum + group.units, 0);
    if (rest > 0) top.push({ key: 'OTROS', name: 'Otros', value: rest });
    return top;
  }, [scoped, breakdownDim, selectedProduct, warehouseDonut]);

  const breakdownTotal = breakdownDonut.reduce((sum, item) => sum + item.value, 0);

  const ranking = useMemo(() => {
    const groups = groupRows(rows, dim)
      .filter((group) => group.stock > 0 && group.units > 0)
      .sort((a, b) => b.rotation - a.rotation);
    const limit = dim === 'product' ? 12 : 15;
    return groups.slice(0, limit).map((group) => ({
      ...group,
      clippedLabel: truncate(group.label, dim === 'product' ? 26 : 22),
      displayRotation: Number(Math.min(group.rotation, 20).toFixed(2))
    }));
  }, [rows, dim]);

  const scatterData = useMemo(() => scoped
    .filter((row) => row.units > 0 || row.stock > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, 160)
    .map((row) => ({
      code: row.code,
      name: row.label,
      rotation: Number(Math.min(row.rotation, 20).toFixed(2)),
      margin: Number(row.margin.toFixed(2)),
      size: Math.max(row.units, 1),
      price: row.row.currentPriceWithIva
    })), [scoped]);

  const tableRows = useMemo(() => [...scoped].sort((a, b) => b.rotation - a.rotation || b.units - a.units).slice(0, 15), [scoped]);

  const scopeLabel = selectedValue === 'TODOS'
    ? `Toda la sucursal · ${branch}`
    : dim === 'product'
      ? selectedProduct?.label ?? selectedValue
      : `${dimensionOptions.find((option) => option.key === dim)?.label}: ${selectedValue}`;

  const rangeLabel = rangeOptions.find((option) => option.key === range)?.short ?? '';
  const rotationTarget = Math.max(1, Math.ceil(totals.rotation * 1.15));
  const gaugeData = [{ name: 'Rotación', value: Math.min(totals.rotation, rotationTarget), fill: '#1d4ed8' }];
  const maxChartRotation = Math.max(...ranking.map((item) => item.displayRotation), 1);

  const changeDimension = (next: DimKey) => {
    setDim(next);
    setSelectedValue('TODOS');
    setBreakdownDim(recommendedBreakdown(next));
    setProductQuery('');
    setProductSearchOpen(false);
  };

  const selectFromDimension = (next: DimKey, value: string) => {
    setDim(next);
    setSelectedValue(value);
    setBreakdownDim(recommendedBreakdown(next));
  };

  const selectProduct = (code: string) => {
    selectFromDimension('product', code);
    setProductQuery('');
    setProductSearchOpen(false);
  };

  const handleSlice = (entry: { key: string; name: string }) => {
    if (selectedProduct) return;
    const nextDim = breakdownDim;
    setDim(nextDim);
    setSelectedValue(entry.key);
    setBreakdownDim(recommendedBreakdown(nextDim));
    setProductQuery('');
    setProductSearchOpen(false);
  };

  const handleScatter = (entry: { code?: string }) => {
    if (!entry?.code) return;
    setDim('product');
    setSelectedValue(entry.code);
    setBreakdownDim('line');
    setProductQuery('');
    setProductSearchOpen(false);
  };

  return (
    <div className="space-y-4">
      <section className="bi-hero overflow-hidden p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.3em] text-blue-200">Dashboard de Datos</div>
            <h1 className="mt-1 text-2xl font-black uppercase tracking-tight lg:text-3xl">Rotación e Inteligencia Comercial</h1>
            <p className="bi-muted mt-1 text-sm font-semibold">Gráficas enlazadas por producto, línea, categoría, marca y tipo · {rangeLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className="bi-select min-w-[180px]">
              {branches.length === 0 && <option value={branch}>{branch}</option>}
              {branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            <button onClick={() => setRefreshTick((tick) => tick + 1)} className="bi-btn-primary">Actualizar</button>
            <button onClick={onClose} className="bi-btn-ghost">Volver</button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}

      <section className="bi-card p-4">
        <div className="grid gap-3 xl:grid-cols-[1.1fr_1.4fr_1.6fr]">
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Ver rotación por</span>
            <select value={dim} onChange={(event) => changeDimension(event.target.value as DimKey)} className="bi-select mt-1 w-full">
              {dimensionOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          {dim === 'product' ? (
            <div className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Buscar producto por código o nombre</span>
              <div
                className="relative mt-1"
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (!(next instanceof Node) || !event.currentTarget.contains(next)) setProductSearchOpen(false);
                }}
              >
                <input
                  type="text"
                  value={productQuery}
                  onChange={(event) => {
                    setProductQuery(event.target.value);
                    setProductSearchOpen(true);
                  }}
                  onFocus={() => setProductSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && productQuery.trim() && productMatches.items[0]) {
                      event.preventDefault();
                      selectProduct(productMatches.items[0].code);
                    }
                    if (event.key === 'Escape') setProductSearchOpen(false);
                  }}
                  placeholder={selectedProduct ? `${selectedProduct.code} · ${selectedProduct.label}` : 'Ej. 00000429 o CAMA ECO...'}
                  className="bi-input w-full"
                  aria-label="Buscar producto por código o nombre"
                  role="combobox"
                  aria-expanded={productSearchOpen}
                  aria-controls="product-search-results"
                  autoComplete="off"
                />
                {productQuery && (
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onClick={() => {
                      setProductQuery('');
                      setProductSearchOpen(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-sm font-black text-slate-400 transition hover:text-slate-700"
                  >
                    ×
                  </button>
                )}
                {productSearchOpen && (
                  <div
                    id="product-search-results"
                    role="listbox"
                    className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedValue === 'TODOS'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSelectedValue('TODOS');
                        setProductQuery('');
                        setProductSearchOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] font-black uppercase tracking-wide transition hover:bg-blue-50 ${selectedValue === 'TODOS' ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}
                    >
                      Todos los productos
                      <span className="text-[10px] font-bold normal-case tracking-normal text-slate-400">{rows.length.toLocaleString('es-EC')}</span>
                    </button>
                    {productMatches.items.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs font-bold text-slate-500">Sin coincidencias para “{productQuery}”.</div>
                    ) : productMatches.items.map((match) => (
                      <button
                        key={match.code}
                        type="button"
                        role="option"
                        aria-selected={match.code === selectedValue}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectProduct(match.code)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-blue-50 ${match.code === selectedValue ? 'bg-blue-50' : ''}`}
                      >
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-black text-slate-700">{match.code}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{match.label}</span>
                        <span className="shrink-0 text-[10px] font-black text-blue-700">{match.units.toLocaleString('es-EC')} u.</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                <span>{productQuery.trim() ? `${productMatches.total.toLocaleString('es-EC')} coincidencia${productMatches.total === 1 ? '' : 's'}${productMatches.total > productMatches.items.length ? ` · top ${productMatches.items.length}` : ''}` : 'Sugerencias por unidades vendidas'}</span>
                {selectedProduct && <span className="truncate font-black text-blue-700">{selectedProduct.code}</span>}
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Seleccionar {dimensionOptions.find((option) => option.key === dim)?.label.toLowerCase()}</span>
              <select value={selectedValue} onChange={(event) => setSelectedValue(event.target.value)} className="bi-select mt-1 w-full">
                <option value="TODOS">TODOS</option>
                {selectedOptions.map((option) => <option key={option.key} value={option.key}>{truncate(option.label, 70)}</option>)}
              </select>
            </label>
          )}
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Línea de tiempo</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {rangeOptions.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setRange(option.key)}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${range === option.key ? 'bi-range-active' : 'bi-range'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600">Alcance: {scopeLabel}</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700">Periodo: {rangeLabel}</span>
          {selectedValue !== 'TODOS' && (
            <button onClick={() => setSelectedValue('TODOS')} className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-black text-slate-600 hover:border-blue-500 hover:text-blue-700">
              Quitar filtro
            </button>
          )}
          {loading && <span className="text-[11px] font-bold text-blue-700">Procesando datos...</span>}
          <span className="ml-auto text-[11px] font-semibold text-slate-400">{totals.products.toLocaleString('es-EC')} productos analizados</span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <BiKpi label="Unidades vendidas" value={twoDecimals(totals.units)} sub={rangeLabel} accent="#1d4ed8" />
        <BiKpi label="Dinero vendido" value={money(totals.revenue)} sub="con IVA" accent="#0f766e" />
        <BiKpi label="Utilidad" value={money(totals.profit)} sub="margen del periodo" accent="#4d7c0f" />
        <BiKpi label="Margen del periodo" value={percent(totals.margin)} sub="utilidad / ventas" accent="#b45309" />
        <BiKpi label="Rotación" value={totals.rotation.toFixed(2)} sub="unidades / stock" accent="#7c3aed" />
        <BiKpi label="Stock total bodegas" value={totals.stock.toLocaleString('es-EC')} sub={totals.coverageDays >= 999 ? 'sin cobertura estimada' : `cobertura ~${totals.coverageDays.toFixed(0)} días`} accent="#be123c" />
      </section>

      {selectedProduct && (
        <BiCard title="Ficha del producto seleccionado" subtitle={`${selectedProduct.code} · ${selectedProduct.label}`}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <DetailTile
              label={selectedProduct.stockWarehouses > 0 ? 'Stock total (suma de bodegas)' : 'Stock total (inventario global)'}
              value={(selectedProduct.stockWarehouses > 0 ? selectedProduct.stockWarehouses : selectedProduct.stock).toLocaleString('es-EC')}
              sub={selectedProduct.stockWarehouses > 0 ? `${Object.keys(selectedProduct.warehouseStocks).length} bodegas` : 'sin detalle de bodegas'}
              accent
            />
            <DetailTile label="Cantidad comprada la última vez" value={selectedProduct.row.lastPurchaseQuantity ? selectedProduct.row.lastPurchaseQuantity.toLocaleString('es-EC') : 'NO CONSTA'} sub={selectedProduct.row.lastPurchase || 'sin fecha'} />
            <DetailTile label="Precio compra última vez + IVA" value={selectedProduct.row.missingFields?.includes('costWithIva') ? 'NO CONSTA' : money(selectedProduct.row.costWithIva)} sub={`Proveedor: ${selectedProduct.row.provider || 'NO CONSTA'}`} />
            <DetailTile label="Precio de venta actual" value={money(selectedProduct.row.currentPriceWithIva)} sub={`Base sin IVA: ${money(selectedProduct.row.pricePuntoPas || selectedProduct.row.publicCost)}`} />
            <DetailTile label="Margen actual de ganancia" value={percent(selectedProduct.row.currentMarginPercent)} sub="sobre costo + IVA" accent />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(selectedProduct.warehouseStocks).sort((a, b) => b[1] - a[1]).map(([warehouse, stock]) => (
              <span key={warehouse} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
                {warehouse}: <span className="text-blue-700">{stock}</span>
              </span>
            ))}
            {Object.keys(selectedProduct.warehouseStocks).length === 0 && selectedProduct.row.stockTotal > 0 && (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
                Inventario global: <span className="text-blue-700">{selectedProduct.row.stockTotal}</span>
              </span>
            )}
            {Object.keys(selectedProduct.warehouseStocks).length === 0 && selectedProduct.row.stockTotal <= 0 && <span className="text-xs font-bold text-slate-500">Sin detalle de bodegas disponible.</span>}
          </div>
          <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2">Línea: <span className="font-black text-slate-900">{selectedProduct.line}</span></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">Categoría: <span className="font-black text-slate-900">{selectedProduct.category}</span></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">Marca: <span className="font-black text-slate-900">{selectedProduct.brand}</span></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">Tipo: <span className="font-black text-slate-900">{selectedProduct.type}</span></div>
          </div>
        </BiCard>
      )}

      <BiCard
        title="Evolución de la rotación"
        subtitle={`Línea de tiempo · ${rangeLabel} · ${scopeLabel}`}
        action={<span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700">Rotación acumulada {totals.rotation.toFixed(2)}</span>}
      >
        <div className="h-[330px] w-full">
          {timeline.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin datos para el periodo seleccionado.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeline} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="biRotationFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={26} interval="preserveStartEnd" />
                <YAxis yAxisId="rotation" tick={{ fontSize: 10, fill: '#1d4ed8' }} width={46} />
                <YAxis yAxisId="units" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} width={46} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => name === 'Rotación acumulada' ? Number(value).toFixed(2) : Number(value).toLocaleString('es-EC')}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                <Bar yAxisId="units" dataKey="units" name="Unidades del periodo" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Area yAxisId="rotation" type="monotone" dataKey="rotation" name="Rotación acumulada" stroke="#1d4ed8" strokeWidth={3} fill="url(#biRotationFill)" activeDot={{ r: 6, fill: '#be123c' }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </BiCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <BiCard
          title={selectedProduct ? 'Stock por bodega' : `Participación en ventas por ${dimensionOptions.find((option) => option.key === breakdownDim)?.label.toLowerCase()}`}
          subtitle={selectedProduct ? 'Suma de todas las bodegas del producto' : 'Clic en una porción para filtrar el dashboard'}
          action={!selectedProduct ? (
            <select value={breakdownDim} onChange={(event) => setBreakdownDim(event.target.value as DimKey)} className="bi-select">
              {dimensionOptions.filter((option) => option.key !== dim).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          ) : undefined}
        >
          <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
            <div className="h-[220px] w-full">
              {breakdownDonut.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin datos de participación.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdownDonut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="56%"
                      outerRadius="84%"
                      paddingAngle={2}
                      cursor={selectedProduct ? 'default' : 'pointer'}
                      onClick={(entry: any) => entry && handleSlice(entry)}
                    >
                      {breakdownDonut.map((entry, index) => <Cell key={entry.key} fill={palette[index % palette.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => Number(value).toLocaleString('es-EC')} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
              {breakdownDonut.map((entry, index) => {
                const share = breakdownTotal > 0 ? (entry.value / breakdownTotal) * 100 : 0;
                return (
                  <button
                    key={entry.key}
                    onClick={() => !selectedProduct && handleSlice(entry)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition ${selectedProduct ? '' : 'hover:border-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: palette[index % palette.length] }} />
                      <span className="truncate text-[11px] font-bold text-slate-700">{entry.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-black text-slate-900">{share.toFixed(1)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        </BiCard>

        <BiCard
          title={`Rotación por ${dimensionOptions.find((option) => option.key === dim)?.label.toLowerCase()}`}
          subtitle="Clic en una barra para filtrar todo el dashboard"
        >
          <div className="h-[220px] w-full">
            {ranking.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin datos de rotación.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 18, left: 0, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" domain={[0, maxChartRotation]} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="clippedLabel" width={150} tick={{ fontSize: 10, fill: '#475569', fontWeight: 700 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, _name, item) => [`${Number(value).toFixed(2)} rotación · ${(item?.payload as GroupMetrics | undefined)?.units.toLocaleString('es-EC') ?? 0} unidades`, 'Valor']}
                  />
                  <Bar dataKey="displayRotation" radius={[0, 6, 6, 0]} cursor="pointer"
                    onClick={(entry: any) => entry && selectFromDimension(dim, entry.key)}>
                    {ranking.map((entry) => <Cell key={entry.key} fill={entry.key === selectedValue ? '#1d4ed8' : '#93a7c4'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </BiCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <BiCard title="Matriz rotación vs margen" subtitle="El tamaño de la burbuja representa las unidades vendidas · clic para ver el producto">
          <div className="h-[300px] w-full">
            {scatterData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">Sin datos para la matriz.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 18, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" dataKey="rotation" name="Rotación" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis type="number" dataKey="margin" name="Margen actual" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} width={48} />
                  <ZAxis type="number" dataKey="size" range={[45, 340]} />
                  <ReferenceLine x={1} stroke="#f59e0b" strokeDasharray="5 4" label={{ value: 'Rotación 1x', position: 'insideTopRight', fontSize: 10, fill: '#b45309' }} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="5 4" />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ strokeDasharray: '3 3' }}
                    formatter={(value, name, item) => {
                      const payload = item?.payload as { name?: string; price?: number } | undefined;
                      if (name === 'Margen actual') return [`${Number(value).toFixed(2)}% · ${money(payload?.price ?? 0)}`, payload?.name ?? 'Producto'];
                      return [Number(value).toFixed(2), 'Rotación'];
                    }}
                  />
                  <Scatter data={scatterData} onClick={(entry: any) => entry && handleScatter(entry)} cursor="pointer">
                    {scatterData.map((entry) => <Cell key={entry.code} fill={entry.code === selectedValue ? '#be123c' : '#0f766e'} fillOpacity={0.78} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        </BiCard>

        <BiCard title="Nivel de rotación del alcance" subtitle="Meta de referencia: 1.00 = vender el equivalente al stock">
          <div className="relative h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="72%" outerRadius="100%" data={gaugeData} startAngle={90} endAngle={-270}>
                <RadialBar background dataKey="value" cornerRadius={12} fill="#1d4ed8" />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-4xl font-black text-slate-900">{totals.rotation.toFixed(2)}</div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Rotación</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 px-2 py-2">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Unidades</div>
              <div className="text-sm font-black text-slate-900">{Math.round(totals.units).toLocaleString('es-EC')}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-2">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Stock total</div>
              <div className="text-sm font-black text-slate-900">{Math.round(totals.stock).toLocaleString('es-EC')}</div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] font-semibold text-slate-500">
            {totals.rotation >= 1 ? 'Rotación saludable: se vendió al menos el stock disponible.' : 'Rotación baja: el stock supera lo vendido en el periodo.'}
          </p>
        </BiCard>
      </div>

      <BiCard title="Detalle del alcance" subtitle="Top 15 productos por rotación · clic en una fila para abrir la ficha">
        <div className="max-h-[420px] overflow-auto scrollbar-thin">
          <table className="bi-table w-full min-w-[900px] text-xs">
            <thead>
              <tr>
                {['Código', 'Producto', 'Línea', 'Categoría', 'Marca', 'Unidades', 'Stock total', 'Rotación', 'Margen del periodo', 'Precio venta actual'].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.code} onClick={() => { setDim('product'); setSelectedValue(row.code); setBreakdownDim('line'); }} className="cursor-pointer">
                  <td className="font-black text-blue-700">{row.code}</td>
                  <td className="max-w-[260px] truncate font-bold">{row.label}</td>
                  <td>{row.line}</td>
                  <td>{row.category}</td>
                  <td>{row.brand}</td>
                  <td className="text-right font-black">{row.units.toLocaleString('es-EC')}</td>
                  <td className="text-right font-black">{row.stock.toLocaleString('es-EC')}</td>
                  <td className="text-right font-black text-blue-700" title={row.rotation.toFixed(2)}>{Math.min(row.rotation, 99.99).toFixed(2)}</td>
                  <td className="text-right font-black">{percent(row.margin)}</td>
                  <td className="text-right">{money(row.row.currentPriceWithIva)}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center font-bold text-slate-400">Sin productos para el periodo seleccionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </BiCard>
    </div>
  );
}
