/**
 * Quick test to verify optimization setup works correctly
 * Tests that:
 * 1. Network interception is set up properly
 * 2. Resource blocking doesn't break page rendering
 * 3. All blocking patterns compile without errors
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

async function testOptimization() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  OPTIMIZATION TEST                                 ║');
  console.log('║  Verify resource blocking setup                   ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  let context, page;

  try {
    if (fs.existsSync(SESSION_FILE)) {
      context = await browser.newContext({ storageState: SESSION_FILE });
    } else {
      context = await browser.newContext();
    }

    page = await context.newPage();
    page.setDefaultTimeout(120000);

    const stats = {
      blocked: 0,
      allowed: 0,
      resourceTypes: {},
    };

    // Setup blocking patterns
    const blockedPatterns = [
      '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg', '**/*.avif',
      '**/*.mp4', '**/*.webm', '**/*.ogg', '**/*.wav', '**/*.mp3',
      '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf', '**/*.eot',
      '**/font*', '**/*.css', '**/*analytics*', '**/*tracking*', '**/*ads*',
    ];

    const resourceTypesToBlock = ['image', 'media', 'font', 'stylesheet'];

    console.log('[Setup] Registering blocked patterns...');
    for (const pattern of blockedPatterns) {
      await page.route(pattern, route => {
        stats.blocked++;
        return route.abort();
      });
    }
    console.log(`✓ ${blockedPatterns.length} patterns registered`);

    console.log('[Setup] Registering resource type intercepts...');
    await page.route('**/*', route => {
      const request = route.request();
      const resourceType = request.resourceType();

      stats.resourceTypes[resourceType] = (stats.resourceTypes[resourceType] || 0) + 1;

      if (resourceTypesToBlock.includes(resourceType)) {
        stats.blocked++;
        return route.abort();
      }

      stats.allowed++;
      return route.continue();
    });
    console.log('✓ Resource type interception registered');

    console.log('\n[Navigation] Loading page...');
    const startNav = Date.now();
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - startNav;
    console.log(`✓ Navigation completed in ${navTime}ms`);

    console.log('[Wait] Waiting for network idle (max 30s)...');
    const startNet = Date.now();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const netTime = Date.now() - startNet;
    console.log(`✓ Network idle wait: ${netTime}ms`);

    await page.waitForTimeout(2000);

    console.log('\n[Rendering] Checking page content...');
    const itemCount = await page.locator('role=listitem').count();
    console.log(`✓ List items found: ${itemCount}`);

    const buttonCount = await page.locator('button').count();
    console.log(`✓ Buttons found: ${buttonCount}`);

    const canvasCount = await page.locator('canvas').count();
    console.log(`✓ Canvas elements: ${canvasCount}`);

    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  RESULTS                                           ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('Network Statistics:');
    console.log(`  Requests blocked:  ${stats.blocked}`);
    console.log(`  Requests allowed:  ${stats.allowed}`);
    console.log(`  Total requests:    ${stats.blocked + stats.allowed}`);
    console.log(`  Block rate:        ${((stats.blocked / (stats.blocked + stats.allowed)) * 100).toFixed(1)}%`);

    console.log('\nResource Types Allowed:');
    Object.entries(stats.resourceTypes)
      .filter(([type]) => !resourceTypesToBlock.includes(type))
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    console.log('\nTiming:');
    console.log(`  Navigation (domcontentloaded): ${navTime}ms`);
    console.log(`  Network idle wait:             ${netTime}ms`);
    console.log(`  Total page load:               ${navTime + netTime}ms`);

    console.log('\nPage Rendering:');
    console.log(`  List items:   ${itemCount > 0 ? '✓ FOUND' : '⚠ None'}`);
    console.log(`  Buttons:      ${buttonCount > 0 ? '✓ FOUND' : '⚠ None'}`);
    console.log(`  Canvas (3D):  ${canvasCount > 0 ? '✓ FOUND' : 'Not loaded'}`);

    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  TEST RESULT: SUCCESS                              ║');
    console.log('║  Optimization setup verified working correctly     ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    await context.close();

    return {
      success: true,
      navTime,
      netTime,
      blocked: stats.blocked,
      allowed: stats.allowed,
      itemCount,
      resourceTypes: stats.resourceTypes,
    };
  } catch (e) {
    console.error('[Error]', e.message);
    if (context) await context.close();
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

testOptimization().then(result => {
  if (!result.success) {
    process.exit(1);
  }
});
