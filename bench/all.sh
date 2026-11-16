#!/usr/bin/env bash
# Runs the whole matrix, three Cores at a time. Usage: bash bench/all.sh [variants] [tasks]
cd "$(dirname "$0")/.."
variants=${1:-"notes sheet facts guided"}
tasks=${2:-"bossa lofi birthday"}
i=0
for task in $tasks; do
  for variant in $variants; do
    npx tsx bench/run.ts "$variant" "$task" "$i" &
    i=$((i + 1))
    if [ $((i % 3)) -eq 0 ]; then wait; fi
  done
done
wait
echo matrix done
