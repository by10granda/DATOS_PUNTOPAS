import type { ProductOverviewRow, ProductRow } from './types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const money = (value: number) => value.toLocaleString('es-EC', { style: 'currency', currency: 'USD' });

export const percent = (value: number) => `${value.toFixed(1)}%`;
export const percentTwo = (value: number) => `${value.toFixed(2)}%`;
export const twoDecimals = (value: number) => value.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ExportOptions = { periodLabel?: string };

const buildProductExport = (rows: ProductRow[]) => {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const headers = ['Código', 'Descripción', 'Marca', 'Línea', 'Categoría', 'Tipo', 'Cantidad Vendida', 'fecha_venta', 'Precio Punto PAS', 'Precio PVP', 'Proveedor', 'Costo Proveedor', 'Costo + IVA', 'precio_venta', 'Costo Público + IVA', 'Precio Actual', 'Fecha Última Compra', 'Cantidad Última Compra', 'Stock Total', ...warehouseColumns, 'Margen Ganancia %', 'Margen Actual %'];
  const body = rows.map((row) => [
    row.code,
    row.description,
    row.brand,
    row.line,
    row.category,
    row.type,
    row.salesXMonths,
    row.saleDate || 'NO CONSTA',
    row.pricePuntoPas,
    row.pricePvp ?? 'NO CONSTA',
    row.provider,
    row.costProvider,
    row.costWithIva,
    row.salePrice || 'NO CONSTA',
    row.publicCostWithIva,
    row.currentPriceWithIva,
    row.lastPurchase || 'NO CONSTA',
    row.lastPurchaseQuantity,
    row.stockTotal,
    ...warehouseColumns.map((warehouse) => row.warehouseStocks?.[warehouse] ?? 0),
    Number(row.marginPercent.toFixed(1)),
    Number(row.currentMarginPercent.toFixed(2)),
  ]);
  return { headers, body };
};

export const exportExcel = (rows: ProductRow[], fileName: string, options: ExportOptions = {}) => {
  const { headers, body } = buildProductExport(rows);
  const titleRows = options.periodLabel ? [
    ['DETALLE EJECUTIVO DIARIO'],
    [`Rango de fechas: ${options.periodLabel}`],
    [],
  ] : [];
  const worksheet = XLSX.utils.aoa_to_sheet([...titleRows, headers, ...body]);
  worksheet['!cols'] = headers.map((header) => ({ wch: header === 'Descripción' ? 48 : Math.max(12, Math.min(24, header.length + 4)) }));
  if (options.periodLabel) worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, headers.length - 1) } }, { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, headers.length - 1) } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportPdf = (rows: ProductRow[], title: string, options: ExportOptions = {}) => {
  const { headers, body } = buildProductExport(rows);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  if (options.periodLabel) {
    doc.setFontSize(9);
    doc.text(`Rango de fechas: ${options.periodLabel}`, 14, 20);
  }
  autoTable(doc, {
    startY: options.periodLabel ? 25 : 20,
    styles: { fontSize: 5.4, cellPadding: 1.1, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [headers],
    body,
  });
  doc.save(`${title}.pdf`);
};

export const exportOverviewExcel = (rows: ProductOverviewRow[], fileName: string) => {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const data = rows.map((row) => ({
    Código: row.code,
    Descripción: row.description,
    Marca: row.brand,
    Línea: row.line,
    Categoría: row.category,
    Tipo: row.type,
    'Stock Total': row.stockTotal,
    ...Object.fromEntries(warehouseColumns.map((warehouse) => [warehouse, row.warehouseStocks?.[warehouse] ?? 0])),
    'Unidades Vendidas': row.salesXMonths,
    'Precio Vendido': row.soldPrice || 'NO CONSTA',
    'Valor Vendido': row.valueSold,
    'Valor Comprado Proveedor': row.providerPurchaseValue,
    'Valor Comprado Proveedor + IVA': row.providerPurchaseValueWithIva,
    Utilidad: row.totalProfit,
    'Margen %': row.marginPercent,
    Rotación: row.rotation,
    'Cobertura Días': row.coverageDays >= 999 ? '999+' : row.coverageDays,
    'Días Sin Venta': row.daysSinceLastSale >= 999 ? '999+' : row.daysSinceLastSale,
    ABC: row.abcClass,
    XYZ: row.xyzClass,
    Pareto: row.pareto ? '80/20' : 'No',
    Tendencia: row.trend,
    'Variación Tendencia %': row.trendPercent,
    Score: row.smartScore,
    Estado: row.inventoryState,
    'Capital Inmovilizado': row.immobilizedCapital,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Object.keys(data[0] ?? {}).length - 1 } }) };
  worksheet['!cols'] = Object.keys(data[0] ?? {}).map((key) => ({ wch: Math.max(12, Math.min(38, key.length + 4)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tabla BI');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportOverviewPdf = (rows: ProductOverviewRow[], title: string) => {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  doc.setFontSize(15);
  doc.text(title, 14, 14);
  doc.setFontSize(9);
  doc.text(`Productos exportados: ${rows.length.toLocaleString('es-EC')}`, 14, 20);
  autoTable(doc, {
    startY: 25,
    styles: { fontSize: 6, cellPadding: 1.4, overflow: 'linebreak' },
    headStyles: { fillColor: [6, 26, 36], textColor: [37, 255, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    head: [[
      'Código', 'Descripción', 'Proveedor', 'Marca', 'Línea', 'Categoría', 'Tipo', 'Stock Total', ...warehouseColumns, 'Unidades', 'Precio Vendido', 'Valor Vendido', 'Valor Comprado', 'Valor Comprado + IVA', 'Utilidad', 'Margen', 'Rotación', 'Cobertura', 'Días Sin Venta', 'ABC', 'XYZ', 'Pareto', 'Tendencia', 'Score', 'Estado'
    ]],
    body: rows.map((row) => [
      row.code,
      row.description,
      row.provider,
      row.brand,
      row.line,
      row.category,
      row.type,
      row.stockTotal,
      ...warehouseColumns.map((warehouse) => row.warehouseStocks?.[warehouse] ?? 0),
      row.salesXMonths,
      row.soldPrice ? row.soldPrice.toFixed(2) : 'NO CONSTA',
      row.valueSold.toFixed(2),
      row.providerPurchaseValue.toFixed(2),
      row.providerPurchaseValueWithIva.toFixed(2),
      row.totalProfit.toFixed(2),
      row.marginPercent.toFixed(1),
      row.rotation.toFixed(2),
      row.coverageDays >= 999 ? '999+' : row.coverageDays.toFixed(0),
      row.daysSinceLastSale >= 999 ? '999+' : row.daysSinceLastSale,
      row.abcClass,
      row.xyzClass,
      row.pareto ? '80/20' : 'No',
      `${row.trend} ${row.trendPercent.toFixed(1)}%`,
      row.smartScore.toFixed(1),
      row.inventoryState,
    ]),
  });
  doc.save(`${title}.pdf`);
};
