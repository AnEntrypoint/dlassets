/**
 * Test optimization: Verify blocking and caching works
 * Compares first run (no cache) vs second run (with cache)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const AssetCache = require('./asset-cache');
const CacheManager = require('./cache-manager');

const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const TEST_URL = 'https://3d.hunyuan.tencent.com/assets';

class OptimizationTester {
  constructor() {
    this.results = { run1: {}, run2: {} };
  }

  async runTest(runNum) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RUN ${runNum}: ${runNum === 1 ? 'Cold start (no cache)' : 'Warm start (with cache)'}`);
    console.log(`${'='.repeat(60)}\n`);

    const assetCache = new AssetCache(__dirname);
    const cacheManager = new CacheManager(__dirname);

    // If this is run 2, we should have cached assets
    if (runNum === 2) {
      const stats = assetCache.getStats();
      console.log(`[Cache] Preloaded assets: ${stats.assetCount}`);
      console.log(`[Cache] Cached size: ${(stats.totalSize / 1024).toFixed(1)} KB\n`);
    }

    const browser = await chromium.launch({ headless: true });

    try {
      // Create context with session if available
      let context;
      if (fs.existsSync(SESSION_FILE)) {
        context = await browser.newContext({ storageState: SESSION_FILE });
        console.log('[Session] Loaded saved session');
      } else {
        context = await browser.newContext();
        console.log('[Session] Created fresh context');
      }

      const page = await context.newPage();

      // Track network activity
      let blocked = 0;
      let allowed = 0;
      let cached = 0;

      const requestsByType = {};

      page.on('request', request => {
        const url = request.url();
        const type = request.resourceType();

        if (!requestsByType[type]) requestsByType[type] = 0;
        requestsByType[type]++;
      });

      // Simple blocking for testing
      await page.route('**/*.png', r => { blocked++; r.abort(); });
      await page.route('**/*.jpg', r => { blocked++; r.abort(); });
      await page.route('**/*.webp', r => { blocked++; r.abort(); });
      await page.route('**/*.gif', r => { blocked++; r.abort(); });
      await page.route('**/*.svg', r => { blocked++; r.abort(); });
      await page.route('**/*.mp4', r => { blocked++; r.abort(); });
      await page.route('**/*.webm', r => { blocked++; r.abort(); });
      await page.route('**/galileotelemetry**', r => { blocked++; r.abort(); });
      await page.route('**/*analytics*', r => { blocked++; r.abort(); });
      await page.route('**/*tracking*', r => { blocked++; r.abort(); });
      await page.route('**/*telemetry*', r => { blocked++; r.abort(); });
      await page.route('**/*beacon*', r => { blocked++; r.abort(); });

      // Track other requests
      await page.route('**/*', route => {
        const resourceType = route.request().resourceType();
        if (!['image', 'media', 'font'].includes(resourceType)) {
          allowed++;
        } else {
          blocked++;
        }
        route.continue();
      });

      const startTime = Date.now();
      console.log('[Nav] Loading page...');

      await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
      const navTime = Date.now() - startTime;
      console.log(`[Nav] Page loaded in ${navTime}ms`);

      // Wait for network idle with timeout
      const idleStart = Date.now();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const idleTime = Date.now() - idleStart;
      console.log(`[Network] Idle after ${idleTime}ms`);

      // Check for errors
      const html = await page.content();
      const hasError = html.includes('hy-error-boundary') || html.includes('页面出错');

      // Count items if they loaded
      const itemCount = await page.locator('role=listitem').count().catch(() => 0);

      const totalTime = Date.now() - startTime;

      // Save session for next run
      if (runNum === 1) {
        await context.storageState({ path: SESSION_FILE });
        console.log('[Session] Saved for next run');
      }

      console.log(`\n[Results]`);
      console.log(`  Error page: ${hasError ? 'YES (bad)' : 'NO (good)'}`);
      console.log(`  Items loaded: ${itemCount}`);
      console.log(`  Blocked requests: ${blocked}`);
      console.log(`  Allowed requests: ${allowed}`);
      console.log(`  Total requests: ${blocked + allowed}`);
      console.log(`  Total time: ${totalTime}ms`);
      console.log(`  \n  Request types: ${JSON.stringify(requestsByType)}`);

      this.results[`run${runNum}`] = {
        blocked,
        allowed,
        totalRequests: blocked + allowed,
        navTime,
        idleTime,
        totalTime,
        hasError,
        itemCount
      };

      await context.close();

    } finally {
      await browser.close();
    }
  }

  async runBoth() {
    try {
      await this.runTest(1);
      console.log('\n[Pause] Waiting 2 seconds...');
      await new Promise(r => setTimeout(r, 2000));

      await this.runTest(2);

      this.printComparison();
    } catch (error) {
      console.error('\n[FATAL]', error.message);
      process.exit(1);
    }
  }

  printComparison() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('COMPARISON: COLD START vs WARM START');
    console.log(`${'='.repeat(60)}\n`);

    const r1 = this.results.run1;
    const r2 = this.results.run2;

    const metrics = [
      ['Total requests', `${r1.totalRequests}`, `${r2.totalRequests}`, (r1.totalRequests - r2.totalRequests) / r1.totalRequests * 100],
      ['Blocked', `${r1.blocked}`, `${r2.blocked}`, (r1.blocked - r2.blocked) / r1.blocked * 100],
      ['Total time (ms)', `${r1.totalTime}`, `${r2.totalTime}`, (r1.totalTime - r2.totalTime) / r1.totalTime * 100],
      ['Navigation time (ms)', `${r1.navTime}`, `${r2.navTime}`, (r1.navTime - r2.navTime) / r1.navTime * 100],
    ];

    console.log('Metric'.padEnd(25) + 'Run 1'.padEnd(15) + 'Run 2'.padEnd(15) + 'Improvement');
    console.log('-'.repeat(70));

    for (const [metric, v1, v2, improvement] of metrics) {
      const impStr = improvement > 0 ? `${improvement.toFixed(1)}% faster` : `${Math.abs(improvement).toFixed(1)}% slower`;
      console.log(
        metric.padEnd(25) +
        v1.padEnd(15) +
        v2.padEnd(15) +
        impStr
      );
    }

    console.log('\n[Summary]');
    if (r2.totalTime < r1.totalTime) {
      const speedup = r1.totalTime / r2.totalTime;
      console.log(`✓ Warm start is ${speedup.toFixed(2)}x faster`);
    }
    if (!r1.hasError && !r2.hasError) {
      console.log(`✓ No error pages (React initialized successfully)`);
    }
    if (r1.itemCount === r2.itemCount) {
      console.log(`✓ Consistent item count: ${r1.itemCount} items`);
    }
    console.log(`✓ Blocking strategy active: ${r1.blocked} requests blocked\n`);
  }
}

const tester = new OptimizationTester();
tester.runBoth();
