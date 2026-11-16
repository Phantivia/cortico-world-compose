// Copies each run's last rendered song to one folder as MP3 named after the run, for listening side by side.
//   node bench/pack.cjs <target dir>      (needs ffmpeg on PATH)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const runs = path.join(__dirname, 'runs');
const target = process.argv[2];
if (!target) { console.error('usage: node bench/pack.cjs <target dir>'); process.exit(2); }
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(runs).sort()) {
  const out = path.join(runs, name, 'out');
  if (!fs.existsSync(out)) continue;
  const wavs = fs.readdirSync(out).filter((f) => f.endsWith('.wav')).map((f) => ({ f, t: fs.statSync(path.join(out, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (wavs.length === 0) { console.log(name, '(no song)'); continue; }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(out, wavs[0].f), '-b:a', '192k', path.join(target, `${name}.mp3`)]);
  console.log(name, '->', wavs[0].f);
}
