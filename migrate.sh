#!/bin/bash
set -e
cd harness
files=$(find . -name walkthrough.md)
for f in $files; do
  dir=$(dirname "$f")
  if [ -f "$dir/closeout.md" ]; then
    echo "closeout.md already exists in $dir, removing walkthrough.md"
    git rm -q "$f"
  else
    echo "Migrating $f to $dir/closeout.md"
    git mv "$f" "$dir/closeout.md"
    sed -i '' 's/## Walkthrough/## Summary/g; s/## Evidence/## Verification/g; s/## Follow-Up/## Residual Risk/g; s/## What Changed/## Summary/g' "$dir/closeout.md"
  fi
done
