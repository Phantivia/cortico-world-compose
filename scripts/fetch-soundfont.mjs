// Downloads the default SoundFont into assets/. The file is not kept in git; a published package carries it.
//   node scripts/fetch-soundfont.mjs
// MuseScore_General.sf3: General MIDI set by S. Christian Collins and others, based on Fluid R3, MIT licence.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3';
const LICENSE = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md';
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
mkdirSync(assets, { recursive: true });

for (const [url, name] of [[SOURCE, 'MuseScore_General.sf3'], [LICENSE, 'MuseScore_General_License.md']]) {
  const target = assets + name;
  if (existsSync(target) && statSync(target).size > 0) { console.log(`${name}: already there`); continue; }
  const res = await fetch(url);
  if (!res.ok || !res.body) { console.error(`${name}: ${res.status} from ${url}`); process.exit(1); }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  console.log(`${name}: ${(statSync(target).size / 1e6).toFixed(1)} MB`);
}
