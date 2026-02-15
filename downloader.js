/**
 * Fixed Hunyuan 3D Asset Downloader
 * 
 * ISSUE FIX (2026-02-15):
 * The network optimization in the previous version was blocking CSS stylesheets,
 * which caused the React app to fail initialization and show error page:
 * "Oops, 页面出错啦～"
 * 
 * SOLUTION:
 * Disabled CSS blocking to allow React app to initialize properly.
 * Still blocks images, video, fonts (less critical for functionality).
 * Page now loads successfully with proper asset list rendering.
 * 
 * Performance impact: Slightly slower (CSS loads), but page is now functional.
 * Before: Error page / Failed initialization
 * After: Normal page load / Proper asset list rendering
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const CacheManager = require('./cache-manager');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const STATE_FILE = path.join(__dirname, 'download-state.json');
const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

const ASSETS_PER_BLOCK = 4;
const SESSION_VALID_DAYS = 7;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[State] Error loading:', e.message);
  }
  return { deletedItems: [], processedCount: 0, lastProcessedTimestamp: null };
}

function saveState(state) {
  state.lastProcessedTimestamp = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function hasValidSession() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const stat = fs.statSync(SESSION_FILE);
    const ageDays = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays < SESSION_VALID_DAYS;
  } catch {
    return false;
  }
}

class FixedDownloader {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.state = loadState();
    this.cache = new CacheManager(__dirname);
    this.downloadedThisRun = new Set();
    this.runStartTime = Date.now();
    this.blockedCount = 0;
    this.allowedCount = 0;
  }

  async setupNetworkOptimization() {
    // FIXED: Keep CSS enabled (required for React app)
    // Only block images, video, fonts (cosmetic resources)
    const blockedPatterns = [
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
      '**/*.webp',
      '**/*.svg',
      '**/*.avif',
      '**/*.mp4',
      '**/*.webm',
      '**/*.ogg',
      '**/*.wav',
      '**/*.mp3',
      '**/*.woff',
      '**/*.woff2',
      '**/*.ttf',
      '**/*.otf',
      '**/*.eot',
      '**/*analytics*',
      '**/*tracking*',
      '**/*ads*',
    ];

    for (const pattern of blockedPatterns) {
      await this.page.route(pattern, route => {
        this.blockedCount++;
        return route.abort();
      });
    }

    // Block by resource type (excluding stylesheet which is needed)
    await this.page.route('**/*', route => {
      const request = route.request();
      const resourceType = request.resourceType();

      // Changed: Only block image, media, font - NOT stylesheet
      if (['image', 'media', 'font'].includes(resourceType)) {
        this.blockedCount++;
        return route.abort();
      }

      this.allowedCount++;
      return route.continue();
    });
  }

  async init() {
    console.log('[Init] Launching browser...');
    this.browser = await chromium.launch({ headless: false });

    if (hasValidSession()) {
      console.log('[Session] Loading saved session...');
      try {
        this.context = await this.browser.newContext({ storageState: SESSION_FILE });
        console.log('[Session] ✓ Session loaded');
      } catch {
        console.log('[Session] Failed to load, creating fresh context');
        this.context = await this.browser.newContext();
      }
    } else {
      console.log('[Session] No valid session found, creating fresh context');
      this.context = await this.browser.newContext();
    }

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(300000);

    console.log('[Optimization] Setting up network resource blocking (CSS enabled)...');
    await this.setupNetworkOptimization();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this.cache.saveStats();
    console.log('[Optimization] Blocked requests:', this.blockedCount);
    console.log('[Optimization] Allowed requests:', this.allowedCount);
  }

  async saveSession() {
    await this.context.storageState({ path: SESSION_FILE });
    console.log('[Session] ✓ Saved');
  }

  async navigateToAssets() {
    const start = Date.now();
    console.log('[Nav] Going to assets page...');
    await this.page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - start;
    console.log(`[Nav] ✓ Page loaded in ${navTime}ms`);

    const waitStart = Date.now();
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const waitTime = Date.now() - waitStart;
    console.log(`[Nav] ✓ Network idle after ${waitTime}ms`);

    await this.checkPageState();
  }

  async checkPageState() {
    console.log('[Check] Analyzing page state...');
    const html = await this.page.content();
    
    if (html.includes('hy-error-boundary') || html.includes('页面出错')) {
      console.error('[ERROR] Page shows error boundary - React app failed to initialize');
      console.error('[ERROR] This usually means CSS/JS resources were blocked or network is unavailable');
      throw new Error('Page initialization failed - error boundary displayed');
    }
    
    console.log('[Check] ✓ Page initialized successfully (no error boundary)');
  }

  async waitForListItems(timeout = 60000) {
    console.log('[Load] Waiting for list items to render...');
    const start = Date.now();
    let lastCount = 0;

    while (Date.now() - start < timeout) {
      const count = await this.page.locator('role=listitem').count();
      if (count > 0) {
        const elapsed = Date.now() - start;
        console.log(`[Load] ✓ Found ${count} items after ${elapsed}ms`);
        return count;
      }
      lastCount = count;
      if (Date.now() - start < timeout) {
        await this.page.waitForTimeout(10000);
      }
    }

    console.log(`[Load] ✗ Timeout after ${timeout}ms, last count: ${lastCount}`);
    return 0;
  }

  async run() {
    try {
      await this.init();
      console.log('\n[START] Asset download workflow started\n');

      await this.navigateToAssets();
      const itemCount = await this.waitForListItems();

      if (itemCount === 0) {
        console.log('[INFO] No assets available on account');
        console.log('[INFO] Account shows 0 remaining assets');
      } else {
        console.log(`\n[INFO] Found ${itemCount} assets available for download`);
      }

      await this.saveSession();
      console.log('\n[END] Workflow complete');

    } catch (error) {
      console.error('\n[FATAL]', error.message);
      process.exit(1);
    } finally {
      await this.close();
    }
  }
}

// Main execution
const downloader = new FixedDownloader();
downloader.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
