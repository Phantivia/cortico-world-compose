/**
 * Serves the WebUI with this World mounted, for looking at the Songs panel and listening: the same headless
 * Core as run.ts, its output directory filled with the last song of every finished benchmark run, rendered
 * again and titled "<run> - <title>". No request is sent, so the model is never called. Device playback
 * volume is 0; listening is through the panel's browser playback.
 *
 *   tsx bench/serve.ts [port] [text a run name must contain]      then open http://127.0.0.1:<port>/
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ComposeWorld } from '../src/world.ts';
import { COMPOSE_DEFAULTS } from '../src/config.ts';
import { coopanionDir, soundfontFile } from './local.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const COOPANION = coopanionDir();
const EXTENSIONS = join(HERE, 'extensions');
const RUNS = join(HERE, 'runs');
const RUN = join(RUNS, '_serve');
const HOME = join(RUN, 'home'), OUT = join(RUN, 'out');
const PORT = Number(process.argv[2] ?? 17890);
const only = process.argv[3] ?? '';

rmSync(RUN, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const cfg = { ...COMPOSE_DEFAULTS, enabled: true, soundfontFile: soundfontFile(), outputDir: OUT, playbackVolume: 0 };
const world = new ComposeWorld({ cfg, dataDir: RUN });
const render = world.tools().find((t) => t.name === 'compose_render')!;
for (const run of readdirSync(RUNS).filter((r) => !r.startsWith('_') && r.includes(only)).sort()) {
  const out = join(RUNS, run, 'out');
  const wavs = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.wav')).map((f) => ({ f, t: statSync(join(out, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
  if (wavs.length === 0) continue;
  const stored = JSON.parse(readFileSync(join(out, wavs[0].f.replace(/\.wav$/, '.json')), 'utf8'));
  const title = `${run} - ${wavs[0].f.replace(/\.wav$/, '')}`;
  if (typeof stored.abc === 'string') stored.abc = /^\s*T:/m.test(stored.abc) ? stored.abc.replace(/^(\s*T:).*$/m, `$1${title}`) : `T:${title}\n${stored.abc}`;
  else stored.title = title;
  const receipt = await render.handler(stored, {} as never);
  console.log(String(typeof receipt === 'string' ? receipt : receipt.text).split('\n')[0].slice(0, 110));
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
