const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function downloadAssetsV2() {
  console.log('[DOWNLOADER V2] Smart Asset Download System\n');
  console.log('=' .repeat(70));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.createContext({
    storageState: path.join(process.cwd(), 'browser-session.json'),
  });
  const page = await context.newPage();

  const downloadDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  let downloadedCount = 0;
  let failedAssets = [];

  try {
    // Step 1: Establish session
    console.log('\n[STEP 1] Establishing authenticated session...');
    await page.goto('https://3d.hunyuan.tencent.com/assets', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Get cookies to use for API calls
    const cookies = await context.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[OK] Got ${cookies.length} auth cookies\n`);

    // Step 2: Fetch asset list from API
    console.log('[STEP 2] Fetching asset list from API...');

    const assetData = await page.evaluate(async () => {
      try {
        const resp = await fetch('https://3d.hunyuan.tencent.com/api/3d/creations/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });

        const text = await resp.text();

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');

        const data = JSON.parse(jsonMatch[0]);

        return {
          totalCount: data.totalCount,
          assets: (data.creations || []).map(c => ({
            id: c.id,
            name: c.name || `asset_${c.id.substring(0, 8)}`,
            url: c.downloadUrl || `/api/3d/creations/${c.id}/download`,
            status: c.status,
            type: c.modelType || c.sceneType || 'unknown',
          })),
        };
      } catch (err) {
        return { error: err.message, assets: [] };
      }
    });

    if (assetData.error) {
      console.error(`[ERROR] Failed to fetch asset list: ${assetData.error}`);
      throw new Error('Asset API call failed');
    }

    console.log(`[OK] Found ${assetData.assets.length} assets (total: ${assetData.totalCount})\n`);

    // Step 3: Download assets using browser's download mechanism
    console.log('[STEP 3] Downloading assets...\n');

    for (let i = 0; i < Math.min(15, assetData.assets.length); i++) {
      const asset = assetData.assets[i];
      const displayNum = `${i+1}/${Math.min(15, assetData.assets.length)}`;

      console.log(`[${displayNum}] ${asset.name} (${asset.type})`);

      try {
        // Navigate to the asset's detail page to trigger download
        const detailUrl = `https://3d.hunyuan.tencent.com/assets/${asset.id}`;

        // Use browser's download mechanism
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

        // Navigate to detail page - this might trigger download or show detail view
        const navigationPromise = page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
        await navigationPromise;

        // Wait a bit for download to complete
        await page.waitForTimeout(2000);

        // Check if we got a download
        const download = await downloadPromise;

        if (download) {
          // Got a download event
          const filename = download.suggestedFilename();
          const filepath = path.join(downloadDir, filename);
          await download.saveAs(filepath);

          const stat = fs.statSync(filepath);
          console.log(`     ✓ Downloaded: ${filename} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
          downloadedCount++;
        } else {
          // No download event - try direct API download
          console.log(`     → No download event, trying direct API...`);

          const apiResult = await page.evaluate(async (url) => {
            try {
              const resp = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Accept': 'application/octet-stream',
                },
              });

              if (resp.ok) {
                const blob = await resp.blob();
                const disposition = resp.headers.get('content-disposition');
                let filename = `asset_${Date.now()}.usdz`;

                if (disposition && disposition.includes('filename')) {
                  const match = disposition.match(/filename[^;=\n]*=(["\']?)([^"\'\n]*)\1/);
                  if (match && match[2]) {
                    filename = match[2];
                  }
                }

                // Create download link in browser
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                return { success: true, filename, size: blob.size };
              } else {
                return { success: false, status: resp.status };
              }
            } catch (err) {
              return { success: false, error: err.message };
            }
          }, asset.url);

          if (apiResult.success) {
            // Wait for download to complete
            await page.waitForTimeout(2000);

            // Try to find the downloaded file
            const expectedPath = path.join(downloadDir, apiResult.filename);
            if (fs.existsSync(expectedPath)) {
              console.log(`     ✓ Downloaded: ${apiResult.filename} (${(apiResult.size / 1024 / 1024).toFixed(2)} MB)`);
              downloadedCount++;
            } else {
              console.log(`     ✗ Download triggered but file not found`);
              failedAssets.push(asset.name);
            }
          } else {
            console.log(`     ✗ API download failed: ${apiResult.error || `HTTP ${apiResult.status}`}`);
            failedAssets.push(asset.name);
          }
        }

      } catch (err) {
        console.log(`     ✗ Error: ${err.message}`);
        failedAssets.push(asset.name);
      }

      // Add small delay between downloads
      await page.waitForTimeout(500);
    }

    // Step 4: Report results
    console.log('\n' + '=' .repeat(70));
    console.log(`\n[FINAL REPORT]\n`);
    console.log(`Downloaded: ${downloadedCount} assets`);
    console.log(`Failed: ${failedAssets.length} assets`);
    console.log(`Directory: ${downloadDir}\n`);

    if (failedAssets.length > 0 && failedAssets.length <= 10) {
      console.log(`Failed assets:`);
      failedAssets.forEach(name => console.log(`  - ${name}`));
      console.log();
    }

    const files = fs.readdirSync(downloadDir);
    console.log(`Files in download directory (${files.length} total):`);
    let totalSize = 0;
    files.slice(0, 15).forEach(f => {
      const stat = fs.statSync(path.join(downloadDir, f));
      totalSize += stat.size;
      console.log(`  - ${f} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
    });
    if (files.length > 15) {
      console.log(`  ... and ${files.length - 15} more files`);
    }
    console.log(`\nTotal size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  } catch (err) {
    console.error('[FATAL ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await context.close();
    await browser.close();
  }
}

downloadAssetsV2().catch(console.error);
