import type { ProductRow } from './types';
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
    Proveedor: row.provider,
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
