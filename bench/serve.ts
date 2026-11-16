/**
 * Serves the WebUI with this World mounted, for looking at the Songs panel: the same headless Core as run.ts,
 * its output directory filled with songs rendered from finished benchmark runs. No request is sent, so the
 * model is never called. Playback volume is 0 and stays silent.
 *
 *   tsx bench/serve.ts [port]      then open http://127.0.0.1:<port>/
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ComposeWorld } from '../src/world.ts';
import { COMPOSE_DEFAULTS } from '../src/config.ts';
import { coopanionDir, soundfontFile } from './local.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const COOPANION = coopanionDir();
const EXTENSIONS = join(HERE, 'extensions');
const RUN = join(HERE, 'runs', '_serve');
const HOME = join(RUN, 'home'), OUT = join(RUN, 'out');
const PORT = Number(process.argv[2] ?? 17850);

rmSync(RUN, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const cfg = { ...COMPOSE_DEFAULTS, enabled: true, soundfontFile: soundfontFile(), outputDir: OUT, playbackVolume: 0 };
const world = new ComposeWorld({ cfg, dataDir: RUN });
const render = world.tools().find((t) => t.name === 'compose_render')!;
for (const run of ['staged-bossa-t2', 'staged-lofi', 'guided-birthday', 'sheet-bossa']) {
  const out = join(HERE, 'runs', run, 'out');
  const sheet = existsSync(out) ? readdirSync(out).find((f) => f.endsWith('.json') && !/\.(v\d+|levels)\.json$/.test(f)) : undefined;
  if (!sheet) continue;
  const receipt = await render.handler(JSON.parse(readFileSync(join(out, sheet), 'utf8')), {} as never);
  console.log(run, '->', String(typeof receipt === 'string' ? receipt : receipt.text).split('\n')[0].slice(0, 80));
}
// one draft that does not read, to show that state
writeFileSync(join(OUT, '坏掉的草稿.json'), JSON.stringify({ title: '坏掉的草稿', tempo: 100, sections: [{ name: 'A', groove: 'pop', chords: 'C | G', melody: 'C5 D5 E5 | G5 - - - -' }] }));

await import(pathToFileURL(join(COOPANION, 'build', 'cortico', 'src', 'extensions', 'runtime.ts')).href);
const { seed, DEPLOYMENT } = await import(pathToFileURL(join(COOPANION, 'core', 'seed.ts')).href);
seed(HOME, 'zh');
const configFile = join(HOME, DEPLOYMENT, 'config.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.web = { ...config.web, port: PORT };
config.companion = { ...config.companion, telemetry: false };
config.worlds = { ...config.worlds, compose: cfg };
writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

const core = spawn(process.execPath, ['--import', 'tsx', join(COOPANION, 'core', 'boot.ts')], {
  cwd: COOPANION,
  stdio: 'inherit',
  env: {
    ...process.env,
    CORTICO_HOME: HOME,
    CORTICO_EXTENSIONS_DIR: EXTENSIONS,
    CORTICO_DESKTOP_PET_HOST: JSON.stringify([process.execPath, '-e', '']),
    COOPANION_TELEMETRY_URL: 'http://127.0.0.1:9/',
    COOPANION_SYSTEM_LANGUAGE: 'zh',
  },
});
core.on('exit', (code) => process.exit(code ?? 1));
const stop = () => { core.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
