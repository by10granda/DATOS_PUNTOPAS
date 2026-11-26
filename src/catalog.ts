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

/**
 * Same-origin URL used by the PDF generator. The browser cannot read the
 * remote picture bytes directly because the asset host does not send CORS
 * headers, so a small proxy serves them.
 */
export const catalogPdfImageUrl = (code: string): string | null => {
  if (!/^\d{1,8}$/.test(code)) return null;
  return `/api/branches?image=${code.padStart(8, '0')}_E.png`;
};

export type CatalogPdfGroup = 'line' | 'category' | 'type';
export type CatalogPdfGrouping = CatalogPdfGroup | 'none';
export type CatalogPdfMode = 'visual' | 'list';
export type CatalogPdfProgress = (done: number, total: number) => void;

export type CatalogPdfOptions = {
  branch: string;
  grouping: CatalogPdfGrouping;
  filterLabel: string;
  mode?: CatalogPdfMode;
  includeImages?: boolean;
  limit?: number;
  totalRows?: number;
  onProgress?: CatalogPdfProgress;
};

type CatalogImage = { dataUrl: string; width: number; height: number };

const moneyValue = (value: number) => `$ ${value.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const safeFileName = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const groupRows = (rows: CatalogProduct[], grouping: CatalogPdfGrouping) => {
  if (grouping === 'none') return [{ title: '', rows }];
  const grouped = new Map<string, CatalogProduct[]>();
  for (const row of rows) {
    const key = (row[grouping] || 'SIN DATO').trim() || 'SIN DATO';
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([title, items]) => ({ title, rows: items }));
};

const stockOf = (row: CatalogProduct) => Object.values(row.warehouseStocks ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);

/** A product belongs in the stock-only PDF when its total on hand is positive. */
export const hasCatalogStock = (row: CatalogProduct): boolean => {
  const total = typeof row.stockTotal === 'number' ? row.stockTotal : stockOf(row);
  return total > 0;
};

const pdfImageCache = new Map<string, CatalogImage | null>();

const toCatalogImage = async (blob: Blob): Promise<CatalogImage> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo leer la imagen'));
      element.src = objectUrl;
    });
    const naturalWidth = image.naturalWidth || 480;
    const naturalHeight = image.naturalHeight || 480;
    const scale = Math.min(1, 520 / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const loadCatalogImage = async (code: string): Promise<CatalogImage | null> => {
  if (pdfImageCache.has(code)) return pdfImageCache.get(code) ?? null;
  const url = catalogPdfImageUrl(code);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const image = await toCatalogImage(await response.blob());
    pdfImageCache.set(code, image);
    return image;
  } catch {
    pdfImageCache.set(code, null);
    return null;
  }
};

const preloadCatalogImages = async (rows: CatalogProduct[], onProgress?: CatalogPdfProgress) => {
  const images = new Map<string, CatalogImage | null>();
  if (!rows.length) return images;
  let next = 0;
  let done = 0;
  onProgress?.(0, rows.length);
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next];
      next += 1;
      images.set(row.code, await loadCatalogImage(row.code));
      done += 1;
      onProgress?.(done, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, () => worker()));
  return images;
};

const drawListCatalog = (
  doc: import('jspdf').jsPDF,
  rows: CatalogProduct[],
  options: CatalogPdfOptions,
  generated: string,
  autoTable: typeof import('jspdf-autotable').default,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

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

  const groups = groupRows(rows, options.grouping);

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
};

const drawVisualCatalog = async (
  doc: import('jspdf').jsPDF,
  rows: CatalogProduct[],
  options: CatalogPdfOptions,
  generated: string,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentTop = 27;
  const contentBottom = pageHeight - 14;
  const gap = 5;
  const columns = 3;
  const cardWidth = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
  const cardHeight = 72;
  const imageHeight = 36;

  const drawHeader = () => {
    doc.setFillColor(11, 31, 58);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setFillColor(255, 0, 0);
    doc.rect(0, 18, pageWidth, 1.4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('PUNTO PAS', margin, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.text('CATÁLOGO DE PRODUCTOS', margin, 13.2);
    doc.setFontSize(7.5);
    doc.text(options.branch, pageWidth - margin, 8, { align: 'right' });
    doc.setFontSize(6.2);
    doc.text(generated, pageWidth - margin, 13.2, { align: 'right' });
    doc.setTextColor(15, 23, 42);
  };

  // Cover page
  doc.setFillColor(11, 31, 58);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  doc.setFillColor(255, 0, 0);
  doc.rect(0, 0, 6, pageHeight, 'F');
  doc.setFillColor(16, 45, 132);
  doc.rect(pageWidth - 54, 0, 54, pageHeight, 'F');

  doc.setFillColor(255, 0, 0);
  doc.roundedRect(margin, 14, 13, 13, 2.5, 2.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PP', margin + 6.5, 22.4, { align: 'center' });
  doc.setFontSize(14);
  doc.text('PUNTO PAS', margin + 18, 21);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(203, 213, 225);
  doc.text('DISTRIBUIDOR', margin + 18, 26);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(36);
  doc.text('CATÁLOGO', margin, 102);
  doc.setTextColor(255, 90, 90);
  doc.setFontSize(17);
  doc.text('DE PRODUCTOS', margin, 114);
  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Precios con IVA incluido', margin, 126);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(options.branch.toUpperCase(), margin, 148);
  doc.setDrawColor(255, 0, 0);
  doc.setLineWidth(0.8);
  doc.line(margin, 152.5, margin + 70, 152.5);

  const totalRows = options.totalRows ?? rows.length;
  if (totalRows > rows.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(`Muestra de ${rows.length.toLocaleString('es-EC')} de ${totalRows.toLocaleString('es-EC')} productos`, margin, 160);
  }

  const cardY = 168;
  const cardHeightCover = 46;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, cardY, pageWidth - margin * 2, cardHeightCover, 5, 5, 'F');
  const stats = [
    { label: 'PRODUCTOS', value: rows.length.toLocaleString('es-EC') },
    { label: 'CON STOCK', value: rows.filter((row) => stockOf(row) > 0).length.toLocaleString('es-EC') },
    { label: 'MONEDA', value: 'USD' },
  ];
  stats.forEach((stat, index) => {
    const x = margin + 8 + index * ((pageWidth - margin * 2 - 16) / 3);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(stat.label, x, cardY + 13);
    doc.setFontSize(16);
    doc.setTextColor(11, 31, 58);
    doc.text(stat.value, x, cardY + 30);
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  const filterLines = doc.splitTextToSize(options.filterLabel || 'Catálogo completo', pageWidth - margin * 2 - 12).slice(0, 2);
  filterLines.forEach((line: string, index: number) => doc.text(line, margin, 230 + index * 4));
  doc.setFontSize(6.8);
  doc.text(`Generado: ${generated}`, margin, 246);

  doc.setDrawColor(71, 85, 105);
  doc.setLineWidth(0.3);
  doc.line(margin, 262, pageWidth - margin, 262);
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text('DISTRIBUIDOR PUNTO PAS · CATÁLOGO INFORMATIVO · PRECIOS SUJETOS A CAMBIO', margin, 268);

  const images = options.includeImages ? await preloadCatalogImages(rows, options.onProgress) : new Map<string, CatalogImage | null>();
  const groups = groupRows(rows, options.grouping);

  let y = contentTop;
  let column = 0;

  const drawGroupTitle = (title: string, atY: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(185, 28, 28);
    doc.text(title.toUpperCase().slice(0, 80), margin, atY + 4);
    doc.setDrawColor(255, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(margin, atY + 6, margin + 20, atY + 6);
    doc.setTextColor(15, 23, 42);
  };

  const drawCard = (row: CatalogProduct, x: number, atY: number, image: CatalogImage | null) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, atY, cardWidth, cardHeight, 2.2, 2.2, 'FD');

    const boxX = x + 2;
    const boxY = atY + 2;
    const boxWidth = cardWidth - 4;
    const boxHeight = imageHeight;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 1.5, 1.5, 'F');

    if (image) {
      const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      doc.addImage(image.dataUrl, 'JPEG', boxX + (boxWidth - drawWidth) / 2, boxY + (boxHeight - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.6);
      doc.setTextColor(148, 163, 184);
      doc.text('SIN IMAGEN', boxX + boxWidth / 2, boxY + boxHeight / 2 + 1, { align: 'center' });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139);
    doc.text(row.code, x + 2.5, atY + 43);

    doc.setFontSize(6.8);
    doc.setTextColor(30, 41, 59);
    const descriptionLines = doc.splitTextToSize(row.description, cardWidth - 5);
    const shownLines = descriptionLines.slice(0, 2);
    if (descriptionLines.length > 2) shownLines[1] = `${shownLines[1].replace(/\s+\S*$/, '')}…`;
    shownLines.forEach((line: string, index: number) => doc.text(line, x + 2.5, atY + 47 + index * 3.2));

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.4);
    doc.setTextColor(148, 163, 184);
    doc.text('IVA incl.', x + 2.5, atY + cardHeight - 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(11, 31, 58);
    doc.text(row.priceAvailable ? moneyValue(row.price) : 'CONSULTAR', x + cardWidth - 2.5, atY + cardHeight - 4.5, { align: 'right' });
    doc.setTextColor(15, 23, 42);
  };

  const startPage = (title?: string) => {
    doc.addPage();
    drawHeader();
    y = contentTop;
    column = 0;
    if (title && options.grouping !== 'none') {
      drawGroupTitle(title, y);
      y += 9;
    }
  };

  startPage();

  for (const group of groups) {
    const title = options.grouping === 'none' ? '' : group.title;
    if (column > 0) {
      y += cardHeight + gap;
      column = 0;
    }
    if (title) {
      if (y + 9 + cardHeight > contentBottom) {
        startPage(`${title} · CONT.`);
      } else {
        drawGroupTitle(title, y);
        y += 9;
      }
    }

    for (const row of group.rows) {
      if (y + cardHeight > contentBottom) {
        startPage(title ? `${title} · CONT.` : undefined);
      }
      drawCard(row, margin + column * (cardWidth + gap), y, images.get(row.code) ?? null);
      column += 1;
      if (column === columns) {
        column = 0;
        y += cardHeight + gap;
      }
    }

    if (column > 0) {
      y += cardHeight + gap;
      column = 0;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 2; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(148, 163, 184);
    doc.text('Distribuidor Punto PAS · Precios con IVA incluido', margin, pageHeight - 7);
    doc.text(`Página ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }
};

export const buildCatalogPdf = async (rows: CatalogProduct[], options: CatalogPdfOptions) => {
  const [jsPdfModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // The browser build exposes the constructor as `default`, while Node's CJS
  // interop exposes it as the named `jsPDF` export.
  const jsPDF = typeof jsPdfModule.default === 'function' ? jsPdfModule.default : jsPdfModule.jsPDF;
  const autoTable = typeof autoTableModule.default === 'function' ? autoTableModule.default : autoTableModule.autoTable;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const generated = new Date().toLocaleString('es-EC', { dateStyle: 'long', timeStyle: 'short' });
  const suffix = options.grouping === 'none' ? 'completo' : `por-${options.grouping === 'line' ? 'linea' : options.grouping === 'category' ? 'categoria' : 'tipo'}`;

  if (options.mode === 'visual') {
    const limited = options.limit && options.limit > 0 ? rows.slice(0, options.limit) : rows;
    await drawVisualCatalog(doc, limited, options, generated);
    return { doc, fileName: `catalogo-visual-${safeFileName(options.branch)}-${suffix}.pdf` };
  }

  drawListCatalog(doc, rows, options, generated, autoTable);
  return { doc, fileName: `catalogo-${safeFileName(options.branch)}-${suffix}.pdf` };
};

export const exportCatalogPdf = async (rows: CatalogProduct[], options: CatalogPdfOptions) => {
  const { doc, fileName } = await buildCatalogPdf(rows, options);
  doc.save(fileName);
};
