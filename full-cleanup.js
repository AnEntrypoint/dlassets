#!/usr/bin/env node

/**
 * Full Repository Cleanup
 * Removes all experimental and debug files
 * Commits changes to git
 * Verifies clean working tree
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORK_DIR = '/c/usdz';

// Experimental and debug files to delete
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

function log(msg, type = 'info') {
  const prefix = {
    info: '  ',
    success: '✓ ',
    error: '✗ ',
    section: '\n> '
  }[type] || '  ';
  console.log(prefix + msg);
}

function runGit(cmd) {
  try {
    const result = execSync(`cd "${WORK_DIR}" && ${cmd}`, { encoding: 'utf-8' });
    return result.trim();
  } catch (err) {
    console.error(`Git command failed: ${cmd}`);
    console.error(err.message);
    throw err;
  }
}

async function cleanup() {
  console.log('\n' + '='.repeat(70));
  console.log('REPOSITORY CLEANUP - REMOVE EXPERIMENTAL FILES');
  console.log('='.repeat(70));

  // Phase 1: Delete files
  log('PHASE 1: Deleting experimental files', 'section');

  let deletedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (const file of filesToDelete) {
    const filePath = path.join(WORK_DIR, file);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log(`Deleted: ${file}`, 'success');
        deletedCount++;
      } else {
        log(`Not found: ${file}`);
        notFoundCount++;
      }
    } catch (err) {
      log(`Error deleting ${file}: ${err.message}`, 'error');
      errorCount++;
    }
  }

  console.log(`\n  Deleted: ${deletedCount} files`);
  console.log(`  Not found: ${notFoundCount} files`);
  console.log(`  Errors: ${errorCount} files`);

  // Phase 2: Git status
  log('PHASE 2: Git staging', 'section');

  try {
    const status = runGit('git status --short');
    if (status) {
      console.log('\nCurrent git status:');
      console.log(status.split('\n').map(l => '  ' + l).join('\n'));
    }

    // Stage the deleted files via git rm
    log('Staging file deletions in git...', 'info');
    for (const file of filesToDelete) {
      const filePath = path.join(WORK_DIR, file);
      if (!fs.existsSync(filePath)) {
        try {
          runGit(`git rm -f "${file}" 2>/dev/null || true`);
          log(`Git staged deletion: ${file}`, 'success');
        } catch (err) {
          // File may not be tracked, continue
        }
      }
    }
  } catch (err) {
    log(`Git operations error: ${err.message}`, 'error');
  }

  // Phase 3: Verify remaining files
  log('PHASE 3: Verifying production files', 'section');

  const productionFiles = [
    'downloader.js',
    'asset-cache.js',
    'cache-manager.js',
    'asset-cache.json',
    'browser-session.json',
    'package.json',
    'package-lock.json',
    'CLAUDE.md',
    'readme.md'
  ];

  console.log('\nProduction files status:');
  let allPresent = true;
  for (const file of productionFiles) {
    const filePath = path.join(WORK_DIR, file);
    const exists = fs.existsSync(filePath);
    if (exists) {
      const stat = fs.statSync(filePath);
      const size = stat.isDirectory() ? '[DIR]' : `${(stat.size / 1024).toFixed(1)}KB`;
      log(`${file.padEnd(35)} ${size}`, 'success');
    } else {
      log(`${file.padEnd(35)} MISSING`, 'error');
      allPresent = false;
    }
  }

  if (!allPresent) {
    log('WARNING: Some production files are missing!', 'error');
  }

  // Phase 4: Commit changes
  log('PHASE 4: Git commit', 'section');

  try {
    const status = runGit('git status --short');
    if (status) {
      log('Creating git commit...', 'info');

      const commitCmd = `git commit -m "Remove experimental and debug files - keep only production code"`;
      const commitResult = runGit(commitCmd);

      if (commitResult.includes('nothing to commit')) {
        log('No changes to commit', 'info');
      } else {
        log('Commit created successfully', 'success');
        console.log(commitResult.split('\n').slice(0, 3).map(l => '  ' + l).join('\n'));
      }
    } else {
      log('No changes to commit (working tree clean)', 'info');
    }
  } catch (err) {
    log(`Commit failed: ${err.message}`, 'error');
  }

  // Phase 5: Final status
  log('PHASE 5: Final verification', 'section');

  try {
    const finalStatus = runGit('git status');
    if (finalStatus.includes('working tree clean') || finalStatus.includes('nothing to commit')) {
      log('Working tree is clean', 'success');
    } else {
      log('Warning: Working tree has pending changes', 'error');
      console.log('\n' + finalStatus.split('\n').map(l => '  ' + l).join('\n'));
    }
  } catch (err) {
    log(`Status check failed: ${err.message}`, 'error');
  }

  // List final files
  log('PHASE 6: Final file listing', 'section');

  const remainingFiles = fs.readdirSync(WORK_DIR)
    .filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== 'downloads')
    .sort();

  console.log(`\nFiles in repository (${remainingFiles.length}):`);
  for (const f of remainingFiles) {
    const filePath = path.join(WORK_DIR, f);
    const stat = fs.statSync(filePath);
    const size = stat.isDirectory() ? '[DIR]' : `${(stat.size / 1024).toFixed(1)}KB`;
    console.log(`  ${f.padEnd(35)} ${size}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('CLEANUP COMPLETE');
  console.log('='.repeat(70) + '\n');
}

// Execute cleanup
cleanup().catch(err => {
  console.error('\nFATAL ERROR:', err);
  process.exit(1);
});
