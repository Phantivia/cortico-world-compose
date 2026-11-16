// Panel bundle: src/webui/client.ts -> dist/webui.js + dist/webui.css, the two files package.json names in
// cortico.webUiClient / webUiStyle. Browser code may only `import type` from cortico/*; a "Could not resolve
// cortico/…" error here means a runtime import slipped in.
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = `${root}dist`;
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
const result = await esbuild.build({
  entryPoints: [{ in: `${root}src/webui/client.ts`, out: 'webui' }],
  outdir, bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, metafile: true,
});
for (const [path, info] of Object.entries(result.metafile.outputs)) console.log(`${path.replace(/\\/g, '/')}  ${(info.bytes / 1024).toFixed(1)} KB`);
