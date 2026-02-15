#!/bin/bash
set -e

cd /c/usdz

echo "=== CLEANUP: REMOVE TEST AND ANALYSIS FILES ==="
echo ""

echo "Step 1: Remove files from git tracking..."
git rm -f test-cache-simulation.js 2>/dev/null || echo "  (test-cache-simulation.js not in index)"
git rm -f test-optimization.js 2>/dev/null || echo "  (test-optimization.js not in index)"
git rm -f network-analysis.json 2>/dev/null || echo "  (network-analysis.json not in index)"

echo ""
echo "Step 2: Check git status"
git status --short

echo ""
echo "Step 3: Stage remaining changes"
git add .

echo ""
echo "Step 4: Commit cleanup"
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

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>" || echo "✓ Nothing to commit"

echo ""
echo "Step 5: Push to remote"
git push

echo ""
echo "Step 6: Verify working tree is clean"
git status

echo ""
echo "=== CLEANUP COMPLETE ==="
