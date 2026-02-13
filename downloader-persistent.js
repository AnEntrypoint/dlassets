const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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
    this.page.setDefaultTimeout(30000);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async saveSession() {
    await this.context.storageState({ path: SESSION_FILE });
    console.log('[Session] ✓ Saved');
  }

  async navigateToAssets() {
    console.log('[Nav] Going to assets page...');
    await this.page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {
      // Network idle timeout is normal for SPAs, continue anyway
    });
    await this.waitForListItems();
  }

  async waitForListItems(timeout = 30000) {
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
      await this.page.waitForTimeout(500);
    }

    console.log(`[Load] ✗ Timeout after ${timeout}ms, last count: ${lastCount}`);
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
    await this.page.waitForTimeout(800);
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
    await this.page.waitForTimeout(500);

    const deleteBtn = await firstItem.locator('button[class*="delete"]').first();
    if (await deleteBtn.count() === 0) {
      console.log('[Delete] Delete button not found');
      return false;
    }

    console.log('[Delete] Clicking delete button...');
    await deleteBtn.click();
    await this.page.waitForTimeout(800);

    console.log('[Delete] Waiting for confirmation dialog...');
    const confirmBtn = this.page.locator('button:has-text("Confirm"), button:has-text("确认"), button:has-text("删除")').first();

    for (let i = 0; i < 20; i++) {
      if (await confirmBtn.count() > 0) {
        console.log(`[Delete] Confirmation button found after ${i * 100}ms`);
        break;
      }
      await this.page.waitForTimeout(100);
    }

    if (await confirmBtn.count() === 0) {
      console.log('[Delete] Confirmation button never appeared');
      return false;
    }

    console.log('[Delete] Clicking confirmation button...');
    await confirmBtn.click();
    await this.page.waitForTimeout(1500);

    const itemsAfterDelete = await this.page.locator('role=listitem').count();
    const deleted = itemsAfterDelete < items.length;
    console.log(`[Delete] ${deleted ? 'Success' : 'Failed'} - Items before: ${items.length}, after: ${itemsAfterDelete}`);

    return deleted;
  }

  async downloadAsset(item, index) {
    try {
      const viewButtons = await item.locator('button:has-text("查看")').all();
      if (index >= viewButtons.length) {
        console.log(`[Asset ${index}] No button at index (have ${viewButtons.length})`);
        return false;
      }

      const viewBtn = viewButtons[index];
      console.log(`[Asset ${index}] Clicking View button...`);
      await viewBtn.click();

      console.log(`[Asset ${index}] Waiting for viewer to appear (up to 10 seconds)...`);
      let viewerFound = false;
      for (let i = 0; i < 10; i++) {
        const downloadBtn = this.page.locator('button:has-text("download"), button:has-text("Download"), button:has-text("下载")');
        if (await downloadBtn.count() > 0) {
          console.log(`[Asset ${index}] Viewer/download button found after ${i}s`);
          viewerFound = true;
          break;
        }
        await this.page.waitForTimeout(1000);
      }

      if (!viewerFound) {
        console.log(`[Asset ${index}] Viewer never appeared - skipping`);
        await this.closeViewerModal().catch(() => {});
        return false;
      }

      await this.selectUSDZFormat();
      await this.page.waitForTimeout(800);

      const downloadBtn = this.page.locator('button:has-text("download"), button:has-text("Download"), button:has-text("下载")').first();
      if (await downloadBtn.count() === 0) {
        console.log(`[Asset ${index}] Download button not found`);
        await this.closeViewerModal();
        return false;
      }

      console.log(`[Asset ${index}] Attempting download...`);

      try {
        const [download] = await Promise.all([
          this.page.waitForEvent('download', { timeout: 20000 }),
          downloadBtn.click()
        ]);

        const filename = download.suggestedFilename() || `model-${Date.now()}.usdz`;
        const filepath = path.join(DOWNLOADS_DIR, filename);
        await download.saveAs(filepath);

        const size = fs.statSync(filepath).size;
        console.log(`[Asset ${index}] ✓ Downloaded ${size} bytes`);

        await this.closeViewerModal();
        return size > 0;
      } catch (downloadErr) {
        console.log(`[Asset ${index}] Download failed: ${downloadErr.message.substring(0, 60)}`);
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
        await this.page.waitForTimeout(500);
        const usdzOpt = this.page.locator('text=USDZ').first();
        await usdzOpt.click();
        await this.page.waitForTimeout(500);
      }
    } catch {
      // Format selection not available
    }
  }

  async processBlock(blockNumber) {
    const items = await this.page.locator('role=listitem').all();
    if (items.length === 0) return { done: true, downloaded: 0 };

    console.log(`\n[Block ${blockNumber}] ${items.length} items remaining`);

    const firstItem = items[0];
    const text = await firstItem.textContent().catch(() => 'unknown');
    console.log(`[Block] Processing: ${text?.substring(0, 50)}...`);

    let downloaded = 0;
    const startCount = countDownloadedFiles();

    for (let i = 0; i < ASSETS_PER_BLOCK; i++) {
      const success = await this.downloadAsset(firstItem, i);
      if (success) {
        downloaded++;
        console.log(`  [Asset ${i + 1}/${ASSETS_PER_BLOCK}] ✓ Downloaded`);
      } else {
        console.log(`  [Asset ${i + 1}/${ASSETS_PER_BLOCK}] ✗ Failed`);
      }
    }

    const newCount = countDownloadedFiles();
    const actualNew = newCount - startCount;

    console.log(`[Block] Downloaded ${actualNew}/${ASSETS_PER_BLOCK} assets`);

    if (actualNew >= ASSETS_PER_BLOCK) {
      console.log('[Block] Deleting item...');
      const deleted = await this.deleteFirstItem();
      if (deleted) {
        this.state.processedCount++;
        saveState(this.state);
        console.log(`[Block] ✓ Deleted (Total: ${this.state.processedCount})`);
        return { done: false, downloaded: actualNew };
      }
    }

    return { done: true, downloaded: actualNew };
  }

  async run() {
    await this.init();

    try {
      console.log(`[Init] Downloaded: ${countDownloadedFiles()}, Processed: ${this.state.processedCount}`);

      await this.navigateToAssets();

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
        await this.page.waitForTimeout(2000);
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
