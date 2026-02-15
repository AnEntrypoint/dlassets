const fs = require('fs');
const path = require('path');

const filesToDelete = [
  'cleanup-and-complete.js',
  'cleanup-files.js',
  'cleanup.sh',
  'consumption-report.json',
  'converter.js',
  'debug-page-content.html',
  'debug-page-no-blocking.html',
  'do-cleanup.js',
  'execute-cleanup.js',
  'phase1-count.png',
  'phase7-final.png',
  'run-cleanup.sh',
  'asset-investigation-report.json',
  'cache-stats.json'
];

console.log('Starting repository cleanup...\n');

let deletedCount = 0;
let notFoundCount = 0;

for (const file of filesToDelete) {
  const filePath = path.join('/c/usdz', file);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✓ Deleted: ${file}`);
      deletedCount++;
    } else {
      console.log(`- Not found: ${file}`);
      notFoundCount++;
    }
  } catch (err) {
    console.error(`✗ Error deleting ${file}: ${err.message}`);
  }
}

console.log(`\nCleanup Summary:`);
console.log(`- Deleted: ${deletedCount} files`);
console.log(`- Not found: ${notFoundCount} files`);

console.log('\nRemaining files in /c/usdz:');
const files = fs.readdirSync('/c/usdz').filter(f => !f.startsWith('.')).sort();
files.forEach(f => console.log(`  ${f}`));

console.log('\n✓ Cleanup complete');
