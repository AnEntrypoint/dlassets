const fs = require('fs');
const path = require('path');
const os = require('os');

const HUNYUAN_URL = 'https://3d.hunyuan.tencent.com/assets';
const DOWNLOADS_DIR = 'C:\\usdz\\downloads';
const STATE_FILE = 'C:\\usdz\\download-state.json';
const TIMEOUT_DOWNLOAD = 30000;
const TIMEOUT_FILE_APPEAR = 20000;
const DELAY_BETWEEN_ITEMS = 3000;

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

async function waitForFile(filename, timeout = TIMEOUT_FILE_APPEAR) {
  const startTime = Date.now();
  const targetPath = path.join(DOWNLOADS_DIR, filename);

  while (Date.now() - startTime < timeout) {
    if (fs.existsSync(targetPath)) {
      await new Promise(r => setTimeout(r, 500));
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        console.log(`File appeared: ${filename} (${stats.size} bytes)`);
        return true;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return false;
}

async function waitForPageReady(page, maxWait = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const loading = await page.locator('[class*="loading"], [class*="spinner"]').count();
    const buttons = await page.locator('role=button[name="View model"]').count();
    
    if (loading <= 4 && buttons > 0) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function getItemCount(page) {
  const count = await page.locator('role=button[name="View model"]').count();
  return Math.ceil(count / 4);
}

async function openItemViewer(page, itemIdx, assetIdx) {
  const buttonIndex = itemIdx * 4 + assetIdx;
  
  let buttons = await page.locator('role=button[name="View model"]').all();

  if (buttons.length === 0) {
    throw new Error('No View model buttons found on page');
  }

  if (buttonIndex >= buttons.length) {
    throw new Error(`Button ${buttonIndex} >= ${buttons.length} available`);
  }

  const btn = buttons[buttonIndex];
  await btn.click();
  await page.waitForTimeout(2500);
}

async function selectUSDZFormat(page) {
  try {
    const formatButton = page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).last();
    await formatButton.click();
    await page.waitForTimeout(800);

    const usdzOption = page.locator('text=USDZ').first();
    await usdzOption.click();
    await page.waitForTimeout(800);
  } catch (err) {
    throw new Error(`Failed to select USDZ format: ${err.message}`);
  }
}

async function downloadFile(page, itemIdx, assetIdx) {
  // Files download to browser's default Downloads folder, not DOWNLOADS_DIR
  // We need to monitor the browser Downloads folder and move files here

  const homeDir = require('os').homedir();
  const browserDownloadsDir = path.join(homeDir, 'Downloads');

  if (!fs.existsSync(browserDownloadsDir)) {
    throw new Error(`Browser Downloads folder not found: ${browserDownloadsDir}`);
  }

  // Get current browser Downloads files
  const beforeFiles = fs.readdirSync(browserDownloadsDir).filter(f => f.endsWith('.usdz'));
  const beforeSet = new Set(beforeFiles);

  // Click download button
  const downloadButton = page.locator('role=button[name="download"]').first();
  await downloadButton.click();

  // Wait for a new file to appear in browser Downloads folder
  const startTime = Date.now();
  let newFile = null;
  let newFileFullPath = null;

  while (Date.now() - startTime < TIMEOUT_DOWNLOAD) {
    const afterFiles = fs.readdirSync(browserDownloadsDir).filter(f => f.endsWith('.usdz'));

    // Find new files that appeared in browser Downloads
    const newFiles = afterFiles.filter(f => !beforeSet.has(f));

    if (newFiles.length > 0) {
      // Use the first new file found
      newFile = newFiles[0];
      newFileFullPath = path.join(browserDownloadsDir, newFile);

      // Wait a bit to ensure file is fully written
      await new Promise(r => setTimeout(r, 1500));

      // Verify file exists and has substantial content
      if (fs.existsSync(newFileFullPath)) {
        const stats = fs.statSync(newFileFullPath);
        if (stats.size > 1000000) { // At least 1 MB
          // Move file to target downloads directory
          const targetPath = path.join(DOWNLOADS_DIR, newFile);
          fs.copyFileSync(newFileFullPath, targetPath);

          // Verify copy succeeded
          if (fs.existsSync(targetPath)) {
            const copiedStats = fs.statSync(targetPath);
            if (copiedStats.size === stats.size) {
              console.log(`File appeared and moved: ${newFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
              return newFile;
            }
          }
        }
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error('No new file appeared after download click');
}

async function closeViewer(page) {
  try {
    const buttons = await page.locator('role=button').all();
    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => '');
      if (text.includes('×') || text.trim() === '×') {
        await btn.click();
        await page.waitForTimeout(600);
        return;
      }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } catch (err) {
    console.warn(`Could not close viewer: ${err.message}`);
  }
}

async function recoverPageStability(page) {
  try {
    console.log('  [Recover] Waiting for loading indicators...');
    
    // Wait for loading to complete
    let attempts = 0;
    while (attempts < 15) {
      const loading = await page.locator('[class*="loading"], [class*="spinner"]').count();
      if (loading <= 4) {
        break;
      }
      await page.waitForTimeout(1000);
      attempts++;
    }
    
    // Reset scroll position
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    
    // Scroll to assets
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(500);
    
    // Check for buttons
    const buttonCount = await page.locator('role=button[name="View model"]').count();
    console.log(`  [Recover] Buttons found: ${buttonCount}`);
    
    if (buttonCount > 0) {
      return true;
    }
    
    // Full navigation recovery
    console.log('  [Recover] Full page navigation...');
    await page.goto(HUNYUAN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for loading again
    for (let i = 0; i < 15; i++) {
      const loading = await page.locator('[class*="loading"], [class*="spinner"]').count();
      if (loading <= 4) break;
      await page.waitForTimeout(1000);
    }
    
    // Scroll to assets
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(500);
    
    const finalCount = await page.locator('role=button[name="View model"]').count();
    console.log(`  [Recover] After navigation: ${finalCount} buttons`);
    
    return finalCount > 0;
  } catch (err) {
    console.error(`  [Recover] Failed: ${err.message}`);
    return false;
  }
}

async function downloadAllAssets(context) {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  const state = loadState();
  let page;

  try {
    const pages = context.pages().filter(p => !p.isClosed());
    page = pages.find(p => p.url().includes('hunyuan')) || pages[0];

    if (!page || page.isClosed()) {
      page = await context.newPage();
      await page.goto(HUNYUAN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    console.log('Waiting for page to be ready...');
    const isReady = await waitForPageReady(page);
    if (!isReady) {
      throw new Error('Page failed to load');
    }

    let totalItems = await getItemCount(page);
    console.log(`\nTotal items found: ${totalItems}`);
    console.log(`Resuming from item ${state.currentItemIndex}/${totalItems}`);

    for (let itemIdx = state.currentItemIndex; itemIdx < totalItems; itemIdx++) {
      if (state.completedItems.includes(itemIdx)) {
        console.log(`Skipping item ${itemIdx} (already completed)`);
        continue;
      }

      console.log(`\nProcessing item ${itemIdx + 1}/${totalItems}`);
      const itemAssets = [];

      try {
        for (let assetIdx = 0; assetIdx < 4; assetIdx++) {
          console.log(`  Asset ${assetIdx + 1}/4...`);

          // Verify page is ready before each asset
          const buttonCount = await page.locator('role=button[name="View model"]').count();
          if (buttonCount === 0) {
            console.log(`  Buttons missing, recovering...`);
            const recovered = await recoverPageStability(page);
            if (!recovered) {
              throw new Error('Failed to recover page for asset click');
            }
          }

          await openItemViewer(page, itemIdx, assetIdx);
          await selectUSDZFormat(page);

          const filename = await downloadFile(page, itemIdx, assetIdx);
          itemAssets.push(filename);
          console.log(`    Downloaded: ${filename}`);

          if (assetIdx < 3) {
            await closeViewer(page);
            await page.waitForTimeout(800);
          }
        }

        state.completedItems.push(itemIdx);
        state.downloadedFiles.push(...itemAssets);
        state.currentItemIndex = itemIdx + 1;
        saveState(state);

        console.log(`  Item ${itemIdx + 1} COMPLETE (4 assets)`);
        await closeViewer(page);
        
        // Recover page for next item
        if (itemIdx < totalItems - 1) {
          console.log(`  Preparing for next item...`);
          const recovered = await recoverPageStability(page);
          if (recovered) {
            console.log(`  Delay before next item...`);
            await page.waitForTimeout(DELAY_BETWEEN_ITEMS);
          }
        }

      } catch (err) {
        console.error(`  ERROR on item ${itemIdx}: ${err.message}`);
        console.error(`  Skipping item ${itemIdx} and continuing...`);
        state.currentItemIndex = itemIdx + 1;
        saveState(state);
        try {
          await closeViewer(page);
          await recoverPageStability(page);
        } catch (recoveryErr) {
          console.warn(`Recovery attempt failed: ${recoveryErr.message}`);
        }
      }
    }

    console.log('\n=== DOWNLOAD COMPLETE ===');
    console.log(`Items processed: ${state.completedItems.length}`);
    console.log(`Files downloaded: ${state.downloadedFiles.length}`);
    console.log(`Start time: ${state.startTime}`);
    console.log(`End time: ${new Date().toISOString()}`);

  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    saveState(state);
    throw err;
  }
}

module.exports = downloadAllAssets;
