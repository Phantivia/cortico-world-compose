// Prints what a run did: each tool call with a short receipt, usage, and the files written.
//   node bench/show.cjs <run name> [receipt width]
const fs = require('fs'), path = require('path');
const run = path.join(__dirname, 'runs', process.argv[2]);
const r = JSON.parse(fs.readFileSync(path.join(run, 'result.json'), 'utf8'));
const u = r.usage && r.usage.successful;
console.log(process.argv[2], '|', r.ended, r.seconds + 's', u ? `calls ${u.calls} in ${u.promptTokens} out ${u.completionTokens} $${u.cost.toFixed(4)}` : '');
const d = path.join(run, 'home/companion/data/runs');
const width = Number(process.argv[3] || 260);
for (const id of fs.existsSync(d) ? fs.readdirSync(d) : []) {
  const f = path.join(d, id, 'toolcalls.jsonl');
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l);
    console.log(' r' + j.round, j.tool, j.durMs + 'ms', 'args ' + JSON.stringify(j.args).length, '=>', String(j.receipt).slice(0, width).replace(/\n/g, ' / '));
  }
}
console.log(' files:', (r.files || []).join(', '));
