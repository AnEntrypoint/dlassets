const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

async function downloadAssets() {
  console.log('[DOWNLOADER] Asset Download System - API-Based Approach\n');
  console.log('=' .repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.createContext({
    storageState: path.join(process.cwd(), 'browser-session.json'),
  });
  const page = await context.newPage();

  const downloadDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  try {
    // Step 1: Navigate to assets page to establish session
    console.log('\n[STEP 1] Establishing session on /assets page...');
    await page.goto('https://3d.hunyuan.tencent.com/assets', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    console.log('[OK] Session established\n');

    // Step 2: Fetch asset list from API
    console.log('[STEP 2] Fetching asset list from API...');
    const assetList = await page.evaluate(async () => {
      try {
        const resp = await fetch('https://3d.hunyuan.tencent.com/api/3d/creations/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        // Parse response
        const text = await resp.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          throw new Error('Could not extract JSON from response');
        }

        const data = JSON.parse(match[0]);
        return {
          totalCount: data.totalCount,
          assets: data.creations.map(c => ({
            id: c.id,
            name: c.name || 'Unnamed',
            previewUrl: c.previewUrl,
            status: c.status,
          })),
        };
      } catch (err) {
        return { error: err.message };
      }
    });

    if (assetList.error) {
      console.error(`[ERROR] Failed to fetch asset list: ${assetList.error}`);
      throw new Error('Failed to fetch asset list');
    }

    console.log(`[OK] Found ${assetList.assets.length} assets (total: ${assetList.totalCount})\n`);

    // Step 3: Attempt to download each asset
    console.log('[STEP 3] Starting downloads...\n');

    let downloadedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < Math.min(10, assetList.assets.length); i++) {
      const asset = assetList.assets[i];
      console.log(`[${i+1}/${Math.min(10, assetList.assets.length)}] Asset: "${asset.name}" (ID: ${asset.id})`);

      try {
        // Try to access download endpoint
        const downloadUrl = `https://3d.hunyuan.tencent.com/api/3d/creations/${asset.id}/download`;

        console.log(`     Attempting download from: ${downloadUrl}`);

        const result = await page.evaluate(async (url) => {
          try {
            const resp = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              timeout: 30000,
            });

            if (resp.ok) {
              const blob = await resp.blob();
              return {
                success: true,
                size: blob.size,
                type: resp.headers.get('content-type'),
                contentDisposition: resp.headers.get('content-disposition'),
              };
            } else {
              return {
                success: false,
                status: resp.status,
                message: await resp.text(),
              };
            }
          } catch (err) {
            return { success: false, error: err.message };
          }
        }, downloadUrl);

        if (result.success) {
          console.log(`     ✓ Downloaded: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
          downloadedCount++;

          // Try to get the file from browser's download event
          const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);

          // Trigger download via link
          await page.evaluate((url) => {
            const a = document.createElement('a');
            a.href = url;
            a.download = true;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }, downloadUrl);

          const download = await downloadPromise;
          if (download) {
            const filename = download.suggestedFilename();
            const filepath = path.join(downloadDir, filename);
            await download.saveAs(filepath);
            console.log(`     Saved: ${filename}`);
          }
        } else {
          console.log(`     ✗ Failed: HTTP ${result.status || 'error'}`);
          if (result.message) {
            console.log(`     Message: ${result.message.substring(0, 100)}`);
          }
          failedCount++;
        }
      } catch (err) {
        console.log(`     ✗ Error: ${err.message}`);
        failedCount++;
      }

      console.log();
    }

    // Step 4: Report results
    console.log('=' .repeat(60));
    console.log(`\n[RESULTS]\n`);
    console.log(`Downloaded: ${downloadedCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Directory: ${downloadDir}`);

    const files = fs.readdirSync(downloadDir);
    if (files.length > 0) {
      console.log(`\nFiles in download directory:`);
      files.forEach(f => {
        const stat = fs.statSync(path.join(downloadDir, f));
        console.log(`  - ${f} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
      });
    }

  } catch (err) {
    console.error('[FATAL ERROR]', err.message);
    console.error(err.stack);
  } finally {
    await context.close();
    await browser.close();
    console.log('\n[DONE] Downloader finished');
  }
}

downloadAssets().catch(console.error);
