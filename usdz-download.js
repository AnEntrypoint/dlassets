#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = '/mnt/c/usdz/downloads';
const STATE_FILE = '/mnt/c/usdz/state.json';
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading state:', e.message);
  }
  return { deletedItems: [], processedCount: 0, lastProcessedTimestamp: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function countDownloadedFiles() {
  if (!fs.existsSync(DOWNLOADS_DIR)) return 0;
  const files = fs.readdirSync(DOWNLOADS_DIR);
  return files.filter(f => f.endsWith('.usdz')).length;
}

async function closeViewer(page) {
  try {
    const closeButton = page.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
    const count = await closeButton.count().catch(() => 0);

    if (count > 0) {
      console.log('[Viewer] Found close button, clicking it');
      await closeButton.click();
      await page.waitForTimeout(600);
      return true;
    }

    console.log('[Viewer] No close button found, trying Escape key');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    return true;
  } catch (err) {
    console.warn('[Viewer] Error closing viewer:', err.message);
    return false;
  }
}

async function deleteItem(page, listitemIndex) {
  try {
    const listitems = await page.locator('role=listitem').all();

    if (listitems.length === 0) {
      throw new Error('No listitems found on page');
    }

    if (listitemIndex >= listitems.length) {
      throw new Error();
    }

    const targetListitem = listitems[listitemIndex];

    await targetListitem.hover();
    await page.waitForTimeout(300);

    const buttonsInListitem = await targetListitem.locator('role=button').all();

    if (buttonsInListitem.length < 5) {
      throw new Error();
    }

    const deleteButton = buttonsInListitem[4];

    const innerHTML = await deleteButton.innerHTML().catch(() => '');
    if (!innerHTML.includes('t-icon-delete')) {
      throw new Error('Delete button verification failed - SVG icon mismatch');
    }

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
      throw new Error('Confirmation modal did not appear within timeout');
    }

    await confirmButton.click();
    await page.waitForTimeout(1200);

    return true;

  } catch (err) {
    console.warn();
    return false;
  }
}

async function runScript(page, context) {
  const state = loadState();
  console.log('[Script] Starting download and deletion workflow');
  console.log('[Script] Current state:', JSON.stringify(state, null, 2));
  console.log('[Script] Files already downloaded:', countDownloadedFiles());

  await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  let attempts = 0;
  while (attempts < 20) {
    const itemCount = await page.locator('role=listitem').count();
    if (itemCount > 0) break;
    await page.waitForTimeout(500);
    attempts++;
  }

  let processedCount = 0;

  while (true) {
    const listitems = await page.locator('role=listitem').all();

    if (listitems.length === 0) {
      console.log('[Script] No items found on page. All items may have been deleted.');
      break;
    }

    console.log('[Script] Found', listitems.length, 'items on current page');

    const targetListitem = listitems[0];

    try {
      const itemText = await targetListitem.textContent();
      console.log('[Item] Processing item:', itemText?.substring(0, 80) || 'unknown');

      let viewModelButtons = await targetListitem.locator('role=button[name="View model"]').all();
      if (viewModelButtons.length === 0) {
        viewModelButtons = await targetListitem.locator('role=button[name="查看模型"]').all();
      }

      if (viewModelButtons.length !== 4) {
        console.log('[Item] Warning: Expected 4 View model buttons, found', viewModelButtons.length);
      }

      let downloadsThisItem = 0;

      for (let j = 0; j < Math.min(4, viewModelButtons.length); j++) {
        try {
          console.log('[Item Asset ' + (j + 1) + '/4] Clicking View model button...');
          await viewModelButtons[j].click();
          await page.waitForTimeout(2500);

          try {
            const formatButton = page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).last();
            const isVisible = await formatButton.isVisible().catch(() => false);
            if (isVisible) {
              await formatButton.click();
              await page.waitForTimeout(800);
              const usdzOption = page.locator('text=USDZ').first();
              await usdzOption.click();
              await page.waitForTimeout(800);
            }
          } catch (e) {
            console.log('[Item Asset ' + (j + 1) + '/4] USDZ format selection skipped:', e.message);
          }

          try {
            const downloadButton = page.locator('role=button[name="download"]').first();
            const downloadCount = await downloadButton.count();
            if (downloadCount > 0) {
              await downloadButton.click();
              console.log('[Item Asset ' + (j + 1) + '/4] Download button clicked');
              downloadsThisItem++;
            }
          } catch (e) {
            console.log('[Item Asset ' + (j + 1) + '/4] Download failed:', e.message);
          }

        } catch (error) {
          console.log('[Item Asset ' + (j + 1) + '/4] Error:', error.message);
        }
      }

      if (downloadsThisItem > 0) {
        console.log('[Item] All 4 assets downloaded. Closing viewer...');
        await closeViewer(page);
        await page.waitForTimeout(800);
      }

      console.log('[Item] Downloaded', downloadsThisItem, 'assets');

      if (downloadsThisItem > 0) {
        console.log('[Item] All downloads complete. Deleting item...');

        const deleteSuccess = await deleteItem(page, 0);

        if (deleteSuccess) {
          state.deletedItems.push(processedCount);
          state.processedCount++;
          state.lastProcessedTimestamp = new Date().toISOString();
          saveState(state);
          console.log('[Item] Successfully deleted. Total deleted:', state.deletedItems.length);
          processedCount++;

          await page.waitForTimeout(1000);
        } else {
          console.log('[Item] Failed to delete, continuing to next item');
          break;
        }
      }

    } catch (error) {
      console.log('[Item] Error processing item:', error.message);
      break;
    }
  }

  console.log('[Script] Process complete!');
  console.log('[Script] Total items processed:', processedCount);
  console.log('[Script] Total items deleted:', state.deletedItems.length);
  console.log('[Script] Total files downloaded:', countDownloadedFiles());
  console.log('[Script] Final state saved');

  return { success: true, itemsDeleted: state.deletedItems.length, filesDownloaded: countDownloadedFiles(), itemsProcessed: processedCount };
}

if (require.main === module) {
  console.log('[Main] This script is meant to be executed via Playwriter browser automation');
  console.log('[Main] Use: mcp__playwriter__execute with page context');
}

module.exports = { runScript, loadState, saveState, countDownloadedFiles, closeViewer, deleteItem };
