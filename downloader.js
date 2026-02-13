#!/usr/bin/env node
/**
 * USDZ Downloader - Download and delete 3D assets from Hunyuan
 * Usage: node downloader.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = 'C:\\usdz\\downloads';
const STATE_FILE = 'C:\\usdz\\download-state.json';
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading state:', e.message);
  }
  return { completedItems: [], currentItemIndex: 0, startTime: new Date().toISOString() };
}

function saveState(state) {
  state.lastUpdate = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function countDownloadedFiles() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  const files = fs.readdirSync(DOWNLOADS_DIR);
  return files.filter(f => f.endsWith('.usdz')).length;
}

async function closeViewer(page) {
  try {
    const closeButton = page.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
    const count = await closeButton.count().catch(() => 0);

    if (count > 0) {
      console.log('[Viewer] Closing viewer...');
      await closeButton.click();
      await page.waitForTimeout(600);
      return true;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    return true;
  } catch (err) {
    console.warn('[Viewer] Error closing:', err.message);
    return false;
  }
}

async function deleteItem(page, listitemIndex) {
  try {
    const listitems = await page.locator('role=listitem').all();
    if (listitems.length === 0) throw new Error('No listitems found');
    if (listitemIndex >= listitems.length) throw new Error('Index out of bounds');

    const targetListitem = listitems[listitemIndex];
    await targetListitem.hover();
    await page.waitForTimeout(300);

    const buttonsInListitem = await targetListitem.locator('role=button').all();
    if (buttonsInListitem.length < 5) throw new Error('Not enough buttons');

    const deleteButton = buttonsInListitem[4];
    const innerHTML = await deleteButton.innerHTML().catch(() => '');
    if (!innerHTML.includes('t-icon-delete')) throw new Error('Wrong button');

    await deleteButton.click();
    await page.waitForTimeout(1000);

    const confirmButton = page.locator('role=button[name="Confirm deletion"]');
    let found = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      if (await confirmButton.count() > 0) {
        found = true;
        break;
      }
      await page.waitForTimeout(200);
    }

    if (!found) throw new Error('Confirmation modal not found');
    await confirmButton.click();
    await page.waitForTimeout(1200);

    return true;
  } catch (err) {
    console.warn('[Delete] Error:', err.message);
    return false;
  }
}

async function runAutomation() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  const page = await context.newPage();

  try {
    const state = loadState();
    console.log('[Start] Downloader starting');
    console.log('[Start] Files already downloaded:', countDownloadedFiles());

    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    console.log('[Start] Page loaded');
    await page.waitForTimeout(3000);

    let processedCount = 0;
    while (true) {
      const listitems = await page.locator('role=listitem').all();
      if (listitems.length === 0) {
        console.log('[Done] No items found. All completed.');
        break;
      }

      console.log('[Items] Found ' + listitems.length + ' items');
      const targetListitem = listitems[0];

      try {
        const itemText = await targetListitem.textContent();
        console.log('[Item] Processing: ' + (itemText?.substring(0, 60) || 'unknown'));

        let viewModelButtons = await targetListitem.locator('role=button[name="View model"]').all();
        if (viewModelButtons.length === 0) {
          viewModelButtons = await targetListitem.locator('role=button[name="查看模型"]').all();
        }

        let downloadsThisItem = 0;
        for (let j = 0; j < Math.min(4, viewModelButtons.length); j++) {
          try {
            console.log('[Asset ' + (j + 1) + '/4] Downloading...');
            const freshButtons = await targetListitem.locator('role=button[name="View model"]').all();
            if (freshButtons.length === 0) {
              await targetListitem.locator('role=button[name="查看模型"]').all();
            }

            if (j < freshButtons.length) {
              await freshButtons[j].click();
              await page.waitForTimeout(2500);

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
                console.log('[Asset ' + (j + 1) + '/4] Format selection skipped');
              }

              try {
                const downloadButton = page.locator('role=button[name="download"]').first();
                if (await downloadButton.count() > 0) {
                  await downloadButton.click();
                  console.log('[Asset ' + (j + 1) + '/4] Downloaded');
                  downloadsThisItem++;
                }
              } catch (e) {
                console.log('[Asset ' + (j + 1) + '/4] Download failed');
              }
            }
          } catch (error) {
            console.log('[Asset ' + (j + 1) + '/4] Error: ' + error.message);
          }
        }

        if (downloadsThisItem > 0) {
          await closeViewer(page);
          await page.waitForTimeout(800);

          if (await deleteItem(page, 0)) {
            state.completedItems.push(processedCount);
            state.currentItemIndex = processedCount + 1;
            saveState(state);
            console.log('[Item] Deleted. Total files: ' + countDownloadedFiles());
            processedCount++;
            await page.waitForTimeout(1000);
          } else {
            console.log('[Item] Delete failed');
            break;
          }
        }

      } catch (error) {
        console.log('[Item] Error: ' + error.message);
        break;
      }
    }

    console.log('[Complete] Items processed: ' + processedCount);
    console.log('[Complete] Total files: ' + countDownloadedFiles());

  } catch (err) {
    console.error('[Error]', err.message);
  } finally {
    await browser.close();
  }
}

runAutomation().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
