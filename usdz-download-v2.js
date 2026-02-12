
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = 'C:\\usdz\\downloads';
const STATE_FILE = 'C:\\usdz\\download-state.json';

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return {
    completedItems: [],
    currentItemIndex: 0,
    downloadedFiles: [],
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString()
  };
}

function saveState(state) {
  state.lastUpdate = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Main downloader function
async function downloadAllAssets(context) {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  const state = loadState();
  const pages = context.pages().filter(p => !p.isClosed());
  let page = pages.find(p => p.url().includes('hunyuan')) || pages[0];

  if (!page || page.isClosed()) {
    page = await context.newPage();
    await page.goto('https://3d.hunyuan.tencent.com/assets', { waitUntil: 'domcontentloaded' });
  }

  // Wait for page ready
  for (let i = 0; i < 20; i++) {
    const loading = await page.locator('[class*="loading"]').count();
    const buttons = await page.locator('role=button[name="View model"]').count();
    if (loading <= 4 && buttons > 0) break;
    await page.waitForTimeout(500);
  }

  const totalItems = Math.ceil(await page.locator('role=button[name="View model"]').count() / 4);
  console.log(`Total items: ${totalItems}, Resuming from: ${state.currentItemIndex}`);

  // Capture download URLs from responses
  let capturedUrls = {};
  page.on('response', (res) => {
    if (res.url().includes('cos.accelerate') && res.status() === 200) {
      const key = 'last_url_' + Date.now();
      capturedUrls[key] = res.url();
    }
  });

  for (let itemIdx = state.currentItemIndex; itemIdx < totalItems; itemIdx++) {
    if (state.completedItems.includes(itemIdx)) continue;

    console.log(`\nItem ${itemIdx + 1}/${totalItems}`);
    const itemAssets = [];

    try {
      for (let assetIdx = 0; assetIdx < 4; assetIdx++) {
        // Verify buttons exist
        const buttons = await page.locator('role=button[name="View model"]').all();
        if (buttons.length === 0) {
          // Recover page
          await page.goto('https://3d.hunyuan.tencent.com/assets', { waitUntil: 'domcontentloaded' });
          for (let i = 0; i < 10; i++) {
            const btns = await page.locator('role=button[name="View model"]').count();
            if (btns > 0) break;
            await page.waitForTimeout(500);
          }
          const newButtons = await page.locator('role=button[name="View model"]').all();
          if (newButtons.length === 0) throw new Error('Cannot recover page');
        }

        // Click button
        const buttonIndex = itemIdx * 4 + assetIdx;
        const btn = await page.locator('role=button[name="View model"]').all();
        if (buttonIndex >= btn.length) throw new Error(`Button ${buttonIndex} out of range`);
        
        console.log(`  Asset ${assetIdx + 1}/4...`);
        await btn[buttonIndex].click();
        await page.waitForTimeout(2500);

        // Select USDZ format
        try {
          const formatBtn = page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).last();
          await formatBtn.click();
          await page.waitForTimeout(600);
          await page.locator('text=USDZ').first().click();
          await page.waitForTimeout(600);
        } catch (e) {
          console.log(`    Format selection failed: ${e.message}`);
        }

        // Clear previous URLs
        const baselineUrl = Object.keys(capturedUrls)[Object.keys(capturedUrls).length - 1];
        
        // Click download
        const dlBtn = await page.locator('role=button[name="download"]').first();
        await dlBtn.click({ timeout: 5000 }).catch(() => {});
        
        // Wait for URL to appear
        let downloadUrl = null;
        for (let w = 0; w < 10; w++) {
          const urls = Object.values(capturedUrls);
          const newUrl = urls[urls.length - 1];
          if (newUrl && newUrl !== baselineUrl) {
            downloadUrl = newUrl;
            break;
          }
          await page.waitForTimeout(500);
        }

        if (downloadUrl) {
          const filename = `asset_${itemIdx}_${assetIdx}_${Date.now()}.usdz`;
          itemAssets.push(filename);
          console.log(`    ✓ Got download URL for ${filename}`);
          
          // Store for later download
          if (!state.pendingDownloads) state.pendingDownloads = [];
          state.pendingDownloads.push({ url: downloadUrl, filename });
        }

        // Close modal
        try {
          const closeBtns = await page.locator('role=button').all();
          for (const cb of closeBtns) {
            const txt = await cb.textContent().catch(() => '');
            if (txt.includes('×')) {
              await cb.click();
              await page.waitForTimeout(500);
              break;
            }
          }
        } catch (e) {}

        if (assetIdx < 3) await page.waitForTimeout(500);
      }

      if (itemAssets.length === 4) {
        state.completedItems.push(itemIdx);
        state.downloadedFiles.push(...itemAssets);
        console.log(`  ✓ Item complete`);
      }
      
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }

    state.currentItemIndex = itemIdx + 1;
    saveState(state);
    await page.waitForTimeout(1000);
  }

  console.log(`\nDownload URLs captured: ${state.pendingDownloads?.length || 0}`);
  return state;
}

module.exports = downloadAllAssets;
