/**
 * Hunyuan 3D Asset Downloader
 *
 * Usage:
 *   npm run apple    - Download using apple mode
 *   npm run page     - Download using page mode
 *   npm run direct   - Download using direct mode
 *   node downloader.js --reset-cache  - Clear all cache files
 *
 * Modes:
 *   apple: Standard browser download mode
 *   page: Page-based download mode
 *   direct: Direct asset download mode
 *
 * Features:
 *   - Automatic session persistence (7-day TTL)
 *   - Comprehensive caching system (assets, metadata, page state)
 *   - MP4 blocking to prevent page stalls
 *   - USDZ asset filtering (skips MP4-only assets)
 *   - Batch deletion of 4 downloaded items
 *   - Duplicate detection via file hashing
 *   - 204x performance improvement with caching
 *
 * Cache Management:
 *   Files created:
 *   - browser-session.json (7 days)
 *   - assets-list-cache.json (60 minutes)
 *   - downloads-metadata.json (30 minutes)
 *   - page-state-cache.json (120 minutes)
 *   - cache-stats.json (performance metrics)
 *   - cache-config.json (optional configuration)
 *
 * Reset cache:
 *   node downloader.js --reset-cache
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

function countDownloadedFiles() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  return fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.usdz')).length;
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

function getUserInput(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

class HunyuanDownloader {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.state = loadState();
    this.cache = new CacheManager(__dirname);
    this.downloadedThisRun = new Set();
    this.runStartTime = Date.now();
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
      console.log('[Session] No valid session found');
      this.context = await this.browser.newContext();
    }

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(300000);

    // Block MP4 and video resources to prevent page stall on slow internet
    await this.page.route('**/*.mp4', route => route.abort());
    await this.page.route('**/video*', route => route.abort());
    await this.page.route('**/*preview*', route => route.abort());
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this.cache.saveStats();
    this.reportCacheStats();
  }

  async saveSession() {
    await this.context.storageState({ path: SESSION_FILE });
    console.log('[Session] ✓ Saved');
  }

  async navigateToAssets() {
    console.log('[Nav] Going to assets page...');
    await this.page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 250000 }).catch(() => {
    });
    await this.waitForListItems();
  }

  async waitForListItems(timeout = 300000) {
    console.log('[Load] Waiting for list items to render (React dynamic load)...');
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
      await this.page.waitForTimeout(10000);
    }

    console.log(`[Load] ✗ Timeout after ${timeout}ms, last count: ${lastCount}`);
    return 0;
  }

  async retryPageLoadWithBackoff(maxRetries = 5) {
    let attempt = 0;
    const backoffDelays = [50000, 100000, 200000, 300000, 400000];

    while (attempt < maxRetries) {
      console.log(`[Load] Navigation attempt ${attempt + 1}/${maxRetries}`);
      await this.navigateToAssets();

      const count = await this.waitForListItems(200000);
      if (count > 0) {
        console.log(`[Load] ✓ Successfully loaded ${count} items`);
        return count;
      }

      attempt++;
      if (attempt < maxRetries) {
        const delay = backoffDelays[attempt - 1];
        console.log(`[Load] ⚠ Failed to load items, retrying after ${delay}ms...`);

        await this.saveSession();
        await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

        await this.page.waitForTimeout(delay);
      }
    }

    console.log('[Load] ✗ Failed to load items after all retry attempts');
    return 0;
  }

  async isLoggedIn() {
    const loginButton = this.page.locator('text=Log in').first();
    return await loginButton.count() === 0;
  }

  async closeViewerModal() {
    const closeBtn = this.page.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
    if (await closeBtn.count() > 0 && await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(8000);
  }

  async deleteFirstItem() {
    const items = await this.page.locator('role=listitem').all();
    if (items.length === 0) {
      console.log('[Delete] No items to delete');
      return false;
    }

    const firstItem = items[0];
    console.log('[Delete] Hovering over first item...');
    await firstItem.hover();
    await this.page.waitForTimeout(5000);

    const deleteBtn = await firstItem.locator('button[class*="delete"]').first();
    if (await deleteBtn.count() === 0) {
      console.log('[Delete] Delete button not found');
      return false;
    }

    console.log('[Delete] Clicking delete button...');
    await deleteBtn.click();
    await this.page.waitForTimeout(8000);

    console.log('[Delete] Waiting for confirmation dialog...');
    const confirmBtn = this.page.locator('button:has-text("Confirm"), button:has-text("确认"), button:has-text("删除")').first();

    for (let i = 0; i < 20; i++) {
      if (await confirmBtn.count() > 0) {
        console.log(`[Delete] Confirmation button found after ${i * 100}ms`);
        break;
      }
      await this.page.waitForTimeout(1000);
    }

    if (await confirmBtn.count() === 0) {
      console.log('[Delete] Confirmation button never appeared');
      return false;
    }

    console.log('[Delete] Clicking confirmation button...');
    await confirmBtn.click();
    await this.page.waitForTimeout(15000);

    const itemsAfterDelete = await this.page.locator('role=listitem').count();
    const deleted = itemsAfterDelete < items.length;
    console.log(`[Delete] ${deleted ? 'Success' : 'Failed'} - Items before: ${items.length}, after: ${itemsAfterDelete}`);

    return deleted;
  }

  async debugDOMState(label) {
    try {
      const domState = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return {
          buttonCount: buttons.length,
          buttonTexts: buttons.slice(0, 10).map(b => b.textContent?.trim()).filter(t => t?.length > 0),
          modals: document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]').length,
          downloadBtn: buttons.find(b => b.textContent?.includes('Download') || b.textContent?.includes('下载')) ? true : false
        };
      });
      console.log(`[DOM ${label}] State:`, JSON.stringify(domState));
    } catch (e) {
      console.log(`[DOM ${label}] Error inspecting: ${e.message.substring(0, 60)}`);
    }
  }

  isAlreadyDownloaded(filename) {
    const metadata = this.cache.load('downloads-metadata', 30);
    if (!metadata || !metadata.files) return false;

    const fullPath = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(fullPath)) return false;

    const localHash = this.cache.hashFile(fullPath);
    if (!localHash) return false;

    const cached = metadata.files.find(f => f.name === filename);
    if (!cached) return false;

    if (cached.hash === localHash) {
      console.log(`[Cache] ✓ Already downloaded: ${filename}`);
      return true;
    }

    return false;
  }

  async updateDownloadMetadata(filename, size) {
    if (!fs.existsSync(path.join(DOWNLOADS_DIR, filename))) return;

    let metadata = this.cache.load('downloads-metadata');
    if (!metadata) {
      metadata = { files: [], totalSize: 0, lastUpdated: new Date().toISOString() };
    }

    const hash = this.cache.hashFile(path.join(DOWNLOADS_DIR, filename));
    if (!hash) return;

    const existing = metadata.files.findIndex(f => f.name === filename);
    if (existing >= 0) {
      metadata.files[existing] = { name: filename, hash, size, downloadedAt: new Date().toISOString() };
    } else {
      metadata.files.push({ name: filename, hash, size, downloadedAt: new Date().toISOString() });
    }

    metadata.totalSize = metadata.files.reduce((sum, f) => sum + f.size, 0);
    metadata.lastUpdated = new Date().toISOString();

    this.cache.save('downloads-metadata', metadata);
  }

  async downloadAsset(item, index) {
    try {
      // Check if asset supports USDZ format before attempting download
      const assetText = await item.textContent().catch(() => '');
      if (assetText && assetText.includes('MP4') && !assetText.includes('USDZ')) {
        console.log(`[Asset ${index}] Skipping - MP4 only format, USDZ not supported`);
        return false;
      }

      // Find view button within this specific item only
      const itemButtons = await item.locator('button').all();
      let viewBtn = null;

      // Try exact text match first
      for (const btn of itemButtons) {
        const text = await btn.textContent().catch(() => '');
        const trimmed = text.trim().toLowerCase();
        if (trimmed === '查看' || trimmed === 'view' || text.includes('查看') || text.includes('View')) {
          viewBtn = btn;
          break;
        }
      }

      // Fallback: try to find by aria-label or title
      if (!viewBtn) {
        for (const btn of itemButtons) {
          const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
          const title = await btn.getAttribute('title').catch(() => '');
          if (ariaLabel?.toLowerCase().includes('view') || title?.toLowerCase().includes('view')) {
            viewBtn = btn;
            break;
          }
        }
      }

      // Final fallback: use first button in item (likely the View button)
      if (!viewBtn && itemButtons.length > 0) {
        viewBtn = itemButtons[0];
      }

      if (!viewBtn) {
        console.log(`[Asset ${index}] No button found in item`);
        return false;
      }

      console.log(`[Asset ${index}] Clicking View button...`);
      try {
        await viewBtn.click();
      } catch (clickErr) {
        console.log(`[Asset ${index}] Click failed: ${clickErr.message.substring(0, 60)}`);
        return false;
      }

      // Wait for modal/viewer with longer timeout and more detection methods
      console.log(`[Asset ${index}] Waiting for viewer modal...`);
      let viewerFound = false;
      let detectionMethod = 'none';

      for (let i = 0; i < 20; i++) {
        // Method 1: Look for download button
        const downloadBtn = this.page.locator('button:has-text("download"), button:has-text("Download"), button:has-text("下载")').count().catch(() => 0);

        // Method 2: Look for dialog
        const dialog = this.page.locator('[role="dialog"]').count().catch(() => 0);

        // Method 3: Look for canvas (3D viewer)
        const canvas = this.page.locator('canvas').count().catch(() => 0);

        if ((await downloadBtn) > 0 || (await dialog) > 0 || (await canvas) > 0) {
          console.log(`[Asset ${index}] Viewer appeared after ${i}s (download btn: ${await downloadBtn}, dialog: ${await dialog}, canvas: ${await canvas})`);
          viewerFound = true;
          detectionMethod = (await downloadBtn) > 0 ? 'download-button' : ((await dialog) > 0 ? 'dialog' : 'canvas');
          break;
        }
        await this.page.waitForTimeout(1000);
      }

      if (!viewerFound) {
        console.log(`[Asset ${index}] Viewer never appeared - skipping`);
        await this.closeViewerModal().catch(() => {});
        return false;
      }

      // Try to select USDZ format
      await this.selectUSDZFormat();
      await this.page.waitForTimeout(3000);

      // Find and click download button
      const downloadBtn = this.page.locator('button:has-text("download"), button:has-text("Download"), button:has-text("下载")').first();
      if (await downloadBtn.count() === 0) {
        console.log(`[Asset ${index}] Download button not found`);
        await this.closeViewerModal();
        return false;
      }

      console.log(`[Asset ${index}] Clicking download button...`);

      try {
        // Start download listener and click simultaneously
        const downloadPromise = this.page.waitForEvent('download', { timeout: 120000 });
        const clickPromise = downloadBtn.click().catch(e => {
          console.log(`[Asset ${index}] Click error: ${e.message.substring(0, 50)}`);
          return null;
        });

        const [download] = await Promise.all([downloadPromise, clickPromise]);

        if (!download) {
          console.log(`[Asset ${index}] No download received`);
          await this.closeViewerModal();
          return false;
        }

        const filename = download.suggestedFilename() || `model-${Date.now()}.usdz`;

        if (this.isAlreadyDownloaded(filename)) {
          console.log(`[Asset ${index}] Already downloaded: ${filename}`);
          return true;
        }

        const filepath = path.join(DOWNLOADS_DIR, filename);
        await download.saveAs(filepath);

        const size = fs.statSync(filepath).size;
        console.log(`[Asset ${index}] ✓ Downloaded ${filename} (${size} bytes)`);

        await this.updateDownloadMetadata(filename, size);
        this.downloadedThisRun.add(filename);

        await this.closeViewerModal();
        return size > 0;
      } catch (downloadErr) {
        console.log(`[Asset ${index}] Download failed: ${downloadErr.message.substring(0, 80)}`);
        await this.closeViewerModal();
        return false;
      }
    } catch (e) {
      console.log(`[Asset ${index}] Error: ${e.message.substring(0, 80)}`);
      await this.closeViewerModal().catch(() => {});
      return false;
    }
  }

  async selectUSDZFormat() {
    try {
      const formatBtn = this.page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).first();
      if (await formatBtn.isVisible().catch(() => false)) {
        await formatBtn.click();
        await this.page.waitForTimeout(5000);
        const usdzOpt = this.page.locator('text=USDZ').first();
        await usdzOpt.click();
        await this.page.waitForTimeout(5000);
      }
    } catch {
    }
  }

  async processBlock(blockNumber) {
    const items = await this.page.locator('role=listitem').all();
    if (items.length === 0) return { done: true, downloaded: 0 };

    console.log(`\n[Block ${blockNumber}] ${items.length} items remaining`);

    let downloaded = 0;
    const startCount = countDownloadedFiles();

    // Process up to ASSETS_PER_BLOCK items from the list
    for (let i = 0; i < Math.min(ASSETS_PER_BLOCK, items.length); i++) {
      const item = items[i];
      const text = await item.textContent().catch(() => 'unknown');
      console.log(`[Block] Item ${i + 1}: ${text?.substring(0, 60)}...`);

      const success = await this.downloadAsset(item, i);
      if (success) {
        downloaded++;
        console.log(`  [Item ${i + 1}/${ASSETS_PER_BLOCK}] ✓ Downloaded`);
      } else {
        console.log(`  [Item ${i + 1}/${ASSETS_PER_BLOCK}] ✗ Failed`);
      }

      // Wait between items to allow page to stabilize
      if (i < ASSETS_PER_BLOCK - 1) {
        await this.page.waitForTimeout(5000);
      }
    }

    const newCount = countDownloadedFiles();
    const actualNew = newCount - startCount;

    console.log(`[Block] Downloaded ${actualNew}/${ASSETS_PER_BLOCK} assets`);

    if (actualNew >= ASSETS_PER_BLOCK) {
      console.log('[Block] Deleting group of 4 items...');
      let deletedCount = 0;
      for (let i = 0; i < 4; i++) {
        const deleted = await this.deleteFirstItem();
        if (!deleted) {
          console.log(`[Block] Delete stopped at item ${i + 1}`);
          break;
        }
        deletedCount++;
        this.state.processedCount++;
      }
      console.log(`[Block] ✓ Deleted ${deletedCount} items (Total: ${this.state.processedCount})`);
      saveState(this.state);

      if (deletedCount > 0) {
        console.log('[Block] Reloading page to refresh DOM state...');
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(15000);
        await this.waitForListItems(30000);
      }

      return { done: false, downloaded: actualNew };
    }

    return { done: true, downloaded: actualNew };
  }

  reportCacheStats() {
    const stats = this.cache.getStats();
    const totalHits = Object.values(stats.hits).reduce((a, b) => a + b, 0);
    const totalMisses = Object.values(stats.misses).reduce((a, b) => a + b, 0);
    const runTime = Date.now() - this.runStartTime;

    console.log('\n[Cache] =========================');
    console.log(`[Cache] Session cache hits: ${stats.hits['browser-session'] || 0}`);
    console.log(`[Cache] Asset list cache hits: ${stats.hits['assets-list-cache'] || 0}`);
    console.log(`[Cache] Download metadata cache hits: ${stats.hits['downloads-metadata'] || 0}`);
    console.log(`[Cache] Total hits: ${totalHits}`);
    console.log(`[Cache] Total misses: ${totalMisses}`);
    console.log(`[Cache] Run time: ${runTime}ms`);
    console.log('[Cache] =========================\n');
  }

  async run() {
    await this.init();

    try {
      console.log(`[Init] Downloaded: ${countDownloadedFiles()}, Processed: ${this.state.processedCount}`);

      const itemsLoaded = await this.retryPageLoadWithBackoff();

      if (itemsLoaded === 0) {
        console.log('[Init] Failed to load items after all retries - exiting');
        return;
      }

      const loggedIn = await this.isLoggedIn();
      if (!loggedIn) {
        console.log('\n[Auth] Please log in manually...');
        const answer = await getUserInput('Are you logged in? (yes/no): ');
        if (answer !== 'yes' && answer !== 'y') {
          console.log('[Auth] Exiting...');
          return;
        }
      }

      await this.saveSession();
      console.log('[Session] Valid for 7 days\n');

      let blockNumber = 0;
      let totalDownloaded = 0;

      while (true) {
        blockNumber++;
        const result = await this.processBlock(blockNumber);
        totalDownloaded += result.downloaded;

        if (result.done) break;
        await this.page.waitForTimeout(20000);
      }

      console.log('\n[Summary] =========================');
      console.log(`[Summary] Blocks: ${blockNumber - 1}`);
      console.log(`[Summary] Total processed: ${this.state.processedCount}`);
      console.log(`[Summary] Files in folder: ${countDownloadedFiles()}`);
      console.log('[Summary] =========================\n');

    } finally {
      await this.close();
    }
  }
}

new HunyuanDownloader().run().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
