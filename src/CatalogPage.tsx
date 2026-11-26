import { useEffect, useMemo, useState } from 'react';
import { fetchBranches, fetchCatalog } from './api';
import { catalogImageUrl, exportCatalogPdf, hasCatalogStock, type CatalogPdfGrouping, type CatalogPdfMode } from './catalog';
import type { Branch, CatalogProduct, CatalogResponse } from './types';
import { money, warehouseStockTotal } from './utils';

const PAGE_SIZE = 60;
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const stockText = (value: number) => Number.isInteger(value)
  ? value.toLocaleString('es-EC')
  : value.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const readBranchFromUrl = () => {
  const value = new URLSearchParams(window.location.search).get('branch');
  return value && value.trim() ? value.trim() : 'ALMACEN PAS';
};

const groupingOptions: { value: CatalogPdfGrouping; label: string }[] = [
  { value: 'none', label: 'Sin agrupar' },
  { value: 'line', label: 'Agrupar por línea' },
  { value: 'category', label: 'Agrupar por categoría' },
  { value: 'type', label: 'Agrupar por tipo' },
];

function ImagePlaceholder() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-300">
      <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m4.5 17.5 4.7-4.6a1.6 1.6 0 0 1 2.2 0l2.4 2.3 1.7-1.6a1.6 1.6 0 0 1 2.2 0l1.8 1.8" />
      </svg>
      <span className="text-[10px] font-black uppercase tracking-[0.22em]">Sin imagen</span>
    </div>
  );
}

function CatalogCard({ row, withImages, eager }: { row: CatalogProduct; withImages: boolean; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = withImages ? catalogImageUrl(row.code) : null;
  const warehouseEntries = Object.entries(row.warehouseStocks ?? {}).sort(([a], [b]) => a.localeCompare(b, 'es'));
  const totalStock = warehouseStockTotal(row);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[1.4rem] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-1 hover:border-[#ff0000]/40 hover:shadow-[0_24px_48px_rgba(15,23,42,0.14)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[linear-gradient(150deg,#f8fafc,#e9eef6)]">
        {imageUrl && !failed ? (
          <img
            src={imageUrl}
            alt={row.description}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <ImagePlaceholder />
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-slate-600 shadow-sm ring-1 ring-slate-200/70">
          {row.code}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-2 min-h-[2.6rem] text-sm font-bold leading-snug text-slate-800">{row.description}</p>
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Stock por bodega</p>
            <span className="inline-flex items-baseline gap-1 rounded-full bg-[#0b1f3a] px-2 py-0.5 text-[10px] font-black text-white">
              <span className="text-[8px] uppercase tracking-[0.1em] text-white/60">Total</span>
              <span className="tabular-nums">{stockText(totalStock)}</span>
            </span>
          </div>
          {warehouseEntries.length ? (
            <ul className="mt-2 space-y-1">
              {warehouseEntries.map(([warehouse, stock]) => (
                <li key={warehouse} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500" title={warehouse}>{warehouse}</span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${stock > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200/70 text-slate-500'}`}>
                    {stockText(stock)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Sin bodegas registradas</p>
          )}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-dashed border-slate-200 pt-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Precio</p>
            {row.priceAvailable ? (
              <p className="text-xl font-black tracking-tight text-[#0b1f3a]">{money(row.price)}</p>
            ) : (
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Consultar</p>
            )}
          </div>
          <span className="rounded-full bg-[#ff0000]/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#b91c1c]">IVA incl.</span>
        </div>
      </div>
    </article>
  );
}

export default function CatalogPage() {
  const [branch, setBranch] = useState(readBranchFromUrl);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [line, setLine] = useState('TODAS');
  const [category, setCategory] = useState('TODOS');
  const [type, setType] = useState('TODOS');
  const [grouping, setGrouping] = useState<CatalogPdfGrouping>('none');
  const [pdfMode, setPdfMode] = useState<CatalogPdfMode>('visual');
  const [pdfLimit, setPdfLimit] = useState(60);
  const [onlyWithStock, setOnlyWithStock] = useState(true);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    fetchBranches().then(setBranches).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.title = `Catálogo · ${branch} · Punto Pas`;
  }, [branch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchCatalog(branch)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branch, reloadKey]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [branch, search, line, category, type]);

  const rows = data?.rows ?? [];
  const lines = useMemo(() => ['TODAS', ...(data?.lines ?? [])], [data?.lines]);
  const categories = useMemo(() => ['TODOS', ...(data?.categories ?? [])], [data?.categories]);
  const types = useMemo(() => ['TODOS', ...(data?.types ?? [])], [data?.types]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return rows.filter((row) => {
      if (line !== 'TODAS' && row.line !== line) return false;
      if (category !== 'TODOS' && row.category !== category) return false;
      if (type !== 'TODOS' && row.type !== type) return false;
      if (term && !normalize(`${row.code} ${row.description}`).includes(term)) return false;
      return true;
    });
  }, [rows, search, line, category, type]);

  const withImages = branch === 'ALMACEN PAS' || !!branches.find((item) => item.name === branch)?.hasImages;
  const pdfRows = useMemo(() => (onlyWithStock ? filtered.filter(hasCatalogStock) : filtered), [filtered, onlyWithStock]);
  const shown = filtered.slice(0, visible);
  const pdfLabel = [
    line !== 'TODAS' ? `Línea: ${line}` : null,
    category !== 'TODOS' ? `Categoría: ${category}` : null,
    type !== 'TODOS' ? `Tipo: ${type}` : null,
    search.trim() ? `Búsqueda: "${search.trim()}"` : null,
    onlyWithStock ? 'Solo con stock' : null,
  ].filter(Boolean).join('  ·  ');

  const changeBranch = (name: string) => {
    if (name === branch) return;
    setBranch(name);
    setData(null);
    const url = new URL(window.location.href);
    url.searchParams.set('branch', name);
    window.history.replaceState({}, '', url.toString());
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    setPdfProgress(null);
    try {
      await exportCatalogPdf(pdfRows, {
        branch,
        grouping,
        filterLabel: pdfLabel,
        mode: pdfMode,
        includeImages: pdfMode === 'visual' && withImages,
        limit: pdfMode === 'visual' ? pdfLimit : undefined,
        totalRows: pdfRows.length,
        onProgress: (done, total) => setPdfProgress({ done, total }),
      });
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'No se pudo generar el PDF');
    } finally {
      setPdfBusy(false);
      setPdfProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1f3a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#ff0000] text-sm font-black text-white shadow-lg shadow-red-900/30">PP</div>
          <div className="leading-tight">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-white">Punto Pas</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/45">Catálogo de productos</p>
          </div>
          <a
            href="/"
            className="ml-auto rounded-full border border-white/20 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/80 transition hover:border-white/50 hover:bg-white/10 hover:text-white"
          >
            Ver dashboard
          </a>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#0b1f3a] pb-20 pt-10 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,0,0,0.32),transparent_42%),radial-gradient(circle_at_88%_10%,rgba(37,99,235,0.28),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#ff0000] to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4">
          <p className="text-[11px] font-black uppercase tracking-[0.36em] text-[#ff6b6b]">Distribuidor Punto Pas</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl font-black tracking-[-0.03em] sm:text-5xl">Catálogo de productos</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
                Código, descripción y precio de venta al público. Precios expresados con IVA incluido.
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 shadow-xl backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/50">Productos</p>
              <p className="text-3xl font-black tabular-nums">{loading ? '—' : filtered.length.toLocaleString('es-EC')}</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">{branch}</p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.24em] text-white/40">Sucursal</span>
            {(branches.length ? branches : [{ name: 'ALMACEN PAS' }, { name: 'VARIEDADES PAS' }, { name: 'STIHL' }]).map((item) => (
              <button
                key={item.name}
                onClick={() => changeBranch(item.name)}
                className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition ${
                  item.name === branch
                    ? 'bg-white text-[#0b1f3a] shadow-lg'
                    : 'border border-white/20 text-white/75 hover:border-white/45 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 pb-20">
        <section className="relative z-10 -mt-14 rounded-[1.6rem] border border-slate-200/80 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.14)] sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.4fr)_repeat(3,minmax(0,1fr))]">
            <div className="relative">
              <label htmlFor="catalog-search" className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Buscar</label>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-[2.35rem] h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m16.5 16.5 4 4" />
              </svg>
              <input
                id="catalog-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Código o descripción…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#ff0000]/60 focus:bg-white focus:ring-4 focus:ring-red-100"
              />
            </div>
            {[
              { id: 'catalog-line', label: 'Línea', value: line, setValue: setLine, options: lines },
              { id: 'catalog-category', label: 'Categoría', value: category, setValue: setCategory, options: categories },
              { id: 'catalog-type', label: 'Tipo', value: type, setValue: setType, options: types },
            ].map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{field.label}</label>
                <select
                  id={field.id}
                  value={field.value}
                  onChange={(event) => field.setValue(event.target.value)}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#ff0000]/60 focus:bg-white focus:ring-4 focus:ring-red-100"
                >
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-slate-200 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1.5">{filtered.length.toLocaleString('es-EC')} productos</span>
              {(line !== 'TODAS' || category !== 'TODOS' || type !== 'TODOS' || search.trim()) && (
                <button
                  onClick={() => { setSearch(''); setLine('TODAS'); setCategory('TODOS'); setType('TODOS'); }}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                >
                  Limpiar filtros
                </button>
              )}
              {pdfError && <span className="text-rose-600">{pdfError}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-600 transition hover:border-slate-300">
                <input
                  type="checkbox"
                  checked={onlyWithStock}
                  onChange={(event) => setOnlyWithStock(event.target.checked)}
                  className="h-4 w-4 accent-[#ff0000]"
                />
                Solo con stock
              </label>
              <select
                value={pdfMode}
                onChange={(event) => setPdfMode(event.target.value as CatalogPdfMode)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-600 outline-none transition focus:border-[#ff0000]/60"
                aria-label="Tipo de PDF"
              >
                <option value="visual">Catálogo visual</option>
                <option value="list">Lista de precios</option>
              </select>
              {pdfMode === 'visual' && (
                <select
                  value={pdfLimit}
                  onChange={(event) => setPdfLimit(Number(event.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-600 outline-none transition focus:border-[#ff0000]/60"
                  aria-label="Productos en el catálogo visual"
                >
                  <option value={60}>60 productos</option>
                  <option value={120}>120 productos</option>
                  <option value={240}>240 productos</option>
                </select>
              )}
              <select
                value={grouping}
                onChange={(event) => setGrouping(event.target.value as CatalogPdfGrouping)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-600 outline-none transition focus:border-[#ff0000]/60"
                aria-label="Agrupación del PDF"
              >
                {groupingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button
                onClick={downloadPdf}
                disabled={pdfBusy || loading || pdfRows.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b1f3a] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#102d84] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
                  <path d="M5 18h14" />
                </svg>
                {pdfBusy
                  ? pdfMode === 'visual'
                    ? (pdfProgress ? `Imágenes ${pdfProgress.done}/${pdfProgress.total}…` : 'Preparando…')
                    : 'Generando…'
                  : 'Descargar PDF'}
              </button>
            </div>
          </div>
          {(onlyWithStock || (pdfMode === 'visual' && (pdfRows.length > pdfLimit || !withImages)) || pdfRows.length === 0) && (
            <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
              {pdfRows.length === 0 ? (
                <span className="text-rose-500">No hay productos con stock para estos filtros.</span>
              ) : (
                <>
                  {onlyWithStock && (
                    <span>Solo se incluyen productos con stock: {pdfRows.length.toLocaleString('es-EC')} de {filtered.length.toLocaleString('es-EC')}.</span>
                  )}
                  {pdfMode === 'visual' && pdfRows.length > pdfLimit && (
                    <span>El PDF visual incluye {Math.min(pdfRows.length, pdfLimit).toLocaleString('es-EC')} de {pdfRows.length.toLocaleString('es-EC')} productos.</span>
                  )}
                  {pdfMode === 'visual' && !withImages && <span>Sin imágenes para esta sucursal: se usará el marco «SIN IMAGEN».</span>}
                </>
              )}
            </div>
          )}
        </section>

        {error ? (
          <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
            <p className="text-sm font-bold text-rose-700">{error}</p>
            <button onClick={() => setReloadKey((value) => value + 1)} className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white">
              Reintentar
            </button>
          </div>
        ) : loading ? (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_value, index) => (
              <div key={index} className="animate-pulse overflow-hidden rounded-[1.4rem] border border-slate-200/70 bg-white">
                <div className="aspect-[4/3] bg-slate-100" />
                <div className="space-y-3 p-4">
                  <div className="h-3 w-4/5 rounded bg-slate-100" />
                  <div className="h-3 w-3/5 rounded bg-slate-100" />
                  <div className="h-6 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-sm font-bold text-slate-600">No hay productos que coincidan con los filtros.</p>
            <button
              onClick={() => { setSearch(''); setLine('TODAS'); setCategory('TODOS'); setType('TODOS'); }}
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-600 transition hover:border-slate-300"
            >
              Ver todo el catálogo
            </button>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((row, index) => <CatalogCard key={`${row.code}-${row.description}`} row={row} withImages={withImages} eager={index < 8} />)}
            </div>
            {visible < filtered.length && (
              <div className="mt-8 flex flex-col items-center gap-2">
                <button
                  onClick={() => setVisible((value) => value + PAGE_SIZE)}
                  className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#ff0000]/50 hover:text-[#b91c1c]"
                >
                  Cargar más productos
                </button>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Mostrando {shown.length.toLocaleString('es-EC')} de {filtered.length.toLocaleString('es-EC')}
                </p>
              </div>
            )}
          </>
        )}

        <footer className="mt-12 border-t border-slate-200 pt-5 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
          Distribuidor Punto Pas · Catálogo informativo · Precios sujetos a cambio
        </footer>
      </main>
    </div>
  );
}
