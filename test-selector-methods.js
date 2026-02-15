/**
 * Test different selector methods to find list items
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testSelectors() {
  console.log('[TEST] Testing different selector methods\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: path.join(process.cwd(), 'browser-session.json'),
  });
  const page = await context.newPage();

  try {
    // Navigate
    console.log('Navigating to /assets...');
    await page.goto('https://3d.hunyuan.tencent.com/assets', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log('Page loaded\n');

    // Wait a few seconds
    await page.waitForTimeout(3000);

    // Test different selectors
    console.log('[TEST 1] Using page.locator("role=listitem").count()');
    try {
      const count1 = await page.locator('role=listitem').count();
      console.log(`  Result: ${count1} items\n`);
    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }

    console.log('[TEST 2] Using page.evaluate() with DOM query');
    const count2 = await page.evaluate(() => {
      return document.querySelectorAll('[role="listitem"], li').length;
    });
    console.log(`  Result: ${count2} items\n`);

    console.log('[TEST 3] Using page.locator("[role=\\"listitem\\"]").count()');
    try {
      const count3 = await page.locator('[role="listitem"]').count();
      console.log(`  Result: ${count3} items\n`);
    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }

    console.log('[TEST 4] Using page.$$ to get all matching elements');
    try {
      const elements = await page.$$('[role="listitem"]');
      console.log(`  Result: ${elements.length} items\n`);
    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }

    console.log('[TEST 5] Check page structure');
    const structure = await page.evaluate(() => {
      return {
        rootDiv: !!document.getElementById('app'),
        divs: document.querySelectorAll('div').length,
        listitems: document.querySelectorAll('[role="listitem"]').length,
        customItems: document.querySelectorAll('[class*="item"]').length,
        allElements: document.querySelectorAll('*').length,
      };
    });
    console.log(`  Structure:`, structure, '\n');

    console.log('[TEST 6] Wait longer and retry');
    await page.waitForTimeout(5000);
    const count6 = await page.evaluate(() => {
      return document.querySelectorAll('[role="listitem"]').length;
    });
    console.log(`  After 5s more wait: ${count6} items\n`);

    console.log('[TEST 7] Try using locator after longer wait');
    try {
      const count7 = await page.locator('[role="listitem"]').count();
      console.log(`  Result: ${count7} items\n`);
    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await context.close();
    await browser.close();
  }
}

testSelectors().catch(console.error);
