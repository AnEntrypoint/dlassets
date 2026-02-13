#!/usr/bin/env node
/**
 * GH Credential Health Check
 * 
 * Periodically checks that gh authentication is valid and git operations work.
 * Can be used in scheduled tasks or CI/CD pipelines.
 * 
 * Usage: node gh-credential-health-check.js
 */

const { execSync } = require('child_process');
const fs = require('fs');

class HealthCheck {
  constructor() {
    this.checks = [];
    this.startTime = Date.now();
  }

  run() {
    console.log('GH Credential Health Check');
    console.log('Timestamp: ' + new Date().toISOString());
    console.log('');

    this.checkGhAuth();
    this.checkGitHelper();
    this.checkGitOperation();
    this.checkTokenValidity();
    
    this.report();
  }

  checkGhAuth() {
    try {
      const status = execSync('gh auth status', { encoding: 'utf-8' });
      const ok = status.includes('Logged in');
      this.checks.push({
        name: 'gh authentication',
        ok: ok,
        message: ok ? 'Authenticated' : 'Not authenticated'
      });
    } catch (e) {
      this.checks.push({
        name: 'gh authentication',
        ok: false,
        message: 'Error: ' + e.message
      });
    }
  }

  checkGitHelper() {
    try {
      const helper = execSync('git config --global credential.helper', { encoding: 'utf-8' }).trim();
      const ok = helper === 'gh';
      this.checks.push({
        name: 'git credential.helper',
        ok: ok,
        message: ok ? 'Set to gh' : 'Set to: ' + helper
      });
    } catch (e) {
      this.checks.push({
        name: 'git credential.helper',
        ok: false,
        message: 'Error: ' + e.message
      });
    }
  }

  checkGitOperation() {
    try {
      execSync('git fetch origin --dry-run', {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 15000,
        stdio: 'pipe'
      });
      this.checks.push({
        name: 'git fetch',
        ok: true,
        message: 'Success'
      });
    } catch (e) {
      const msg = e.killed ? 'Timeout' : e.message;
      this.checks.push({
        name: 'git fetch',
        ok: false,
        message: 'Error: ' + msg
      });
    }
  }

  checkTokenValidity() {
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
      const ok = token.startsWith('gho_');
      this.checks.push({
        name: 'token validity',
        ok: ok,
        message: ok ? 'Valid token format' : 'Invalid format'
      });
    } catch (e) {
      this.checks.push({
        name: 'token validity',
        ok: false,
        message: 'Error: ' + e.message
      });
    }
  }

  report() {
    const ok = this.checks.every(c => c.ok);
    
    console.log('Results:');
    this.checks.forEach(check => {
      const icon = check.ok ? '✓' : '✗';
      console.log(`  ${icon} ${check.name.padEnd(25)} ${check.message}`);
    });

    console.log('');
    console.log('Status: ' + (ok ? 'HEALTHY' : 'UNHEALTHY'));
    
    if (!ok) {
      console.log('\nFailed checks:');
      this.checks.filter(c => !c.ok).forEach(c => {
        console.log('  - ' + c.name + ': ' + c.message);
      });
      console.log('\nRun: node gh-credential-reset.js quick');
      process.exit(1);
    }
  }
}

new HealthCheck().run();
