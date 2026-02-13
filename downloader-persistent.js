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
    await this.waitForListItems();
  }

  async waitForListItems(timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const count = await this.page.locator('role=listitem').count();
      if (count > 0) return count;
      await this.page.waitForTimeout(500);
    }
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
    if (items.length === 0) return false;

    const firstItem = items[0];
    await firstItem.hover();
    await this.page.waitForTimeout(300);

    const buttons = await firstItem.locator('role=button').all();
    if (buttons.length < 5) return false;

    const deleteBtn = buttons[4];
    const html = await deleteBtn.innerHTML().catch(() => '');
    if (!html.includes('t-icon-delete')) return false;

    await deleteBtn.click();
    await this.page.waitForTimeout(500);

    const confirmBtn = this.page.locator('role=button[name="Confirm deletion"], button:has-text("Confirm")');
    for (let i = 0; i < 15; i++) {
      if (await confirmBtn.count() > 0) break;
      await this.page.waitForTimeout(200);
    }

    if (await confirmBtn.count() === 0) return false;

    await confirmBtn.click();
    await this.page.waitForTimeout(1000);
    return true;
  }

  async downloadAsset(item, index) {
    const viewButtons = await item.locator('role=button[name="View model"], role=button[name="查看模型"]').all();
    if (index >= viewButtons.length) return false;

    await viewButtons[index].click();
    await this.page.waitForTimeout(2000);

    await this.selectUSDZFormat();

    const downloadBtn = this.page.locator('role=button[name="download"], button:has-text("Download")').first();
    if (await downloadBtn.count() === 0) {
      await this.closeViewerModal();
      return false;
    }

    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 30000 }),
      downloadBtn.click()
    ]);

    const filename = download.suggestedFilename() || `model-${Date.now()}.usdz`;
    const filepath = path.join(DOWNLOADS_DIR, filename);
    await download.saveAs(filepath);

    await this.closeViewerModal();
    return fs.existsSync(filepath) && fs.statSync(filepath).size > 0;
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
