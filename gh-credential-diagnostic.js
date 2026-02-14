#!/usr/bin/env node
/**
 * GH Credential Helper Diagnostic
 * 
 * This script verifies that gh is properly configured as the git credential helper
 * and that all credentials are being passed correctly to git operations.
 * 
 * Usage: node gh-credential-diagnostic.js
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

class CredentialDiagnostic {
  constructor() {
    this.results = [];
    this.errors = [];
  }

  run() {
    console.log('GH Credential Helper Diagnostic');
    console.log('=' .repeat(60));
    console.log('');

    this.checkGhInstallation();
    this.checkGhAuthentication();
    this.checkGitConfiguration();
    this.checkCredentialFlow();
    this.checkGitOperations();
    this.reportResults();
  }

  checkGhInstallation() {
    console.log('1. Checking gh installation...');
    try {
      const version = execSync('gh --version', { encoding: 'utf-8' });
      console.log('   ✓ gh is installed:', version.split('\n')[0]);
      this.results.push({ check: 'gh installation', status: 'OK' });
    } catch (e) {
      console.log('   ✗ gh not found in PATH');
      this.errors.push('gh CLI is not installed or not in PATH');
    }
  }

  checkGhAuthentication() {
    console.log('\n2. Checking gh authentication...');
    try {
      const status = execSync('gh auth status', { encoding: 'utf-8' });
      if (status.includes('Logged in')) {
        const userMatch = status.match(/logged in to github\.com account (\w+)/i);
        const user = userMatch ? userMatch[1] : 'unknown';
        console.log('   ✓ Authenticated as:', user);
        
        const scopes = status.match(/scopes: '([^']*)'/);
        if (scopes) {
          console.log('   ✓ Token scopes:', scopes[1]);
        }
        
        this.results.push({ check: 'gh authentication', status: 'OK' });
      } else {
        this.errors.push('gh is not authenticated');
        console.log('   ✗ Not authenticated');
      }
    } catch (e) {
      this.errors.push('Failed to check gh authentication: ' + e.message);
      console.log('   ✗ Error:', e.message);
    }
  }

  checkGitConfiguration() {
    console.log('\n3. Checking git configuration...');
    
    try {
      const helper = execSync('git config --global credential.helper', { encoding: 'utf-8' }).trim();
      if (helper === 'gh') {
        console.log('   ✓ credential.helper set to: gh');
        this.results.push({ check: 'git credential.helper', status: 'OK' });
      } else {
        console.log('   ✗ credential.helper is:', helper || '(not set)');
        this.errors.push('credential.helper is not set to gh');
      }
    } catch (e) {
      this.errors.push('Failed to read git config: ' + e.message);
      console.log('   ✗ Error reading credential.helper');
    }
  }

  checkCredentialFlow() {
    console.log('\n4. Checking credential helper flow...');
    
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
      if (token.startsWith('gho_')) {
        console.log('   ✓ gh can provide authentication tokens');
        this.results.push({ check: 'credential flow', status: 'OK' });
      } else {
        this.errors.push('Token format unexpected');
        console.log('   ✗ Token format unexpected');
      }
    } catch (e) {
      this.errors.push('Failed to get token from gh: ' + e.message);
      console.log('   ✗ Error:', e.message);
    }
  }

  checkGitOperations() {
    console.log('\n5. Checking git operations...');
    
    const operations = [
      { name: 'fetch', cmd: ['fetch', 'origin', '--dry-run'], timeout: 150000 },
      { name: 'ls-remote', cmd: ['ls-remote', 'origin', 'HEAD'], timeout: 100000 },
      { name: 'status', cmd: ['status'], timeout: 50000 }
    ];

    for (const op of operations) {
      try {
        const result = execSync(`git ${op.cmd.join(' ')}`, {
          encoding: 'utf-8',
          cwd: process.cwd(),
          timeout: op.timeout
        });
        console.log(`   ✓ git ${op.name} works`);
        this.results.push({ check: `git ${op.name}`, status: 'OK' });
      } catch (e) {
        if (e.killed) {
          this.errors.push(`git ${op.name} timed out`);
          console.log(`   ✗ git ${op.name} timed out`);
        } else {
          this.errors.push(`git ${op.name} failed: ${e.message}`);
          console.log(`   ✗ git ${op.name} failed`);
        }
      }
    }
  }

  reportResults() {
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    
    if (this.errors.length === 0) {
      console.log('\n✓ All checks passed! GH credential helper is properly configured.');
      console.log('\nGit will automatically use gh to authenticate to https://github.com URLs.');
    } else {
      console.log('\n✗ Found ' + this.errors.length + ' issue(s):');
      this.errors.forEach((e, i) => {
        console.log(`  ${i + 1}. ${e}`);
      });
      console.log('\nRecommendations:');
      console.log('  - Install gh: https://cli.github.com');
      console.log('  - Authenticate: gh auth login');
      console.log('  - Configure git: git config --global credential.helper gh');
    }
    
    console.log('\n' + '='.repeat(60));
  }
}

new CredentialDiagnostic().run();
