/**
 * Where this machine keeps what the benchmark needs. Values come from the environment, then from
 * bench/local.json (not in git):
 *
 *   { "coopanion": "<a Coopanion checkout with pnpm install and pnpm run build:cortico done>",
 *     "keyFile":   "<a .env file with a DEEPSEEK_API_KEY line>",
 *     "soundfont": "<optional .sf2/.sf3; default is assets/MuseScore_General.sf3>",
 *     "endpoints": { "<name>": { "dir": "<an endpoint directory of another deployment>", "spec": { "model": "..." } } } }
 *
 * A run with ENDPOINT=<name> copies that directory's config.json, .env and oauth.json into its own home, lays
 * `spec` over the copied one and makes it the active endpoint. The provider extension the endpoint needs
 * has to be linked in bench/extensions next to this package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./local.json', import.meta.url));
const local = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> & { endpoints?: Record<string, { dir: string; spec?: Record<string, unknown> }> } : {};

function need(name: string, env: string): string {
  const value = process.env[env] ?? local[name];
  if (!value) { console.error(`set ${env} or "${name}" in bench/local.json (see bench/local.ts)`); process.exit(2); }
  return value;
}

export const coopanionDir = (): string => need('coopanion', 'COOPANION');
export const keyFile = (): string => need('keyFile', 'KEY_FILE');
export const soundfontFile = (): string => process.env.SF ?? local.soundfont ?? fileURLToPath(new URL('../assets/MuseScore_General.sf3', import.meta.url));
export const endpoint = (name: string): { dir: string; spec?: Record<string, unknown> } => {
  const found = local.endpoints?.[name];
  if (!found) { console.error(`endpoint "${name}" is not in bench/local.json (see bench/local.ts)`); process.exit(2); }
  return found;
};
