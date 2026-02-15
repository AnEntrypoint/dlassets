const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testNavigationFlow() {
  console.log('[TEST] Starting navigation flow test...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.createContext({
    storageState: path.join(process.cwd(), 'browser-session.json'),
  });
  const page = await context.newPage();

  // Intercept console messages
  page.on('console', msg => {
    if (msg.type() !== 'log') {
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
    }
  });

  try {
    // Step 1: Load home page
    console.log('[STEP 1] Loading home page: https://3d.hunyuan.tencent.com/');
    await page.goto('https://3d.hunyuan.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[OK] Home page loaded\n');

    // Check what's on the home page
    console.log('[INSPECT] Checking home page structure...');
    const homeStructure = await page.evaluate(() => {
      const title = document.title;
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim(),
        href: a.href,
        title: a.title,
      })).filter(a => a.text.length > 0 && a.text.length < 50);

      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        title: b.title,
      })).filter(b => b.text.length > 0 && b.text.length < 50);

      return { title, links: links.slice(0, 10), buttons: buttons.slice(0, 10) };
    });

    console.log(`Home page title: "${homeStructure.title}"`);
    console.log(`Found ${homeStructure.links.length} links:`);
    homeStructure.links.forEach((l, i) => {
      console.log(`  ${i+1}. "${l.text}" → ${l.href}`);
    });
    console.log(`Found ${homeStructure.buttons.length} buttons:`);
    homeStructure.buttons.forEach((b, i) => {
      console.log(`  ${i+1}. "${b.text}"`);
    });
    console.log();

    // Step 2: Find and click Assets link
    console.log('[STEP 2] Looking for Assets link...');
    const assetsLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      for (const el of links) {
        const text = el.textContent.toLowerCase();
        if (text.includes('asset') || text.includes('作品') || text.includes('创作')) {
          return {
            found: true,
            text: el.textContent,
            tag: el.tagName,
            href: el.href || el.getAttribute('onclick'),
          };
        }
      }
      return { found: false };
    });

    if (assetsLink.found) {
      console.log(`[OK] Found Assets link: "${assetsLink.text}" (${assetsLink.tag})\n`);
      console.log('[STEP 3] Clicking Assets link...');
      await page.click('a:has-text("asset"), a:has-text("作品"), a:has-text("创作"), button:has-text("asset"), button:has-text("作品"), button:has-text("创作")').catch(() => {
        console.log('[NOTE] Standard click selectors did not work, trying alternative...');
      });

      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
        console.log('[NOTE] No navigation event, page may have changed content');
      });

      await page.waitForTimeout(3000);
      console.log('[OK] Clicked, waiting for page to settle...\n');
    } else {
      console.log('[WARNING] Assets link not found, trying direct navigation\n');
      console.log('[STEP 3] Navigating directly to /assets...');
      await page.goto('https://3d.hunyuan.tencent.com/assets', { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[OK] Navigated to /assets\n');
    }

    // Step 4: Inspect /assets page structure
    console.log('[STEP 4] Inspecting /assets page structure...');
    const assetsStructure = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        bodyText: document.body.textContent.substring(0, 200),
        divCount: document.querySelectorAll('div').length,
        listItems: document.querySelectorAll('[role="listitem"], li').length,
        buttons: document.querySelectorAll('button').length,
        imgs: document.querySelectorAll('img').length,
      };
    });

    console.log(`Current URL: ${assetsStructure.url}`);
    console.log(`Page title: "${assetsStructure.title}"`);
    console.log(`Body text preview: "${assetsStructure.bodyText.substring(0, 100)}..."`);
    console.log(`Structure: ${assetsStructure.divCount} divs, ${assetsStructure.listItems} list items, ${assetsStructure.buttons} buttons, ${assetsStructure.imgs} images\n`);

    // Step 5: Check for loading indicators
    console.log('[STEP 5] Checking for loading indicators...');
    const loadingStatus = await page.evaluate(() => {
      const spinners = document.querySelectorAll('[class*="loading"], [class*="spin"], [class*="progress"], [aria-busy="true"]');
      const loadingText = Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent.includes('加载中') ||
        el.textContent.includes('Loading') ||
        el.textContent.includes('处理中')
      ).length;

      return {
        spinnerElements: spinners.length,
        loadingTextElements: loadingText,
        visibility: {
          hidden: document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').length,
          visible: document.querySelectorAll('[style*="display: block"], [style*="opacity: 1"]').length,
        }
      };
    });

    console.log(`Loading indicators: ${loadingStatus.spinnerElements} spinners, ${loadingStatus.loadingTextElements} loading text`);
    console.log(`Visibility: ${loadingStatus.hidden} hidden elements, ${loadingStatus.visible} visible elements\n`);

    // Step 6: Check for asset items and try to interact
    console.log('[STEP 6] Looking for asset items...');
    const assetItems = await page.evaluate(() => {
      // Try multiple selectors
      let items = document.querySelectorAll('[role="listitem"]');
      if (items.length === 0) items = document.querySelectorAll('li');
      if (items.length === 0) items = document.querySelectorAll('[class*="item"], [class*="card"]');

      return {
        count: items.length,
        firstItem: items.length > 0 ? {
          text: items[0].textContent.substring(0, 100),
          html: items[0].innerHTML.substring(0, 200),
          classes: items[0].className,
        } : null,
        sampleTexts: Array.from(items).slice(0, 3).map(item => item.textContent.trim().substring(0, 50)),
      };
    });

    console.log(`Found ${assetItems.count} asset items`);
    if (assetItems.firstItem) {
      console.log(`First item text: "${assetItems.firstItem.text}"`);
      console.log(`First item classes: "${assetItems.firstItem.classes}"`);
    }
    if (assetItems.sampleTexts.length > 0) {
      console.log('Sample asset names:');
      assetItems.sampleTexts.forEach((text, i) => {
        console.log(`  ${i+1}. "${text}"`);
      });
    }
    console.log();

    // Step 7: Try to click on first asset
    if (assetItems.count > 0) {
      console.log('[STEP 7] Attempting to click first asset...');
      try {
        // Click on first item
        await page.evaluate(() => {
          const items = document.querySelectorAll('[role="listitem"]');
          if (items.length === 0) return false;
          items[0].click();
          return true;
        });

        console.log('[OK] Clicked first asset');

        // Wait and check what happens
        await page.waitForTimeout(2000);

        const afterClick = await page.evaluate(() => {
          const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"]');
          const viewers = document.querySelectorAll('[class*="viewer"], [class*="Viewer"], canvas');
          return {
            modals: modals.length,
            viewers: viewers.length,
            url: window.location.href,
            title: document.title,
          };
        });

        console.log(`After click: ${afterClick.modals} modals, ${afterClick.viewers} viewer elements`);
        console.log(`URL: ${afterClick.url}`);
        console.log(`Title: "${afterClick.title}"\n`);

        // Check browser console for errors
        console.log('[STEP 8] Checking browser console output (last 30 seconds)...');
        const now = Date.now();
        const recentMessages = [];
        page.on('console', msg => {
          if (Date.now() - now < 30000) {
            recentMessages.push(`[${msg.type()}] ${msg.text()}`);
          }
        });

      } catch (err) {
        console.log(`[ERROR] Failed to click asset: ${err.message}`);
      }
    }

    // Step 9: Test API directly
    console.log('\n[STEP 9] Testing API endpoints directly...');

    const cookies = context._browser._connection._client._sessionState?.cookies || [];
    console.log(`Available cookies for API: ${cookies.length}`);

    try {
      console.log('Testing: POST /api/3d/creations/count');
      const countResp = await page.evaluate(async () => {
        try {
          const resp = await fetch('https://3d.hunyuan.tencent.com/api/3d/creations/count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({}),
          });
          return {
            status: resp.status,
            contentType: resp.headers.get('content-type'),
            text: await resp.text(),
          };
        } catch (err) {
          return { error: err.message };
        }
      });

      console.log(`Response status: ${countResp.status || 'error'}`);
      console.log(`Response: ${(countResp.text || countResp.error).substring(0, 200)}`);
    } catch (err) {
      console.log(`[ERROR] API test failed: ${err.message}`);
    }

  } catch (err) {
    console.error('[FATAL ERROR]', err.message);
    console.error(err.stack);
  } finally {
    await context.close();
    await browser.close();
    console.log('\n[DONE] Test complete');
  }
}

testNavigationFlow().catch(console.error);
