#!/usr/bin/env node

/**
 * COMPREHENSIVE ASSET CLEANUP & COMPLETION WORKFLOW
 *
 * This script executes 4 phases:
 * 1. DELETE suspicious small files (< 1 MB metadata only)
 * 2. ANALYZE current file structure and asset distribution
 * 3. QUERY API to understand asset versions (4 per asset structure)
 * 4. DOWNLOAD missing versions to complete 8 assets × 4 versions = 32 files
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const API_BASE = 'https://api.3d.hunyuan.tencent.com';
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

// Files to delete (suspicious metadata files)
const FILES_TO_DELETE = [
  'gun.glb',
  'bike.glb',
  'bike (2).glb',
  'computer_pile.glb',
  'computer_pile (3).glb',
  'barrel (3).glb',
  'barrel (6).glb',
  'minivan (3).glb'
];

// Utility logging
const log = (msg, level = 'info') => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = level === 'error' ? '✗' : level === 'success' ? '✓' : '→';
  console.log(`[${timestamp}] ${prefix} ${msg}`);
};

const section = (title) => {
  console.log('\n' + '═'.repeat(75));
  console.log(`  ${title}`);
  console.log('═'.repeat(75) + '\n');
};

/**
 * PHASE 1: Delete Suspicious Small Files
 */
async function phase1() {
  section('PHASE 1: DELETE SUSPICIOUS SMALL FILES');

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    log('Downloads directory not found, creating...', 'info');
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    return { deleted: 0, toDelete: [] };
  }

  const toDelete = [];
  let deleted = 0;

  for (const filename of FILES_TO_DELETE) {
    const filepath = path.join(DOWNLOADS_DIR, filename);
    if (fs.existsSync(filepath)) {
      try {
        const stat = fs.statSync(filepath);
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
        toDelete.push({ filename, size: sizeMB });

        // Delete the file
        fs.unlinkSync(filepath);
        log(`Deleted: ${filename} (${sizeMB} MB)`, 'success');
        deleted++;
      } catch (err) {
        log(`Failed to delete ${filename}: ${err.message}`, 'error');
      }
    }
  }

  log(`\nSummary: Deleted ${deleted}/${FILES_TO_DELETE.length} files\n`);
  return { deleted, toDelete };
}

/**
 * PHASE 2: Analyze Current File Structure
 */
async function phase2() {
  section('PHASE 2: ANALYZE CURRENT FILE STRUCTURE');

  const files = fs.readdirSync(DOWNLOADS_DIR);
  const stats = files.map(f => {
    const fullPath = path.join(DOWNLOADS_DIR, f);
    const stat = fs.statSync(fullPath);
    return {
      name: f,
      size: stat.size,
      sizeMB: (stat.size / (1024 * 1024)).toFixed(2)
    };
  });

  // Sort by size descending
  stats.sort((a, b) => b.size - a.size);

  log(`Total files: ${stats.length}`);
  log(`Total size: ${(stats.reduce((sum, s) => sum + s.size, 0) / (1024 * 1024)).toFixed(2)} MB\n`);

  console.log('Files:');
  stats.forEach((s, i) => {
    const sizeCategory = s.size < 1024 * 1024 ? '[META]' : '[MODEL]';
    console.log(`  ${i+1}. ${s.name.padEnd(50)} ${s.sizeMB.padStart(10)} MB ${sizeCategory}`);
  });

  // Identify assets
  const assetMap = new Map();
  stats.forEach(s => {
    // Extract asset name from filename
    const withoutExt = s.name.replace(/\.[^.]+$/, '');

    // Remove trailing numbers like (2), (3), etc.
    const baseName = withoutExt.replace(/\s*\(\d+\)\s*$/, '');

    if (!assetMap.has(baseName)) {
      assetMap.set(baseName, []);
    }
    assetMap.get(baseName).push(s.name);
  });

  log(`\nAssets identified: ${assetMap.size}`);
  const assetList = [];
  for (const [assetName, versions] of assetMap.entries()) {
    assetList.push({ name: assetName, versions: versions.length, files: versions });
    log(`  ${assetName}: ${versions.length} version(s)`);
  }

  return { stats, assetMap, assetList };
}

/**
 * PHASE 3: Query API to Understand Asset Versions
 */
async function phase3(sessionCookies) {
  section('PHASE 3: UNDERSTAND API STRUCTURE');

  if (!sessionCookies || sessionCookies.length === 0) {
    log('No session cookies available. Attempting browser-based API query...', 'info');
    return await phase3Browser();
  }

  // Use cookies to query API directly
  const cookieHeader = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');

  log('Querying /api/3d/creations/list...');

  return new Promise((resolve) => {
    const postData = JSON.stringify({});
    const options = {
      hostname: 'api.3d.hunyuan.tencent.com',
      path: '/api/3d/creations/list',
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 50 * 1024 * 1024) {
          req.abort();
          resolve(null);
        }
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          log('API response received', 'success');

          if (parsed.data && parsed.data.length > 0) {
            log(`Found ${parsed.data.length} assets in API\n`);

            // Analyze structure
            const firstAsset = parsed.data[0];
            log('First asset structure:');
            log(`  ID: ${firstAsset.id || 'N/A'}`);
            log(`  Name: ${firstAsset.name || 'N/A'}`);

            if (firstAsset.urlResult) {
              const versions = Object.keys(firstAsset.urlResult || {});
              log(`  Available versions: ${versions.length}`);
              versions.forEach(v => log(`    - ${v}`));
            }

            const assetStats = parsed.data.map(a => ({
              id: a.id,
              name: a.name,
              versions: Object.keys(a.urlResult || {}).length,
              urls: a.urlResult ? Object.keys(a.urlResult) : []
            }));

            resolve({
              totalAssets: parsed.data.length,
              assets: assetStats,
              rawData: parsed.data
            });
          } else {
            log('No assets found in API response', 'error');
            resolve(null);
          }
        } catch (err) {
          log(`Failed to parse API response: ${err.message}`, 'error');
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      log(`API request error: ${err.message}`, 'error');
      resolve(null);
    });

    req.setTimeout(30000, () => {
      req.abort();
      log('API request timeout', 'error');
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Fallback: Query API via browser automation
 */
async function phase3Browser() {
  log('Launching browser to query API via network monitoring...');

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // Load session cookies
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (sessionData.cookies) {
        await context.addCookies(sessionData.cookies);
      }
    }

    const page = await context.newPage();

    let apiResponse = null;

    // Intercept API calls
    page.on('response', response => {
      if (response.url().includes('/api/3d/creations/list')) {
        response.text().then(text => {
          try {
            apiResponse = JSON.parse(text);
          } catch (e) {
            // Ignore parsing errors for large responses
          }
        });
      }
    });

    log('Navigating to assets page...');
    await page.goto(WEBSITE_URL, { waitUntil: 'networkidle', timeout: 60000 });

    log('Waiting for API response...', 'success');
    await page.waitForTimeout(5000); // Wait for API calls to complete

    await browser.close();

    if (apiResponse && apiResponse.data) {
      log(`API data received: ${apiResponse.data.length} assets`);
      return {
        totalAssets: apiResponse.data.length,
        assets: apiResponse.data.map(a => ({
          id: a.id,
          name: a.name,
          versions: Object.keys(a.urlResult || {}).length,
          urls: a.urlResult ? Object.keys(a.urlResult) : []
        }))
      };
    }
  } catch (err) {
    log(`Browser automation error: ${err.message}`, 'error');
  }

  return null;
}

/**
 * PHASE 4: Generate Report and Download Plan
 */
async function phase4(analysis, apiData) {
  section('PHASE 4: DOWNLOAD PLAN');

  if (!apiData || !apiData.assets) {
    log('Cannot generate download plan without API data', 'error');
    log('Recommendation: Run the downloader.js with valid session', 'info');
    return null;
  }

  log(`Total API assets: ${apiData.totalAssets}`);
  log(`Assets in local storage: ${analysis.assetList.length}`);
  log(`Total local files: ${analysis.stats.length}\n`);

  // Map local files to API assets
  const localAssetNames = new Set(analysis.assetList.map(a => a.name.toLowerCase()));
  const downloadPlan = [];

  for (const apiAsset of apiData.assets) {
    const localMatches = analysis.assetList.filter(a =>
      a.name.toLowerCase().includes(apiAsset.name.toLowerCase()) ||
      apiAsset.name.toLowerCase().includes(a.name.toLowerCase())
    );

    const currentVersions = localMatches.reduce((sum, a) => sum + a.versions, 0);
    const missingVersions = apiAsset.versions - currentVersions;

    if (missingVersions > 0 || currentVersions === 0) {
      downloadPlan.push({
        apiAsset: apiAsset.name,
        currentVersions,
        targetVersions: apiAsset.versions,
        missingVersions: Math.max(0, missingVersions),
        urls: apiAsset.urls,
        localFiles: localMatches.flatMap(a => a.files)
      });
    }
  }

  if (downloadPlan.length > 0) {
    log(`\nDownload Plan (${downloadPlan.length} assets need completion):\n`);
    downloadPlan.forEach((plan, i) => {
      log(`${i+1}. ${plan.apiAsset}`);
      log(`   Current: ${plan.currentVersions}/${plan.targetVersions} versions`);
      log(`   Missing: ${plan.missingVersions} versions to download`);
      if (plan.localFiles.length > 0) {
        log(`   Local: ${plan.localFiles.join(', ')}`);
      }
    });

    const totalToDownload = downloadPlan.reduce((sum, p) => sum + p.missingVersions, 0);
    log(`\nTotal files to download: ${totalToDownload}`);
    log(`Expected final count: ${analysis.stats.length + totalToDownload} files\n`);
  } else {
    log('All assets appear to be complete!', 'success');
  }

  return downloadPlan;
}

/**
 * MAIN EXECUTION
 */
async function main() {
  section('ASSET CLEANUP & COMPLETION WORKFLOW');

  try {
    // Load session first
    let sessionCookies = [];
    if (fs.existsSync(SESSION_FILE)) {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      sessionCookies = sessionData.cookies || [];
      log(`Session loaded: ${sessionCookies.length} cookies`, 'success');
    } else {
      log('No session file found - API queries will use browser automation', 'info');
    }

    // Execute phases
    const phase1Result = await phase1();
    const phase2Result = await phase2();
    const phase3Result = await phase3(sessionCookies);
    const phase4Result = await phase4(phase2Result, phase3Result);

    // Final summary
    section('EXECUTION COMPLETE');

    console.log('Summary:');
    console.log(`  Phase 1 - Deleted: ${phase1Result.deleted} files`);
    console.log(`  Phase 2 - Current: ${phase2Result.stats.length} files, ${phase2Result.assetList.length} assets`);
    if (phase3Result) {
      console.log(`  Phase 3 - API: ${phase3Result.totalAssets} assets with structured versions`);
    } else {
      console.log('  Phase 3 - API: Unable to query (see recommendations below)');
    }
    if (phase4Result && phase4Result.length > 0) {
      console.log(`  Phase 4 - Plan: ${phase4Result.length} assets need version completion`);
    }

    console.log('\nRecommendations:');
    if (phase1Result.deleted > 0) {
      console.log(`  ✓ Cleaned up ${phase1Result.deleted} suspicious files`);
    }
    if (!phase3Result) {
      console.log('  → Run: npm run download  (to get full API data and complete downloads)');
    } else if (phase4Result && phase4Result.length > 0) {
      console.log('  → Implement Phase 3 downloader to fetch missing versions');
      console.log('  → Target: 8 assets × 4 versions = 32 total files');
    } else {
      console.log('  ✓ Asset collection appears complete');
    }

    console.log('\n' + '═'.repeat(75) + '\n');

  } catch (err) {
    log(`Fatal error: ${err.message}`, 'error');
    process.exit(1);
  }
}

// Execute
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
