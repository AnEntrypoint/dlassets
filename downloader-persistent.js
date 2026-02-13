#!/usr/bin/env node
/**
 * USDZ Persistent Downloader - Reuses saved login session
 * Saves browser state after login so future runs don't require re-authentication
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DOWNLOADS_DIR = 'C:\\usdz\\downloads';
const STATE_FILE = 'C:\\usdz\\download-state.json';
const SESSION_FILE = 'C:\\usdz\\browser-session.json';
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

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
  const files = fs.readdirSync(DOWNLOADS_DIR);
  return files.filter(f => f.endsWith('.usdz')).length;
}

function hasValidSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return false;
  }
  try {
    const stat = fs.statSync(SESSION_FILE);
    // Session valid for 7 days
    const ageMs = Date.now() - stat.mtime.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays < 7;
  } catch (e) {
    return false;
  }
}

async function closeViewer(page) {
  try {
    let closeButton = page.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
    let count = await closeButton.count().catch(() => 0);

    if (count > 0) {
      console.log('[Viewer] Closing with button...');
      await closeButton.click();
      await page.waitForTimeout(800);
      return true;
    }

    console.log('[Viewer] Closing with Escape key...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    return true;
  } catch (err) {
    console.log('[Viewer] Close error:', err.message);
    return false;
  }
}

async function deleteItem(page, listitemIndex) {
  try {
    const listitems = await page.locator('role=listitem').all();

    if (listitems.length === 0) {
      throw new Error('No listitems found');
    }

    if (listitemIndex >= listitems.length) {
      throw new Error('Index out of bounds');
    }

    const targetListitem = listitems[listitemIndex];

    await targetListitem.hover();
    await page.waitForTimeout(300);

    const buttonsInListitem = await targetListitem.locator('role=button').all();

    if (buttonsInListitem.length < 5) {
      throw new Error('Not enough buttons in listitem');
    }

    const deleteButton = buttonsInListitem[4];

    const innerHTML = await deleteButton.innerHTML().catch(() => '');
    if (!innerHTML.includes('t-icon-delete')) {
      throw new Error('Delete button not found');
    }

    console.log('[Delete] Clicking delete button...');
    await deleteButton.click();
    await page.waitForTimeout(1000);

    let confirmButton = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      confirmButton = page.locator('role=button[name="Confirm deletion"]');
      const count = await confirmButton.count();
      if (count > 0) break;
      await page.waitForTimeout(200);
    }

    if (!confirmButton || await confirmButton.count() === 0) {
      throw new Error('Confirmation modal did not appear');
    }

    console.log('[Delete] Confirming deletion...');
    await confirmButton.click();
    await page.waitForTimeout(1200);

    return true;

  } catch (err) {
    console.warn('[Delete] Error:', err.message);
    return false;
  }
}

async function getUserConfirmation(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function runAutomation() {
  let browser;
  try {
    console.log('[Init] Launching browser...');
    browser = await chromium.launch({ headless: false });
    let context;

    // Check if we have a valid saved session
    if (hasValidSession()) {
      console.log('[Session] Found valid saved session - loading...');
      try {
        context = await browser.newContext({ storageState: SESSION_FILE });
        console.log('[Session] ✓ Session loaded');
      } catch (e) {
        console.log('[Session] Could not load saved session, starting fresh');
        context = await browser.newContext({
          extraHTTPHeaders: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
      }
    } else {
      console.log('[Session] No saved session or session expired');
      context = await browser.newContext({
        extraHTTPHeaders: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    }

    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    const page = await context.newPage();

    const state = loadState();
    console.log('[Init] Files already downloaded: ' + countDownloadedFiles());
    console.log('[Init] Items processed: ' + state.processedCount);

    console.log('[Nav] Navigating to website...');
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[Nav] Page loaded');

    // Wait for user to verify login (if session was loaded, this should be instant)
    console.log('\n[AUTH] Please verify you are logged in.');
    const confirmed = await getUserConfirmation('Are you logged in? (yes/no): ');

    if (!confirmed) {
      console.log('[AUTH] Please log in and try again.');
      await browser.close();
      return;
    }

    // Save the session for future use
    console.log('[Session] Saving session for future use...');
    await context.storageState({ path: SESSION_FILE });
    console.log('[Session] ✓ Session saved to: ' + SESSION_FILE);
    console.log('[Session] Next run will reuse this session (valid for 7 days)\n');

    await page.waitForTimeout(2000);

    console.log('[Wait] Checking for items...');
    let attempts = 0;
    while (attempts < 30) {
      const itemCount = await page.locator('role=listitem').count();
      if (itemCount > 0) {
        console.log('[Wait] Found ' + itemCount + ' items\n');
        break;
      }
      await page.waitForTimeout(500);
      attempts++;
    }

    let processedCount = 0;
    let blockNumber = 0;

    while (true) {
      blockNumber++;
      const listitems = await page.locator('role=listitem').all();

      if (listitems.length === 0) {
        console.log('\n[Complete] ✓ No items remaining! All blocks processed!');
        break;
      }

      console.log(`\n[Block ${blockNumber}] Found ${listitems.length} remaining items`);

      const targetListitem = listitems[0];

      try {
        const itemText = await targetListitem.textContent();
        console.log('[Block] Item: ' + (itemText?.substring(0, 70) || 'unknown'));

        let viewModelButtons = await targetListitem.locator('role=button[name="View model"]').all();
        if (viewModelButtons.length === 0) {
          viewModelButtons = await targetListitem.locator('role=button[name="查看模型"]').all();
        }

        console.log('[Block] Found ' + viewModelButtons.length + ' assets');

        let downloadsThisBlock = 0;
        const assetStartCount = countDownloadedFiles();

        for (let j = 0; j < Math.min(4, viewModelButtons.length); j++) {
          try {
            console.log(`  [Asset ${j + 1}/4] Starting...`);

            // Re-fetch buttons
            let freshButtons = await targetListitem.locator('role=button[name="View model"]').all();
            if (freshButtons.length === 0) {
              freshButtons = await targetListitem.locator('role=button[name="查看模型"]').all();
            }

            if (j >= freshButtons.length) {
              console.log(`  [Asset ${j + 1}/4] Button not available`);
              continue;
            }

            await freshButtons[j].click();
            await page.waitForTimeout(3000);

            // Try to select USDZ format
            try {
              const formatButton = page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).last();
              if (await formatButton.isVisible().catch(() => false)) {
                await formatButton.click();
                await page.waitForTimeout(800);
                const usdzOption = page.locator('text=USDZ').first();
                await usdzOption.click();
                await page.waitForTimeout(800);
              }
            } catch (e) {
              console.log(`  [Asset ${j + 1}/4] Format selection skipped`);
            }

            // Download
            try {
              const downloadButton = page.locator('role=button[name="download"]').first();
              if (await downloadButton.count() > 0) {
                await downloadButton.click();
                await page.waitForTimeout(2000);
                console.log(`  [Asset ${j + 1}/4] ✓ Downloaded`);
                downloadsThisBlock++;
              }
            } catch (e) {
              console.log(`  [Asset ${j + 1}/4] Download failed: ${e.message}`);
            }

          } catch (error) {
            console.log(`  [Asset ${j + 1}/4] Error: ${error.message}`);
          }
        }

        const assetsNow = countDownloadedFiles();
        const newAssets = assetsNow - assetStartCount;
        console.log(`[Block] Downloaded ${newAssets} new files (Total: ${assetsNow})`);

        if (newAssets >= 4) {
          console.log('[Block] All 4 assets found! Closing viewer...');
          await closeViewer(page);
          await page.waitForTimeout(1500);

          console.log('[Block] Deleting block...');
          const deleteSuccess = await deleteItem(page, 0);

          if (deleteSuccess) {
            state.deletedItems.push(blockNumber - 1);
            state.processedCount++;
            saveState(state);
            console.log(`[Block] ✓ Deleted block #${blockNumber}`);
            console.log(`        Total blocks: ${state.deletedItems.length} | Files: ${countDownloadedFiles()}`);
            processedCount++;

            await page.waitForTimeout(2000);
          } else {
            console.log('[Block] Delete failed - stopping');
            break;
          }
        } else if (newAssets > 0) {
          console.log(`[Block] Only ${newAssets} assets downloaded (expected 4) - stopping`);
          break;
        } else {
          console.log('[Block] No new assets downloaded - stopping');
          break;
        }

      } catch (error) {
        console.log('[Block] Error: ' + error.message);
        break;
      }
    }

    console.log('\n[Summary] ============================================');
    console.log(`[Summary] Blocks processed: ${processedCount}`);
    console.log(`[Summary] Total blocks deleted: ${state.deletedItems.length}`);
    console.log(`[Summary] Total files downloaded: ${countDownloadedFiles()}`);
    console.log('[Summary] ============================================\n');

    console.log('[Session] ✓ Session saved for next run');
    console.log('[Session] Next time, just run: node downloader-persistent.js');
    console.log('[Session] (No login needed for 7 days)\n');

  } catch (err) {
    console.error('[Fatal Error]', err.message);
  } finally {
    if (browser) {
      console.log('[Cleanup] Closing browser...');
      await browser.close();
    }
  }
}

runAutomation().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
