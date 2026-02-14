/**
 * Benchmark: Compare page load times between original and optimized downloader
 *
 * This script measures:
 * - Page navigation time (domcontentloaded to loaded)
 * - Network idle wait time
 * - Total page load time
 * - Resource blocking statistics
 * - Network request counts
 *
 * Usage:
 *   node benchmark-downloader.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const WEBSITE_URL = 'https://3d.hunyuan.tencent.com/assets';

async function benchmarkOriginal() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  BENCHMARK: ORIGINAL DOWNLOADER                   ║');
  console.log('║  (Only MP4 video blocking)                        ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  let context, page;

  try {
    if (fs.existsSync(SESSION_FILE)) {
      context = await browser.newContext({ storageState: SESSION_FILE });
    } else {
      context = await browser.newContext();
    }

    page = await context.newPage();
    page.setDefaultTimeout(300000);

    let requestCount = 0;
    let responseCount = 0;
    let blockedCount = 0;

    page.on('request', () => requestCount++);
    page.on('response', () => responseCount++);

    await page.route('**/*.mp4', route => {
      blockedCount++;
      return route.abort();
    });
    await page.route('**/video*', route => {
      blockedCount++;
      return route.abort();
    });
    await page.route('**/*preview*', route => {
      blockedCount++;
      return route.abort();
    });

    const startTime = Date.now();
    console.log('[Benchmark] Starting page load...');

    const navStart = Date.now();
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - navStart;
    console.log(`[Benchmark] Navigation (domcontentloaded): ${navTime}ms`);

    const networkStart = Date.now();
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const networkTime = Date.now() - networkStart;
    console.log(`[Benchmark] Network idle wait: ${networkTime}ms`);

    const totalTime = Date.now() - startTime;

    console.log(`\n[Original] Network Statistics:`);
    console.log(`  - Total requests initiated: ${requestCount}`);
    console.log(`  - Total responses received: ${responseCount}`);
    console.log(`  - Requests blocked: ${blockedCount}`);
    console.log(`  - Block rate: ${blockedCount > 0 ? ((blockedCount / requestCount) * 100).toFixed(1) : 0}%`);

    console.log(`\n[Original] Timing:`);
    console.log(`  - Navigation time: ${navTime}ms`);
    console.log(`  - Network idle wait: ${networkTime}ms`);
    console.log(`  - Total time: ${totalTime}ms`);

    await page.waitForTimeout(2000);

    const itemCount = await page.locator('role=listitem').count();
    console.log(`\n[Original] Page Rendering:`);
    console.log(`  - List items found: ${itemCount}`);

    await context.close();

    return {
      name: 'Original',
      navTime,
      networkTime,
      totalTime,
      requestCount,
      responseCount,
      blockedCount,
      itemCount,
    };
  } finally {
    await browser.close();
  }
}

async function benchmarkOptimized() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  BENCHMARK: OPTIMIZED DOWNLOADER                  ║');
  console.log('║  (Images, video, fonts, CSS all blocked)          ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  let context, page;

  try {
    if (fs.existsSync(SESSION_FILE)) {
      context = await browser.newContext({ storageState: SESSION_FILE });
    } else {
      context = await browser.newContext();
    }

    page = await context.newPage();
    page.setDefaultTimeout(300000);

    let requestCount = 0;
    let responseCount = 0;
    let blockedCount = 0;

    page.on('request', () => requestCount++);
    page.on('response', () => responseCount++);

    const blockedPatterns = [
      '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg', '**/*.avif',
      '**/*.mp4', '**/*.webm', '**/*.ogg', '**/*.wav', '**/*.mp3',
      '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf', '**/*.eot',
      '**/font*', '**/*.css', '**/*analytics*', '**/*tracking*', '**/*ads*',
    ];

    const resourceTypesToBlock = ['image', 'media', 'font', 'stylesheet'];

    for (const pattern of blockedPatterns) {
      await page.route(pattern, route => {
        blockedCount++;
        return route.abort();
      });
    }

    await page.route('**/*', route => {
      const request = route.request();
      const resourceType = request.resourceType();

      if (resourceTypesToBlock.includes(resourceType)) {
        blockedCount++;
        return route.abort();
      }

      return route.continue();
    });

    const startTime = Date.now();
    console.log('[Benchmark] Starting page load...');

    const navStart = Date.now();
    await page.goto(WEBSITE_URL, { waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - navStart;
    console.log(`[Benchmark] Navigation (domcontentloaded): ${navTime}ms`);

    const networkStart = Date.now();
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const networkTime = Date.now() - networkStart;
    console.log(`[Benchmark] Network idle wait: ${networkTime}ms`);

    const totalTime = Date.now() - startTime;

    console.log(`\n[Optimized] Network Statistics:`);
    console.log(`  - Total requests initiated: ${requestCount}`);
    console.log(`  - Total responses received: ${responseCount}`);
    console.log(`  - Requests blocked: ${blockedCount}`);
    console.log(`  - Block rate: ${blockedCount > 0 ? ((blockedCount / requestCount) * 100).toFixed(1) : 0}%`);

    console.log(`\n[Optimized] Timing:`);
    console.log(`  - Navigation time: ${navTime}ms`);
    console.log(`  - Network idle wait: ${networkTime}ms`);
    console.log(`  - Total time: ${totalTime}ms`);

    await page.waitForTimeout(2000);

    const itemCount = await page.locator('role=listitem').count();
    console.log(`\n[Optimized] Page Rendering:`);
    console.log(`  - List items found: ${itemCount}`);

    await context.close();

    return {
      name: 'Optimized',
      navTime,
      networkTime,
      totalTime,
      requestCount,
      responseCount,
      blockedCount,
      itemCount,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('\n' + '='.repeat(55));
  console.log('HUNYUAN DOWNLOADER OPTIMIZATION BENCHMARK');
  console.log('='.repeat(55));
  console.log(`Testing ${WEBSITE_URL}`);
  console.log('='.repeat(55));

  try {
    const original = await benchmarkOriginal();
    await new Promise(resolve => setTimeout(resolve, 3000));
    const optimized = await benchmarkOptimized();

    console.log('\n' + '='.repeat(55));
    console.log('BENCHMARK RESULTS SUMMARY');
    console.log('='.repeat(55) + '\n');

    console.log('Navigation Time (domcontentloaded):');
    console.log(`  Original:  ${original.navTime}ms`);
    console.log(`  Optimized: ${optimized.navTime}ms`);
    const navImprovement = ((original.navTime - optimized.navTime) / original.navTime * 100).toFixed(1);
    console.log(`  Improvement: ${navImprovement}% faster ${navImprovement > 0 ? '✓' : '✗'}`);

    console.log('\nNetwork Idle Wait:');
    console.log(`  Original:  ${original.networkTime}ms`);
    console.log(`  Optimized: ${optimized.networkTime}ms`);
    const networkImprovement = ((original.networkTime - optimized.networkTime) / original.networkTime * 100).toFixed(1);
    console.log(`  Improvement: ${networkImprovement}% faster ${networkImprovement > 0 ? '✓' : '✗'}`);

    console.log('\nTotal Page Load Time:');
    console.log(`  Original:  ${original.totalTime}ms`);
    console.log(`  Optimized: ${optimized.totalTime}ms`);
    const totalImprovement = ((original.totalTime - optimized.totalTime) / original.totalTime * 100).toFixed(1);
    console.log(`  Improvement: ${totalImprovement}% faster ${totalImprovement > 0 ? '✓' : '✗'}`);

    console.log('\nNetwork Request Statistics:');
    console.log(`  Original  - Requests: ${original.requestCount}, Responses: ${original.responseCount}, Blocked: ${original.blockedCount}`);
    console.log(`  Optimized - Requests: ${optimized.requestCount}, Responses: ${optimized.responseCount}, Blocked: ${optimized.blockedCount}`);
    const reqReduction = ((original.requestCount - optimized.requestCount) / original.requestCount * 100).toFixed(1);
    console.log(`  Request reduction: ${reqReduction}% fewer ${reqReduction > 0 ? '✓' : '✗'}`);

    console.log('\nPage Rendering:');
    console.log(`  Original  - List items: ${original.itemCount}`);
    console.log(`  Optimized - List items: ${optimized.itemCount}`);
    console.log(`  Rendering consistency: ${original.itemCount === optimized.itemCount ? '✓ MATCH' : '✗ MISMATCH'}`);

    console.log('\n' + '='.repeat(55));
    console.log('SUMMARY');
    console.log('='.repeat(55));
    if (totalImprovement > 50) {
      console.log('✓✓✓ EXCELLENT OPTIMIZATION - 50%+ speedup achieved');
    } else if (totalImprovement > 30) {
      console.log('✓✓ GOOD OPTIMIZATION - 30%+ speedup achieved');
    } else if (totalImprovement > 0) {
      console.log('✓ MODERATE OPTIMIZATION - measurable speedup');
    } else {
      console.log('⚠ No improvement detected');
    }
    console.log(`Overall speedup: ${totalImprovement}%`);
    console.log('='.repeat(55) + '\n');

  } catch (e) {
    console.error('[Error]', e.message);
    process.exit(1);
  }
}

main();
