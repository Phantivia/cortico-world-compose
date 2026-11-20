// Runs a block of the matrix: every variant × task on one endpoint, a few Cores at a time.
//
//   node bench/batch.mjs <endpoint> "<variants>" "<tasks>" [first port index] [trial] [at a time]
//
// <endpoint> is "deepseek" (the app's default endpoint) or a name from "endpoints" in bench/local.json.
// MAXTOK, MODEL, IDLE_MS and LIMIT_MS pass through to run.ts. Its process id is written to
// bench/runs/batch-<endpoint>.pid; `taskkill /PID <id> /T /F` (or kill on POSIX) ends the block with its Cores.
// Two blocks may run side by side when their port indices do not overlap.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const [endpoint, variants = '', tasks = '', first = '0', trial = '', width = '3'] = process.argv.slice(2);
if (!endpoint || !variants || !tasks) { console.error('usage: node bench/batch.mjs <endpoint> "<variants>" "<tasks>" [first port index] [trial] [at a time]'); process.exit(2); }
const jobs = tasks.split(/\s+/).filter(Boolean).flatMap((task) => variants.split(/\s+/).filter(Boolean).map((variant) => ({ variant, task })));
mkdirSync(`${HERE}runs`, { recursive: true });
const pidFile = `${HERE}runs/batch-${endpoint}.pid`;
writeFileSync(pidFile, `${process.pid}\n`);

const children = new Set();
const stop = () => { for (const child of children) child.kill(); rmSync(pidFile, { force: true }); process.exit(1); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const index = next++;
    const { variant, task } = jobs[index];
    await new Promise((done) => {
      const child = spawn(process.execPath, ['--import', 'tsx', `${HERE}run.ts`, variant, task, String(Number(first) + index)], {
        cwd: `${HERE}..`,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, ...(endpoint === 'deepseek' ? {} : { ENDPOINT: endpoint }), ...(trial ? { TRIAL: trial } : {}) },
      });
      children.add(child);
      child.on('exit', () => { children.delete(child); done(); });
    });
  }
};
await Promise.all(Array.from({ length: Number(width) }, worker));
rmSync(pidFile, { force: true });
console.log(`batch ${endpoint} done: ${jobs.length} runs`);
