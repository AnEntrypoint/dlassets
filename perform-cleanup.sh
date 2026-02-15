#!/bin/bash

cd /c/usdz

# List files to delete
echo "Files to delete:"
files_to_delete=(
  "cleanup-and-complete.js"
  "cleanup-files.js"
  "cleanup.sh"
  "consumption-report.json"
  "converter.js"
  "debug-page-content.html"
  "debug-page-no-blocking.html"
  "do-cleanup.js"
  "execute-cleanup.js"
  "phase1-count.png"
  "phase7-final.png"
  "run-cleanup.sh"
  "asset-investigation-report.json"
  "cache-stats.json"
)

# Delete each file if it exists
for file in "${files_to_delete[@]}"; do
  if [ -f "$file" ]; then
    echo "Deleting: $file"
    rm -f "$file"
    echo "✓ Deleted: $file"
  else
    echo "- Not found: $file"
  fi
done

# Show remaining files
echo ""
echo "Remaining files in /c/usdz:"
ls -1 | sort
