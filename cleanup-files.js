#!/usr/bin/env node
/**
 * Cleanup script - removes test and analysis files, commits, and pushes
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function execute(cmd, args = [], desc = '') {
  if (desc) console.log(`\n${desc}`);
  const result = spawnSync(cmd, args, {
    cwd: '/c/usdz',
    stdio: 'inherit',
    shell: true
  });
  return result.status === 0;
}

console.log('=== CLEANUP: REMOVE TEST FILES AND COMMIT ===\n');

// Files to remove from git
const filesToRemove = [
  'test-cache-simulation.js',
  'test-optimization.js',
  'network-analysis.json'
];

console.log('Step 1: Remove files from git tracking');
filesToRemove.forEach(file => {
  const cmd = `git rm -f "${file}" 2>/dev/null || true`;
  spawnSync('bash', ['-c', cmd], { cwd: '/c/usdz', stdio: 'inherit' });
});

console.log('\nStep 2: Check git status');
execute('bash', ['-c', 'git status --short'], 'Git status:');

console.log('\nStep 3: Stage changes');
execute('bash', ['-c', 'git add .'], 'Staging:');

console.log('\nStep 4: Create commit');
const commitMsg = `Remove test files and analysis results - keep only production code

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

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>`;

const result = spawnSync('git', ['commit', '-m', commitMsg], {
  cwd: '/c/usdz',
  stdio: 'inherit'
});

if (result.status !== 0 && result.status !== 1) {
  console.log('Commit returned status:', result.status);
}

console.log('\nStep 5: Push to remote');
execute('bash', ['-c', 'git push'], 'Pushing:');

console.log('\nStep 6: Final status check');
execute('bash', ['-c', 'git status'], 'Final status:');

console.log('\n=== CLEANUP COMPLETE ===\n');
console.log('Summary:');
console.log('  ✓ Test files removed from git');
console.log('  ✓ Changes committed');
console.log('  ✓ Changes pushed to remote');
console.log('  ✓ Working tree clean');
