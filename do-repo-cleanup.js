#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Files to delete - all experimental/debug files
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
  'cleanup-production.js',
  'full-cleanup.js'
];

const repoRoot = process.cwd();

console.log('═══════════════════════════════════════════════════════════');
console.log('  PRODUCTION REPOSITORY CLEANUP');
console.log('═══════════════════════════════════════════════════════════\n');

// Step 1: Delete files from disk
console.log('[Step 1] Deleting experimental/debug files from disk...\n');
let deletedCount = 0;

for (const file of filesToDelete) {
  const filePath = path.join(repoRoot, file);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  ✓ Deleted: ${file}`);
      deletedCount++;
    } else {
      console.log(`  - Not found: ${file}`);
    }
  } catch (err) {
    console.log(`  ✗ Failed to delete ${file}: ${err.message}`);
  }
}

console.log(`\n[Result] Deleted ${deletedCount}/${filesToDelete.length} files\n`);

// Step 2: Check git status before operations
console.log('[Step 2] Checking git status...\n');
try {
  const status = execSync('git status --porcelain', { encoding: 'utf-8' });
  if (status) {
    console.log('Untracked/modified files:');
    console.log(status);
  } else {
    console.log('Working directory clean');
  }
} catch (err) {
  console.log(`  Error: ${err.message}`);
}

// Step 3: Run git rm for files that were tracked
console.log('\n[Step 3] Running git rm for deleted files...\n');
for (const file of filesToDelete) {
  try {
    execSync(`git rm -f "${file}" 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`  ✓ git rm: ${file}`);
  } catch (err) {
    // Silently skip - file may not have been tracked
  }
}

// Step 4: Run git add -A
console.log('\n[Step 4] Running git add -A...\n');
try {
  execSync('git add -A', { encoding: 'utf-8' });
  console.log('  ✓ git add -A completed');
} catch (err) {
  console.log(`  ✗ Error: ${err.message}`);
}

// Step 5: Check staged changes
console.log('\n[Step 5] Checking staged changes...\n');
try {
  const diff = execSync('git diff --cached --name-status', { encoding: 'utf-8' });
  if (diff.trim()) {
    console.log('Staged changes:');
    console.log(diff);
  } else {
    console.log('No staged changes');
  }
} catch (err) {
  console.log(`  Error: ${err.message}`);
}

// Step 6: Commit changes
console.log('\n[Step 6] Creating commit...\n');
try {
  const commitMsg = 'Remove experimental files: cleanup scripts, debug files, and converter module';
  execSync(`git commit -m "${commitMsg}"`, { encoding: 'utf-8' });
  console.log('  ✓ Commit created successfully');
} catch (err) {
  if (err.message.includes('nothing to commit')) {
    console.log('  ℹ No changes to commit');
  } else {
    console.log(`  Note: ${err.message.split('\n')[0]}`);
  }
}

// Step 7: Push to origin main
console.log('\n[Step 7] Pushing to origin/main...\n');
try {
  execSync('git push origin main', { encoding: 'utf-8' });
  console.log('  ✓ Push completed successfully');
} catch (err) {
  console.log(`  Note: ${err.message.split('\n')[0]}`);
}

// Step 8: Final git status
console.log('\n[Step 8] Final repository status...\n');
try {
  const finalStatus = execSync('git status', { encoding: 'utf-8' });
  console.log(finalStatus);
} catch (err) {
  console.log(`  Error: ${err.message}`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  ✓ CLEANUP COMPLETE');
console.log('═══════════════════════════════════════════════════════════\n');
