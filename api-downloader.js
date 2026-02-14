/**
 * Direct API Asset Downloader
 *
 * Bypasses the broken /assets UI page and downloads directly from API.
 * Uses session cookies from browser-session.json for authentication.
 *
 * Usage:
 *   node api-downloader.js          - Download all assets
 *   node api-downloader.js --verify - Just verify count
 *   node api-downloader.js --list   - List assets without downloading
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'browser-session.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const API_BASE = 'https://3d.hunyuan.tencent.com/api/3d/creations';

class APIDownloader {
  constructor() {
    this.cookies = [];
    this.downloadedCount = 0;
    this.failedCount = 0;
  }

  loadSession() {
    if (!fs.existsSync(SESSION_FILE)) {
      throw new Error('No session file. Browser session required.');
    }

    try {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      this.cookies = data.cookies || [];

      if (this.cookies.length === 0) {
        throw new Error('No cookies in session file');
      }

      console.log(`[Session] Loaded ${this.cookies.length} cookies`);
      return true;
    } catch (e) {
      throw new Error(`Failed to load session: ${e.message}`);
    }
  }

  getCookieString() {
    return this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  apiRequest(endpoint, method = 'POST', body = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const cookieStr = this.getCookieString();

      const options = {
        hostname: '3d.hunyuan.tencent.com',
        path: `/api/3d/creations${endpoint}`,
        method: method,
        headers: {
          'Cookie': cookieStr,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      };

      console.log(`[API] ${method} ${endpoint}`);

      const req = https.request(options, (res) => {
        console.log(`[API] Response: ${res.statusCode}`);

        let data = '';
        let chunks = 0;

        res.on('data', (chunk) => {
          data += chunk;
          chunks++;
          if (chunks % 1000 === 0) {
            process.stdout.write('.');
          }
        });

        res.on('end', () => {
          if (chunks > 1000) console.log('');

          if (res.statusCode !== 200 && res.statusCode !== 201) {
            console.log(`[API] Status error: ${res.statusCode}`);
            return resolve({ error: `HTTP ${res.statusCode}` });
          }

          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            console.log(`[API] Parse error: ${e.message}`);
            resolve({ error: 'JSON parse error', size: data.length });
          }
        });
      });

      req.on('error', (e) => {
        console.log(`[API] Request error: ${e.message}`);
        reject(e);
      });

      req.setTimeout(timeout, () => {
        console.log(`[API] Timeout after ${timeout}ms`);
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        const bodyStr = JSON.stringify(body);
        req.write(bodyStr);
      }

      req.end();
    });
  }

  extractAssetIds(jsonStr) {
    const ids = new Set();
    // More specific regex to avoid false matches
    const regex = /"id"\s*:\s*"([a-f0-9]{32})"/g;
    let match;
    let count = 0;

    while ((match = regex.exec(jsonStr)) !== null) {
      ids.add(match[1]);
      count++;
      if (count % 100 === 0) {
        process.stdout.write('.');
      }
    }

    if (count > 0) console.log('');
    return Array.from(ids);
  }

  async getAssetCount() {
    console.log('\n[Count] Fetching asset count...');
    try {
      const response = await this.apiRequest('/count', 'POST', {});

      if (response.error) {
        console.log(`[Count] Error: ${response.error}`);
        return null;
      }

      const count = response.data?.count || response.count || 0;
      console.log(`[Count] Total assets: ${count}`);
      return count;
    } catch (e) {
      console.log(`[Count] Failed: ${e.message}`);
      return null;
    }
  }

  async listAssets() {
    console.log('\n[List] Fetching asset list...');
    try {
      const response = await this.apiRequest('/list', 'POST', {});

      if (response.error) {
        console.log(`[List] Error: ${response.error}`);
        return [];
      }

      const responseStr = JSON.stringify(response);
      const ids = this.extractAssetIds(responseStr);

      console.log(`[List] Extracted ${ids.length} asset IDs`);

      if (ids.length > 0) {
        console.log(`[List] Sample IDs:`);
        ids.slice(0, 5).forEach(id => console.log(`  - ${id}`));
        if (ids.length > 5) console.log(`  ... and ${ids.length - 5} more`);
      }

      return ids;
    } catch (e) {
      console.log(`[List] Failed: ${e.message}`);
      return [];
    }
  }

  async downloadAsset(assetId) {
    console.log(`[Download] Starting for ${assetId}...`);

    try {
      // First, get asset metadata
      const metaResponse = await this.apiRequest(`/${assetId}`, 'GET');

      if (metaResponse.error) {
        console.log(`[Download] No metadata for ${assetId}`);
        this.failedCount++;
        return false;
      }

      // For actual download, use the direct download endpoint
      const downloadUrl = `/api/3d/creations/${assetId}/download`;

      const cookieStr = this.getCookieString();
      const downloadOptions = {
        hostname: '3d.hunyuan.tencent.com',
        path: downloadUrl,
        method: 'GET',
        headers: {
          'Cookie': cookieStr,
          'User-Agent': 'Mozilla/5.0'
        }
      };

      return new Promise((resolve) => {
        const req = https.request(downloadOptions, (res) => {
          if (res.statusCode === 404 || res.statusCode === 403) {
            console.log(`[Download] Not available (${res.statusCode})`);
            this.failedCount++;
            resolve(false);
            return;
          }

          if (res.statusCode !== 200) {
            console.log(`[Download] Status ${res.statusCode}`);
            this.failedCount++;
            resolve(false);
            return;
          }

          // Get filename from content-disposition or use asset ID
          let filename = assetId + '.usdz';
          const contentDisp = res.headers['content-disposition'];
          if (contentDisp) {
            const match = contentDisp.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
          }

          if (!fs.existsSync(DOWNLOADS_DIR)) {
            fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
          }

          const filepath = path.join(DOWNLOADS_DIR, filename);
          const file = fs.createWriteStream(filepath);

          res.pipe(file);
          file.on('finish', () => {
            file.close();
            const size = fs.statSync(filepath).size;
            console.log(`[Download] ✓ ${filename} (${size} bytes)`);
            this.downloadedCount++;
            resolve(true);
          });
        });

        req.on('error', (e) => {
          console.log(`[Download] Error: ${e.message}`);
          this.failedCount++;
          resolve(false);
        });

        req.setTimeout(300000, () => {
          req.destroy();
          console.log(`[Download] Timeout`);
          this.failedCount++;
          resolve(false);
        });

        req.end();
      });
    } catch (e) {
      console.log(`[Download] Exception: ${e.message}`);
      this.failedCount++;
      return false;
    }
  }

  async run() {
    console.log('=== API Downloader ===\n');

    try {
      this.loadSession();

      const mode = process.argv[2] || '--download';

      if (mode === '--verify') {
        const count = await this.getAssetCount();
        console.log(`\n[Result] Asset count: ${count}`);
        return;
      }

      if (mode === '--list') {
        const ids = await this.listAssets();
        console.log(`\n[Result] Found ${ids.length} assets`);
        return;
      }

      // Default: download mode
      const count = await this.getAssetCount();
      if (count === null || count === 0) {
        console.log('\n[Result] No assets to download');
        return;
      }

      const ids = await this.listAssets();
      if (ids.length === 0) {
        console.log('\n[Result] Could not extract asset IDs');
        return;
      }

      console.log(`\n[Download] Starting to download ${Math.min(4, ids.length)} assets...`);
      for (let i = 0; i < Math.min(4, ids.length); i++) {
        await this.downloadAsset(ids[i]);
        if (i < Math.min(4, ids.length) - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      console.log(`\n[Result] Downloaded: ${this.downloadedCount}, Failed: ${this.failedCount}`);
    } catch (e) {
      console.error(`[Error] ${e.message}`);
      process.exit(1);
    }
  }
}

new APIDownloader().run().catch(console.error);
