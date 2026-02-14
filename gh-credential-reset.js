#!/usr/bin/env node
/**
 * GH Credential Helper Reset Script
 * 
 * This script resets the gh credential helper configuration and provides
 * recovery options if credentials fail.
 * 
 * Usage: node gh-credential-reset.js [full|quick]
 *   full  - Complete reset: logout, clear cache, reconfigure
 *   quick - Quick fix: just reconfigure credential helper
 */

const { execSync } = require('child_process');
const fs = require('fs');

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function reset(mode = 'quick') {
  log('GH Credential Helper Reset - ' + mode + ' mode');
  console.log('');

  try {
    if (mode === 'full') {
      log('Step 1: Logging out from gh...');
      try {
        execSync('gh auth logout --hostname github.com -c', { encoding: 'utf-8' });
        log('  ✓ Logged out');
      } catch (e) {
        log('  Note: ' + e.message);
      }

      log('\nStep 2: Clearing git credentials cache...');
      try {
        execSync('git credential reject', { 
          input: 'protocol=https\nhost=github.com\n\n',
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8'
        });
        log('  ✓ Credentials cleared');
      } catch (e) {
        log('  Note: ' + e.message);
      }

      log('\nStep 3: Re-authenticating with gh...');
      console.log('  Please complete the login process when prompted...');
      try {
        execSync('gh auth login -h github.com -w', {
          stdio: 'inherit',
          timeout: 600000
        });
        log('  ✓ Authentication complete');
      } catch (e) {
        log('  Error: ' + e.message);
        return false;
      }
    }

    log('\nStep 4: Configuring git credential helper...');
    try {
      execSync('git config --global credential.helper gh', { encoding: 'utf-8' });
      log('  ✓ credential.helper set to gh');
    } catch (e) {
      log('  Error: ' + e.message);
      return false;
    }

    log('\nStep 5: Verifying configuration...');
    try {
      const helper = execSync('git config --global credential.helper', { encoding: 'utf-8' }).trim();
      const auth = execSync('gh auth status', { encoding: 'utf-8' });
      
      if (helper === 'gh' && auth.includes('Logged in')) {
        log('  ✓ Configuration verified');
        log('  ✓ Authentication verified');
        return true;
      } else {
        log('  Error: Configuration incomplete');
        return false;
      }
    } catch (e) {
      log('  Error: ' + e.message);
      return false;
    }

  } catch (e) {
    log('Fatal error: ' + e.message);
    return false;
  }
}

// Parse arguments
const mode = process.argv[2] || 'quick';

if (!['full', 'quick'].includes(mode)) {
  console.log('Usage: node gh-credential-reset.js [full|quick]');
  console.log('  full  - Complete reset: logout, clear cache, reconfigure');
  console.log('  quick - Quick fix: just reconfigure credential helper');
  process.exit(1);
}

const success = reset(mode);

if (success) {
  log('\n✓ Reset complete! Git commands should now work with gh credentials.');
  process.exit(0);
} else {
  log('\n✗ Reset failed. Manual intervention may be needed.');
  process.exit(1);
}
