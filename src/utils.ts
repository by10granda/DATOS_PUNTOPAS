import type { ProductOverviewRow, ProductRow } from './types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const money = (value: number) => value.toLocaleString('es-EC', { style: 'currency', currency: 'USD' });

export const percent = (value: number) => `${value.toFixed(1)}%`;

export const exportExcel = (rows: ProductRow[], fileName: string) => {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const data = rows.map((row) => ({
    Código: row.code,
    Descripción: row.description,
    Proveedor: row.provider,
    Marca: row.brand,
    Línea: row.line,
    Categoría: row.category,
    Tipo: row.type,
    'Stock Total': row.stockTotal,
    ...Object.fromEntries(warehouseColumns.map((warehouse) => [warehouse, row.warehouseStocks?.[warehouse] ?? 0])),
    'Cantidad Vendida': row.salesXMonths,
    fecha_venta: row.saleDate || 'NO CONSTA',
    'Ganancia Unitaria': row.unitProfit,
    'Ganancia Total': row.totalProfit,
    'Última Compra': row.lastPurchase,
    'Costo Proveedor': row.costProvider,
    'Costo + IVA': row.costWithIva,
    'Costo Público': row.publicCost,
    precio_venta: row.salePrice || 'NO CONSTA',
    'Costo Público + IVA': row.publicCostWithIva,
    'Precio Actual': row.currentPriceWithIva,
    'Precio Punto PAS': row.pricePuntoPas,
    'Precio PVP': row.pricePvp ?? 'NO CONSTA',
    'Margen %': row.marginPercent,
    'Margen Actual %': row.currentMarginPercent,
    Rotación: row.rotation,
    'Estado Inventario': row.inventoryState,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportPdf = (rows: ProductRow[], title: string) => {
  const warehouseColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.warehouseStocks ?? {})))).sort((a, b) => a.localeCompare(b, 'es'));
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  autoTable(doc, {
    startY: 20,
    head: [[
      'Código', 'Descripción', 'Stock Total', ...warehouseColumns, 'Cantidad Vendida', 'fecha_venta', 'Ganancia Unitaria', 'Ganancia Total', 'Última Compra', 'Costo', 'Costo IVA', 'Precio', 'precio_venta', 'Precio IVA', 'Precio Actual', 'Margen', 'Margen Actual', 'Proveedor', 'Rotación', 'Estado'
    ]],
    body: rows.map((row) => [
      row.code,
      row.description,
      row.stockTotal,
      ...warehouseColumns.map((warehouse) => row.warehouseStocks?.[warehouse] ?? 0),
      row.salesXMonths,
      row.saleDate || 'NO CONSTA',
      row.unitProfit.toFixed(2),
      row.totalProfit.toFixed(2),
      row.lastPurchase,
      row.costProvider.toFixed(2),
      row.costWithIva.toFixed(2),
      row.publicCost.toFixed(2),
      row.salePrice ? row.salePrice.toFixed(2) : 'NO CONSTA',
      row.publicCostWithIva.toFixed(2),
      row.currentPriceWithIva.toFixed(2),
      row.marginPercent.toFixed(1),
      row.currentMarginPercent.toFixed(1),
      row.provider,
      row.rotation.toFixed(2),
      row.inventoryState
    ])
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
