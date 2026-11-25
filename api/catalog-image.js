export const maxDuration = 30;

const ASSET_BASE = 'https://assets.distribuidor-puntopas.com/PRODUCTOS_ESMERALDAS2';
const FILE_PATTERN = /^(\d{1,8})_E\.png$/i;

/**
 * Same-origin proxy for the catalog pictures. The asset host does not send CORS
 * headers, so the browser cannot read the bytes to embed them in a PDF.
 */
export default async function handler(req, res) {
  const raw = Array.isArray(req.query.file) ? req.query.file[0] : req.query.file;
  const match = typeof raw === 'string' ? raw.match(FILE_PATTERN) : null;
  if (!match) {
    res.status(400).json({ message: 'Imagen no válida' });
    return;
  }

  const file = `${match[1].padStart(8, '0')}_E.png`;
  try {
    const upstream = await fetch(`${ASSET_BASE}/${file}`, { signal: AbortSignal.timeout(20000) });
    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(upstream.status).end();
      return;
    }
    const image = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(image);
  } catch {
    res.status(502).json({ message: 'No se pudo obtener la imagen' });
  }
}
