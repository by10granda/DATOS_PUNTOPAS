import type { CatalogProduct } from './types';

// Only the first branch publishes product pictures today. The rest show a
// placeholder until their asset endpoint is available.
const imageBase = 'https://assets.distribuidor-puntopas.com/PRODUCTOS_ESMERALDAS2';

/**
 * Builds the asset URL for a product picture. Codes must be numeric so a code
 * like `PAS054` never resolves to an unrelated product image.
 */
export const catalogImageUrl = (code: string): string | null => {
  if (!/^\d{1,8}$/.test(code)) return null;
  return `${imageBase}/${code.padStart(8, '0')}_E.png`;
};

export type CatalogPdfGroup = 'line' | 'category' | 'type';
export type CatalogPdfGrouping = CatalogPdfGroup | 'none';

const moneyValue = (value: number) => `$ ${value.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const safeFileName = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

export const buildCatalogPdf = async (
  rows: CatalogProduct[],
  options: { branch: string; grouping: CatalogPdfGrouping; filterLabel: string },
) => {
  const [jsPdfModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // The browser build exposes the constructor as `default`, while Node's CJS
  // interop exposes it as the named `jsPDF` export.
  const jsPDF = typeof jsPdfModule.default === 'function' ? jsPdfModule.default : jsPdfModule.jsPDF;
  const autoTable = typeof autoTableModule.default === 'function' ? autoTableModule.default : autoTableModule.autoTable;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generated = new Date().toLocaleString('es-EC', { dateStyle: 'long', timeStyle: 'short' });

  const drawHeader = () => {
    doc.setFillColor(11, 31, 58);
    doc.rect(0, 0, pageWidth, 20, 'F');
    doc.setFillColor(255, 0, 0);
    doc.rect(0, 20, pageWidth, 1.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PUNTO PAS', 12, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('CATALOGO DE PRODUCTOS', 12, 14.5);
    doc.setFontSize(8.5);
    doc.text(options.branch, pageWidth - 12, 9, { align: 'right' });
    doc.setFontSize(6.8);
    doc.text(generated, pageWidth - 12, 14.5, { align: 'right' });
    doc.setTextColor(15, 23, 42);
  };

  drawHeader();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(11, 31, 58);
  doc.text('Catalogo de productos', 12, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${rows.length} producto${rows.length === 1 ? '' : 's'} · Precios con IVA incluido`, 12, 35.5);
  if (options.filterLabel) doc.text(options.filterLabel.slice(0, 120), 12, 40);
  doc.setTextColor(15, 23, 42);

  const groups = (() => {
    if (options.grouping === 'none') return [{ title: '', rows }];
    const grouped = new Map<string, CatalogProduct[]>();
    for (const row of rows) {
      const key = (row[options.grouping] || 'SIN DATO').trim() || 'SIN DATO';
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([title, items]) => ({ title, rows: items }));
  })();

  let cursor = options.filterLabel ? 46 : 41;
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor;

  groups.forEach((group, index) => {
    if (index > 0) {
      const previous = lastY();
      if (previous > pageHeight - 42) {
        doc.addPage();
        drawHeader();
        cursor = 28;
      } else {
        cursor = previous + 9;
      }
      if (options.grouping !== 'none') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(185, 28, 28);
        doc.text(group.title, 12, cursor);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(12, cursor + 1.6, pageWidth - 12, cursor + 1.6);
        doc.setTextColor(15, 23, 42);
        cursor += 5.5;
      }
    } else if (options.grouping !== 'none' && group.title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(185, 28, 28);
      doc.text(group.title, 12, cursor);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(12, cursor + 1.6, pageWidth - 12, cursor + 1.6);
      doc.setTextColor(15, 23, 42);
      cursor += 5.5;
    }

    autoTable(doc, {
      startY: cursor,
      head: [['CÓDIGO', 'DESCRIPCIÓN', 'PRECIO']],
      body: group.rows.map((row) => [
        row.code,
        row.description,
        row.priceAvailable ? moneyValue(row.price) : 'CONSULTAR',
      ]),
      margin: { top: 25, left: 12, right: 12, bottom: 16 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.15 },
      headStyles: { fillColor: [11, 31, 58], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 247, 251] },
      columnStyles: {
        0: { cellWidth: 27 },
        1: { cellWidth: 119 },
        2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
      },
      didDrawPage: () => drawHeader(),
    });
    cursor = lastY() + 6;
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Distribuidor Punto PAS · Precios con IVA incluido', 12, pageHeight - 8);
    doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 12, pageHeight - 8, { align: 'right' });
  }

  const suffix = options.grouping === 'none' ? 'completo' : `por-${options.grouping === 'line' ? 'linea' : options.grouping === 'category' ? 'categoria' : 'tipo'}`;
  return { doc, fileName: `catalogo-${safeFileName(options.branch)}-${suffix}.pdf` };
};

export const exportCatalogPdf = async (
  rows: CatalogProduct[],
  options: { branch: string; grouping: CatalogPdfGrouping; filterLabel: string },
) => {
  const { doc, fileName } = await buildCatalogPdf(rows, options);
  doc.save(fileName);
};
