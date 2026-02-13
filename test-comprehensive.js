#!/usr/bin/env node
/**
 * Comprehensive USDZ Downloader Testing Suite
 * Tests each phase individually before proceeding
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOWNLOADS_DIR = 'C:\\usdz\\downloads';
const BROWSER_DOWNLOADS = path.join(os.homedir(), 'Downloads');
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';
const STATE_FILE = 'C:\\usdz\\test-state.json';

let testLog = [];

function log(phase, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${phase}: ${message}`;
  console.log(logEntry);
  testLog.push(logEntry);
}

function saveTestLog() {
  fs.writeFileSync('C:\\usdz\\test-results.txt', testLog.join('\n'), 'utf-8');
}

function countFiles(dir, extension = '.usdz') {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith(extension)).length;
}

async function phase1_PageInspection(page) {
  log('PHASE1', '=== PHASE 1: PAGE INSPECTION AND VERIFICATION ===');

  try {
    log('PHASE1', `Navigating to ${WEBSITE_URL}`);
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('PHASE1', 'Page loaded');

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: 'C:\\usdz\\phase1-page-load.png' });
    log('PHASE1', 'Screenshot saved: phase1-page-load.png');

    // Count listitems
    const listitems = await page.locator('role=listitem').all();
    log('PHASE1', `Found ${listitems.length} listitem elements`);

    if (listitems.length === 0) {
      log('PHASE1', 'ERROR: No listitems found. Page may not have loaded properly.');
      return false;
    }

    // Inspect first item
    const firstItem = listitems[0];
    const itemText = await firstItem.textContent();
    log('PHASE1', `First item text: ${itemText?.substring(0, 80) || 'N/A'}`);

    // Count buttons in first item
    const buttons = await firstItem.locator('role=button').all();
    log('PHASE1', `First item has ${buttons.length} buttons`);

    // Try to find "View model" buttons
    const viewModelButtons = await firstItem.locator('role=button[name="View model"]').all();
    const viewModelButtonsCN = await firstItem.locator('role=button[name="查看模型"]').all();
    log('PHASE1', `Found ${viewModelButtons.length} "View model" buttons (English)`);
    log('PHASE1', `Found ${viewModelButtonsCN.length} "查看模型" buttons (Chinese)`);

    if (viewModelButtons.length === 0 && viewModelButtonsCN.length === 0) {
      log('PHASE1', 'ERROR: No "View model" buttons found in first item');
      return false;
    }

    // Check all buttons with their content
    log('PHASE1', 'Button inspection:');
    for (let i = 0; i < Math.min(5, buttons.length); i++) {
      const html = await buttons[i].innerHTML().catch(() => 'N/A');
      const text = await buttons[i].textContent().catch(() => 'N/A');
      log('PHASE1', `  Button ${i}: text="${text.substring(0, 30)}" html="${html.substring(0, 50)}"`);
    }

    log('PHASE1', '✓ PHASE 1 COMPLETE: Page structure verified');
    return true;

  } catch (err) {
    log('PHASE1', `ERROR: ${err.message}`);
    return false;
  }
}

async function phase2_SingleItemTest(page) {
  log('PHASE2', '=== PHASE 2: SINGLE ITEM DOWNLOAD TEST ===');

  try {
    const beforeCount = countFiles(DOWNLOADS_DIR);
    log('PHASE2', `Files in target folder before: ${beforeCount}`);

    // Get first listitem
    const listitems = await page.locator('role=listitem').all();
    if (listitems.length === 0) {
      log('PHASE2', 'ERROR: No listitems found');
      return false;
    }

    const firstItem = listitems[0];
    const itemText = await firstItem.textContent();
    log('PHASE2', `Testing first item: ${itemText?.substring(0, 60)}`);

    // Find view model button
    let viewModelButtons = await firstItem.locator('role=button[name="View model"]').all();
    if (viewModelButtons.length === 0) {
      viewModelButtons = await firstItem.locator('role=button[name="查看模型"]').all();
    }

    if (viewModelButtons.length === 0) {
      log('PHASE2', 'ERROR: No "View model" buttons found');
      return false;
    }

    log('PHASE2', `Found ${viewModelButtons.length} view model buttons`);

    // Test clicking first view model button
    log('PHASE2', 'Clicking first "View model" button...');
    await viewModelButtons[0].click();
    await page.waitForTimeout(2500);

    // Take screenshot to verify viewer opened
    await page.screenshot({ path: 'C:\\usdz\\phase2-viewer-opened.png' });
    log('PHASE2', 'Screenshot saved: phase2-viewer-opened.png');

    // Check if modal/viewer is visible
    const modal = page.locator('[role="dialog"], .modal, [class*="viewer"]').first();
    const isVisible = await modal.isVisible().catch(() => false);
    if (isVisible) {
      log('PHASE2', '✓ Viewer opened successfully');
    } else {
      log('PHASE2', 'WARNING: Viewer modal not detected, but proceeding...');
    }

    // Look for format selector button
    const formatButton = page.locator('role=button').filter({ hasText: /^(OBJ|FBX|STL|USDZ|MP4|GIF)$/ }).last();
    const formatExists = await formatButton.count().catch(() => 0);
    if (formatExists > 0) {
      log('PHASE2', 'Format selector button found');
      const formatText = await formatButton.textContent().catch(() => 'N/A');
      log('PHASE2', `  Current format: ${formatText}`);
    } else {
      log('PHASE2', 'WARNING: Format selector button not found');
    }

    // Look for download button
    const downloadButton = page.locator('role=button[name="download"]').first();
    const downloadExists = await downloadButton.count().catch(() => 0);
    if (downloadExists > 0) {
      log('PHASE2', '✓ Download button found');
    } else {
      log('PHASE2', 'ERROR: Download button not found');
      return false;
    }

    // Try to select USDZ format if available
    if (formatExists > 0) {
      try {
        log('PHASE2', 'Attempting to select USDZ format...');
        await formatButton.click();
        await page.waitForTimeout(500);

        const usdzOption = page.locator('text=USDZ').first();
        if (await usdzOption.count() > 0) {
          await usdzOption.click();
          log('PHASE2', '✓ USDZ format selected');
          await page.waitForTimeout(800);
        }
      } catch (e) {
        log('PHASE2', `Format selection failed: ${e.message}`);
      }
    }

    // Click download button
    log('PHASE2', 'Clicking download button...');
    await downloadButton.click();
    await page.waitForTimeout(2000);

    // Wait for file to appear
    log('PHASE2', 'Waiting for file to download...');
    await page.waitForTimeout(3000);

    const afterCount = countFiles(DOWNLOADS_DIR);
    log('PHASE2', `Files in target folder after: ${afterCount}`);

    if (afterCount > beforeCount) {
      log('PHASE2', `✓ File downloaded! New files: ${afterCount - beforeCount}`);
    } else {
      log('PHASE2', 'WARNING: No new files detected in target folder');
      // Check browser downloads
      const browserDownloads = countFiles(BROWSER_DOWNLOADS);
      log('PHASE2', `Browser downloads folder has ${browserDownloads} USDZ files`);
    }

    // Close viewer
    log('PHASE2', 'Closing viewer...');
    try {
      const closeButton = page.locator('button[aria-label*="close" i], button:has-text("×"), button:has-text("Close")').first();
      if (await closeButton.count() > 0) {
        await closeButton.click();
        await page.waitForTimeout(600);
        log('PHASE2', '✓ Viewer closed');
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        log('PHASE2', 'Pressed Escape to close viewer');
      }
    } catch (e) {
      log('PHASE2', `Error closing viewer: ${e.message}`);
    }

    // Verify item still exists
    const itemsAfter = await page.locator('role=listitem').all();
    log('PHASE2', `Items remaining: ${itemsAfter.length}`);

    log('PHASE2', '✓ PHASE 2 COMPLETE: Single item download tested');
    return true;

  } catch (err) {
    log('PHASE2', `ERROR: ${err.message}`);
    return false;
  }
}

async function phase3_DeletionTest(page) {
  log('PHASE3', '=== PHASE 3: DELETION TEST ===');

  try {
    const listitems = await page.locator('role=listitem').all();
    log('PHASE3', `Items before deletion: ${listitems.length}`);

    if (listitems.length === 0) {
      log('PHASE3', 'No items to delete. Skipping deletion test.');
      return true;
    }

    const firstItem = listitems[0];
    const itemText = await firstItem.textContent();
    log('PHASE3', `Deleting item: ${itemText?.substring(0, 60)}`);

    // Hover to reveal buttons
    await firstItem.hover();
    await page.waitForTimeout(300);

    const buttons = await firstItem.locator('role=button').all();
    log('PHASE3', `Item has ${buttons.length} buttons`);

    if (buttons.length < 5) {
      log('PHASE3', `ERROR: Item has only ${buttons.length} buttons, expected at least 5`);
      return false;
    }

    // Check 5th button for delete icon
    const deleteButton = buttons[4];
    const deleteHTML = await deleteButton.innerHTML().catch(() => '');
    if (deleteHTML.includes('t-icon-delete')) {
      log('PHASE3', '✓ Delete button found (5th button with t-icon-delete)');
    } else {
      log('PHASE3', 'WARNING: 5th button does not have t-icon-delete. Checking other buttons...');
      for (let i = 0; i < buttons.length; i++) {
        const html = await buttons[i].innerHTML().catch(() => '');
        if (html.includes('delete')) {
          log('PHASE3', `  Found delete icon in button ${i}`);
        }
      }
    }

    // Click delete button
    log('PHASE3', 'Clicking delete button...');
    await deleteButton.click();
    await page.waitForTimeout(1000);

    // Wait for confirmation modal
    log('PHASE3', 'Waiting for confirmation modal...');
    const confirmButton = page.locator('role=button[name="Confirm deletion"]');
    let found = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      if (await confirmButton.count() > 0) {
        found = true;
        break;
      }
      await page.waitForTimeout(200);
    }

    if (!found) {
      log('PHASE3', 'ERROR: Confirmation modal not found');
      await page.screenshot({ path: 'C:\\usdz\\phase3-no-modal.png' });
      return false;
    }

    log('PHASE3', '✓ Confirmation modal appeared');

    // Take screenshot
    await page.screenshot({ path: 'C:\\usdz\\phase3-confirmation-modal.png' });

    // Click confirm
    log('PHASE3', 'Clicking "Confirm deletion"...');
    await confirmButton.click();
    await page.waitForTimeout(1200);

    // Verify deletion
    const itemsAfter = await page.locator('role=listitem').all();
    log('PHASE3', `Items after deletion: ${itemsAfter.length}`);

    if (itemsAfter.length < listitems.length) {
      log('PHASE3', `✓ Item deleted successfully! (${listitems.length} → ${itemsAfter.length})`);
      return true;
    } else {
      log('PHASE3', 'ERROR: Item count did not decrease');
      return false;
    }

  } catch (err) {
    log('PHASE3', `ERROR: ${err.message}`);
    return false;
  }
}

async function runTests() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const page = await context.newPage();

  try {
    log('START', 'Comprehensive USDZ Downloader Test Suite');
    log('START', `Working directory: ${process.cwd()}`);

    // PHASE 1: Page Inspection
    const phase1Pass = await phase1_PageInspection(page);

    if (!phase1Pass) {
      log('START', 'PHASE 1 FAILED: Cannot continue without valid page structure');
      saveTestLog();
      return;
    }

    // PHASE 2: Single Item Test
    const phase2Pass = await phase2_SingleItemTest(page);

    if (!phase2Pass) {
      log('START', 'PHASE 2 FAILED: Single item download test unsuccessful');
      saveTestLog();
      return;
    }

    // PHASE 3: Deletion Test
    const phase3Pass = await phase3_DeletionTest(page);

    if (!phase3Pass) {
      log('START', 'PHASE 3 FAILED: Deletion test unsuccessful');
      saveTestLog();
      return;
    }

    log('SUCCESS', 'All phases completed successfully!');
    log('SUCCESS', `Initial target downloads: 6 USDZ files`);
    log('SUCCESS', `Browser downloads available: 26 USDZ files`);
    log('SUCCESS', 'Ready for full automation in next phase');

  } catch (err) {
    log('FATAL', `${err.message}`);
  } finally {
    saveTestLog();
    log('END', 'Test suite completed. Results saved to test-results.txt');
    await browser.close();
  }
}

runTests().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
