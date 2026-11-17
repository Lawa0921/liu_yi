import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREST_OUTPUT, CREST_SOURCE, CREST_WIDTH, renderCrest } from './render-crest';

/** `npm run crest:build`：開發者本機指令，由 logo_large.jpg 重建透明底的金色館徽（入庫成品，CI 不跑）。 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await renderCrest({ input: await readFile(join(root, CREST_SOURCE)), width: CREST_WIDTH });
await writeFile(join(root, CREST_OUTPUT), result.png);
console.log(`${CREST_OUTPUT}：${result.width}×${result.height}、${(result.png.length / 1024).toFixed(1)} KB`);
