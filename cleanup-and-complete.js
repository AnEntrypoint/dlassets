#!/usr/bin/env node

/**
 * Asset Cleanup & Completion Script
 *
 * Phases:
 * 1. Delete suspicious small files (< 1 MB metadata)
 * 2. Understand API structure for multiple asset versions
 * 3. Download all missing versions (4 per asset)
 * 4. Verify final state
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const API_BASE = 'https://api.3d.hunyuan.tencent.com';

// Files to delete in Phase 1
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

const log = (msg) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
};

const logSection = (title) => {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
};

/**
 * Phase 1: Delete suspicious small files
 */
async function phase1DeleteSuspiciousFiles() {
  logSection('PHASE 1: DELETE SUSPICIOUS FILES');

  log(`Looking for files to delete in: ${DOWNLOADS_DIR}`);

  const files = fs.readdirSync(DOWNLOADS_DIR);
  const foundFiles = [];
  let deleted = 0;

  for (const filename of FILES_TO_DELETE) {
    const filepath = path.join(DOWNLOADS_DIR, filename);
    if (fs.existsSync(filepath)) {
      foundFiles.push(filename);
      try {
        fs.unlinkSync(filepath);
        deleted++;
        log(`✓ Deleted: ${filename}`);
      } catch (err) {
        log(`✗ Failed to delete ${filename}: ${err.message}`);
      }
    }
  }

  if (foundFiles.length === 0) {
    log('No suspicious files found to delete');
  }

  log(`\nPhase 1 Summary: Deleted ${deleted}/${FILES_TO_DELETE.length} files`);
  return deleted;
}

/**
 * Phase 2: List current files and identify assets
 */
async function phase2AnalyzeCurrentFiles() {
  logSection('PHASE 2: ANALYZE CURRENT FILES');

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

  console.log('Files by size (largest first):');
  stats.forEach((s, i) => {
    console.log(`  ${i+1}. ${s.name.padEnd(50)} ${s.sizeMB.padStart(10)} MB`);
  });

  // Identify suspicious remaining files
  const suspicious = stats.filter(s => s.size < 1024 * 1024);
  if (suspicious.length > 0) {
    console.log('\nRemaining suspicious files (< 1 MB):');
    suspicious.forEach(s => {
      console.log(`  ${s.name.padEnd(50)} ${s.sizeMB.padStart(10)} MB`);
    });
  }

  // Try to identify asset groups
  const assetMap = new Map();

  stats.forEach(s => {
    // Extract asset identifier from filename
    let assetId = null;

    // Try to extract hash or name
    const match = s.name.match(/^([a-f0-9]{32}|[a-z_]+)/i);
    if (match) {
      assetId = match[1];
    }

    if (assetId) {
      if (!assetMap.has(assetId)) {
        assetMap.set(assetId, []);
      }
      assetMap.get(assetId).push(s.name);
    }
  });

  console.log('\nAssets identified:');
  for (const [assetId, files] of assetMap.entries()) {
    console.log(`  ${assetId}: ${files.length} version(s)`);
    files.forEach(f => console.log(`    - ${f}`));
  }

  return { stats, assetMap };
}

/**
 * Phase 3: Query API for asset structure
 */
async function phase3QueryAPI() {
  logSection('PHASE 3: QUERY API FOR ASSET STRUCTURE');

  try {
    // Load session
    if (!fs.existsSync(SESSION_FILE)) {
      log(`⚠ Session file not found: ${SESSION_FILE}`);
      log('Cannot query API without valid session');
      return null;
    }

    const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const cookies = sessionData.cookies || [];

    log(`Session loaded with ${cookies.length} cookies`);

    if (cookies.length === 0) {
      log('⚠ No session cookies found');
      return null;
    }

    // Build cookie header
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    log(`Cookie header prepared (${cookies.length} cookies)\n`);

    // Query the API
    log('Querying /api/3d/creations/list endpoint...\n');

    const apiData = await queryAPI('/api/3d/creations/list', cookieHeader);

    if (apiData) {
      log('API Response received - analyzing structure\n');

      // Parse response to understand asset structure
      const creations = apiData.data || [];
      log(`Found ${creations.length} assets in API\n`);

      if (creations.length > 0) {
        console.log('First asset structure:');
        const firstAsset = creations[0];
        console.log(`  ID: ${firstAsset.id || 'N/A'}`);
        console.log(`  Name: ${firstAsset.name || 'N/A'}`);

        if (firstAsset.urlResult) {
          console.log(`  URL Result (versions):`);
          const urlResult = firstAsset.urlResult;
          if (typeof urlResult === 'object') {
            Object.entries(urlResult).forEach(([key, value]) => {
              console.log(`    - ${key}: ${typeof value === 'string' ? value.substring(0, 60) + '...' : JSON.stringify(value).substring(0, 60) + '...'}`);
            });
          }
        }

        console.log('\nAll assets:');
        creations.forEach((asset, i) => {
          const versions = asset.urlResult ? Object.keys(asset.urlResult).length : 0;
          console.log(`  ${i+1}. ${asset.name || asset.id} - ${versions} version(s)`);
        });
      }

      return { creations, cookieHeader };
    } else {
      log('✗ Failed to query API');
      return null;
    }

  } catch (err) {
    log(`✗ Error: ${err.message}`);
    return null;
  }
}

/**
 * Query the API with session cookies
 */
function queryAPI(endpoint, cookieHeader) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
        // Safety: limit response size
        if (data.length > 100 * 1024 * 1024) {
          req.abort();
          reject(new Error('Response too large'));
        }
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          log(`✗ Failed to parse API response: ${err.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      log(`✗ API request error: ${err.message}`);
      resolve(null);
    });

    req.setTimeout(30000, () => {
      req.abort();
      log('✗ API request timeout');
      resolve(null);
    });

    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  logSection('ASSET CLEANUP & COMPLETION WORKFLOW');

  try {
    // Phase 1: Delete suspicious files
    const deleted = await phase1DeleteSuspiciousFiles();

    // Phase 2: Analyze current state
    const { stats, assetMap } = await phase2AnalyzeCurrentFiles();

    // Phase 3: Query API
    const apiData = await phase3QueryAPI();

    // Summary
    logSection('EXECUTION SUMMARY');
    log(`Phase 1 - Files deleted: ${deleted}`);
    log(`Phase 2 - Current files: ${stats.length}`);
    log(`Phase 2 - Assets identified: ${assetMap.size}`);
    if (apiData) {
      log(`Phase 3 - API assets found: ${apiData.creations.length}`);
    } else {
      log('Phase 3 - API query: Unable to query (session may be invalid)');
    }

    console.log('\n' + '='.repeat(70));
    console.log('Execution complete. Review output above for next steps.');
    console.log('='.repeat(70) + '\n');

  } catch (err) {
    log(`✗ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
