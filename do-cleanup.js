#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, desc) {
  console.log(`\n${desc}`);
  try {
    const output = execSync(cmd, { cwd: '/c/usdz', encoding: 'utf-8', stdio: 'pipe' });
    console.log(output);
    return true;
  } catch (e) {
    console.error('Error:', e.message);
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.log(e.stderr);
    return false;
  }
}

console.log('=== CLEANUP AND COMMIT ===\n');

// Step 1: Remove files from git
console.log('Removing test files from git tracking...');
try {
  execSync('git rm -f test-cache-simulation.js test-optimization.js network-analysis.json', { cwd: '/c/usdz' });
  console.log('✓ Files removed from git');
} catch (e) {
  console.log('Note: Files may not exist in git index yet');
}

// Step 2: Check status
run('git status --short', 'Current git status:');

// Step 3: Commit changes
console.log('\nCreating commit...');
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

try {
  execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: '/c/usdz' });
  console.log('✓ Commit created');
} catch (e) {
  if (e.message.includes('nothing to commit')) {
    console.log('✓ Nothing to commit (working tree clean)');
  } else {
    console.error('Commit error:', e.message);
  }
}

// Step 4: Push
console.log('\nPushing to remote...');
try {
  const pushOutput = execSync('git push', { cwd: '/c/usdz', encoding: 'utf-8' });
  console.log('✓ Pushed successfully');
  if (pushOutput) console.log(pushOutput);
} catch (e) {
  console.log('Push status:', e.message);
}

// Step 5: Final status
run('git status --short', 'Final git status:');

console.log('\n=== CLEANUP COMPLETE ===');
