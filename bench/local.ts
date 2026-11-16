/**
 * Where this machine keeps what the benchmark needs. Values come from the environment, then from
 * bench/local.json (not in git):
 *
 *   { "coopanion": "<a Coopanion checkout with pnpm install and pnpm run build:cortico done>",
 *     "keyFile":   "<a .env file with a DEEPSEEK_API_KEY line>",
 *     "soundfont": "<optional .sf2/.sf3; default is assets/MuseScore_General.sf3>" }
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./local.json', import.meta.url));
const local = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> : {};

function need(name: string, env: string): string {
  const value = process.env[env] ?? local[name];
  if (!value) { console.error(`set ${env} or "${name}" in bench/local.json (see bench/local.ts)`); process.exit(2); }
  return value;
}

export const coopanionDir = (): string => need('coopanion', 'COOPANION');
export const keyFile = (): string => need('keyFile', 'KEY_FILE');
export const soundfontFile = (): string => process.env.SF ?? local.soundfont ?? fileURLToPath(new URL('../assets/MuseScore_General.sf3', import.meta.url));
