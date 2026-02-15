#!/bin/bash
cd /c/usdz

echo "=== CLEANUP START ==="
echo ""

# Delete test files
echo "Deleting test files..."
git rm -f test-cache-simulation.js
git rm -f test-optimization.js
git rm -f network-analysis.json

echo "✓ Test files removed from git"
echo ""

# Show status
echo "=== GIT STATUS ==="
git status --short

echo ""
echo "=== COMMITTING ==="
git commit -m "Remove test files and analysis results - keep only production code

Deleted:
- test-cache-simulation.js (test file)
- test-optimization.js (test file)
- network-analysis.json (analysis results)

Kept:
- downloader.js (production app)
- asset-cache.js (production app)
- cache-manager.js (production app)
- asset-cache.json (cache persistence)
- All other production files

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

echo ""
echo "=== PUSHING TO REMOTE ==="
git push

echo ""
echo "=== FINAL GIT STATUS ==="
git status --short
if [ -z "$(git status --short)" ]; then
  echo "(clean)"
fi

echo ""
echo "=== CLEANUP COMPLETE ==="
