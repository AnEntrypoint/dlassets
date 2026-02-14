const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CacheManager {
  constructor(cacheDir = __dirname) {
    this.cacheDir = cacheDir;
    this.stats = {
      hits: {}, misses: {}, refreshes: {}, errors: {}
    };
    this.config = this.loadConfig();
    this.ensureCacheDir();
    global.cacheManager = this;
  }

  loadConfig() {
    const configPath = path.join(this.cacheDir, 'cache-config.json');
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      // Use defaults if config load fails
    }
    return {
      enableSessionCache: true,
      enableAssetListCache: true,
      enableDownloadMetadataCache: true,
      enablePageStateCache: true,
      assetListCacheTtlMinutes: 60,
      pageStateCacheTtlMinutes: 120,
      downloadMetadataCacheTtlMinutes: 30,
      retryQueueTtlHours: 24,
      autoCleanupOldCaches: true,
      cleanupIntervalDays: 7
    };
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getCachePath(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  isValidCache(key, ttlMinutes) {
    const cachePath = this.getCachePath(key);
    if (!fs.existsSync(cachePath)) {
      this.recordMiss(key);
      return false;
    }

    try {
      const stat = fs.statSync(cachePath);
      const ageMinutes = (Date.now() - stat.mtime.getTime()) / (1000 * 60);

      if (ageMinutes > ttlMinutes) {
        this.recordMiss(key, 'TTL expired');
        return false;
      }

      this.recordHit(key);
      return true;
    } catch (e) {
      this.recordError(key, e.message);
      return false;
    }
  }

  load(key, ttlMinutes = null) {
    const cachePath = this.getCachePath(key);

    if (ttlMinutes !== null && !this.isValidCache(key, ttlMinutes)) {
      return null;
    }

    try {
      if (fs.existsSync(cachePath)) {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (ttlMinutes === null) {
          this.recordHit(key);
        }
        return data;
      }
    } catch (e) {
      this.recordError(key, `Parse error: ${e.message}`);
      try {
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
      } catch {}
    }

    this.recordMiss(key);
    return null;
  }

  save(key, data) {
    const cachePath = this.getCachePath(key);
    try {
      const tempPath = cachePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, cachePath);
      this.recordRefresh(key);
      return true;
    } catch (e) {
      this.recordError(key, `Write error: ${e.message}`);
      return false;
    }
  }

  invalidate(key) {
    const cachePath = this.getCachePath(key);
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch (e) {
      this.recordError(key, `Delete error: ${e.message}`);
    }
  }

  recordHit(key) {
    if (!this.stats.hits[key]) this.stats.hits[key] = 0;
    this.stats.hits[key]++;
  }

  recordMiss(key, reason = '') {
    if (!this.stats.misses[key]) this.stats.misses[key] = 0;
    this.stats.misses[key]++;
  }

  recordRefresh(key) {
    if (!this.stats.refreshes[key]) this.stats.refreshes[key] = 0;
    this.stats.refreshes[key]++;
  }

  recordError(key, error) {
    if (!this.stats.errors[key]) this.stats.errors[key] = [];
    this.stats.errors[key].push({ timestamp: new Date().toISOString(), error });
  }

  saveStats() {
    const statsPath = path.join(this.cacheDir, 'cache-stats.json');
    const summary = {
      sessionCacheHits: this.stats.hits['browser-session'] || 0,
      assetListCacheHits: this.stats.hits['assets-list-cache'] || 0,
      downloadMetadataCacheHits: this.stats.hits['downloads-metadata'] || 0,
      pageStateCacheHits: this.stats.hits['page-state-cache'] || 0,
      totalHits: Object.values(this.stats.hits).reduce((a, b) => a + b, 0),
      totalMisses: Object.values(this.stats.misses).reduce((a, b) => a + b, 0),
      totalErrors: Object.keys(this.stats.errors).length,
      timestamp: new Date().toISOString()
    };
    try {
      fs.writeFileSync(statsPath, JSON.stringify(summary, null, 2), 'utf8');
    } catch (e) {
      // Stats write error - non-critical
    }
  }

  getStats() {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      refreshes: this.stats.refreshes,
      errors: this.stats.errors
    };
  }

  clearAll() {
    try {
      const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('-cache.json') || f.endsWith('-metadata.json') || f.endsWith('-queue.json'));
      files.forEach(f => {
        fs.unlinkSync(path.join(this.cacheDir, f));
      });
    } catch (e) {
      // Silently continue on clear error
    }
  }

  hashFile(filepath) {
    try {
      if (!fs.existsSync(filepath)) return null;
      const stat = fs.statSync(filepath);
      if (stat.size === 0) return null;

      const hash = crypto.createHash('sha256');
      const chunk = fs.readFileSync(filepath, null, 0, Math.min(1048576, stat.size));
      hash.update(chunk);
      return hash.digest('hex').substring(0, 16);
    } catch (e) {
      return null;
    }
  }
}

module.exports = CacheManager;
