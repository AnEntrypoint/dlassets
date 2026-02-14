/**
 * Performance Comparison: Original vs Optimized blocking strategies
 *
 * This test compares two different resource blocking approaches:
 * 1. Original: Only MP4/video blocking (minimal)
 * 2. Optimized: Comprehensive blocking (images, fonts, CSS, media)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

async function testWithStrategy(name, setupFn) {
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(56)}\n`);

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
      startTime: Date.now(),
    };

    // Setup strategy-specific blocking
    await setupFn(page, stats);

    console.log('[Navigation] Loading page...');
    const navStart = Date.now();
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - navStart;
    console.log(`  Navigation: ${navTime}ms`);

    console.log('[Wait] Network idle (max 30s)...');
    const netStart = Date.now();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const netTime = Date.now() - netStart;
    console.log(`  Wait time: ${netTime}ms`);

    const totalTime = navTime + netTime;

    console.log('[Rendering] Checking page...');
    await page.waitForTimeout(1000);
    const itemCount = await page.locator('role=listitem').count();
    console.log(`  List items: ${itemCount}`);
    const buttonCount = await page.locator('button').count();
    console.log(`  Buttons: ${buttonCount}`);

    console.log('\n[Results]');
    console.log(`  Requests blocked: ${stats.blocked}`);
    console.log(`  Requests allowed: ${stats.allowed}`);
    const blockRate = stats.blocked + stats.allowed > 0
      ? ((stats.blocked / (stats.blocked + stats.allowed)) * 100).toFixed(1)
      : 0;
    console.log(`  Block rate: ${blockRate}%`);
    console.log(`  Total time: ${totalTime}ms`);

    await context.close();

    return {
      name,
      navTime,
      netTime,
      totalTime,
      blocked: stats.blocked,
      allowed: stats.allowed,
      blockRate,
    };
  } catch (e) {
    console.error('[Error]', e.message);
    if (context) await context.close();
    throw e;
  } finally {
    await browser.close();
  }
}

async function main() {
  const results = [];

  // Test 1: Original strategy (minimal blocking)
  try {
    const result1 = await testWithStrategy(
      'ORIGINAL: Minimal blocking (MP4 only)',
      async (page, stats) => {
        page.on('response', () => stats.allowed++);

        await page.route('**/*.mp4', route => {
          stats.blocked++;
          return route.abort();
        });
        await page.route('**/video*', route => {
          stats.blocked++;
          return route.abort();
        });
        await page.route('**/*preview*', route => {
          stats.blocked++;
          return route.abort();
        });
      }
    );
    results.push(result1);
  } catch (e) {
    console.error('Test 1 failed:', e.message);
  }

  // Wait between tests
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 2: Optimized strategy (comprehensive blocking)
  try {
    const result2 = await testWithStrategy(
      'OPTIMIZED: Comprehensive blocking (images, video, fonts, CSS)',
      async (page, stats) => {
        const blockedPatterns = [
          '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg', '**/*.avif',
          '**/*.mp4', '**/*.webm', '**/*.ogg', '**/*.wav', '**/*.mp3',
          '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf', '**/*.eot',
          '**/font*', '**/*.css', '**/*analytics*', '**/*tracking*', '**/*ads*',
        ];

        const resourceTypesToBlock = ['image', 'media', 'font', 'stylesheet'];

        for (const pattern of blockedPatterns) {
          await page.route(pattern, route => {
            stats.blocked++;
            return route.abort();
          });
        }

        await page.route('**/*', route => {
          const resourceType = route.request().resourceType();
          if (resourceTypesToBlock.includes(resourceType)) {
            stats.blocked++;
            return route.abort();
          }
          stats.allowed++;
          return route.continue();
        });
      }
    );
    results.push(result2);
  } catch (e) {
    console.error('Test 2 failed:', e.message);
  }

  // Print summary
  if (results.length === 2) {
    console.log('\n' + '═'.repeat(56));
    console.log('  PERFORMANCE COMPARISON SUMMARY');
    console.log('═'.repeat(56) + '\n');

    const [original, optimized] = results;

    console.log('Navigation Time (domcontentloaded):');
    console.log(`  Original:  ${original.navTime}ms`);
    console.log(`  Optimized: ${optimized.navTime}ms`);
    const navDiff = original.navTime - optimized.navTime;
    const navPct = (navDiff / original.navTime * 100).toFixed(1);
    console.log(`  ${navDiff > 0 ? '✓ ' : '✗ '}${Math.abs(navPct)}% ${navDiff > 0 ? 'faster' : 'slower'}`);

    console.log('\nNetwork Idle Wait:');
    console.log(`  Original:  ${original.netTime}ms`);
    console.log(`  Optimized: ${optimized.netTime}ms`);
    const netDiff = original.netTime - optimized.netTime;
    const netPct = (netDiff / original.netTime * 100).toFixed(1);
    console.log(`  ${netDiff > 0 ? '✓ ' : '✗ '}${Math.abs(netPct)}% ${netDiff > 0 ? 'faster' : 'slower'}`);

    console.log('\nTotal Page Load Time:');
    console.log(`  Original:  ${original.totalTime}ms`);
    console.log(`  Optimized: ${optimized.totalTime}ms`);
    const totalDiff = original.totalTime - optimized.totalTime;
    const totalPct = (totalDiff / original.totalTime * 100).toFixed(1);
    console.log(`  ${totalDiff > 0 ? '✓ ' : '✗ '}${Math.abs(totalPct)}% ${totalDiff > 0 ? 'faster' : 'slower'}`);

    console.log('\nRequest Statistics:');
    console.log(`  Original - Blocked: ${original.blocked}, Allowed: ${original.allowed}, Rate: ${original.blockRate}%`);
    console.log(`  Optimized - Blocked: ${optimized.blocked}, Allowed: ${optimized.allowed}, Rate: ${optimized.blockRate}%`);
    const blockDiff = optimized.blocked - original.blocked;
    console.log(`  Additional blocks: ${blockDiff} requests`);

    console.log('\n' + '═'.repeat(56));
    console.log('  VERDICT');
    console.log('═'.repeat(56) + '\n');

    if (totalDiff > 0) {
      if (totalPct > 50) {
        console.log('✓✓✓ EXCELLENT - Over 50% speedup achieved!');
      } else if (totalPct > 30) {
        console.log('✓✓ GOOD - 30%+ speedup achieved');
      } else {
        console.log('✓ MODERATE - ' + totalPct + '% speedup');
      }
    } else {
      console.log('⚠ No improvement or slower');
    }

    console.log(`\nOptimized version is ${Math.abs(totalPct)}% ${totalDiff > 0 ? 'faster' : 'slower'}`);
    console.log(`Blocking ${blockDiff} additional requests`);

    console.log('\n' + '═'.repeat(56) + '\n');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
