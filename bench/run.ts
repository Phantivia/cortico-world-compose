/**
 * One benchmark run: a Coopanion Core (the checkout named in bench/local.ts) on a fresh home (default Coo persona, no pet
 * window, telemetry off), this package linked in as its only extension, one request sent over the console
 * channel. Ends when the Core has been idle for a while after its first model call, or at the time limit.
 *
 *   tsx bench/run.ts <variant> <task> [index]
 *
 * The key file (bench/local.ts) is copied into the run's home; the key is never printed.
 * Results: bench/runs/<variant>-<task>/{out/*.wav, out/*.json, result.json, core.log}
 */
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { coopanionDir, keyFile, soundfontFile } from './local.ts';
import { TASKS, VARIANTS } from './matrix.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const COOPANION = coopanionDir();
const KEY_FILE = keyFile();
const SOUNDFONT = soundfontFile();
const EXTENSIONS = join(HERE, 'extensions');
const IDLE_MS = Number(process.env.IDLE_MS ?? 100_000), LIMIT_MS = Number(process.env.LIMIT_MS ?? 9 * 60_000);

const [variantId, taskId, indexArg] = process.argv.slice(2);
const variant = VARIANTS[variantId], task = TASKS[taskId];
if (!variant || !task) { console.error(`usage: run.ts <${Object.keys(VARIANTS).join('|')}> <${Object.keys(TASKS).join('|')}> [index]`); process.exit(2); }
const model = process.env.MODEL ?? '';
const runName = `${variantId}-${taskId}${model ? `-${model}` : ''}${process.env.TRIAL ? `-${process.env.TRIAL}` : ''}`;
const RUN = join(HERE, 'runs', runName);
const HOME = join(RUN, 'home'), OUT = join(RUN, 'out');
const PORT = 17820 + Number(indexArg ?? 0);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

rmSync(RUN, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(EXTENSIONS, 'node_modules', 'cortico-world-compose'))) { console.error('run bench/setup.sh first (links this package into bench/extensions)'); process.exit(2); }

// seed a new install, as the app does on its first start
await import(pathToFileURL(join(COOPANION, 'build', 'cortico', 'src', 'extensions', 'runtime.ts')).href);
const { seed, DEPLOYMENT } = await import(pathToFileURL(join(COOPANION, 'core', 'seed.ts')).href);
seed(HOME, 'zh');
const deploy = join(HOME, DEPLOYMENT);
const configFile = join(deploy, 'config.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.web = { ...config.web, port: PORT };
config.companion = { ...config.companion, telemetry: false };
config.worlds = { ...config.worlds, compose: { enabled: true, soundfontFile: SOUNDFONT, outputDir: OUT, canPlay: false, toolset: variant.toolset, reportsFacts: variant.facts } };
writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
const endpoint = join(HOME, 'providers', config.activeProvider);
copyFileSync(KEY_FILE, join(endpoint, '.env'));
if (model || process.env.MAXTOK) {
  const entry = JSON.parse(readFileSync(join(endpoint, 'config.json'), 'utf8'));
  if (model) entry.spec.model = model;
  if (process.env.MAXTOK) entry.spec.maxTokens = Number(process.env.MAXTOK);
  writeFileSync(join(endpoint, 'config.json'), JSON.stringify(entry, null, 2) + '\n');
}
if (variant.prompt) {
  mkdirSync(join(deploy, 'worlds', 'compose'), { recursive: true });
  cpSync(join(HERE, 'prompts', variant.prompt), join(deploy, 'worlds', 'compose', 'ENV_PROMPT.md'));
}

const log: string[] = [];
const core = spawn(process.execPath, ['--import', 'tsx', join(COOPANION, 'core', 'boot.ts')], {
  cwd: COOPANION,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CORTICO_HOME: HOME,
    CORTICO_EXTENSIONS_DIR: EXTENSIONS,
    CORTICO_DESKTOP_PET_HOST: JSON.stringify([process.execPath, '-e', '']),
    COOPANION_TELEMETRY_URL: 'http://127.0.0.1:9/',
    COOPANION_SYSTEM_LANGUAGE: 'zh',
  },
});
core.stdout.on('data', (d) => log.push(String(d)));
core.stderr.on('data', (d) => log.push(String(d)));
let exited: number | null = null;
core.on('exit', (code) => { exited = code ?? 1; });

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${ORIGIN}${path}`, { ...init, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  return res.ok ? res.json() as Promise<Record<string, unknown>> : null;
};
const started = Date.now();
let status: Record<string, unknown> | null = null;
while (!status && exited === null && Date.now() - started < 90_000) { await sleep(1500); status = await api('/api/status').catch(() => null); }
const result: Record<string, unknown> = { variant: variantId, task: taskId, model: model || 'default', request: task };
const finish = async (why: string) => {
  result.ended = why;
  result.seconds = Math.round((Date.now() - started) / 1000);
  result.usage = await api('/api/usage?days=1').catch(() => null);
  result.files = existsSync(OUT) ? readdirSync(OUT) : [];
  writeFileSync(join(RUN, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(RUN, 'core.log'), log.join(''));
  await api('/api/run/shutdown', { method: 'POST', body: '{}' }).catch(() => null);
  await sleep(1500);
  core.kill();
  console.log(`${runName}: ${why}, ${result.seconds}s, files: ${(result.files as string[]).filter((f) => f.endsWith('.wav')).join(', ') || 'none'}`);
  process.exit(0);
};
if (!status) await finish(exited !== null ? `core exited (${exited}) before it listened` : 'core did not listen within 90 s');
const worlds = await api('/api/worlds');
result.composeMounted = JSON.stringify(worlds).includes('"compose"');

const { WebSocket } = createRequire(join(COOPANION, 'package.json'))('ws') as typeof import('ws');
const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws/providers/${encodeURIComponent('world:console')}/panels/chat`, { headers: { origin: ORIGIN } });
const frames: unknown[] = [];
socket.on('message', (raw) => { try { frames.push(JSON.parse(String(raw))); } catch { /* not a frame */ } });
await new Promise<void>((done, fail) => { socket.on('open', () => done()); socket.on('error', fail); });
socket.send(JSON.stringify({ type: 'hello', name: 'bench' }));
await sleep(500);
socket.send(JSON.stringify({ type: 'msg', text: task }));

// Activity is read from the run's transcript: it grows with every model item and tool result.
const transcriptSize = (): number => {
  const runs = join(deploy, 'data', 'runs');
  if (!existsSync(runs)) return 0;
  return readdirSync(runs).reduce((sum, r) => {
    const f = join(runs, r, 'transcript.jsonl');
    return sum + (existsSync(f) ? statSync(f).size : 0);
  }, 0);
};
await sleep(4000);
let size = transcriptSize(), lastGrowth = Date.now();
while (true) {
  await sleep(3000);
  if (exited !== null) await finish(`core exited (${exited})`);
  const now = transcriptSize();
  if (now !== size) { size = now; lastGrowth = Date.now(); }
  result.frames = frames.filter((f) => (f as { type?: string }).type !== 'sys');
  if (Date.now() - lastGrowth > IDLE_MS) await finish('idle');
  if (Date.now() - started > LIMIT_MS) await finish('time limit');
}
