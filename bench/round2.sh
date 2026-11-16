#!/usr/bin/env bash
# Second round: the shipped prompt and compose_revise, three bossa trials, and a guided-bossa repeat.
cd "$(dirname "$0")/.."
npx tsx bench/run.ts staged bossa 0 &
TRIAL=t2 npx tsx bench/run.ts staged bossa 1 &
TRIAL=t3 npx tsx bench/run.ts staged bossa 2 &
wait
npx tsx bench/run.ts staged lofi 3 &
npx tsx bench/run.ts staged birthday 4 &
TRIAL=t2 npx tsx bench/run.ts guided bossa 5 &
wait
echo round2 done
