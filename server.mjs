import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress as brotliCompressWithDictionary } from 'brotli-compress';

const root = fileURLToPath(new URL('./', import.meta.url));
const publicRoot = join(root, 'public');
const port = Number(process.env.PORT || 4178);
const dictionary = await readFile(join(publicRoot, 'catalog-dictionary.txt'));
const dictionaryHash = createHash('sha256').update(dictionary).digest();
const dictionaryHashSf = `:${dictionaryHash.toString('base64')}:`;
const rows = [
  { id: 1, title: 'The quiet side of Bali', description: 'A sunlit hideaway tucked between rice fields and the coast.', category: 'Stay', location: 'Ubud, Indonesia', price: 128, rating: 4.92, image: '/images/bali-studio.jpg' },
  { id: 2, title: 'Old town, new light', description: 'Walkable streets, late coffee, and a balcony above the city.', category: 'City guide', location: 'Jakarta, Indonesia', price: 86, rating: 4.87, image: '/images/jakarta-loft.jpg' },
  { id: 3, title: 'A slower kind of morning', description: 'Wake up to mountain air in a small timber cabin.', category: 'Stay', location: 'Bandung, Indonesia', price: 104, rating: 4.96, image: '/images/bandung-home.jpg' },
  { id: 4, title: 'Blue hour by the water', description: 'A weekend escape built around long walks and fresh seafood.', category: 'Weekend', location: 'Surabaya, Indonesia', price: 112, rating: 4.89, image: '/images/surabaya-suite.jpg' },
  { id: 5, title: 'A little room to breathe', description: 'Warm wood, open windows, and a view over the rooftops.', category: 'Stay', location: 'Yogyakarta, Indonesia', price: 79, rating: 4.91, image: '/images/bali-studio.jpg' },
  { id: 6, title: 'The coast at your pace', description: 'A bright base for quiet beaches and unplanned afternoons.', category: 'Weekend', location: 'Lombok, Indonesia', price: 142, rating: 4.95, image: '/images/surabaya-suite.jpg' },
];
const dataset = { items: rows, page: 1, total: rows.length, updatedAt: '2026-10-10T08:00:00Z' };
// Repeated realistic response fields make the cross-response dictionary effect visible.
dataset.recommendations = Array.from({ length: 18 }, (_, index) => ({
  id: `rec-${index + 1}`, title: rows[index % rows.length].title,
  description: rows[index % rows.length].description, category: rows[index % rows.length].category,
  location: rows[index % rows.length].location, image: rows[index % rows.length].image,
  rating: rows[index % rows.length].rating, price: rows[index % rows.length].price,
  highlights: ['free cancellation', 'local host', 'walkable location'],
}));
const brotli = (input) => brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
const json = (value) => Buffer.from(JSON.stringify(value));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8' };
const accepts = (header, coding) => header?.split(',').some((part) => part.trim().split(';')[0] === coding);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/items') {
    const requestedMode = ['identity', 'gzip', 'br', 'dictionary'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'br';
    const original = json(dataset);
    const availableDictionary = req.headers['available-dictionary'];
    const hasDictionary = availableDictionary === dictionaryHashSf
      && req.headers['dictionary-id'] === '"catalog-v1"'
      && accepts(req.headers['accept-encoding'], 'dcb');
    let body = original;
    let encoding = 'identity';

    if (requestedMode === 'gzip') { body = gzipSync(original, { level: 6 }); encoding = 'gzip'; }
    else if (requestedMode === 'br') { body = brotli(original); encoding = 'br'; }
    else if (requestedMode === 'dictionary') {
      if (hasDictionary) {
        const stream = await brotliCompressWithDictionary(original, { quality: 5, customDictionary: new Uint8Array(dictionary) });
        // RFC 9842 dcb framing: magic bytes, SHA-256(dictionary), then Brotli stream.
        body = Buffer.concat([Buffer.from([0xff, 0x44, 0x43, 0x42]), dictionaryHash, Buffer.from(stream)]);
        encoding = 'dcb';
      } else if (accepts(req.headers['accept-encoding'], 'br')) {
        body = brotli(original); encoding = 'br';
      } else if (accepts(req.headers['accept-encoding'], 'gzip')) {
        body = gzipSync(original, { level: 6 }); encoding = 'gzip';
      }
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(encoding !== 'identity' ? { 'Content-Encoding': encoding } : {}),
      'Cache-Control': 'no-store',
      'Vary': 'Accept-Encoding, Available-Dictionary, Dictionary-ID',
      'Access-Control-Expose-Headers': 'X-Original-Bytes, X-Wire-Bytes, X-Demo-Mode, X-Dictionary-Hash, X-Dictionary-Bytes',
      'X-Original-Bytes': String(original.length), 'X-Wire-Bytes': String(body.length), 'X-Dictionary-Bytes': String(dictionary.length),
      'X-Demo-Mode': encoding,
      ...(encoding === 'dcb' ? { 'X-Dictionary-Hash': dictionaryHash.toString('hex') } : {}),
    });
    res.end(body);
    return;
  }
  if (url.pathname === '/api/dictionary') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Use-As-Dictionary': 'match="/api/items*", id="catalog-v1"',
      'X-Dictionary-Hash': dictionaryHash.toString('hex'),
    });
    res.end(dictionary);
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = normalize(join(publicRoot, requested));
  if (!path.startsWith(publicRoot)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', ...(requested === '/index.html' ? { 'Link': '</api/dictionary>; rel="compression-dictionary"' } : {}) });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});

server.listen(port, () => console.log(`Compression demo running at http://localhost:${port}`));
