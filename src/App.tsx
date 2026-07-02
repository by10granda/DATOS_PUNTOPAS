import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, PieChart, Pie, Line, LineChart, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { fetchBranches, fetchDashboard, fetchProductOverview } from './api';
import type { Branch, DashboardResponse, ProductOverviewResponse, ProductOverviewRow, ProductRow, PeriodMonths } from './types';
import { exportExcel, exportOverviewExcel, exportOverviewPdf, exportPdf, money, percent } from './utils';

const periodOptions: PeriodMonths[] = [1, 2, 3];
const badgeColor = (signal: ProductRow['inventorySignal']) =>
  signal === 'Normal' ? 'bg-emerald-100 text-emerald-800' : signal === 'Atención' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800';

const chartColors = ['#ff0000', '#102d84', '#25ff00', '#7c3aed'];
const overviewAnalysisLabels = {
  all: 'Todos',
  lowStock: 'Alta Rotación y Stock Bajo',
  overstock: 'Sobrestock y Pocas Ventas',
  noSales: 'Productos Sin Ventas',
  highRotation: 'Alta Rotación',
} as const;

type SearchSuggestion = {
  kind: 'Producto' | 'Código' | 'Marca' | 'Línea' | 'Categoría' | 'Tipo';
  label: string;
  value: string;
  score: number;
};

const cloudinaryProductImage = (code: string) => `https://res.cloudinary.com/dy5t5q3dl/image/upload/v1782406564/${code}_E.png`;

const normalizeSearch = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const scoreMatch = (query: string, value: string) => {
  const q = normalizeSearch(query.trim());
  const v = normalizeSearch(value);
  if (!q) return 0;
  if (v === q) return 100;
  if (v.startsWith(q)) return 90;
  if (v.includes(q)) return 70;
  const parts = q.split(/\s+/).filter(Boolean);
  const matches = parts.filter((part) => v.includes(part)).length;
  return matches ? 40 + matches * 8 : 0;
};

const dateInput = (date: Date) => date.toISOString().slice(0, 10);

const subtractMonths = (months: number) => {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return dateInput(date);
};

const exceedsThreeMonths = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const limit = new Date(startDate);
  limit.setMonth(limit.getMonth() + 3);
  return endDate >= limit;
};

function App() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>('ALMACEN PAS');
  const [periodMonths, setPeriodMonths] = useState<PeriodMonths>(3);
  const [selectedCategory, setSelectedCategory] = useState('TODOS');
  const [selectedBrand, setSelectedBrand] = useState('TODAS');
  const [selectedLine, setSelectedLine] = useState('TODAS');
  const [selectedType, setSelectedType] = useState('TODOS');
  const [selectedProductCode, setSelectedProductCode] = useState('TODOS');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [queryMode, setQueryMode] = useState<'preset' | 'manual'>('preset');
  const [manualStart, setManualStart] = useState(subtractMonths(1));
  const [manualEnd, setManualEnd] = useState(dateInput(new Date()));
  const [appliedManualRange, setAppliedManualRange] = useState<{ start: string; end: string } | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [dark] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const [drawer, setDrawer] = useState<{ row: ProductRow; periodMonths: PeriodMonths } | null>(null);
  const [dailyDetailOpen, setDailyDetailOpen] = useState(false);
  const [sortKey, setSortKey] = useState<keyof ProductRow>('salesXMonths');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [overviewPeriod, setOverviewPeriod] = useState<PeriodMonths>(3);
  const [overviewData, setOverviewData] = useState<ProductOverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    fetchBranches().then(setBranches).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    fetchProductOverview(overviewPeriod)
      .then((result) => {
        if (!active) return;
        setOverviewData(result);
        setOverviewError(null);
      })
      .catch((err: Error) => {
        if (active) setOverviewError(err.message);
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });
    return () => { active = false; };
  }, [overviewPeriod]);

  useEffect(() => {
    let active = true;

    const loadDashboard = () => {
      if (!hasLoadedRef.current) setLoading(true);
      fetchDashboard({
        branch: selectedBranch,
        periodMonths,
        search,
        category: selectedCategory,
        brand: selectedBrand,
        line: selectedLine,
        type: selectedType,
        productCode: selectedProductCode,
        dateStart: queryMode === 'manual' ? appliedManualRange?.start ?? null : null,
        dateEnd: queryMode === 'manual' ? appliedManualRange?.end ?? null : null,
      })
        .then((result) => {
          if (!active) return;
          setData(result);
          setError(null);
          setLastUpdated(new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          hasLoadedRef.current = true;
        })
        .catch((err: Error) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    loadDashboard();
    const interval = window.setInterval(loadDashboard, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedBranch, periodMonths, search, selectedCategory, selectedBrand, selectedLine, selectedType, selectedProductCode, queryMode, appliedManualRange]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedBranch, periodMonths, selectedCategory, selectedBrand, selectedLine, selectedType, selectedProductCode, queryMode, appliedManualRange]);

  const applyManualRange = () => {
    if (!manualStart || !manualEnd) {
      setManualError('Seleccione fecha inicial y fecha final.');
      return;
    }
    if (new Date(manualEnd) < new Date(manualStart)) {
      setManualError('La fecha final no puede ser menor que la fecha inicial.');
      return;
    }
    if (exceedsThreeMonths(manualStart, manualEnd)) {
      setManualError('La consulta manual no puede superar 3 meses.');
      return;
    }
    setManualError(null);
    setQueryMode('manual');
    setAppliedManualRange({ start: manualStart, end: manualEnd });
    setHistoricalOpen(false);
  };

  const resetToRealtime = () => {
    setManualError(null);
    setQueryMode('preset');
    setAppliedManualRange(null);
    setHistoricalOpen(false);
  };

  const clearSearchFilters = () => {
    setSearch('');
    setSelectedProductCode('TODOS');
    setSelectedBrand('TODAS');
    setSelectedLine('TODAS');
    setSelectedCategory('TODOS');
    setSelectedType('TODOS');
  };

  const displayedRows = [...(data?.rows ?? [])]
    .sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (typeof aValue === 'string' && typeof bValue === 'string') return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      const aNum = Number(aValue);
      const bNum = Number(bValue);
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    });

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / pageSize));
  const currentRows = displayedRows.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: keyof ProductRow) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('desc');
  };

  const categories = ['TODOS', ...(data?.availableCategories ?? [])];
  const brands = ['TODAS', ...(data?.availableBrands ?? [])];
  const lines = ['TODAS', ...(data?.availableLines ?? [])];
  const types = ['TODOS', ...(data?.availableTypes ?? [])];
  const products = [{ code: 'TODOS', description: 'TODOS LOS PRODUCTOS' }, ...(data?.availableProducts ?? [])];
  const selectedProduct = products.find((item) => item.code === selectedProductCode);
  const selectedContext = [
    selectedProductCode !== 'TODOS' ? `Producto: ${selectedProduct?.description ?? selectedProductCode}` : null,
    selectedBrand !== 'TODAS' ? `Marca: ${selectedBrand}` : null,
    selectedLine !== 'TODAS' ? `Línea: ${selectedLine}` : null,
    selectedCategory !== 'TODOS' ? `Categoría: ${selectedCategory}` : null,
    selectedType !== 'TODOS' ? `Tipo: ${selectedType}` : null,
    search ? `Búsqueda: ${search}` : null,
  ].filter(Boolean).join(' | ');
  const activePeriodLabel = queryMode === 'manual' && appliedManualRange ? `${appliedManualRange.start} a ${appliedManualRange.end}` : 'Día actual';
  const dataScopeTitle = selectedContext || 'Vista general de ALMACEN PAS';
  const participationPeriodTitle = queryMode === 'manual' && appliedManualRange ? `Participación del ${appliedManualRange.start} al ${appliedManualRange.end}` : 'Participación diaria';
  const titleWithScope = (title: string) => `${title} - ${dataScopeTitle} - ${activePeriodLabel}`;
  const suggestions: SearchSuggestion[] = search.trim().length >= 2 ? [
    ...products.flatMap((item) => item.code === 'TODOS' ? [] : [
      { kind: 'Producto' as const, label: item.description, value: item.code, score: Math.max(scoreMatch(search, item.description), scoreMatch(search, item.code)) },
      { kind: 'Código' as const, label: item.code, value: item.code, score: scoreMatch(search, item.code) }
    ]),
    ...brands.filter((item) => item !== 'TODAS').map((item) => ({ kind: 'Marca' as const, label: item, value: item, score: scoreMatch(search, item) })),
    ...lines.filter((item) => item !== 'TODAS').map((item) => ({ kind: 'Línea' as const, label: item, value: item, score: scoreMatch(search, item) })),
    ...categories.filter((item) => item !== 'TODOS').map((item) => ({ kind: 'Categoría' as const, label: item, value: item, score: scoreMatch(search, item) })),
    ...types.filter((item) => item !== 'TODOS').map((item) => ({ kind: 'Tipo' as const, label: item, value: item, score: scoreMatch(search, item) })),
  ].filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 10) : [];

  const applySuggestion = (suggestion: SearchSuggestion) => {
    if (suggestion.kind === 'Producto' || suggestion.kind === 'Código') setSelectedProductCode(suggestion.value);
    if (suggestion.kind === 'Marca') setSelectedBrand(suggestion.value);
    if (suggestion.kind === 'Línea') setSelectedLine(suggestion.value);
    if (suggestion.kind === 'Categoría') setSelectedCategory(suggestion.value);
    if (suggestion.kind === 'Tipo') setSelectedType(suggestion.value);
    setSearch(suggestion.label);
    setSearchFocused(false);
  };

  return (
    <div className="premium-shell min-h-screen text-slate-900 dark:text-slate-100">
      <div className="executive-header relative overflow-hidden border-b-4 border-corporateGreen text-white shadow-2xl">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute left-1/3 top-0 h-px w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        <div className="relative mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-7 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.25em] text-white/85">Business Intelligence</div>
            <h1 className="text-2xl font-black uppercase tracking-wide drop-shadow-sm lg:text-4xl">DISTRIBUIDOR PUNTO PAS ANALISIS DE DATOS</h1>
            <p className="mt-1 text-sm font-semibold uppercase tracking-[0.2em] text-white/85">POR: ING. BYRON GRANDA</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-corporateGreen/40 bg-white/10 px-5 py-2.5 text-sm font-black text-white shadow-lg">
              Auto actualización: 30s{lastUpdated ? ` | ${lastUpdated}` : ''}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1760px] space-y-4 px-4 py-5">
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
        {overviewError && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{overviewError}</div>}

        {overviewExpanded && overviewData ? (
          <ProductOverviewExpanded data={overviewData} onClose={() => setOverviewExpanded(false)} />
        ) : dailyDetailOpen && data ? (
          <DailyDetailPage data={data} scopeTitle={dataScopeTitle} periodLabel={activePeriodLabel} onClose={() => setDailyDetailOpen(false)} />
        ) : (
          <>
        <ProductOverviewModule
          data={overviewData}
          loading={overviewLoading}
          period={overviewPeriod}
          onPeriodChange={setOverviewPeriod}
          onExpand={() => setOverviewExpanded(true)}
          onRefresh={() => {
            setOverviewLoading(true);
            fetchProductOverview(overviewPeriod, true)
              .then((result) => {
                setOverviewData(result);
                setOverviewError(null);
              })
              .catch((err: Error) => setOverviewError(err.message))
              .finally(() => setOverviewLoading(false));
          }}
        />

        <section className="premium-card rounded-[1.6rem] p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="section-title text-lg font-black uppercase text-corporateBlue dark:text-corporateGreen">Paso 1. Selección de Sucursal</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Elija una sucursal para activar el resto de filtros.</p>
            </div>
            {selectedBranch && <div className="rounded-full border border-corporateGreen/40 bg-corporateBlue px-4 py-2 text-sm font-black text-white shadow-lg">Sucursal activa: {selectedBranch}</div>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {branches.length === 0 ? (
              <div className="text-sm text-slate-500">Cargando sucursales...</div>
            ) : branches.map((branch) => (
              <button
                key={branch.name}
                onClick={() => setSelectedBranch(branch.name)}
                className={`group relative overflow-hidden rounded-[1.4rem] border p-4 text-left transition duration-300 ${selectedBranch === branch.name ? 'border-corporateGreen bg-gradient-to-br from-corporateBlue to-slate-950 text-white shadow-2xl shadow-corporateBlue/25' : 'border-slate-200 bg-white/80 hover:-translate-y-1 hover:border-corporateBlue hover:shadow-xl dark:border-slate-700 dark:bg-slate-800/80'}`}
              >
                <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-full bg-corporateRed/10 transition group-hover:bg-corporateRed/20" />
                <div className="relative text-xs font-black uppercase tracking-[0.24em] opacity-70">Sucursal</div>
                <div className="mt-2 text-xl font-black">{branch.name}</div>
                <div className="relative mt-5 h-1.5 overflow-hidden rounded-full bg-slate-200/60 dark:bg-slate-700">
                  <div className={`h-full rounded-full ${selectedBranch === branch.name ? 'bg-corporateGreen' : 'bg-corporateBlue'}`} style={{ width: '68%' }} />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="premium-card rounded-[1.6rem] p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="section-title text-lg font-black uppercase text-corporateBlue dark:text-corporateGreen">Tiempo Real. Ventas del Día</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">El dashboard principal consulta únicamente el día actual para operación diaria.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-corporateGreen/50 bg-gradient-to-br from-slate-950 to-corporateBlue px-5 py-4 text-white shadow-xl">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Modo activo</div>
              <div className="mt-1 text-lg font-black">Ventas de hoy</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/75 px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Actualización</div>
              <div className="mt-1 text-lg font-black">Tiempo real</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/75 px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Detalle</div>
              <div className="mt-1 text-lg font-black">Por hora</div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[1.5rem] border border-slate-700 bg-slate-950/40 p-4">
            <button onClick={() => setHistoricalOpen(true)} className="rounded-xl bg-corporateBlue px-5 py-2.5 font-black text-white shadow-lg transition hover:-translate-y-0.5">
              Elegir histórica de datos
            </button>
            {queryMode === 'manual' && appliedManualRange ? (
              <button onClick={resetToRealtime} className="rounded-xl border border-corporateGreen/40 px-5 py-2.5 font-black text-corporateGreen transition hover:bg-corporateGreen/10">
                Volver a tiempo real
              </button>
            ) : null}
            <div className="text-sm font-bold text-slate-300">
              {queryMode === 'manual' && appliedManualRange ? `Histórico activo: ${appliedManualRange.start} a ${appliedManualRange.end}` : 'Modo actual: ventas del día en tiempo real'}
            </div>
          </div>
        </section>

        {selectedBranch && (
          <section className="premium-card rounded-[1.6rem] p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="section-title text-lg font-black uppercase text-corporateBlue dark:text-corporateGreen">Paso 3. Filtros de Categorías y Marcas</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Los filtros se combinan automáticamente.</p>
                  </div>
                </div>
                <div className="relative mb-3">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
                    placeholder="Buscar código, producto, marca, línea, categoría, tipo o proveedor"
                    className="w-full rounded-xl border border-slate-300 bg-white/75 px-3 py-2.5 text-sm outline-none ring-corporateBlue/20 transition focus:border-corporateBlue focus:ring-4 dark:border-slate-700 dark:bg-slate-950/40"
                  />
                  {searchFocused && suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
                      {suggestions.map((suggestion) => (
                        <button key={`${suggestion.kind}-${suggestion.value}-${suggestion.label}`} onClick={() => applySuggestion(suggestion)} className="flex w-full items-center justify-between gap-4 border-b border-white/5 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-white/10">
                          <span className="min-w-0 truncate font-bold text-white">{suggestion.label}</span>
                          <span className="rounded-full bg-corporateBlue px-3 py-1 text-xs font-black text-white">{suggestion.kind}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mb-4 flex justify-end">
                  <button onClick={clearSearchFilters} className="rounded-2xl border border-corporateGreen/40 px-5 py-2.5 text-sm font-black text-corporateGreen transition hover:bg-corporateGreen/10">
                    Limpiar búsquedas
                  </button>
                </div>
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <FilterSelect label="Producto" value={selectedProductCode} onChange={setSelectedProductCode} options={products.map((item) => ({ value: item.code, label: item.code === 'TODOS' ? item.description : `${item.code} - ${item.description}` }))} />
                  <FilterSelect label="Marca" value={selectedBrand} onChange={setSelectedBrand} options={brands.map((item) => ({ value: item, label: item }))} />
                  <FilterSelect label="Línea" value={selectedLine} onChange={setSelectedLine} options={lines.map((item) => ({ value: item, label: item }))} />
                  <FilterSelect label="Categoría" value={selectedCategory} onChange={setSelectedCategory} options={categories.map((item) => ({ value: item, label: item }))} />
                  <FilterSelect label="Tipo" value={selectedType} onChange={setSelectedType} options={types.map((item) => ({ value: item, label: item }))} />
                </div>
                <div className="mb-4 rounded-xl border border-corporateGreen/30 bg-corporateGreen/10 px-3 py-2.5">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-corporateGreen">Datos filtrados actualmente</div>
                  <div className="mt-1 text-sm font-bold text-white">{dataScopeTitle} | {activePeriodLabel}</div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Total Productos" value={data?.kpis.totalProducts ?? 0} />
                  <StatCard label="Unidades Vendidas" value={data?.kpis.totalUnitsSold ?? 0} accent="green" />
                  <StatCard label="Ganancias Totales" value={money(data?.kpis.totalProfit ?? 0)} accent="blue" />
                  <StatCard label="Margen Promedio" value={percent(data?.kpis.averageMargin ?? 0)} accent="blue" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <KpiCircle label="Alta Rotación" value={data?.kpis.highRotation ?? 0} color="#25ff00" />
                <KpiCircle label="Sin Ventas" value={data?.kpis.noSales ?? 0} color="#ff0000" />
                <KpiCircle label="Sobrestock" value={data?.kpis.overstock ?? 0} color="#102d84" />
                  <div className="sm:col-span-2 xl:col-span-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
                  <h3 className="mb-3 text-sm font-black uppercase text-corporateBlue dark:text-corporateGreen">Resumen de filtros</h3>
                  <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>Sucursal: <span className="font-bold">{selectedBranch}</span></div>
                    <div>Periodo: <span className="font-bold">{activePeriodLabel}</span></div>
                    <div>Categoría: <span className="font-bold">{selectedCategory}</span></div>
                    <div>Marca: <span className="font-bold">{selectedBrand}</span></div>
                    <div>Línea: <span className="font-bold">{selectedLine}</span></div>
                    <div>Tipo: <span className="font-bold">{selectedType}</span></div>
                    <div>Producto: <span className="font-bold">{selectedProductCode}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {data && selectedBranch && (
          <>
            <ExecutiveSummary data={data} scopeTitle={dataScopeTitle} periodLabel={activePeriodLabel} onRowClick={(row) => setDrawer({ row, periodMonths })} onTrendClick={() => setDailyDetailOpen(true)} />

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartCard title={titleWithScope('Total Productos Vendidos')}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.barSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="ventas" radius={[10, 10, 0, 0]}>
                      {data.barSeries.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title={titleWithScope('Ventas por hora')}>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.monthlySeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="quantity" stroke="#102d84" strokeWidth={4} dot={{ r: 5, fill: '#ff0000' }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <ChartCard title={titleWithScope(participationPeriodTitle)}>
                <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={data.donutSeries} dataKey="value" nameKey="name" outerRadius={100} innerRadius={70} label>
                        {data.donutSeries.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col justify-center gap-3">
                    {data.donutSeries.map((item, index) => (
                        <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                        <span className="font-semibold">{item.name}</span>
                        <span className="font-black" style={{ color: chartColors[index % chartColors.length] }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title={titleWithScope('Inteligencia de Inventario')}>
                <div className="space-y-3">
                  {data.rows.slice(0, 5).map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-black">{row.description}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">{row.recommendation}</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeColor(row.inventorySignal)}`}>{row.inventorySignal}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </section>

            <DataSection
              title={titleWithScope('TOTAL PRODUCTOS')}
              rows={currentRows}
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
              onRowClick={(row) => setDrawer({ row, periodMonths })}
              onSort={handleSort}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onExportExcel={() => exportExcel(displayedRows, 'total-productos')}
              onExportPdf={() => exportPdf(displayedRows, 'Total Productos')}
            />

            <DataSection
              title={titleWithScope('PRODUCTOS CON STOCK BAJO Y ALTA ROTACIÓN - COMPRAR')}
              rows={data.lowStockHighRotationRows}
              hidePagination
              onRowClick={(row) => setDrawer({ row, periodMonths })}
              onExportExcel={() => exportExcel(data.lowStockHighRotationRows, 'stock-bajo-alta-rotacion')}
              onExportPdf={() => exportPdf(data.lowStockHighRotationRows, 'Stock Bajo Alta Rotación')}
            />

            <div className="grid gap-4 xl:grid-cols-3">
              <DataSection
                title={titleWithScope('PRODUCTOS CON ALTA ROTACIÓN')}
                rows={data.topRotationRows}
                hidePagination
                onRowClick={(row) => setDrawer({ row, periodMonths })}
                onExportExcel={() => exportExcel(data.topRotationRows, 'alta-rotacion')}
                onExportPdf={() => exportPdf(data.topRotationRows, 'Alta Rotación')}
              />
              <DataSection
                title={titleWithScope('PRODUCTOS SIN VENTAS NI ROTACIÓN')}
                rows={data.noSalesRows}
                hidePagination
                onRowClick={(row) => setDrawer({ row, periodMonths })}
                onExportExcel={() => exportExcel(data.noSalesRows, 'sin-ventas')}
                onExportPdf={() => exportPdf(data.noSalesRows, 'Sin Ventas')}
              />
              <DataSection
                title={titleWithScope('PRODUCTOS CON SOBRESTOCK')}
                rows={data.overstockRows}
                hidePagination
                onRowClick={(row) => setDrawer({ row, periodMonths })}
                onExportExcel={() => exportExcel(data.overstockRows, 'sobrestock')}
                onExportPdf={() => exportPdf(data.overstockRows, 'Sobrestock')}
              />
            </div>
          </>
        )}

          </>
        )}

        {loading && <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">Cargando análisis...</div>}
      </main>

      {drawer && <ProductDrawer row={drawer.row} periodMonths={drawer.periodMonths} onClose={() => setDrawer(null)} />}
      {historicalOpen && <HistoricalModal manualStart={manualStart} manualEnd={manualEnd} manualError={manualError} onStartChange={setManualStart} onEndChange={setManualEnd} onApply={applyManualRange} onClose={() => setHistoricalOpen(false)} />}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-white outline-none transition focus:border-corporateGreen"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function HistoricalModal({
  manualStart,
  manualEnd,
  manualError,
  onStartChange,
  onEndChange,
  onApply,
  onClose
}: {
  manualStart: string;
  manualEnd: string;
  manualError: string | null;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[1.5rem] border border-slate-700 bg-[#061a24] p-4 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-corporateGreen">Histórica de datos</div>
            <h3 className="text-xl font-black uppercase">Seleccione fecha de inicio y fin</h3>
          </div>
          <button onClick={onClose} className="rounded-full bg-white px-4 py-2 font-black text-[#061a24]">Cerrar</button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold text-slate-300">
            Fecha inicial
            <input type="date" value={manualStart} onChange={(event) => onStartChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-white outline-none focus:border-corporateGreen" />
          </label>
          <label className="text-sm font-bold text-slate-300">
            Fecha final
            <input type="date" value={manualEnd} onChange={(event) => onEndChange(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-white outline-none focus:border-corporateGreen" />
          </label>
        </div>

        <div className="mt-3 text-xs font-semibold text-slate-400">Límite operativo: máximo 3 meses por consulta.</div>
        {manualError && <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-950/40 px-3 py-2.5 text-sm font-bold text-rose-200">{manualError}</div>}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-600 px-4 py-2.5 font-black text-slate-200">Cancelar</button>
          <button onClick={onApply} className="rounded-xl bg-corporateBlue px-5 py-2.5 font-black text-white shadow-lg">Consultar histórico</button>
        </div>
      </div>
    </div>
  );
}

function ProductOverviewModule({ data, loading, period, onPeriodChange, onExpand, onRefresh }: { data: ProductOverviewResponse | null; loading: boolean; period: PeriodMonths; onPeriodChange: (period: PeriodMonths) => void; onExpand: () => void; onRefresh: () => void }) {
  const [chartMode, setChartMode] = useState<'week' | 'month'>('week');
  const unitsSeries = getOverviewChartSeries(data?.weeklyUnitsSeries ?? [], 'quantity', chartMode);
  const revenueSeries = getOverviewChartSeries(data?.weeklyRevenueSeries ?? [], 'revenue', chartMode);

  return (
    <section className="premium-card rounded-[1.8rem] border-corporateGreen/30 p-5">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-corporateGreen/40 bg-corporateGreen/10 px-3 py-1 text-xs font-black uppercase tracking-[0.25em] text-corporateGreen">Job diario 01:00 AM | Caché BI</div>
          <h2 className="section-title text-2xl font-black uppercase text-corporateBlue dark:text-corporateGreen">{data?.title ?? 'TOTAL DE PRODUCTOS - VISTA GENERAL'}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-300">{data?.periodLabel ?? 'Calculando rango automático'} | ALMACEN PAS</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Datos históricos precalculados. No responde a filtros del dashboard operativo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {periodOptions.map((option) => (
            <button key={option} onClick={() => onPeriodChange(option)} className={`rounded-full px-4 py-2 text-sm font-black transition ${period === option ? 'bg-corporateGreen text-slate-950' : 'border border-slate-700 bg-slate-950/50 text-white hover:border-corporateGreen'}`}>
              {option === 3 ? 'Vista General' : `Último${option > 1 ? 's' : ''} ${option} mes${option > 1 ? 'es' : ''}`}
            </button>
          ))}
          <button onClick={onRefresh} className="rounded-full border border-corporateBlue/50 px-4 py-2 text-sm font-black text-corporateBlue dark:text-corporateGreen">Recalcular</button>
        </div>
      </div>

      {loading && <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-sm font-bold text-slate-300">Procesando métricas históricas...</div>}

      {data && !loading && (
        <>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Productos Vendidos" value={data.kpis.totalProductsSold} />
            <StatCard label="Unidades Vendidas" value={data.kpis.totalUnitsSold} accent="green" />
            <StatCard label="Dinero Vendido" value={money(data.kpis.totalRevenue)} accent="blue" />
            <StatCard label="Utilidad Generada" value={money(data.kpis.totalProfit)} accent="green" />
            <StatCard label="Margen Promedio" value={percent(data.kpis.averageMargin)} accent="blue" />
            <StatCard label="Productos Activos" value={data.kpis.activeProducts} />
            <StatCard label="Sin Movimiento" value={data.kpis.noMovementProducts} />
            <StatCard label="Alta Rotación" value={data.kpis.highRotationProducts} accent="green" />
            <StatCard label="Críticos Stock" value={data.kpis.criticalStockProducts} accent="blue" />
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <button onClick={onExpand} className="text-left">
              <ProductOverviewChart title={chartMode === 'week' ? 'Ventas semanales (Unidades)' : 'Ventas mensuales (Unidades)'} data={unitsSeries} dataKey="quantity" color="#25ff00" />
            </button>
            <button onClick={onExpand} className="text-left">
              <ProductOverviewChart title={chartMode === 'week' ? 'Dinero vendido semanalmente' : 'Dinero vendido mensualmente'} data={revenueSeries} dataKey="revenue" color="#38bdf8" moneyAxis />
            </button>
          </div>
          <ChartModeSwitch mode={chartMode} onChange={setChartMode} />
        </>
      )}
    </section>
  );
}

function getOverviewChartSeries<T extends 'quantity' | 'revenue'>(series: Array<{ week: string; monthLabel?: string } & Record<T, number>>, key: T, mode: 'week' | 'month') {
  if (mode === 'week') return series.map((item) => ({ week: item.week, [key]: item[key] })) as Array<{ week: string } & Record<T, number>>;
  const byMonth = new Map<string, number>();
  for (const item of series) {
    const month = item.monthLabel ?? item.week;
    byMonth.set(month, (byMonth.get(month) ?? 0) + item[key]);
  }
  return Array.from(byMonth.entries()).map(([week, value]) => ({ week, [key]: value })) as Array<{ week: string } & Record<T, number>>;
}

function ChartModeSwitch({ mode, onChange }: { mode: 'week' | 'month'; onChange: (mode: 'week' | 'month') => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/45 p-3">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-corporateGreen">Ver gráficas por</div>
      <button onClick={() => onChange('week')} className={`rounded-xl px-4 py-2 text-sm font-black transition ${mode === 'week' ? 'bg-corporateGreen text-slate-950' : 'border border-slate-700 text-white hover:border-corporateGreen'}`}>Semanas</button>
      <button onClick={() => onChange('month')} className={`rounded-xl px-4 py-2 text-sm font-black transition ${mode === 'month' ? 'bg-corporateGreen text-slate-950' : 'border border-slate-700 text-white hover:border-corporateGreen'}`}>Meses</button>
    </div>
  );
}

function ProductOverviewChart({ title, data, dataKey, color, moneyAxis }: { title: string; data: Array<{ week: string } & Record<string, string | number>>; dataKey: string; color: string; moneyAxis?: boolean }) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(value) => moneyAxis ? `$${Number(value).toFixed(0)}` : String(value)} />
          <Tooltip formatter={(value) => moneyAxis ? money(Number(value)) : Number(value).toLocaleString('es-EC')} contentStyle={{ background: '#061a24', border: '1px solid rgba(37,255,0,0.25)', borderRadius: 16, color: '#fff' }} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={4} dot={{ r: 4, fill: color }} activeDot={{ r: 7 }} animationDuration={900} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ProductOverviewExpanded({ data, onClose }: { data: ProductOverviewResponse; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [line, setLine] = useState('TODAS');
  const [category, setCategory] = useState('TODAS');
  const [type, setType] = useState('TODOS');
  const [brand, setBrand] = useState('TODAS');
  const [analysis, setAnalysis] = useState<'all' | 'lowStock' | 'overstock' | 'noSales' | 'highRotation'>('all');
  const [sort, setSort] = useState<'smartScore' | 'rotation' | 'totalProfit' | 'valueSold' | 'marginPercent' | 'stock' | 'stockAsc' | 'coverageDays'>('smartScore');
  const [page, setPage] = useState(1);
  const [chartMode, setChartMode] = useState<'week' | 'month'>('week');
  const unitsSeries = getOverviewChartSeries(data.weeklyUnitsSeries, 'quantity', chartMode);
  const revenueSeries = getOverviewChartSeries(data.weeklyRevenueSeries, 'revenue', chartMode);

  const searchTerm = normalizeSearch(search);
  const filtered = data.rows.filter((row) => {
    const searchMatch = !searchTerm || [row.code, row.description, row.brand, row.line, row.category, row.type].some((field) => normalizeSearch(field).includes(searchTerm));
    const lineMatch = line === 'TODAS' || row.line === line;
    const categoryMatch = category === 'TODAS' || row.category === category;
    const typeMatch = type === 'TODOS' || row.type === type;
    const brandMatch = brand === 'TODAS' || row.brand === brand;
    const analysisMatch = analysis === 'all'
      || (analysis === 'lowStock' && row.salesXMonths > 0 && row.coverageDays <= 30 && row.rotation >= 0.5)
      || (analysis === 'overstock' && row.coverageDays >= 120 && row.stock > 0)
      || (analysis === 'noSales' && row.salesXMonths === 0)
      || (analysis === 'highRotation' && (row.rotation >= 1 || row.averageDailySales >= 1));
    return searchMatch && lineMatch && categoryMatch && typeMatch && brandMatch && analysisMatch;
  }).sort((a, b) => {
    if (analysis === 'lowStock') return a.coverageDays - b.coverageDays || b.rotation - a.rotation;
    if (analysis === 'overstock') return b.coverageDays - a.coverageDays || b.immobilizedCapital - a.immobilizedCapital;
    if (analysis === 'noSales') return b.daysSinceLastSale - a.daysSinceLastSale;
    if (analysis === 'highRotation') return b.rotation - a.rotation || b.salesXMonths - a.salesXMonths || b.valueSold - a.valueSold;
    if (sort === 'stockAsc') return a.stock - b.stock;
    return Number(b[sort]) - Number(a[sort]);
  });
  const pageSize = 18;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeAnalysisLabel = overviewAnalysisLabels[analysis];
  const exportBaseName = `${data.title.toLowerCase().replace(/\s+/g, '-')}-${activeAnalysisLabel.toLowerCase().replace(/\s+/g, '-')}`;

  const resetPage = (action: () => void) => {
    action();
    setPage(1);
  };

  return (
    <section className="space-y-4">
      <div className="premium-card rounded-[1.8rem] p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-corporateGreen">Vista Expandida</div>
            <h2 className="section-title text-2xl font-black uppercase text-corporateBlue dark:text-corporateGreen">{data.title}</h2>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-300">{data.periodLabel} | Generado: {data.generatedAt}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-white px-5 py-2.5 font-black text-[#061a24] shadow-lg">Volver al dashboard</button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ProductOverviewChart title={chartMode === 'week' ? 'Ventas semanales (Unidades)' : 'Ventas mensuales (Unidades)'} data={unitsSeries} dataKey="quantity" color="#25ff00" />
        <ProductOverviewChart title={chartMode === 'week' ? 'Dinero vendido semanalmente' : 'Dinero vendido mensualmente'} data={revenueSeries} dataKey="revenue" color="#38bdf8" moneyAxis />
      </div>
      <ChartModeSwitch mode={chartMode} onChange={setChartMode} />

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Productos Vendidos" value={data.kpis.totalProductsSold} />
        <StatCard label="Unidades Vendidas" value={data.kpis.totalUnitsSold} accent="green" />
        <StatCard label="Dinero Vendido" value={money(data.kpis.totalRevenue)} accent="blue" />
        <StatCard label="Utilidad" value={money(data.kpis.totalProfit)} accent="green" />
        <StatCard label="Críticos Stock" value={data.kpis.criticalStockProducts} accent="blue" />
      </div>

      <div className="premium-card rounded-[1.6rem] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <AnalysisButton active={analysis === 'lowStock'} label="Alta Rotación y Stock Bajo" onClick={() => resetPage(() => setAnalysis('lowStock'))} />
            <AnalysisButton active={analysis === 'overstock'} label="Sobrestock y Pocas Ventas" onClick={() => resetPage(() => setAnalysis('overstock'))} />
            <AnalysisButton active={analysis === 'noSales'} label="Productos Sin Ventas" onClick={() => resetPage(() => setAnalysis('noSales'))} />
            <AnalysisButton active={analysis === 'highRotation'} label="Alta Rotación" onClick={() => resetPage(() => setAnalysis('highRotation'))} />
            <AnalysisButton active={analysis === 'all'} label="Todos" onClick={() => resetPage(() => setAnalysis('all'))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportOverviewExcel(filtered, exportBaseName)} className="rounded-full bg-corporateBlue px-4 py-2 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5">Exportar Excel</button>
            <button onClick={() => exportOverviewPdf(filtered, `${data.title} - ${activeAnalysisLabel}`)} className="rounded-full bg-corporateRed px-4 py-2 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5">Exportar PDF</button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.4fr_repeat(5,1fr)]">
          <input value={search} onChange={(event) => resetPage(() => setSearch(event.target.value))} placeholder="Buscar código, descripción, marca, línea, categoría o tipo" className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-corporateGreen" />
          <FilterSelect label="Línea" value={line} onChange={(value) => resetPage(() => setLine(value))} options={[{ value: 'TODAS', label: 'TODAS' }, ...data.availableLines.map((item) => ({ value: item, label: item }))]} />
          <FilterSelect label="Categoría" value={category} onChange={(value) => resetPage(() => setCategory(value))} options={[{ value: 'TODAS', label: 'TODAS' }, ...data.availableCategories.map((item) => ({ value: item, label: item }))]} />
          <FilterSelect label="Tipo" value={type} onChange={(value) => resetPage(() => setType(value))} options={[{ value: 'TODOS', label: 'TODOS' }, ...data.availableTypes.map((item) => ({ value: item, label: item }))]} />
          <FilterSelect label="Marca" value={brand} onChange={(value) => resetPage(() => setBrand(value))} options={[{ value: 'TODAS', label: 'TODAS' }, ...data.availableBrands.map((item) => ({ value: item, label: item }))]} />
          <FilterSelect label="Orden" value={sort} onChange={(value) => resetPage(() => setSort(value as typeof sort))} options={[
            { value: 'smartScore', label: 'Mayor score' },
            { value: 'rotation', label: 'Mayor rotación' },
            { value: 'totalProfit', label: 'Mayor utilidad' },
            { value: 'valueSold', label: 'Mayor venta' },
            { value: 'marginPercent', label: 'Mayor margen' },
            { value: 'stock', label: 'Mayor stock' },
            { value: 'stockAsc', label: 'Menor stock' },
            { value: 'coverageDays', label: 'Mayor cobertura' },
          ]} />
        </div>

        <ProductOverviewTable rows={visibleRows} />
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>{filtered.length.toLocaleString('es-EC')} productos | Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full border border-slate-700 px-4 py-2 font-black">Anterior</button>
            <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-full border border-slate-700 px-4 py-2 font-black">Siguiente</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalysisButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-full px-4 py-2 text-sm font-black transition ${active ? 'bg-corporateGreen text-slate-950' : 'border border-slate-700 text-slate-200 hover:border-corporateGreen'}`}>{label}</button>;
}

function ProductOverviewTable({ rows }: { rows: ProductOverviewRow[] }) {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  return (
    <div className="mt-4 overflow-x-auto scrollbar-thin">
      <table className="min-w-[1800px] w-full border-separate border-spacing-y-1 text-xs">
        <thead>
          <tr>
            {['Código', 'Descripción', 'Proveedor', 'Marca', 'Línea', 'Categoría', 'Tipo', 'Stock Total', ...warehouseColumns, 'Unidades vendidas', 'Valor vendido', 'Valor comprado proveedor', 'Valor comprado proveedor + IVA', 'Utilidad', 'Margen', 'Rotación', 'Cobertura (días)', 'Días sin venta', 'Clasificación ABC', 'XYZ', 'Pareto', 'Tendencia', 'Score', 'Estado'].map((label) => (
              <th key={label} className="whitespace-nowrap border-b border-slate-700 px-2.5 py-2 text-left font-black uppercase tracking-wide text-slate-400">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="bg-white/80 shadow-sm dark:bg-slate-800/70">
              <td className="rounded-l-xl px-2.5 py-2 font-black text-corporateGreen">{row.code}</td>
              <td className="max-w-[260px] truncate px-2.5 py-2 font-bold">{row.description}</td>
              <td className="max-w-[220px] truncate px-2.5 py-2">{row.provider}</td>
              <td className="px-2.5 py-2">{row.brand}</td>
              <td className="px-2.5 py-2">{row.line}</td>
              <td className="px-2.5 py-2">{row.category}</td>
              <td className="px-2.5 py-2">{row.type}</td>
              <td className="px-2.5 py-2 font-black">{row.stockTotal}</td>
              {warehouseColumns.map((warehouse) => <td key={`${row.id}-${warehouse}`} className="px-2.5 py-2 font-black">{row.warehouseStocks?.[warehouse] ?? 0}</td>)}
              <td className="px-2.5 py-2 font-black">{row.salesXMonths}</td>
              <td className="px-2.5 py-2 font-black text-corporateGreen">{money(row.valueSold)}</td>
              <td className="px-2.5 py-2 font-black">{money(row.providerPurchaseValue)}</td>
              <td className="px-2.5 py-2 font-black">{money(row.providerPurchaseValueWithIva)}</td>
              <td className="px-2.5 py-2 font-black text-emerald-300">{money(row.totalProfit)}</td>
              <td className="px-2.5 py-2">{percent(row.marginPercent)}</td>
              <td className="px-2.5 py-2">{row.rotation.toFixed(2)}</td>
              <td className="px-2.5 py-2">{row.coverageDays >= 999 ? '999+' : row.coverageDays.toFixed(0)}</td>
              <td className="px-2.5 py-2">{row.daysSinceLastSale >= 999 ? '999+' : row.daysSinceLastSale}</td>
              <td className="px-2.5 py-2 font-black">{row.abcClass}</td>
              <td className="px-2.5 py-2 font-black">{row.xyzClass}</td>
              <td className="px-2.5 py-2">{row.pareto ? '80/20' : 'No'}</td>
              <td className="px-2.5 py-2">{row.trend} ({row.trendPercent.toFixed(1)}%)</td>
              <td className="px-2.5 py-2 font-black text-corporateGreen">{row.smartScore.toFixed(1)}</td>
              <td className="rounded-r-xl px-2.5 py-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeColor(row.inventorySignal)}`}>{row.inventoryState}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExecutiveSummary({ data, scopeTitle, periodLabel, onRowClick, onTrendClick }: { data: DashboardResponse; scopeTitle: string; periodLabel: string; onRowClick: (row: ProductRow) => void; onTrendClick: () => void }) {
  const topProducts = data.topRotationRows.slice(0, 10);
  const soldProducts = data.rows.filter((row) => row.salesXMonths > 0);
  const maxSales = Math.max(...topProducts.map((row) => row.salesXMonths), 1);
  const maxStock = Math.max(...topProducts.map((row) => row.stock), 1);
  const stockCritical = data.lowStockHighRotationRows.length;
  const participationTitle = periodLabel === 'Día actual' ? 'Participación diaria' : `Participación del ${periodLabel.replace(' a ', ' al ')}`;
  const soldProfit = soldProducts.reduce((sum, row) => sum + row.totalProfit, 0);
  const soldAverageMargin = soldProducts.length > 0 ? soldProducts.reduce((sum, row) => sum + row.marginPercent, 0) / soldProducts.length : 0;

  return (
    <section className="overflow-hidden rounded-[1.6rem] bg-[#061a24] text-white shadow-2xl shadow-slate-950/20">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="text-xs font-black uppercase tracking-[0.25em] text-[#18b8b1]">Dashboard filtrado</div>
        <div className="mt-1 text-xl font-black uppercase">{scopeTitle}</div>
        <div className="text-sm font-bold text-cyan-100/60">Periodo: {periodLabel}</div>
      </div>
      <div className="grid min-h-[360px] 2xl:grid-cols-[1.05fr_1.45fr_0.95fr]">
        <div className="space-y-4 border-b border-white/10 p-4 2xl:border-b-0 2xl:border-r">
          <div className="rounded-2xl bg-[#092935] p-4 shadow-inner shadow-black/20">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">Ventas del periodo</div>
            <div className="mt-3 text-4xl font-black tracking-tight text-white">{data.kpis.totalUnitsSold.toLocaleString('es-EC')}</div>
            <div className="mt-1 text-sm text-cyan-100/65">Unidades vendidas</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DarkMetric label="Stock Total" value={data.kpis.totalStock.toLocaleString('es-EC')} />
            <DarkMetric label="Ganancia" value={money(data.kpis.totalProfit)} />
            <DarkMetric label="Productos" value={data.kpis.totalProducts.toLocaleString('es-EC')} />
            <DarkMetric label="Stock Crítico" value={stockCritical.toLocaleString('es-EC')} danger />
          </div>

          <div className="rounded-2xl bg-[#092935] p-4">
            <div className="mb-4 text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">Estado de inventario</div>
            <ProgressLine label="Alta rotación" value={data.kpis.highRotation} total={data.kpis.totalProducts} color="#18b8b1" />
            <ProgressLine label="Sin ventas" value={data.kpis.noSales} total={data.kpis.totalProducts} color="#ffbe1b" />
            <ProgressLine label="Sobrestock" value={data.kpis.overstock} total={data.kpis.totalProducts} color="#ff3b30" />
          </div>
        </div>

        <div className="space-y-4 border-b border-white/10 p-4 2xl:border-b-0 2xl:border-r">
          <div className="grid gap-4 2xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl bg-[#092935] p-4">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">{participationTitle}</div>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={data.donutSeries} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={3}>
                    {data.donutSeries.map((entry, index) => <Cell key={entry.name} fill={index % 2 === 0 ? '#18b8b1' : '#ffbe1b'} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-2xl bg-[#092935] p-4">
              <div className="mb-5 text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">Ventas vs Stock</div>
              <div className="space-y-4">
                {topProducts.slice(0, 4).map((row) => (
                  <div key={row.id}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-cyan-50/90">{row.description}</span>
                      <span className="font-black text-white">Stock {row.stock}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <div className="h-6 rounded-sm bg-white/10">
                        <div className="h-full rounded-sm bg-[#ffbe1b]" style={{ width: `${Math.max(5, (row.salesXMonths / maxSales) * 100)}%` }} />
                      </div>
                      <div className="h-6 rounded-sm bg-white/10">
                        <div className="h-full rounded-sm bg-[#18b8b1]" style={{ width: `${Math.max(5, (row.stock / maxStock) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-5 text-xs font-bold text-cyan-100/70">
                <span><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-[#ffbe1b]" />Ventas</span>
                <span><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-[#18b8b1]" />Stock total</span>
              </div>
            </div>
          </div>

          <button onClick={onTrendClick} className="w-full rounded-2xl bg-[#071f2a] p-4 text-left transition hover:bg-[#0b2a37]">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">Ventas durante el día</div>
                <div className="text-xs font-bold text-cyan-100/50">Click para detalle</div>
              </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <DarkMetric label="Ganancias Totales" value={money(soldProfit)} />
              <DarkMetric label="Margen Promedio" value={percent(soldAverageMargin)} />
              <DarkMetric label="Productos Vendidos" value={soldProducts.length.toLocaleString('es-EC')} />
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={data.monthlySeries}>
                <CartesianGrid stroke="#31505c" vertical={false} opacity={0.35} />
                <XAxis dataKey="month" stroke="#9dc7d0" fontSize={11} />
                <YAxis stroke="#9dc7d0" fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="quantity" stroke="#18b8b1" strokeWidth={4} dot={{ r: 4, fill: '#ffbe1b' }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-2 scrollbar-thin">
              {soldProducts.length > 0 ? soldProducts.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-black text-white">{row.description}</div>
                    <div className="text-cyan-100/60">Código {row.code}</div>
                  </div>
                  <div className="text-right font-black text-[#ffbe1b]">Cantidad vendida hoy: {row.salesXMonths}</div>
                  <div className="text-right font-black text-[#18b8b1]">{money(row.totalProfit)}</div>
                </div>
              )) : <div className="rounded-xl bg-white/5 px-3 py-2 text-sm font-bold text-cyan-100/70">No hay productos vendidos en el periodo seleccionado.</div>}
            </div>
          </button>
        </div>

        <div className="bg-[#073943] p-4">
          <div className="mb-5 text-center">
              <div className="text-lg font-black uppercase tracking-wide text-white">Top 10 productos</div>
              <div className="text-xs text-cyan-100/65">Mayor rotación durante el día</div>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-2 scrollbar-thin">
            {topProducts.map((row, index) => (
              <button key={row.id} onClick={() => onRowClick(row)} className="grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left transition hover:bg-white/10">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ffbe1b] text-sm font-black text-white">{index + 1}</div>
                <div className="min-w-0">
                  <div className="truncate font-black text-white">{row.description}</div>
                  <div className="text-xs text-cyan-100/70">Cantidad vendida hoy {row.salesXMonths} | Stock {row.stock}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-black text-white">{money(row.totalProfit)}</div>
                  <div className="text-xs text-cyan-100/70">Margen {percent(row.marginPercent)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DarkMetric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-[#092935] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/60">{label}</div>
      <div className={`mt-2 text-2xl font-black ${danger ? 'text-[#ffbe1b]' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function ProgressLine({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const width = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-xs font-bold text-cyan-100/75">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-5 rounded-sm bg-white/10">
        <div className="h-full rounded-sm" style={{ width: `${Math.max(3, width)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'blue' }) {
  const bg = accent === 'green' ? 'from-corporateGreen/20 via-white to-emerald-50' : accent === 'blue' ? 'from-corporateBlue/20 via-white to-indigo-50' : 'from-corporateRed/10 via-white to-rose-50';
  return (
    <div className={`relative overflow-hidden rounded-[1.6rem] border border-slate-200 bg-gradient-to-br ${bg} p-5 shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950`}>
      <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-corporateBlue/10" />
      <div className="relative text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
      <div className="relative mt-2 text-3xl font-black text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function KpiCircle({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-[1.7rem] border border-slate-200 bg-white/70 p-5 text-center shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-8 bg-white text-2xl font-black shadow-inner dark:bg-slate-950" style={{ borderColor: color, color }}>
        {value}
      </div>
      <div className="mt-3 text-sm font-black uppercase tracking-wide">{label}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="premium-card rounded-[1.6rem] p-4">
      <div className="section-title mb-3 text-sm font-black uppercase text-corporateBlue dark:text-corporateGreen">{title}</div>
      {children}
    </div>
  );
}

function DataSection({
  title,
  rows,
  onRowClick,
  hidePagination,
  page,
  totalPages,
  onPrev,
  onNext,
  onSort,
  sortKey,
  sortDirection,
  onExportExcel,
  onExportPdf
}: {
  title: string;
  rows: ProductRow[];
  onRowClick: (row: ProductRow) => void;
  hidePagination?: boolean;
  page?: number;
  totalPages?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onSort?: (key: keyof ProductRow) => void;
  sortKey?: keyof ProductRow;
  sortDirection?: 'asc' | 'desc';
  onExportExcel: () => void;
  onExportPdf: () => void;
}) {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const columns: Array<{ key: keyof ProductRow; label: string }> = [
    { key: 'code', label: 'Código' },
    { key: 'description', label: 'Descripción' },
    { key: 'stockTotal', label: 'Stock Total' },
    { key: 'salesXMonths', label: 'Cantidad Vendida' },
    { key: 'saleDate', label: 'fecha_venta' },
    { key: 'totalProfit', label: 'Ganancia Total' },
    { key: 'lastPurchase', label: 'Última Compra' },
    { key: 'costProvider', label: 'Costo Proveedor' },
    { key: 'costWithIva', label: 'Costo + IVA' },
    { key: 'publicCost', label: 'Costo Público' },
    { key: 'salePrice', label: 'precio_venta' },
    { key: 'publicCostWithIva', label: 'Costo Público + IVA' },
    { key: 'currentPriceWithIva', label: 'Precio Actual' },
    { key: 'marginPercent', label: 'Margen %' },
    { key: 'currentMarginPercent', label: 'Margen Actual %' },
    { key: 'provider', label: 'Proveedor' },
    { key: 'rotation', label: 'Rotación' },
    { key: 'inventoryState', label: 'Estado Inventario' }
  ];

  return (
    <div className="premium-card rounded-[1.6rem] p-4 xl:col-span-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="section-title text-sm font-black uppercase text-corporateBlue dark:text-corporateGreen">{title}</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onExportExcel} className="rounded-full bg-corporateBlue px-4 py-2 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5">Exportar Excel</button>
          <button onClick={onExportPdf} className="rounded-full bg-corporateRed px-4 py-2 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5">Exportar PDF</button>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="min-w-full border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr>
              {columns.map((column) => (
                <Fragment key={column.key as string}>
                  <th onClick={() => onSort?.(column.key)} className="cursor-pointer whitespace-nowrap border-b border-slate-200 px-2.5 py-2 text-left font-black uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {column.label}
                    {sortKey === column.key && <span className="ml-2 text-xs">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  {column.key === 'stockTotal' && warehouseColumns.map((warehouse) => (
                    <th key={warehouse} className="whitespace-nowrap border-b border-slate-200 px-2.5 py-2 text-left font-black uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">{warehouse}</th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => onRowClick(row)} className="cursor-pointer rounded-xl bg-white/80 shadow-sm transition hover:-translate-y-0.5 hover:bg-corporateBlue/5 hover:shadow-md dark:bg-slate-800/70 dark:hover:bg-slate-800">
                <td className="whitespace-nowrap rounded-l-xl px-2.5 py-2 font-bold text-corporateBlue dark:text-corporateGreen">{row.code}</td>
                <td className="max-w-[240px] truncate px-2.5 py-2">{row.description}</td>
                <td className="px-2.5 py-2 font-black">{row.stockTotal}</td>
                {warehouseColumns.map((warehouse) => <td key={`${row.id}-${warehouse}`} className="px-2.5 py-2">{row.warehouseStocks?.[warehouse] ?? 0}</td>)}
                <td className="px-2.5 py-2">{row.salesXMonths}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{row.saleDate || 'NO CONSTA'}</td>
                <td className="px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300">{money(row.totalProfit)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{row.lastPurchase}</td>
                <td className="px-2.5 py-2">{money(row.costProvider)}</td>
                <td className="px-2.5 py-2">{money(row.costWithIva)}</td>
                <td className="px-2.5 py-2">{money(row.publicCost)}</td>
                <td className="px-2.5 py-2 font-bold text-corporateBlue dark:text-corporateGreen">{row.salePrice > 0 ? money(row.salePrice) : 'NO CONSTA'}</td>
                <td className="px-2.5 py-2">{money(row.publicCostWithIva)}</td>
                <td className="px-2.5 py-2 font-bold">{money(row.currentPriceWithIva)}</td>
                <td className="px-2.5 py-2">{percent(row.marginPercent)}</td>
                <td className="px-2.5 py-2 font-bold text-corporateBlue dark:text-corporateGreen">{percent(row.currentMarginPercent)}</td>
                <td className="whitespace-nowrap px-2.5 py-2">{row.provider}</td>
                <td className="px-2.5 py-2 font-bold">{row.rotation.toFixed(2)}</td>
                <td className="rounded-r-xl px-2.5 py-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeColor(row.inventorySignal)}`}>{row.inventoryState}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hidePagination && page && totalPages && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <div className="text-slate-500">Página {page} de {totalPages}</div>
          <div className="flex gap-2">
            <button onClick={onPrev} className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 font-bold shadow-sm dark:border-slate-700 dark:bg-slate-800">Anterior</button>
            <button onClick={onNext} className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 font-bold shadow-sm dark:border-slate-700 dark:bg-slate-800">Siguiente</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DailyDetailPage({ data, scopeTitle, periodLabel, onClose }: { data: DashboardResponse; scopeTitle: string; periodLabel: string; onClose: () => void }) {
  const [detailSearch, setDetailSearch] = useState('');
  const [detailSearchFocused, setDetailSearchFocused] = useState(false);
  const rows = data.rows.filter((row) => row.salesXMonths > 0);
  const searchTerm = detailSearch.trim();
  const scoredRows = rows.map((row) => {
    const score = Math.max(
      scoreMatch(searchTerm, row.code),
      scoreMatch(searchTerm, row.description),
      scoreMatch(searchTerm, row.brand),
      scoreMatch(searchTerm, row.line),
      scoreMatch(searchTerm, row.category),
      scoreMatch(searchTerm, row.type),
      scoreMatch(searchTerm, row.provider)
    );
    return { row, score };
  });
  const visibleRows = searchTerm ? scoredRows.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.row) : rows;
  const detailSuggestions = searchTerm.length >= 2 ? scoredRows
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row) : [];
  const soldProfit = visibleRows.reduce((sum, row) => sum + row.totalProfit, 0);
  const totalSalesMoney = visibleRows.reduce((sum, row) => sum + (row.publicCostWithIva * row.salesXMonths), 0);
  const soldAverageMargin = visibleRows.length > 0 ? visibleRows.reduce((sum, row) => sum + row.marginPercent, 0) / visibleRows.length : 0;
  const soldUnits = visibleRows.reduce((sum, row) => sum + row.salesXMonths, 0);
  const warehouseColumns = Array.from(new Set(visibleRows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <section className="overflow-hidden rounded-[1.5rem] bg-[#061a24] text-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-[#18b8b1]">Página detalle ejecutivo diario</div>
            <h2 className="text-xl font-black uppercase">{scopeTitle}</h2>
            <div className="text-sm font-bold text-cyan-100/60">Periodo: {periodLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => exportExcel(visibleRows, 'detalle-ejecutivo-diario')} className="rounded-full bg-[#18b8b1] px-4 py-2 text-sm font-black text-[#061a24] shadow-lg transition hover:-translate-y-0.5">Exportar Excel</button>
            <button onClick={() => exportPdf(visibleRows, 'Detalle Ejecutivo Diario')} className="rounded-full bg-[#ffbe1b] px-4 py-2 text-sm font-black text-[#061a24] shadow-lg transition hover:-translate-y-0.5">Exportar PDF</button>
            <button onClick={onClose} className="rounded-full bg-white px-5 py-2 font-black text-[#061a24]">Volver al dashboard</button>
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl bg-[#092935] p-4">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-cyan-100/80">Línea general de ventas</div>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={data.monthlySeries}>
                <CartesianGrid stroke="#31505c" vertical={false} opacity={0.35} />
                <XAxis dataKey="month" stroke="#9dc7d0" fontSize={11} />
                <YAxis stroke="#9dc7d0" fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="quantity" stroke="#18b8b1" strokeWidth={4} dot={{ r: 4, fill: '#ffbe1b' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <DarkMetric label="Total Ventas" value={money(totalSalesMoney)} />
            <DarkMetric label="Ganancia día" value={money(soldProfit)} />
            <DarkMetric label="Media margen" value={percent(soldAverageMargin)} />
            <DarkMetric label="Productos vendidos" value={rows.length.toLocaleString('es-EC')} />
            <DarkMetric label="Unidades" value={soldUnits.toLocaleString('es-EC')} />
          </div>
        </div>

        <div className="border-y border-white/10 px-4 py-3">
          <div className="relative">
            <input
              value={detailSearch}
              onChange={(event) => setDetailSearch(event.target.value)}
              onFocus={() => setDetailSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setDetailSearchFocused(false), 180)}
              placeholder="Buscar tipo Google: código, producto, marca, línea, categoría, tipo o proveedor"
              className="w-full rounded-2xl border border-cyan-100/15 bg-[#092935] px-4 py-3 text-sm font-bold text-white outline-none ring-[#18b8b1]/20 transition placeholder:text-cyan-100/35 focus:border-[#18b8b1] focus:ring-4"
            />
            {detailSearch && (
              <button onClick={() => setDetailSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 px-3 py-1 text-xs font-black text-cyan-100/75 hover:bg-white/10">
                Limpiar
              </button>
            )}
            {detailSearchFocused && detailSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-cyan-100/15 bg-[#061a24] shadow-2xl">
                {detailSuggestions.map((row) => (
                  <button key={row.id} onClick={() => setDetailSearch(`${row.code} ${row.description}`)} className="flex w-full items-center justify-between gap-4 border-b border-white/5 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-white/10">
                    <span className="min-w-0 truncate font-black text-white">{row.code} - {row.description}</span>
                    <span className="shrink-0 rounded-full bg-[#18b8b1] px-3 py-1 text-xs font-black text-[#061a24]">{row.salesXMonths} und.</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 text-xs font-bold text-cyan-100/60">
            Mostrando {visibleRows.length.toLocaleString('es-EC')} de {rows.length.toLocaleString('es-EC')} productos vendidos.
          </div>
        </div>

        <div className="overflow-auto px-4 pb-4 pt-3 scrollbar-thin">
          <table className="min-w-[1900px] w-full border-separate border-spacing-y-1 text-xs">
            <thead className="sticky top-0 z-10 bg-[#061a24]">
              <tr>
                {['Imagen', 'Código', 'Descripción', 'Marca', 'Línea', 'Categoría', 'Tipo', 'Cantidad Vendida Día', 'fecha_venta', 'Precio Punto PAS', 'Precio PVP', 'Proveedor', 'Costo Proveedor', 'Costo + IVA', 'precio_venta', 'Costo Público + IVA', 'Precio Actual', 'Fecha Última Compra', 'Cantidad Última Compra', 'Stock Total', ...warehouseColumns, 'Margen Ganancia %', 'Margen Actual %'].map((label) => (
                  <th key={label} className="whitespace-nowrap border-b border-white/10 px-2.5 py-2 text-left font-black uppercase tracking-wide text-cyan-100/70">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="bg-white/5 transition hover:bg-white/10">
                  <td className="rounded-l-xl px-2.5 py-2">
                    <img src={cloudinaryProductImage(row.code)} alt={row.description} onError={(event) => { event.currentTarget.style.display = 'none'; }} className="h-10 w-10 rounded-lg object-cover" />
                  </td>
                  <td className="px-2.5 py-2 font-black text-[#ffbe1b]">{row.code}</td>
                  <td className="max-w-[280px] truncate px-2.5 py-2 font-bold">{row.description}</td>
                  <td className="px-2.5 py-2">{row.brand}</td>
                  <td className="px-2.5 py-2">{row.line}</td>
                  <td className="px-2.5 py-2">{row.category}</td>
                  <td className="px-2.5 py-2">{row.type}</td>
                  <td className="px-2.5 py-2 font-black text-[#ffbe1b]">{row.salesXMonths}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">{row.saleDate || 'NO CONSTA'}</td>
                  <td className="px-2.5 py-2 font-bold">{money(row.pricePuntoPas)}</td>
                  <td className="px-2.5 py-2 font-bold">{row.pricePvp === null ? 'NO CONSTA' : money(row.pricePvp)}</td>
                  <td className="px-2.5 py-2">{row.provider}</td>
                  <td className="px-2.5 py-2">{money(row.costProvider)}</td>
                  <td className="px-2.5 py-2">{money(row.costWithIva)}</td>
                  <td className="px-2.5 py-2 font-bold text-[#ffbe1b]">{row.salePrice > 0 ? money(row.salePrice) : 'NO CONSTA'}</td>
                  <td className="px-2.5 py-2">{money(row.publicCostWithIva)}</td>
                  <td className="px-2.5 py-2 font-bold">{money(row.currentPriceWithIva)}</td>
                  <td className="px-2.5 py-2">{row.lastPurchase || 'NO CONSTA'}</td>
                  <td className="px-2.5 py-2">{row.lastPurchaseQuantity}</td>
                  <td className="px-2.5 py-2 font-black text-[#18b8b1]">{row.stockTotal}</td>
                  {warehouseColumns.map((warehouse) => <td key={`${row.id}-${warehouse}`} className="px-2.5 py-2 font-black text-cyan-100">{row.warehouseStocks?.[warehouse] ?? 0}</td>)}
                  <td className="rounded-r-xl px-2.5 py-2 font-black">{percent(row.marginPercent)}</td>
                  <td className="rounded-r-xl px-2.5 py-2 font-black text-[#18b8b1]">{percent(row.currentMarginPercent)}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={22 + warehouseColumns.length} className="rounded-xl bg-white/5 px-4 py-8 text-center text-sm font-bold text-cyan-100/70">No hay productos vendidos que coincidan con la búsqueda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
    </section>
  );
}

function ProductDrawer({ row, periodMonths, onClose }: { row: ProductRow; periodMonths: PeriodMonths; onClose: () => void }) {
  const selectedSales = row.monthlySales.slice(-periodMonths);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between gap-4">
          <img src={cloudinaryProductImage(row.code)} alt={row.description} onError={(event) => { event.currentTarget.style.display = 'none'; }} className="h-20 w-20 rounded-2xl border border-slate-700 object-cover shadow-xl" />
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-corporateRed">Descripción del producto</div>
            <h3 className="text-xl font-black text-corporateBlue dark:text-corporateGreen">{row.description}</h3>
            <div className="mt-1 text-sm font-black text-slate-400">Código: {row.code}</div>
          </div>
          <button onClick={onClose} className="rounded-full border border-slate-200 bg-slate-100 px-4 py-2 font-black shadow-sm transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800">Cerrar</button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-gradient-to-br from-corporateBlue to-slate-950 p-4 text-white shadow-xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Stock Total</div>
            <div className="mt-1 text-3xl font-black">{row.stockTotal}</div>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-corporateRed to-red-900 p-4 text-white shadow-xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Cantidad Vendida</div>
            <div className="mt-1 text-3xl font-black">{row.salesXMonths}</div>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-900 p-4 text-white shadow-xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Ganancia Total</div>
            <div className="mt-2 text-2xl font-black">{money(row.totalProfit)}</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Código" value={row.code} />
          <Detail label="fecha_venta" value={row.saleDate || 'NO CONSTA'} />
          <Detail label="Marca" value={row.brand} />
          <Detail label="Categoría" value={row.category} />
          <Detail label="Proveedor" value={row.provider} />
          <Detail label="Costo" value={money(row.costProvider)} />
          <Detail label="Precio Venta" value={money(row.publicCost)} />
          <Detail label="precio_venta" value={row.salePrice > 0 ? money(row.salePrice) : 'NO CONSTA'} />
          <Detail label="Costo Público + IVA" value={money(row.publicCostWithIva)} />
          <Detail label="Precio Actual" value={money(row.currentPriceWithIva)} />
          <Detail label="Ganancia Unitaria" value={money(row.unitProfit)} />
          <Detail label="Ganancia Total" value={money(row.totalProfit)} />
          <Detail label="Margen" value={percent(row.marginPercent)} />
          <Detail label="Margen Actual" value={percent(row.currentMarginPercent)} />
          <Detail label="Stock Total" value={row.stockTotal} />
          {Object.entries(row.warehouseStocks ?? {}).map(([warehouse, stock]) => <Detail key={warehouse} label={warehouse} value={stock} />)}
          <Detail label="Última Compra" value={row.lastPurchase} />
          <Detail label="Recomendación" value={row.recommendation} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-3 font-black uppercase text-corporateBlue dark:text-corporateGreen">Ventas Históricas</div>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={row.monthlySales}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="quantity" fill="#102d84" radius={[8, 8, 0, 0]} />
                <Line type="monotone" dataKey="quantity" stroke="#ff0000" strokeWidth={3} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-3 font-black uppercase text-corporateBlue dark:text-corporateGreen">Reporte Mensual</div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={selectedSales} dataKey="quantity" nameKey="month" outerRadius={70} innerRadius={45} label>
                  {selectedSales.map((entry, index) => <Cell key={entry.month} fill={chartColors[index % chartColors.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {selectedSales.map((item, index) => {
                const total = selectedSales.reduce((sum, sale) => sum + sale.quantity, 0) || 1;
                const value = (item.quantity / total) * 100;
                return <KpiMini key={item.month} label={item.month} value={value} color={chartColors[index % chartColors.length]} />;
              })}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Rotación: <span className="font-black">{row.rotation.toFixed(2)}</span></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Días estimados de inventario: <span className="font-black">{row.estimatedDaysInventory}</span></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Ganancia unitaria: <span className="font-black">{money(row.unitProfit)}</span></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Ganancia total del producto: <span className="font-black">{money(row.totalProfit)}</span></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Estado: <span className="font-black">{row.inventoryState}</span></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">Semáforo: <span className="font-black">{row.inventorySignal}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiMini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-center dark:border-slate-700">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 text-sm font-black" style={{ borderColor: color, color }}>
        {Math.round(value)}%
      </div>
      <div className="mt-2 text-xs font-bold uppercase">{label}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  );
}

export default App;
