const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * AssetCache - Intelligent caching for web assets (CSS, JS, fonts)
 *
 * Caches static assets that have cache-busting versions in URLs.
 * Uses URL hash/version matching to detect when assets change.
 * Supports both hash-based (file123abc.js) and versioned URLs (file.js?v=123).
 */
class AssetCache {
  constructor(cacheDir = __dirname) {
    this.cacheDir = cacheDir;
    this.assetCachePath = path.join(cacheDir, 'asset-cache.json');
    this.assets = this.loadCache();
    this.stats = { hits: 0, misses: 0, saved: 0 };
  }

  loadCache() {
    try {
      if (fs.existsSync(this.assetCachePath)) {
        const data = JSON.parse(fs.readFileSync(this.assetCachePath, 'utf8'));
        // Cleanup old entries (>48 hours)
        const now = Date.now();
        const cleaned = {};
        for (const [key, val] of Object.entries(data)) {
          if (now - val.timestamp < 48 * 60 * 60 * 1000) {
            cleaned[key] = val;
          }
        }
        return cleaned;
      }
    } catch (e) {
      // Ignore cache load errors
    }
    return {};
  }

  /**
   * Generate cache key from URL
   * Extracts the meaningful part to detect asset changes
   */
  getCacheKey(url) {
    try {
      const urlObj = new URL(url);
      // For URLs with hash/version in filename (e.g., file.abc123.js)
      // or query string (e.g., file.js?v=123)
      const pathname = urlObj.pathname;
      const search = urlObj.search;
      // Combine path and query to catch cache-busting
      return pathname + search;
    } catch {
      return url;
    }
  }

  /**
   * Check if cached asset is fresh
   * Assets are considered fresh if URL hasn't changed (content hash in URL)
   */
  isFresh(url, contentType) {
    const key = this.getCacheKey(url);
    const cached = this.assets[key];

    if (!cached) return false;

    // Check type matches
    if (cached.contentType !== contentType) return false;

    // Check age - allow CSS/JS for 48 hours if hash is in URL
    const age = Date.now() - cached.timestamp;
    const maxAge = this.hasVersionInUrl(url) ? 48 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    if (age > maxAge) return false;

    this.stats.hits++;
    return true;
  }

  /**
   * Check if URL has cache-busting version (hash or query param)
   */
  hasVersionInUrl(url) {
    // Check for hash in filename: file.abc123def.js
    if (/\.[a-f0-9]{8,}\./i.test(url)) return true;
    // Check for version query param: file.js?v=123 or file.js?hash=abc123
    if (/[\?&](v=|hash=|version=)/i.test(url)) return true;
    return false;
  }

  /**
   * Get cached asset content
   */
  get(url, contentType) {
    if (!this.isFresh(url, contentType)) {
      this.stats.misses++;
      return null;
    }

    const key = this.getCacheKey(url);
    return this.assets[key].content;
  }

  /**
   * Store asset in cache
   */
  set(url, content, contentType) {
    const key = this.getCacheKey(url);
    this.assets[key] = {
      url,
      contentType,
      content,
      timestamp: Date.now(),
      size: content.length
    };
    this.stats.saved++;
    this.saveCache();
  }

  /**
   * Save cache to disk
   */
  saveCache() {
    try {
      const tempPath = this.assetCachePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.assets, null, 2), 'utf8');
      fs.renameSync(tempPath, this.assetCachePath);
    } catch (e) {
      // Silently fail on cache write
    }
  }

  /**
   * Clear all cached assets
   */
  clear() {
    this.assets = {};
    try {
      if (fs.existsSync(this.assetCachePath)) {
        fs.unlinkSync(this.assetCachePath);
      }
    } catch (e) {
      // Silently fail on clear
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalSize = Object.values(this.assets).reduce((sum, a) => sum + (a.size || 0), 0);
    return {
      ...this.stats,
      totalSize,
      assetCount: Object.keys(this.assets).length
    };
  }
}

module.exports = AssetCache;
