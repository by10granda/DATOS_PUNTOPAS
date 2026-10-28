import XLSX from 'xlsx';

const branchSlug = (branch) => branch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SUCURSAL';
const localDate = (value) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export function createMadereraStockReport({ branch, rows, now = new Date() }) {
  if (branch !== 'VARIEDADES PAS' || !Array.isArray(rows) || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Datos invalidos para el reporte de Maderera');
  }
  const selected = rows.filter((row) => Number.isFinite(row.galponMaderera) && row.galponMaderera > 0)
    .sort((a, b) => b.galponMaderera - a.galponMaderera || String(a.code).localeCompare(String(b.code), 'es'));
  const date = localDate(now);
  const table = [
    ['Sucursal', branch],
    ['Corte', `${now.toLocaleString('en-CA', { timeZone: 'America/Guayaquil', hourCycle: 'h23' })} America/Guayaquil`],
    ['Criterio', 'Stock GALPON MADERERA mayor que 0'],
    ['Productos incluidos', selected.length],
    [],
    ['Codigo', 'Descripcion', 'Stock BODEGA GENERAL SL', 'Stock EXHIBICION', 'Stock GALPON MADERERA'],
    ...selected.map((row) => [String(row.code), row.description || 'NO HAY', row.bodegaGeneralSl, row.exhibicion, row.galponMaderera]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!autofilter'] = { ref: `A6:E${6 + selected.length}` };
  sheet['!cols'] = [{ wch: 18 }, { wch: 54 }, { wch: 28 }, { wch: 24 }, { wch: 30 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Stock Maderera');
  return {
    branch,
    count: selected.length,
    filename: `Stock_Maderera_${branchSlug(branch)}_${date}.xlsx`,
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
    captionLines: [
      `Sucursal: ${branch}`,
      `Productos con stock en GALPON MADERERA: ${selected.length}`,
      `Corte: ${now.toISOString()}`,
    ],
  };
}
