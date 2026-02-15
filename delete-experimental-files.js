#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// List of experimental/debug files to delete
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
  'cache-stats.json',
  'download-all-versions.js',
  'api-deletion.js',
  'deletion-cycle.js',
  'deletion-v2.js',
  'deletion-v3.js',
  'deletion-v4.js',
  'comprehensive-consumption.js',
  'smart-api-consumer.js',
  'streaming-api-consumer.js',
  'verify-and-execute.js',
  'sync-consumer.js',
  'test-phase1-simple.js',
  'run-master-workflow.js',
  'execute-and-log.js',
  'phase1-verify-count.js',
  'final-execution.js',
  'perform-cleanup.sh',
  'cleanup-repo.js'
];

const WORK_DIR = '/c/usdz';

console.log('Repository Cleanup - Deleting Experimental Files\n');
console.log('=' .repeat(60));

let deletedCount = 0;
let errorCount = 0;
let notFoundCount = 0;

for (const file of filesToDelete) {
  const filePath = path.join(WORK_DIR, file);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✓ DELETED: ${file}`);
      deletedCount++;
    } else {
      console.log(`- NOT FOUND: ${file}`);
      notFoundCount++;
    }
  } catch (err) {
    console.error(`✗ ERROR: ${file} - ${err.message}`);
    errorCount++;
  }
}

console.log('\n' + '='.repeat(60));
console.log('CLEANUP SUMMARY\n');
console.log(`  Deleted:    ${deletedCount} files`);
console.log(`  Not found:  ${notFoundCount} files`);
console.log(`  Errors:     ${errorCount} files`);

console.log('\n' + '='.repeat(60));
console.log('REMAINING PRODUCTION FILES\n');

const remainingFiles = fs.readdirSync(WORK_DIR)
  .filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== 'downloads')
  .sort();

remainingFiles.forEach(f => {
  const filePath = path.join(WORK_DIR, f);
  const stat = fs.statSync(filePath);
  const size = stat.isDirectory() ? '[DIR]' : `${(stat.size / 1024).toFixed(1)}KB`;
  console.log(`  ${f.padEnd(40)} ${size}`);
});

console.log('\n' + '='.repeat(60));
console.log('✓ CLEANUP COMPLETE\n');

process.exit(errorCount > 0 ? 1 : 0);
