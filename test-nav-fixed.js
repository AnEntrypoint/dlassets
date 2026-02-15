const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testNavigationFlow() {
  console.log('[TEST] Starting navigation flow test...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: path.join(process.cwd(), 'browser-session.json'),
  });
  const page = await context.newPage();

  // Intercept console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() !== 'log') {
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
    }
  });

  try {
    // Step 1: Load home page
    console.log('[STEP 1] Loading home page: https://3d.hunyuan.tencent.com/');
    const startTime = Date.now();
    await page.goto('https://3d.hunyuan.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loadTime = Date.now() - startTime;
    console.log(`[OK] Home page loaded in ${loadTime}ms\n`);

    // Check what's on the home page
    console.log('[INSPECT] Checking home page structure...');
    const homeStructure = await page.evaluate(() => {
      const title = document.title;
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim(),
        href: a.href,
      })).filter(a => a.text.length > 0 && a.text.length < 50);

      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
      })).filter(b => b.text.length > 0 && b.text.length < 50);

      return { title, links: links.slice(0, 10), buttons: buttons.slice(0, 10) };
    });

    console.log(`Home page title: "${homeStructure.title}"`);
    console.log(`Found ${homeStructure.links.length} links (first 10):`);
    homeStructure.links.forEach((l, i) => {
      console.log(`  ${i+1}. "${l.text}"`);
    });
    console.log();

    // Step 2: Navigate to /assets directly
    console.log('[STEP 2] Navigating to /assets...');
    const assetsStartTime = Date.now();
    await page.goto('https://3d.hunyuan.tencent.com/assets', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const assetsLoadTime = Date.now() - assetsStartTime;
    console.log(`[OK] /assets page loaded in ${assetsLoadTime}ms\n`);

    // Step 3: Inspect /assets page structure
    console.log('[STEP 3] Inspecting /assets page structure...');
    const assetsStructure = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        divCount: document.querySelectorAll('div').length,
        listItems: document.querySelectorAll('[role="listitem"], li').length,
        buttons: document.querySelectorAll('button').length,
        imgs: document.querySelectorAll('img').length,
        reactRoot: !!document.getElementById('app'),
      };
    });

    console.log(`Current URL: ${assetsStructure.url}`);
    console.log(`Page title: "${assetsStructure.title}"`);
    console.log(`Structure: ${assetsStructure.divCount} divs, ${assetsStructure.listItems} list items, ${assetsStructure.buttons} buttons, ${assetsStructure.imgs} images`);
    console.log(`React app: ${assetsStructure.reactRoot ? 'Found' : 'Not found'}\n`);

    // Step 4: Wait for content with increasing timeout
    console.log('[STEP 4] Waiting for asset list to render...');
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(2000);
      const itemCount = await page.evaluate(() => {
        return document.querySelectorAll('[role="listitem"], li, [class*="item"]').length;
      });
      console.log(`  After ${(i+1)*2}s: ${itemCount} items found`);
      if (itemCount > 0) break;
    }
    console.log();

    // Step 5: Check for loading indicators
    console.log('[STEP 5] Checking for loading indicators...');
    const loadingStatus = await page.evaluate(() => {
      const spinners = document.querySelectorAll('[class*="loading"], [class*="spin"], [class*="progress"], [aria-busy="true"]');
      const loadingText = Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent.includes('加载中') ||
        el.textContent.includes('Loading') ||
        el.textContent.includes('处理中') ||
        el.textContent.includes('loading')
      ).length;

      return {
        spinnerElements: spinners.length,
        loadingTextElements: loadingText,
      };
    });

    console.log(`Loading indicators: ${loadingStatus.spinnerElements} spinners, ${loadingStatus.loadingTextElements} loading text elements\n`);

    // Step 6: Get detailed asset information
    console.log('[STEP 6] Looking for asset items...');
    const assetItems = await page.evaluate(() => {
      // Try multiple selectors
      let items = document.querySelectorAll('[role="listitem"]');
      if (items.length === 0) items = document.querySelectorAll('li');
      if (items.length === 0) items = document.querySelectorAll('[class*="item"]');

      return {
        count: items.length,
        firstItem: items.length > 0 ? {
          text: items[0].textContent.substring(0, 100),
          classes: items[0].className,
        } : null,
        sampleTexts: Array.from(items).slice(0, 5).map(item => item.textContent.trim().substring(0, 50)),
      };
    });

    console.log(`Found ${assetItems.count} asset items`);
    if (assetItems.sampleTexts.length > 0) {
      console.log('Sample asset names:');
      assetItems.sampleTexts.forEach((text, i) => {
        console.log(`  ${i+1}. "${text}"`);
      });
    }
    console.log();

    // Step 7: Try to click on first asset if items exist
    if (assetItems.count > 0) {
      console.log('[STEP 7] Attempting to click first asset...');
      try {
        await page.evaluate(() => {
          const items = document.querySelectorAll('[role="listitem"], li');
          if (items.length > 0) {
            const clickableArea = items[0].querySelector('button, a, [role="button"], [role="link"]') || items[0];
            clickableArea.click();
          }
        });

        console.log('[OK] Clicked first asset');
        await page.waitForTimeout(3000);

        const afterClick = await page.evaluate(() => {
          const modals = document.querySelectorAll('[role="dialog"], [class*="modal"]');
          const viewers = document.querySelectorAll('[class*="viewer"], canvas');
          return {
            modals: modals.length,
            viewers: viewers.length,
            url: window.location.href,
          };
        });

        console.log(`After click: ${afterClick.modals} modals, ${afterClick.viewers} viewer elements`);
        console.log(`URL changed to: ${afterClick.url}\n`);
      } catch (err) {
        console.log(`[ERROR] Failed to interact with asset: ${err.message}\n`);
      }
    }

    // Step 8: Test API directly
    console.log('[STEP 8] Testing API endpoints directly...');
    try {
      console.log('Testing: POST /api/3d/creations/list');
      const resp = await page.evaluate(async () => {
        try {
          const response = await fetch('https://3d.hunyuan.tencent.com/api/3d/creations/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({}),
            timeout: 5000,
          });
          const text = await response.text();
          return {
            status: response.status,
            bodyLength: text.length,
            bodyStart: text.substring(0, 200),
          };
        } catch (err) {
          return { error: err.message };
        }
      });

      console.log(`API Response status: ${resp.status || 'error'}`);
      console.log(`Response size: ${resp.bodyLength || 'N/A'} bytes`);
      if (resp.bodyStart) {
        console.log(`Response start: ${resp.bodyStart}`);
      }
    } catch (err) {
      console.log(`[ERROR] API test failed: ${err.message}`);
    }

  } catch (err) {
    console.error('[FATAL ERROR]', err.message);
    console.error(err.stack);
  } finally {
    await context.close();
    await browser.close();
    console.log('\n[DONE] Test complete. Browser closed.');
  }
}

testNavigationFlow().catch(console.error);
