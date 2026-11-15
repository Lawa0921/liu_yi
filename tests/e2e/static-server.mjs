// 端對端測試用的靜態檔案伺服器：把建置好的資料夾掛在指定的 base 路徑下，行為仿 GitHub Pages
// （資料夾網址回 index.html、找不到回 404.html 與 404 狀態碼、base 以外一律 404）。
// 不用 `astro preview` 是因為它同一個專案同時只能開一個，而測試要同時服務 /liu_yi 與 / 兩份建置。
//
//   node tests/e2e/static-server.mjs --dir dist --base /liu_yi --port 4391

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'dist' },
    base: { type: 'string', default: '/' },
    port: { type: 'string', default: '4391' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const root = resolve(values.dir);
const segments = values.base.split('/').filter(Boolean);
const base = segments.length === 0 ? '/' : `/${segments.join('/')}/`;

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

/** @param {string} path */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * 網址路徑 → 檔案路徑；不在 base 底下、跳出根目錄、或檔案不存在時回 undefined。
 * @param {string} pathname
 */
async function resolveFile(pathname) {
  if (pathname === base.slice(0, -1)) pathname = base;
  if (!pathname.startsWith(base)) return undefined;

  const relative = normalize(decodeURIComponent(pathname.slice(base.length)));
  const candidate = join(root, relative);
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;

  if (pathname.endsWith('/')) {
    const index = join(candidate, 'index.html');
    return (await isFile(index)) ? index : undefined;
  }
  return (await isFile(candidate)) ? candidate : undefined;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file = await resolveFile(pathname);
  let status = 200;

  if (!file) {
    status = 404;
    const notFound = join(root, '404.html');
    file = (await isFile(notFound)) ? notFound : undefined;
  }

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  res.writeHead(status, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(await readFile(file));
});

server.listen(Number(values.port), values.host, () => {
  console.log(`serving ${root} at http://${values.host}:${values.port}${base}`);
});
