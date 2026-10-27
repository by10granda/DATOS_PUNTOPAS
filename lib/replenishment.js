import XLSX from 'xlsx';

const DAY = 86_400_000;
const ZONE = 'America/Guayaquil';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const localFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const localParts = (date) => Object.fromEntries(localFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
const dayKey = (date) => {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
};

export function resolveReportRange(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Invalid now');
  const dateEnd = dayKey(now);
  const [year, month] = dateEnd.split('-').map(Number);
  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 4 + i, 1));
    return { key: d.toISOString().slice(0, 7), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
  const dateStart = `${months[0].key}-01`;
  const dayKeys = [];
  for (let t = Date.parse(`${dateStart}T00:00:00Z`); t <= Date.parse(`${dateEnd}T00:00:00Z`); t += DAY) {
    dayKeys.push(new Date(t).toISOString().slice(0, 10));
  }
  return { dateStart, dateEnd, months, dayKeys, cutoff: now.toISOString() };
}

// Do not let Date.parse normalize impossible calendar dates or use the host timezone.
export function parseSaleDate(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid fecha_venta');
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!match) throw new TypeError('Invalid fecha_venta');
  const [, y, m, d, h = '00', min = '00', s = '00', fraction = '', offset = '-05:00'] = match;
  const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (calendar.toISOString().slice(0, 10) !== `${y}-${m}-${d}` || +h > 23 || +min > 59 || +s > 59) {
    throw new TypeError('Invalid fecha_venta');
  }
  if (offset !== 'Z' && offset !== 'z' && (+offset.slice(1, 3) > 23 || +offset.slice(-2) > 59)) {
    throw new TypeError('Invalid fecha_venta offset');
  }
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}${fraction}${offset.toUpperCase()}`);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid fecha_venta');
  return date;
}

export function aggregateReportSales(sales, range) {
  if (!Array.isArray(sales)) throw new TypeError('sales must be an array');
  const byCode = new Map();
  const indexes = new Map(range.dayKeys.map((key, index) => [key, index]));
  for (const sale of sales) {
    const raw = sale?.cantidad_vendida;
    if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !raw.trim()) || !Number.isFinite(Number(raw))) {
      throw new TypeError('Invalid cantidad_vendida');
    }
    if (typeof sale.codigo !== 'string' || !sale.codigo.trim()) throw new TypeError('Invalid codigo');
    const date = parseSaleDate(sale.fecha_venta);
    const key = dayKey(date);
    if (date.getTime() > Date.parse(range.cutoff) || !indexes.has(key)) continue;
    const code = sale.codigo.trim();
    if (!byCode.has(code)) byCode.set(code, { total: 0, monthly: [0, 0, 0, 0], daily: range.dayKeys.map(() => 0) });
    const entry = byCode.get(code);
    const quantity = Number(raw);
    const monthIndex = range.months.findIndex((month) => month.key === key.slice(0, 7));
    entry.total += quantity;
    entry.monthly[monthIndex] += quantity;
    entry.daily[indexes.get(key)] += quantity;
    if (![entry.total, entry.monthly[monthIndex], entry.daily[indexes.get(key)]].every(Number.isFinite)) {
      throw new TypeError('Sales total overflow');
    }
  }
  return byCode;
}

export function forecastDemand(daily) {
  if (!Array.isArray(daily) || !daily.length || !daily.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new TypeError('daily must contain finite numbers');
  }
  const mean = Math.max(0, daily.reduce((sum, n) => sum + n, 0) / daily.length);
  if (daily.length < 56) return { demandDaily: mean, mean, model: 'mean', forecast: mean, mae: {}, validation: [] };
  const values = daily.map((n) => Math.max(0, n));
  const start = daily.length - 28;
  let ses = values[0];
  let probability = values[0] > 0 ? 1 : 0;
  let size = values[0];
  let seenPositive = values[0] > 0;
  const window = [values[0]];
  const errors = { SMA28: 0, SES: 0, TSB: 0 };
  const validation = [];
  for (let i = 1; i < values.length; i++) {
    const predictions = { SMA28: window.reduce((a, b) => a + b, 0) / window.length, SES: ses, TSB: probability * size };
    const actual = values[i];
    if (i >= start) {
      validation.push({ index: i, actual, predictions });
      for (const model of Object.keys(errors)) errors[model] += Math.abs(predictions[model] - actual) / 28;
    }
    // Each forecast is scored before this day's observation updates any model.
    ses += 0.2 * (actual - ses);
    probability += 0.1 * ((actual > 0 ? 1 : 0) - probability);
    if (actual > 0) {
      size = seenPositive ? size + 0.2 * (actual - size) : actual;
      seenPositive = true;
    }
    window.push(actual);
    if (window.length > 28) window.shift();
  }
  const model = Object.keys(errors).reduce((best, next) => errors[next] < errors[best] ? next : best);
  const forecasts = { SMA28: window.reduce((a, b) => a + b, 0) / window.length, SES: ses, TSB: probability * size };
  const forecast = forecasts[model];
  return { demandDaily: Math.max(mean, forecast), mean, model, forecast, mae: errors, validation };
}

const knownNumber = (row, key) => !row.missingFields?.includes(key) && typeof row[key] === 'number' && Number.isFinite(row[key]);
const field = (row, key) => {
  const value = row[key];
  return row.missingFields?.includes(key) || (typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'string' || !value.trim()) ? 'NO HAY' : value;
};

const reportHeaders = (range) => ['Codigo', 'Descripcion', 'Cantidad vendida',
  ...range.months.map((month, i) => `${month.label}${i === 3 ? ' (parcial)' : ''}`),
  'Proveedor', 'Costo+IVA', 'PrecioActual', 'StockTotal', 'MargenActual%'];

const createReportWorkbook = ({ metadata, headers, dataRows, sheetName }) => {
  const table = [...metadata, [], headers, ...dataRows];
  const sheet = XLSX.utils.aoa_to_sheet(table);
  const headerRow = metadata.length + 2;
  sheet['!autofilter'] = { ref: `A${headerRow}:L${headerRow + dataRows.length}` };
  sheet['!cols'] = headers.map((_, i) => ({ wch: i === 1 ? 48 : 23 }));
  for (let r = headerRow; r < table.length; r++) {
    for (const c of [8, 9, 11]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') {
        if (c === 11) {
          cell.v /= 100;
          cell.z = '0.00%';
        } else {
          cell.z = '"$"#,##0.00';
        }
      }
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const branchSlug = (branch) => branch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SUCURSAL';

export function selectReportRows({ branch, rows, aggregatedSales }) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const selected = [];
  let skippedUnknownStock = 0;
  for (const row of rows) {
    if (branch === 'VARIEDADES PAS' && row.code === '00000609') continue;
    const sales = aggregatedSales.get(row.code);
    if (!sales || sales.total <= 0) continue;
    if (!knownNumber(row, 'stockTotal')) {
      skippedUnknownStock++;
      continue;
    }
    const { demandDaily } = forecastDemand(sales.daily);
    const coverageDays = row.stockTotal / demandDaily;
    if (row.stockTotal <= 0 || coverageDays < 15) selected.push({ row, sales, demandDaily, coverageDays });
  }
  selected.sort((a, b) => Number(b.row.stockTotal <= 0) - Number(a.row.stockTotal <= 0)
    || a.coverageDays - b.coverageDays || b.sales.total - a.sales.total
    || (a.row.code < b.row.code ? -1 : a.row.code > b.row.code ? 1 : 0));
  return { selected, skippedUnknownStock };
}

export function createReplenishmentReport({ branch, rows, sales, now = new Date() }) {
  if (typeof branch !== 'string' || !branch.trim()) throw new TypeError('Invalid branch');
  const range = resolveReportRange(now);
  const aggregatedSales = aggregateReportSales(sales, range);
  const { selected, skippedUnknownStock } = selectReportRows({ branch, rows, aggregatedSales });
  const p = localParts(now);
  const headers = reportHeaders(range);
  const metadata = [
    ['Sucursal', branch],
    ['Rango', `${range.dateStart} a ${range.dateEnd}`],
    ['Corte', `${range.dateEnd} ${p.hour}:${p.minute}:${p.second} -05:00 (${ZONE})`],
    ['Criterio', 'Venta neta > 0; stock conocido; stock <= 0 o cobertura < 15 dias'],
    ['Stock desconocido omitido', skippedUnknownStock],
  ];
  const dataRows = selected.map(({ row, sales: totals }) => [String(row.code), field(row, 'description'), totals.total, ...totals.monthly,
    field(row, 'provider'), field(row, 'costWithIva'), field(row, 'currentPriceWithIva'), row.stockTotal, field(row, 'currentMarginPercent')]);
  return { branch, filename: `Reposicion_${branchSlug(branch)}_${range.dateEnd}.xlsx`,
    buffer: createReportWorkbook({ metadata, headers, dataRows, sheetName: 'Reposicion' }), count: selected.length,
    skippedUnknownStock, dateStart: range.dateStart, dateEnd: range.dateEnd, generatedAt: range.cutoff };
}

export function createLowMarginStockReport({ branch, rows, sales, now = new Date() }) {
  if (typeof branch !== 'string' || !branch.trim()) throw new TypeError('Invalid branch');
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const range = resolveReportRange(now);
  const aggregatedSales = aggregateReportSales(sales, range);
  const selected = rows.filter((row) => knownNumber(row, 'stockTotal') && row.stockTotal > 0
    && knownNumber(row, 'currentMarginPercent') && row.currentMarginPercent >= 1 && row.currentMarginPercent <= 10)
    .map((row) => ({ row, totals: aggregatedSales.get(row.code) ?? { total: 0, monthly: [0, 0, 0, 0] } }));
  selected.sort((a, b) => a.row.currentMarginPercent - b.row.currentMarginPercent
    || b.row.stockTotal - a.row.stockTotal
    || (a.row.code < b.row.code ? -1 : a.row.code > b.row.code ? 1 : 0));
  const p = localParts(now);
  const headers = reportHeaders(range);
  const metadata = [
    ['Sucursal', branch],
    ['Rango', `${range.dateStart} a ${range.dateEnd}`],
    ['Corte', `${range.dateEnd} ${p.hour}:${p.minute}:${p.second} -05:00 (${ZONE})`],
    ['Criterio', 'StockTotal conocido > 0; MargenActual% conocido entre 1% y 10% inclusive; ventas no requeridas'],
    ['Productos incluidos', selected.length],
  ];
  const dataRows = selected.map(({ row, totals }) => [String(row.code), field(row, 'description'), totals.total, ...totals.monthly,
    field(row, 'provider'), field(row, 'costWithIva'), field(row, 'currentPriceWithIva'), row.stockTotal, row.currentMarginPercent]);
  return {
    branch,
    filename: `Margen_1_A_10_${branchSlug(branch)}_${range.dateEnd}.xlsx`,
    buffer: createReportWorkbook({ metadata, headers, dataRows, sheetName: 'Margen 1 a 10' }),
    count: selected.length,
    dateStart: range.dateStart,
    dateEnd: range.dateEnd,
    generatedAt: range.cutoff,
    captionLines: [
      `Sucursal: ${branch}`,
      `Periodo: ${range.dateStart} a ${range.dateEnd} (4 meses, actual incluido)`,
      `Productos con stock y margen 1%-10%: ${selected.length}`,
      `Corte: ${range.cutoff}`,
    ],
  };
}
