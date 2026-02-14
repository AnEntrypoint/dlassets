/**
 * API-Based Hunyuan 3D Asset Downloader
 *
 * Bypasses broken /assets page UI by working directly with APIs
 * - Fetches asset count and list via API
 * - Extracts asset URLs and IDs using regex (avoids 29MB JSON parse timeout)
 * - Downloads each asset directly
 * - No browser UI interaction needed
 *
 * Usage: node api-downloader.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const BASEURL = 'https://3d.hunyuan.tencent.com';

class APIDownloader {
  constructor() {
    this.session = null;
    this.cookies = {};
    this.assetIds = [];
    this.downloadedCount = 0;
    this.failedCount = 0;
    this.startTime = Date.now();
  }

  log(tag, msg) {
    const time = new Date().toISOString().substring(11, 19);
    console.log(`[${time}] [${tag}] ${msg}`);
  }

  loadSession() {
    try {
      if (!fs.existsSync(SESSION_FILE)) {
        this.log('Session', '✗ No session file found');
        return false;
      }

      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (!data.cookies || data.cookies.length === 0) {
        this.log('Session', '✗ No cookies in session');
        return false;
      }

      data.cookies.forEach(cookie => {
        this.cookies[cookie.name] = cookie.value;
      });

      this.log('Session', `✓ Loaded ${data.cookies.length} cookies`);
      return true;
    } catch (e) {
      this.log('Session', `✗ Error: ${e.message.substring(0, 80)}`);
      return false;
    }
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  request(method, pathname, options = {}) {
    return new Promise((resolve, reject) => {
      const requestUrl = url.parse(`${BASEURL}${pathname}`);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': this.getCookieHeader(),
        'Accept': 'application/json',
        ...options.headers
      };

      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }

      const requestOptions = {
        hostname: requestUrl.hostname,
        port: requestUrl.port || 443,
        path: requestUrl.path,
        method: method,
        headers,
        timeout: 120000
      };

      const client = requestUrl.protocol === 'https:' ? https : http;
      const req = client.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async getAssetCount() {
    try {
      this.log('API', 'Fetching asset count...');
      const res = await this.request('POST', '/api/3d/creations/list', {
        body: { pageSize: 1 }
      });

      if (res.status !== 200) {
        this.log('API', `✗ Count API returned ${res.status}`);
        return 0;
      }

      // Try to parse full response to get count
      try {
        const json = JSON.parse(res.data);
        const count = json.result?.total || json.total || 0;
        this.log('API', `✓ Asset count: ${count}`);
        return count;
      } catch {
        // Fallback: extract from partial data
        const match = res.data.match(/"total"\s*:\s*(\d+)/);
        const count = match ? parseInt(match[1]) : 0;
        this.log('API', `✓ Asset count (regex): ${count}`);
        return count;
      }
    } catch (e) {
      this.log('API', `✗ Error: ${e.message.substring(0, 80)}`);
      return 0;
    }
  }

  async getAssetList() {
    try {
      this.log('API', 'Fetching asset list (this may take a moment)...');
      const res = await this.request('POST', '/api/3d/creations/list', {
        body: { pageSize: 1000 }
      });

      if (res.status !== 200) {
        this.log('API', `✗ List API returned ${res.status}`);
        return [];
      }

      this.log('API', `✓ Got response (${(res.data.length / 1024 / 1024).toFixed(1)} MB)`);

      // Extract all download URLs using regex - avoids full JSON parse timeout
      const urls = [];
      const urlPattern = /"downloadUrl"\s*:\s*"([^"]+\.usdz[^"]*)"/gi;
      let match;

      while ((match = urlPattern.exec(res.data)) !== null) {
        urls.push(match[1]);
      }

      this.log('API', `✓ Extracted ${urls.length} asset URLs via regex`);
      return urls;
    } catch (e) {
      this.log('API', `✗ Error: ${e.message.substring(0, 80)}`);
      return [];
    }
  }

  async downloadAsset(assetUrl, index, total) {
    try {
      if (!assetUrl.startsWith('http')) {
        assetUrl = BASEURL + assetUrl;
      }

      const filename = assetUrl.split('/').pop() || `asset-${index}.usdz`;
      const filepath = path.join(DOWNLOADS_DIR, filename);

      // Check if already downloaded
      if (fs.existsSync(filepath)) {
        const stat = fs.statSync(filepath);
        if (stat.size > 0) {
          this.log(`Asset`, `✓ Already downloaded: ${filename} (${(stat.size/1024/1024).toFixed(2)} MB)`);
          return true;
        }
      }

      this.log(`Asset`, `[${index}/${total}] Downloading ${filename}...`);

      return new Promise((resolve) => {
        const client = assetUrl.startsWith('https') ? https : http;
        const request = client.get(assetUrl, { timeout: 180000 }, (res) => {
          if (res.statusCode !== 200) {
            this.log(`Asset`, `✗ [${index}/${total}] HTTP ${res.statusCode}`);
            resolve(false);
            return;
          }

          const file = fs.createWriteStream(filepath);
          let downloaded = 0;

          res.on('data', chunk => {
            downloaded += chunk.length;
            const progress = ((downloaded / 1024 / 1024).toFixed(2));
            process.stdout.write(`\r  [${index}/${total}] Downloading: ${progress} MB...`);
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            const stat = fs.statSync(filepath);
            console.log(`\r  [${index}/${total}] ✓ Downloaded: ${filename} (${(stat.size/1024/1024).toFixed(2)} MB)`);
            this.downloadedCount++;
            resolve(true);
          });

          file.on('error', (e) => {
            fs.unlink(filepath, () => {});
            this.log(`Asset`, `✗ [${index}/${total}] File write error: ${e.message.substring(0, 40)}`);
            resolve(false);
          });
        });

        request.on('error', (e) => {
          this.log(`Asset`, `✗ [${index}/${total}] Download error: ${e.message.substring(0, 40)}`);
          resolve(false);
        });

        request.on('timeout', () => {
          request.destroy();
          this.log(`Asset`, `✗ [${index}/${total}] Download timeout`);
          resolve(false);
        });
      });
    } catch (e) {
      this.log(`Asset`, `✗ [${index}/${total}] Error: ${e.message.substring(0, 80)}`);
      this.failedCount++;
      return false;
    }
  }

  async run() {
    console.log('\n═══════════════════════════════════════');
    console.log('  API-Based Hunyuan 3D Asset Downloader');
    console.log('═══════════════════════════════════════\n');

    // Ensure downloads directory exists
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      this.log('Init', `✓ Created downloads directory`);
    }

    // Load session
    if (!this.loadSession()) {
      this.log('Init', '✗ Cannot proceed without valid session');
      process.exit(1);
    }

    // Get asset count
    const count = await this.getAssetCount();
    if (count === 0) {
      this.log('API', 'No assets to download');
      return;
    }

    // Get asset list
    const assetUrls = await this.getAssetList();
    if (assetUrls.length === 0) {
      this.log('API', '✗ Failed to extract asset URLs');
      process.exit(1);
    }

    this.log('API', `Starting download of ${assetUrls.length} assets...`);

    // Download each asset
    let completed = 0;
    for (let i = 0; i < assetUrls.length; i++) {
      const success = await this.downloadAsset(assetUrls[i], i + 1, assetUrls.length);
      if (success) {
        completed++;
      } else {
        this.failedCount++;
      }

      // Brief delay between downloads
      if (i < assetUrls.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Summary
    const runtime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log('\n═══════════════════════════════════════');
    console.log(`  Download Summary`);
    console.log('═══════════════════════════════════════');
    console.log(`  Total Assets:     ${assetUrls.length}`);
    console.log(`  Downloaded:       ${this.downloadedCount}`);
    console.log(`  Failed:           ${this.failedCount}`);
    console.log(`  Runtime:          ${runtime}s`);
    console.log('═══════════════════════════════════════\n');

    if (this.failedCount === 0) {
      this.log('Status', '✓✓✓ ALL ASSETS DOWNLOADED SUCCESSFULLY ✓✓✓');
    } else {
      this.log('Status', `⚠ Download complete with ${this.failedCount} failures`);
    }
  }
}

new APIDownloader().run().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
